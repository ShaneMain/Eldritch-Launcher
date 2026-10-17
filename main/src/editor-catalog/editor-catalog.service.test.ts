import type {
    EditorCatalogProviderId,
    EditorCatalogRelease,
    EngineSource,
} from '@shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL_ENGINE_SOURCES } from './editor-catalog.constants.js';
import { createEmptyEditorCatalog } from './editor-catalog.schema.js';
import { EditorCatalogService } from './editor-catalog.service.js';
import type { EditorCatalogStore } from './editor-catalog.store.js';
import type {
    EditorCatalogFile,
    FetchedEditorCatalogProvider,
} from './editor-catalog.types.js';
import type { GithubEditorCatalogAdapter } from './github-editor-catalog.adapter.js';
import { EngineSourceAuthError } from './github-source.errors.js';

vi.mock('@mariodebono/di', () => ({ Injectable: () => () => undefined }));
vi.mock('@mariodebono/di-config', () => ({ ConfigService: class {} }));
vi.mock('./editor-catalog.store.js', () => ({ EditorCatalogStore: class {} }));
vi.mock('./github-editor-catalog.adapter.js', () => ({
    GithubEditorCatalogAdapter: class {},
}));
vi.mock('./engine-sources.service.js', () => ({
    EngineSourcesService: class {},
}));
vi.mock('./github-source-access.service.js', () => ({
    GithubSourceAccessService: class {},
}));
vi.mock('./editor-catalog.schema.js', () => {
    const createEmptyProviderState = () => ({
        integrityMetadataRefreshed: false,
        templateMetadataRefreshed: false,
        lastFetchedAt: null,
        lastPublishedAt: null,
        releases: [],
    });
    return {
        compareEditorReleases: vi.fn(() => 0),
        createEmptyProviderState,
        createEmptyEditorCatalog: () => ({
            schemaVersion: 1,
            providers: Object.fromEntries(
                ['official-stable', 'official-prerelease'].map((id) => [
                    id,
                    createEmptyProviderState(),
                ]),
            ),
        }),
    };
});

vi.mock('electron-log', () => ({
    default: {
        error: vi.fn(),
    },
}));

const FORK_SOURCE: EngineSource = {
    id: 'fork:eldritch-game-studio/eldritch-engine',
    kind: 'fork',
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: 'Eldritch Engine',
    requiresAuth: true,
    builtIn: false,
};

/** Matches the source argument passed to the adapter. */
const source = (id: EditorCatalogProviderId) => expect.objectContaining({ id });

