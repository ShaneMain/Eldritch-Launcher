import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    EngineSourceAuthError,
    GithubRequestError,
} from './github-source.errors.js';
import { GithubSourceAccessService } from './github-source-access.service.js';

vi.mock('@mariodebono/di', () => ({ Injectable: () => () => undefined }));
vi.mock('../app-integrations/app-integrations.service.js', () => ({
    AppIntegrationsService: class {},
}));

const PRIVATE_REPOSITORY = {
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    requiresAuth: true,
};

/**
 * Sends one request whose response has the given status.
 *
 * @param status - HTTP status GitHub answers with.
 * @param token - Bearer token sent with the request.
 * @param requiresAuth - Whether the source needs a GitHub login.
 * @returns The error the request failed with.
 */
async function failWith(
    status: number,
    token: string | null,
    requiresAuth = true,
): Promise<unknown> {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status })),
    );
    const service = new GithubSourceAccessService({} as never);
    return service
        .request(
            '/repos/Eldritch-Game-Studio/Eldritch-Engine/releases',
            token,
            {
                ...PRIVATE_REPOSITORY,
                requiresAuth,
            },
        )
        .then(
            () => undefined,
            (error: unknown) => error,
        );
}

describe('GithubSourceAccessService', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([403, 404])(
        'asks for sign-in when a private source answers %i without a token',
        async (status) => {
            const error = await failWith(status, null);

            expect(error).toBeInstanceOf(EngineSourceAuthError);
            expect(error).toMatchObject({ signedIn: false });
        },
    );

    it.each([403, 404])(
        'reports that the GitHub App lacks access when a signed-in request answers %i',
        async (status) => {
            const error = await failWith(status, 'ghu_token');

            expect(error).toBeInstanceOf(EngineSourceAuthError);
            expect(error).toMatchObject({
                signedIn: true,
                message:
                    'The signed-in GitHub account cannot access Eldritch-Game-Studio/Eldritch-Engine',
            });
        },
    );

    it('asks to sign in again when GitHub rejects the token', async () => {
        const error = await failWith(401, 'expired');

        expect(error).toBeInstanceOf(EngineSourceAuthError);
        expect(error).toMatchObject({ signedIn: false });
    });

    it('reports a missing public source as a request failure', async () => {
        const error = await failWith(404, 'ghu_token', false);

        expect(error).toBeInstanceOf(GithubRequestError);
        expect(error).toMatchObject({ status: 404 });
    });
});
