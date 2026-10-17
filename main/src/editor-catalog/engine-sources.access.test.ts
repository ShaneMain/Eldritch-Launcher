import { describe, expect, it, vi } from 'vitest';
import { EngineSourcesService } from './engine-sources.service.js';
import { EngineSourceAuthError } from './github-source.errors.js';
import type { GithubRepositoryRef } from './github-source-access.service.js';

vi.mock('@mariodebono/di', () => ({ Injectable: () => () => undefined }));
vi.mock('./engine-sources.store.js', () => ({ EngineSourcesStore: class {} }));
vi.mock('./github-source-access.service.js', () => ({
    GithubSourceAccessService: class {},
}));

// Carries both input shapes so the test holds for owner/repo and URL input.
const PRIVATE_REPOSITORY_INPUT = {
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    url: 'https://github.com/Eldritch-Game-Studio/Eldritch-Engine',
} as never;

/**
 * Creates the service with a repository probe that GitHub refuses, as it
 * does for a private repository the caller cannot see.
 *
 * @param token - Token the GitHub login lends, or null when signed out.
 * @returns The service and its store.
 */
function createService(token: string | null) {
    const store = {
        read: vi.fn(async () => ({ forks: [] })),
        update: vi.fn(),
    };
    const access = {
        withToken: vi.fn(
            <T>(operation: (value: string | null) => Promise<T>): Promise<T> =>
                operation(token),
        ),
        request: vi.fn(
            async (
                _path: string,
                requestToken: string | null,
                repository: GithubRepositoryRef,
            ) => {
                expect(repository.requiresAuth).toBe(true);
                throw new EngineSourceAuthError(
                    `${repository.owner}/${repository.repo}`,
                    requestToken !== null,
                );
            },
        ),
    };
    return {
        service: new EngineSourcesService(store as never, access as never),
        store,
    };
}
describe('EngineSourcesService.add', () => {
    it('asks a signed-out user to sign in for a repository GitHub hides', async () => {
        const { service, store } = createService(null);

        await expect(service.add(PRIVATE_REPOSITORY_INPUT)).resolves.toEqual({
            ok: false,
            reason: 'auth-required',
        });
        expect(store.update).not.toHaveBeenCalled();
    });

    it('reports no-access when GitHub hides the repository from a signed-in user', async () => {
        const { service, store } = createService('ghu_token');

        await expect(service.add(PRIVATE_REPOSITORY_INPUT)).resolves.toEqual({
            ok: false,
            reason: 'no-access',
        });
        expect(store.update).not.toHaveBeenCalled();
    });
});