describe('EditorCatalogService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('queries a fresh catalog without fetching', async () => {
        const catalog = createCatalogWithRelease(
            createRelease('official-stable', '4.5-stable'),
        );
        const { service, githubAdapter } = createService(catalog);

        const result = await service.getCatalog({
            query: { search: '4.5', platform: 'win32' },
        });

        expect(result.releases).toHaveLength(1);
        expect(githubAdapter.fetchProvider).not.toHaveBeenCalled();
        await expect(
            service.getReleaseById('official-stable:4.5-stable'),
        ).resolves.toMatchObject({ version: '4.5-stable' });
    });

    it('never fetches providers while E2E fixtures are active', async () => {
        const catalog = createEmptyEditorCatalog();
        const { service, githubAdapter } = createService(catalog, true);

        await service.getCatalog();
        await service.refreshCatalog();

        expect(githubAdapter.fetchProvider).not.toHaveBeenCalled();
    });

    it('fully refreshes a fresh legacy cache without integrity metadata', async () => {
        const cached = createRelease('official-stable', '4.5-stable');
        delete cached.variants[0].assets[0].digest;
        const catalog = createCatalogWithRelease(cached);
        catalog.providers['official-stable'].integrityMetadataRefreshed = false;
        const { service, githubAdapter } = createService(catalog);

        await service.getCatalog();

        expect(githubAdapter.fetchProvider).toHaveBeenCalledWith(
            source('official-stable'),
            null,
            null,
        );

        await service.getCatalog();

        expect(githubAdapter.fetchProvider).toHaveBeenCalledOnce();
    });

    it('refreshes a legacy cache missing only template metadata once', async () => {
        const catalog = createCatalogWithRelease(
            createRelease('official-stable', '4.5-stable'),
        );
        catalog.providers['official-stable'].templateMetadataRefreshed = false;
        const { service, githubAdapter, store } = createService(catalog);
        const updated = createRelease('official-stable', '4.5-stable');
        updated.templateAssets = [
            {
                id: 'templates',
                name: 'Godot_v4.5-stable_export_templates.tpz',
                flavor: 'gdscript',
                downloadUrl: 'https://example.test/templates.tpz',
                sizeBytes: 123456,
            },
        ];
        githubAdapter.fetchProvider.mockResolvedValueOnce({
            providerId: 'official-stable',
            lastPublishedAt: updated.publishedAt,
            releases: [updated],
        });

        const result = await service.getCatalog();

        expect(result.releases[0].templateAssets).toEqual(
            updated.templateAssets,
        );
        expect(githubAdapter.fetchProvider).toHaveBeenCalledExactlyOnceWith(
            source('official-stable'),
            null,
            null,
        );
        expect((await store.read()).providers['official-stable']).toMatchObject(
            {
                integrityMetadataRefreshed: true,
                templateMetadataRefreshed: true,
            },
        );
        await service.getCatalog();
        expect(githubAdapter.fetchProvider).toHaveBeenCalledOnce();
    });

    it('automatically refreshes only stale providers', async () => {
        const cached = createRelease('official-stable', '4.5-stable');
        const catalog = createCatalogWithRelease(cached);
        catalog.providers['official-stable'].lastFetchedAt = null;
        const { service, githubAdapter } = createService(catalog);

        await service.getCatalog();

        expect(githubAdapter.fetchProvider).toHaveBeenCalledOnce();
        expect(githubAdapter.fetchProvider).toHaveBeenCalledWith(
            source('official-stable'),
            cached.publishedAt,
            null,
        );
    });

    it('explicitly refreshes every provider', async () => {
        const catalog = createCatalogWithRelease(
            createRelease('official-stable', '4.5-stable'),
        );
        const { service, githubAdapter } = createService(catalog);

        await service.refreshCatalog();

        expect(githubAdapter.fetchProvider).toHaveBeenCalledTimes(2);
        expect(githubAdapter.fetchProvider).toHaveBeenCalledWith(
            source('official-stable'),
            catalog.providers['official-stable'].lastPublishedAt,
            null,
        );
        expect(githubAdapter.fetchProvider).toHaveBeenCalledWith(
            source('official-prerelease'),
            catalog.providers['official-prerelease'].lastPublishedAt,
            null,
        );
    });

    it('fetches providers missing from an active automatic refresh', async () => {
        const cached = createRelease('official-stable', '4.5-stable');
        const catalog = createCatalogWithRelease(cached);
        catalog.providers['official-stable'].lastFetchedAt = null;
        const { service, githubAdapter } = createService(catalog);
        let resolveStableRefresh: (
            value: FetchedEditorCatalogProvider,
        ) => void = () => undefined;
        const stableRefresh = new Promise<FetchedEditorCatalogProvider>(
            (resolve) => {
                resolveStableRefresh = resolve;
            },
        );
        githubAdapter.fetchProvider.mockImplementation(async ({ id }) => {
            const providerId = id;
            if (providerId === 'official-stable') {
                return stableRefresh;
            }
            return {
                providerId,
                lastPublishedAt: '2026-01-02T00:00:00.000Z',
                releases: [createRelease(providerId, '4.6-beta1')],
            };
        });

        const automaticRefresh = service.getCatalog();
        await vi.waitFor(() =>
            expect(githubAdapter.fetchProvider).toHaveBeenCalledOnce(),
        );
        const explicitRefresh = service.refreshCatalog();
        resolveStableRefresh({
            providerId: 'official-stable',
            lastPublishedAt: '2026-01-02T00:00:00.000Z',
            releases: [createRelease('official-stable', '4.5-stable')],
        });

        const [, explicitResult] = await Promise.all([
            automaticRefresh,
            explicitRefresh,
        ]);

        expect(githubAdapter.fetchProvider).toHaveBeenCalledTimes(2);
        expect(githubAdapter.fetchProvider).toHaveBeenNthCalledWith(
            2,
            source('official-prerelease'),
            null,
            null,
        );
        expect(explicitResult.releases).toHaveLength(2);
    });

    it('deduplicates concurrent stale refreshes', async () => {
        const catalog = createEmptyEditorCatalog();
        const { service, githubAdapter } = createService(catalog);

        const [first, second] = await Promise.all([
            service.getCatalog(),
            service.getCatalog({ query: { prerelease: false } }),
        ]);

        expect(githubAdapter.fetchProvider).toHaveBeenCalledTimes(2);
        expect(first.releases).toHaveLength(2);
        expect(second.releases).toHaveLength(1);
    });

    it('keeps cached data and reports a provider refresh error', async () => {
        const cached = createRelease('official-prerelease', '4.6-beta1');
        const catalog = createCatalogWithRelease(cached);
        catalog.providers['official-stable'].lastFetchedAt = null;
        catalog.providers['official-prerelease'].lastFetchedAt = null;
        const { service, githubAdapter } = createService(catalog);
        githubAdapter.fetchProvider.mockImplementation(async ({ id }) => {
            const providerId = id;
            if (providerId === 'official-prerelease') {
                throw new Error('builds unavailable');
            }
            return {
                providerId,
                lastPublishedAt: '2026-01-02T00:00:00.000Z',
                releases: [createRelease(providerId, '4.5-stable')],
            };
        });

        const result = await service.refreshCatalog();

        expect(result.releases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: cached.id }),
                expect.objectContaining({
                    id: 'official-stable:4.5-stable',
                }),
            ]),
        );
        expect(
            result.providers.find(({ id }) => id === 'official-prerelease')
                ?.refreshError,
        ).toBe('builds unavailable');
    });

    it('updates the fetch time when no new releases are found', async () => {
        const cached = createRelease('official-stable', '4.5-stable');
        const catalog = createCatalogWithRelease(cached);
        catalog.providers['official-stable'].lastFetchedAt = 0;
        const { service, githubAdapter } = createService(catalog);
        githubAdapter.fetchProvider.mockResolvedValue({
            providerId: 'official-stable',
            lastPublishedAt: cached.publishedAt,
            releases: [],
        });

        const result = await service.getCatalog();

        expect(result.releases).toContainEqual(cached);
        expect(
            result.providers.find(({ id }) => id === 'official-stable')
                ?.lastFetchedAt,
        ).toBe(Date.now());
    });

    it('replaces a cached partial release once and retains releases outside the fetched pages', async () => {
        const cached = createRelease('official-stable', '4.5-stable');
        const older = createRelease('official-stable', '4.4-stable');
        const newer = createRelease('official-stable', '4.6-stable');
        newer.publishedAt = '2026-01-02T00:00:00.000Z';
        const catalog = createCatalogWithRelease(newer);
        catalog.providers['official-stable'].releases.push(cached, older);
        catalog.providers['official-stable'].lastFetchedAt = 0;
        const completed = structuredClone(cached);
        completed.variants.push({
            id: `${cached.id}:dotnet`,
            flavor: 'dotnet',
            assets: [
                {
                    ...cached.variants[0].assets[0],
                    id: `${cached.id}:dotnet:linux:x64`,
                    platform: 'linux',
                    digest: `sha256:${'b'.repeat(64)}`,
                    checksumManifestUrl: 'https://example.com/SHA512-SUMS.txt',
                },
            ],
        });
        const { service, githubAdapter, store } = createService(catalog);
        githubAdapter.fetchProvider.mockResolvedValue({
            providerId: 'official-stable',
            lastPublishedAt: newer.publishedAt,
            releases: [newer, completed],
        });

        const result = await service.getCatalog();

        expect(result.releases).toHaveLength(3);
        expect(result.releases.find(({ id }) => id === cached.id)).toEqual(
            completed,
        );
        expect(result.releases).toContainEqual(older);
        expect(result.releases).toContainEqual(newer);
        expect(
            (await store.read()).providers['official-stable'].lastPublishedAt,
        ).toBe(newer.publishedAt);
        expect(githubAdapter.fetchProvider).toHaveBeenCalledExactlyOnceWith(
            source('official-stable'),
            newer.publishedAt,
            null,
        );
    });

    it('rebuilds a malformed catalog during explicit refresh', async () => {
        const { service, store } = createService(createEmptyEditorCatalog());
        store.read.mockRejectedValue(new Error('invalid catalog'));

        const result = await service.refreshCatalog();

        expect(store.replace).toHaveBeenCalledOnce();
        expect(result.releases).toHaveLength(2);
    });

    it('rebuilds a malformed catalog when it is first read', async () => {
        const { service, store } = createService(createEmptyEditorCatalog());
        store.read.mockRejectedValue(new Error('invalid catalog'));

        const result = await service.getCatalog();

        expect(store.replace).toHaveBeenCalledOnce();
        expect(result.releases).toHaveLength(2);
    });

    it('reports a fork source as auth-required without a token and keeps the state', async () => {
        const { service, githubAdapter } = createService(
            createEmptyEditorCatalog(),
            false,
            { sources: [...OFFICIAL_ENGINE_SOURCES, FORK_SOURCE] },
        );

        const result = await service.refreshCatalog();

        expect(githubAdapter.fetchProvider).not.toHaveBeenCalledWith(
            source(FORK_SOURCE.id),
            expect.anything(),
            expect.anything(),
        );
        expect(
            result.providers.find(({ id }) => id === FORK_SOURCE.id),
        ).toMatchObject({ state: 'auth-required' });
        expect(
            (
                await service.getCatalog({ refreshIfStale: false })
            ).providers.find(({ id }) => id === FORK_SOURCE.id),
        ).toMatchObject({ state: 'auth-required' });
    });

    it('fetches a fork source with the token and clears an earlier failure', async () => {
        const catalog = createEmptyEditorCatalog();
        catalog.providers[FORK_SOURCE.id] = {
            lastFetchedAt: null,
            lastPublishedAt: null,
            lastFailure: { state: 'auth-required', message: 'sign in' },
            releases: [],
        };
        const { service, githubAdapter } = createService(catalog, false, {
            sources: [FORK_SOURCE],
            token: 'ghu_token',
        });

        const result = await service.refreshProvider(FORK_SOURCE.id);

        expect(githubAdapter.fetchProvider).toHaveBeenCalledExactlyOnceWith(
            source(FORK_SOURCE.id),
            null,
            'ghu_token',
        );
        expect(result.providers).toEqual([
            expect.objectContaining({ id: FORK_SOURCE.id, state: 'ok' }),
        ]);
        expect(result.providers[0].refreshError).toBeUndefined();
    });

    it('reports no-access when the signed-in account cannot see a fork', async () => {
        const { service, githubAdapter } = createService(
            createEmptyEditorCatalog(),
            false,
            { sources: [FORK_SOURCE], token: 'ghu_token' },
        );
        githubAdapter.fetchProvider.mockRejectedValueOnce(
            new EngineSourceAuthError(
                'Eldritch-Game-Studio/Eldritch-Engine',
                true,
            ),
        );

        const result = await service.refreshCatalog();

        expect(result.providers).toEqual([
            expect.objectContaining({
                id: FORK_SOURCE.id,
                state: 'no-access',
                refreshError:
                    'The signed-in GitHub account cannot access Eldritch-Game-Studio/Eldritch-Engine',
            }),
        ]);
    });

    it.each(['auth-required', 'no-access'] as const)(
        'retries a fork blocked by %s on the next catalog read, so a new sign-in or GitHub App grant lists its builds',
        async (state) => {
            const catalog = createCatalogWithRelease(
                createRelease('official-stable', '4.5-stable'),
            );
            catalog.providers[FORK_SOURCE.id] = {
                integrityMetadataRefreshed: true,
                templateMetadataRefreshed: true,
                lastFetchedAt: Date.now(),
                lastPublishedAt: null,
                lastFailure: { state, message: 'blocked' },
                releases: [],
            };
            const { service, githubAdapter } = createService(catalog, false, {
                sources: [OFFICIAL_ENGINE_SOURCES[0], FORK_SOURCE],
                token: 'ghu_token',
            });

            const result = await service.getCatalog();

            expect(githubAdapter.fetchProvider).toHaveBeenCalledExactlyOnceWith(
                source(FORK_SOURCE.id),
                null,
                'ghu_token',
            );
            expect(
                result.providers.find(({ id }) => id === FORK_SOURCE.id),
            ).toMatchObject({ state: 'ok' });
            expect(
                result.releases.filter(
                    (release) => release.providerId === FORK_SOURCE.id,
                ),
            ).toHaveLength(1);
        },
    );

    it('retries an official source anonymously when the token is refused', async () => {
        const { service, githubAdapter } = createService(
            createEmptyEditorCatalog(),
            false,
            { sources: [OFFICIAL_ENGINE_SOURCES[0]], token: 'expired' },
        );
        githubAdapter.fetchProvider.mockRejectedValueOnce(
            new EngineSourceAuthError('godotengine/godot'),
        );

        const result = await service.refreshCatalog();

        expect(githubAdapter.fetchProvider).toHaveBeenLastCalledWith(
            source('official-stable'),
            null,
            null,
        );
        expect(result.providers[0].state).toBe('ok');
        expect(result.releases).toHaveLength(1);
    });

    it('drops the cache of a removed provider', async () => {
        const catalog = createEmptyEditorCatalog();
        catalog.providers[FORK_SOURCE.id] = {
            lastFetchedAt: 1,
            lastPublishedAt: null,
            releases: [],
        };
        const { service, store } = createService(catalog);

        await service.removeProvider(FORK_SOURCE.id);

        expect((await store.read()).providers[FORK_SOURCE.id]).toBeUndefined();
    });
});

