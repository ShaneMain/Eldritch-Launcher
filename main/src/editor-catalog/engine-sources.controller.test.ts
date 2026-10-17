import type {
    EditorCatalogResult,
    EngineSource,
    EngineSourceSummary,
} from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mariodebono/di-electron', () => ({
    BridgeController: () => () => undefined,
    createIpcHandleTyped: () => () => () => undefined,
}));
vi.mock('@mariodebono/di-config', () => ({ ConfigService: class {} }));
vi.mock('./editor-catalog.service.js', () => ({
    EditorCatalogService: class {},
}));
vi.mock('./engine-sources.service.js', () => ({
    EngineSourcesService: class {},
}));
vi.mock('./project-engine-status.service.js', () => ({
    ProjectEngineStatusService: class {},
}));

import { EngineSourcesController } from './engine-sources.controller.js';

const INSTALL_URL =
    'https://github.com/apps/eldritch-launcher/installations/new';

const PUBLIC_FORK: EngineSource = {
    id: 'fork:redot-engine/redot-engine',
    kind: 'fork',
    owner: 'Redot-Engine',
    repo: 'redot-engine',
    displayName: 'redot-engine',
    requiresAuth: false,
    builtIn: false,
};

const PRIVATE_FORK: EngineSource = {
    id: 'fork:eldritch-game-studio/eldritch-engine',
    kind: 'fork',
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: 'Eldritch-Engine',
    requiresAuth: true,
    builtIn: false,
};

/**
 * Creates the controller with in-memory collaborators.
 *
 * @param catalog - Catalog result returned by every catalog read.
 * @param addOutcome - Result of adding a source.
 * @returns The controller.
 */
function createController(
    catalog: EditorCatalogResult,
    addOutcome: unknown = { ok: true, source: PUBLIC_FORK },
    engineStatus: unknown = { kind: 'not-fork' },
) {
    const sources = {
        list: vi.fn(async () => [PUBLIC_FORK, PRIVATE_FORK]),
        add: vi.fn(async () => addOutcome),
    };
    const catalogService = {
        getCatalog: vi.fn(async () => catalog),
        refreshProvider: vi.fn(async () => catalog),
    };
    const configService = {
        getOrThrow: vi.fn(() => 'eldritch-launcher'),
    };
    return new EngineSourcesController(
        sources as never,
        catalogService as never,
        {
            getProjectEngineStatus: vi.fn(async () => engineStatus),
        } as never,
        configService as never,
    );
}

/**
 * Creates one catalog release of a provider.
 *
 * @param providerId - Provider that published the release.
 * @param index - Distinguishes releases.
 * @returns A minimal catalog release.
 */
function release(providerId: string, index: number) {
    return { id: `${providerId}:${index}`, providerId } as never;
}

describe('EngineSourcesController', () => {
    it('reports how many builds each source lists right after it is added', async () => {
        const controller = createController({
            releases: [
                release(PUBLIC_FORK.id, 1),
                release(PUBLIC_FORK.id, 2),
                release('official-stable', 1),
            ],
            providers: [
                {
                    id: PUBLIC_FORK.id,
                    lastFetchedAt: 1,
                    isStale: false,
                    state: 'ok',
                },
                {
                    id: PRIVATE_FORK.id,
                    lastFetchedAt: null,
                    isStale: true,
                    state: 'no-access',
                    refreshError: 'cannot access',
                },
            ],
        });

        const result = await controller.addSource({
            owner: 'Redot-Engine',
            repo: 'redot-engine',
        } as never);
        if (!result.ok) {
            throw new Error(`add failed: ${result.reason}`);
        }
        const summaries: EngineSourceSummary[] = result.sources;
        expect(summaries[0]).toMatchObject({
            id: PUBLIC_FORK.id,
            state: 'ok',
            buildCount: 2,
        });
        expect(summaries[0].githubAppInstallUrl).toBeUndefined();
        expect(summaries[1]).toMatchObject({
            id: PRIVATE_FORK.id,
            state: 'no-access',
            buildCount: 0,
            githubAppInstallUrl: INSTALL_URL,
        });
    });

    it('offers the GitHub App installation when a repository is not visible', async () => {
        const controller = createController(
            { releases: [], providers: [] },
            { ok: false, reason: 'no-access' },
        );

        await expect(
            controller.addSource({
                owner: 'Eldritch-Game-Studio',
                repo: 'Eldritch-Engine',
            } as never),
        ).resolves.toEqual({
            ok: false,
            reason: 'no-access',
            githubAppInstallUrl: INSTALL_URL,
        });
    });

    it('names the GitHub App installation for a pin the app cannot see', async () => {
        const controller = createController(
            { releases: [], providers: [] },
            undefined,
            { kind: 'no-access', source: 'Eldritch/Engine' },
        );

        await expect(
            controller.getProjectEngineStatus('/projects/game'),
        ).resolves.toEqual({
            kind: 'no-access',
            source: 'Eldritch/Engine',
            githubAppInstallUrl: INSTALL_URL,
        });
    });

    it('returns other engine statuses unchanged', async () => {
        const controller = createController(
            { releases: [], providers: [] },
            undefined,
            { kind: 'auth-required', source: 'Eldritch/Engine' },
        );

        await expect(
            controller.getProjectEngineStatus('/projects/game'),
        ).resolves.toEqual({
            kind: 'auth-required',
            source: 'Eldritch/Engine',
        });
    });

    it('returns other add failures unchanged', async () => {
        const controller = createController(
            { releases: [], providers: [] },
            { ok: false, reason: 'auth-required' },
        );

        await expect(
            controller.addSource({
                owner: 'Eldritch-Game-Studio',
                repo: 'Eldritch-Engine',
            } as never),
        ).resolves.toEqual({ ok: false, reason: 'auth-required' });
    });
});