/**
 * Creates the catalogue service with in-memory collaborators.
 *
 * @param initialCatalog - Initial persisted catalogue state.
 * @param e2eFixtures - Whether development fixture isolation is active.
 * @returns The service and its inspectable collaborators.
 */
function createService(
    initialCatalog: EditorCatalogFile,
    e2eFixtures = false,
    options: { sources?: EngineSource[]; token?: string | null } = {},
) {
    let catalog = structuredClone(initialCatalog);
    const store = {
        read: vi.fn(async () => structuredClone(catalog)),
        update: vi.fn(
            async (
                mutator: (value: EditorCatalogFile) => EditorCatalogFile,
            ) => {
                catalog = mutator(structuredClone(catalog));
                return structuredClone(catalog);
            },
        ),
        replace: vi.fn(async (value: EditorCatalogFile) => {
            catalog = structuredClone(value);
            return structuredClone(catalog);
        }),
    };
    const githubAdapter = {
        fetchProvider: vi.fn(
            async ({
                id: providerId,
            }: EngineSource): Promise<FetchedEditorCatalogProvider> => ({
                providerId,
                lastPublishedAt: '2026-01-02T00:00:00.000Z',
                releases: [
                    createRelease(
                        providerId,
                        providerId === 'official-stable'
                            ? '4.5-stable'
                            : '4.6-beta1',
                    ),
                ],
            }),
        ),
    };
    const configService = {
        get: vi.fn(() => e2eFixtures),
    };
    const sources = {
        list: vi.fn(
            async () => options.sources ?? [...OFFICIAL_ENGINE_SOURCES],
        ),
    };
    const access = {
        withToken: vi.fn(
            <T>(operation: (token: string | null) => Promise<T>): Promise<T> =>
                operation(options.token ?? null),
        ),
    };

    return {
        service: new EditorCatalogService(
            store as unknown as EditorCatalogStore,
            githubAdapter as unknown as GithubEditorCatalogAdapter,
            configService as never,
            sources as never,
            access as never,
        ),
        store,
        githubAdapter,
    };
}

function createCatalogWithRelease(
    release: EditorCatalogRelease,
): EditorCatalogFile {
    const catalog = createEmptyEditorCatalog();
    catalog.providers[release.providerId] = {
        integrityMetadataRefreshed: true,
        templateMetadataRefreshed: true,
        lastFetchedAt: Date.now(),
        lastPublishedAt: release.publishedAt,
        releases: [release],
    };
    for (const provider of Object.values(catalog.providers)) {
        provider.integrityMetadataRefreshed = true;
        provider.templateMetadataRefreshed = true;
        provider.lastFetchedAt ??= Date.now();
    }
    return catalog;
}

function createRelease(
    providerId: EditorCatalogProviderId,
    version: string,
): EditorCatalogRelease {
    const prerelease = providerId === 'official-prerelease';
    const flavor = prerelease ? 'dotnet' : 'gdscript';
    return {
        id: `${providerId}:${version}`,
        sourceReleaseId: version,
        providerId,
        tag: version,
        version,
        baseVersion: version.slice(0, 3),
        name: `Godot ${version}`,
        publishedAt: '2026-01-01T00:00:00.000Z',
        prerelease,
        versionParts: {
            major: 4,
            minor: prerelease ? 6 : 5,
            patch: 0,
            channel: prerelease ? 'beta' : 'stable',
            iteration: prerelease ? 1 : 0,
        },
        variants: [
            {
                id: `${providerId}:${version}:${flavor}`,
                flavor,
                assets: [
                    {
                        id: `${providerId}:${version}:${flavor}:win32:x64`,
                        name: `${version}.zip`,
                        downloadUrl: 'https://example.com/editor.zip',
                        digest: `sha256:${'a'.repeat(64)}`,
                        platform: 'win32',
                        architecture: 'x64',
                    },
                ],
            },
        ],
    };
}
