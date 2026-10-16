import type { EngineSource } from '@shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    OFFICIAL_ENGINE_SOURCE_IDS,
    OFFICIAL_ENGINE_SOURCES,
} from './editor-catalog.constants.js';
import { GithubEditorCatalogAdapter } from './github-editor-catalog.adapter.js';
import { githubReleasePageSchema } from './github-editor-catalog.schema.js';
import { GithubSourceAccessService } from './github-source-access.service.js';

vi.mock('@mariodebono/di', () => ({ Injectable: () => () => undefined }));
vi.mock('../app-integrations/app-integrations.service.js', () => ({
    AppIntegrationsService: class {},
}));
vi.mock('./github-editor-catalog.schema.js', () => ({
    githubReleasePageSchema: { parse: vi.fn((value) => value) },
}));

vi.mock('electron-log', () => ({
    default: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Built-in source for the official stable repository. */
const STABLE = sourceFor('official-stable');

/**
 * Finds one built-in official source.
 *
 * @param id - Official source ID.
 * @returns The source definition.
 */
function sourceFor(id: string): EngineSource {
    return OFFICIAL_ENGINE_SOURCES.find(
        (source) => source.id === id,
    ) as EngineSource;
}

/**
 * Creates an adapter that sends requests through the stubbed global fetch.
 *
 * @returns A catalog adapter.
 */
function createAdapter(): GithubEditorCatalogAdapter {
    return new GithubEditorCatalogAdapter(
        new GithubSourceAccessService({} as never),
    );
}

describe('GithubEditorCatalogAdapter', () => {
    it('stops fetching when response validation fails', async () => {
        const fetchMock = createPagedFetchMock([
            createGithubReleasePage(1, 100),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        vi.mocked(githubReleasePageSchema.parse).mockImplementationOnce(() => {
            throw new Error('invalid release response');
        });

        await expect(
            createAdapter().fetchProvider(STABLE, null, null),
        ).rejects.toThrow('invalid release response');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('keeps template metadata from the GitHub response through catalogue mapping', async () => {
        const release = createGithubRelease(4);
        const digest = `sha256:${'a'.repeat(64)}`;
        const template = {
            id: 42,
            name: 'Godot_v4.4-stable_mono_export_templates.tpz',
            browser_download_url: 'https://example.com/templates.tpz',
            size: 123456,
            digest,
        };
        const response = { ...release, assets: [...release.assets, template] };
        vi.stubGlobal('fetch', createPagedFetchMock([[response]]));

        const result = await createAdapter().fetchProvider(STABLE, null, null);

        expect(result.releases[0].templateAssets).toEqual([
            expect.objectContaining({
                id: 'official-stable:4.4-stable:templates:42',
                name: template.name,
                flavor: 'dotnet',
                downloadUrl: template.browser_download_url,
                sizeBytes: template.size,
                digest,
            }),
        ]);
    });

    it('fetches every page during an empty-cache bootstrap', async () => {
        const fetchMock = createPagedFetchMock([
            createGithubReleasePage(1, 100),
            createGithubReleasePage(101, 1),
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(STABLE, null, null);

        expect(result.releases).toHaveLength(101);
        expect(result.lastPublishedAt).toBe(createPublishedAt(101));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0][0])).toContain(
            '/godotengine/godot/releases',
        );
        expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    });

    it('stops on the first page when it reaches the cached boundary', async () => {
        const publishedAfter = createPublishedAt(101);
        const fetchMock = createPagedFetchMock([
            createGithubReleasePage(1, 100),
            [],
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(
            STABLE,
            publishedAfter,
            null,
        );

        expect(result.releases).toHaveLength(100);
        expect(result.releases[0].tag).toBe('4.1-stable');
        expect(result.releases[99].tag).toBe('4.100-stable');
        expect(result.lastPublishedAt).toBe(publishedAfter);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('remaps the complete boundary page, including equal and older publication dates', async () => {
        const publishedAfter = createPublishedAt(100);
        const page = [
            createGithubRelease(102),
            createGithubRelease(101),
            createGithubRelease(100),
            ...createGithubReleasePage(1, 97),
        ];
        const fetchMock = createPagedFetchMock([page, []]);
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(
            STABLE,
            publishedAfter,
            null,
        );

        expect(result.releases.map(({ tag }) => tag)).toEqual(
            page.map(({ tag_name }) => tag_name),
        );
        expect(result.lastPublishedAt).toBe(createPublishedAt(102));
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('backfills 250 newer releases across three pages before stopping at the cached boundary', async () => {
        const publishedAfter = createPublishedAt(100);
        const firstPage = createGithubReleasePage(251, 100).reverse();
        const secondPage = createGithubReleasePage(151, 100).reverse();
        const boundaryPage = createGithubReleasePage(51, 100).reverse();
        const fetchMock = createPagedFetchMock([
            firstPage,
            secondPage,
            boundaryPage,
            [],
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(
            STABLE,
            publishedAfter,
            null,
        );

        expect(result.releases.map(({ tag }) => tag)).toEqual(
            [...firstPage, ...secondPage, ...boundaryPage].map(
                ({ tag_name }) => tag_name,
            ),
        );
        expect(result.lastPublishedAt).toBe(createPublishedAt(350));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(
            fetchMock.mock.calls.map(([url]) => ({
                page: url.searchParams.get('page'),
                perPage: url.searchParams.get('per_page'),
            })),
        ).toEqual([
            { page: '1', perPage: '100' },
            { page: '2', perPage: '100' },
            { page: '3', perPage: '100' },
        ]);
    });

    it('does not use null publication dates as a boundary', async () => {
        const publishedAfter = createPublishedAt(100);
        const fetchMock = createPagedFetchMock([
            createGithubReleasePage(1, 100, null),
            [],
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(
            STABLE,
            publishedAfter,
            null,
        );

        expect(result.releases).toHaveLength(100);
        expect(result.releases[0].publishedAt).toBeNull();
        expect(result.lastPublishedAt).toBe(publishedAfter);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the page limit as the final pagination guard', async () => {
        const fullPage = createGithubReleasePage(1, 100, null);
        const fetchMock = vi.fn(async () => Response.json(fullPage));
        vi.stubGlobal('fetch', fetchMock);

        const result = await createAdapter().fetchProvider(STABLE, null, null);

        expect(result.releases).toHaveLength(10000);
        expect(result.lastPublishedAt).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(100);
    });

    it('throws a useful response error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('forbidden', { status: 403 })),
        );

        await expect(
            createAdapter().fetchProvider(STABLE, null, null),
        ).rejects.toThrow('GitHub request for godotengine/godot failed: 403');
    });

    it('reports a rate limit separately from authorisation', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('', {
                        status: 403,
                        headers: { 'x-ratelimit-remaining': '0' },
                    }),
            ),
        );

        await expect(
            createAdapter().fetchProvider(STABLE, null, null),
        ).rejects.toThrow('GitHub rate limit reached for godotengine/godot');
    });

    it('sends the optional token to official sources', async () => {
        const fetchMock = createPagedFetchMock([[createGithubRelease(4)]]);
        vi.stubGlobal('fetch', fetchMock);

        await createAdapter().fetchProvider(STABLE, null, 'ghu_token');

        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: expect.objectContaining({
                Authorization: 'Bearer ghu_token',
            }),
        });
    });

    it.each(OFFICIAL_ENGINE_SOURCE_IDS)(
        'picks up later desktop uploads in %s after a newer release is cached',
        async (providerId) => {
            const newer = createGithubRelease(5);
            const delayed = createGithubRelease(4);
            const unsupported = {
                ...delayed,
                assets: [
                    {
                        id: 40,
                        name: 'Godot_v4.4-stable_export_templates.tpz',
                        browser_download_url:
                            'https://example.com/templates.tpz',
                    },
                    {
                        id: 41,
                        name: 'Godot_v4.4-stable_web_editor.zip',
                        browser_download_url: 'https://example.com/web.zip',
                    },
                ],
            };
            const fetchMock = createPagedFetchMock([
                [newer, unsupported],
                [
                    newer,
                    {
                        ...delayed,
                        assets: [...unsupported.assets, ...delayed.assets],
                    },
                ],
            ]);
            vi.stubGlobal('fetch', fetchMock);
            const adapter = createAdapter();

            const first = await adapter.fetchProvider(
                sourceFor(providerId),
                newer.published_at,
                null,
            );
            const second = await adapter.fetchProvider(
                sourceFor(providerId),
                first.lastPublishedAt,
                null,
            );

            expect(first.releases.map(({ tag }) => tag)).toEqual([
                newer.tag_name,
            ]);
            expect(second.releases.map(({ tag }) => tag)).toEqual([
                newer.tag_name,
                delayed.tag_name,
            ]);
            expect(second.releases[1].variants[0].assets).toHaveLength(1);
            expect(second.lastPublishedAt).toBe(newer.published_at);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const repository =
                providerId === 'official-stable' ? 'godot' : 'godot-builds';
            expect(String(fetchMock.mock.calls[0][0])).toContain(
                `/godotengine/${repository}/releases?page=1&per_page=100`,
            );
        },
    );

    it('remaps a partial release with later platform and .NET assets and integrity metadata', async () => {
        const release = createGithubRelease(4);
        const digest = `sha256:${'b'.repeat(64)}`;
        const checksumManifestUrl = 'https://example.com/SHA512-SUMS.txt';
        const uploadedAssets = [
            'Godot_v4.4-stable_macos.universal.zip',
            'Godot_v4.4-stable_linux.x86_64.zip',
            'Godot_v4.4-stable_mono_win64.zip',
            'Godot_v4.4-stable_mono_macos.universal.zip',
            'Godot_v4.4-stable_mono_linux.x86_64.zip',
        ].map((name, index) => ({
            id: 40 + index,
            name,
            browser_download_url: `https://example.com/${name}`,
            digest,
        }));
        const completed = {
            ...release,
            assets: [
                ...release.assets,
                ...uploadedAssets,
                {
                    id: 50,
                    name: 'SHA512-SUMS.txt',
                    browser_download_url: checksumManifestUrl,
                },
            ],
        };
        vi.stubGlobal('fetch', createPagedFetchMock([[release], [completed]]));
        const adapter = createAdapter();

        const first = await adapter.fetchProvider(STABLE, null, null);
        const second = await adapter.fetchProvider(
            STABLE,
            first.lastPublishedAt,
            null,
        );

        expect(first.releases[0].variants).toHaveLength(1);
        expect(first.releases[0].variants[0].assets).toHaveLength(1);
        expect(second.releases).toHaveLength(1);
        expect(second.releases[0].id).toBe(first.releases[0].id);
        expect(second.releases[0].variants.map(({ flavor }) => flavor)).toEqual(
            ['gdscript', 'dotnet'],
        );
        for (const variant of second.releases[0].variants) {
            expect(variant.assets.map(({ platform }) => platform)).toEqual([
                'win32',
                'darwin',
                'darwin',
                'linux',
            ]);
            expect(variant.assets).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        platform: 'darwin',
                        digest,
                        checksumManifestUrl,
                    }),
                    expect.objectContaining({
                        platform: 'linux',
                        digest,
                        checksumManifestUrl,
                    }),
                ]),
            );
        }
        expect(second.lastPublishedAt).toBe(first.lastPublishedAt);
    });

    it('resolves the tag commit of a fork release without a manifest once', async () => {
        const revision = '77dcf97d82cbfe4e4615475fa52ca03da645dbd8';
        const fork: EngineSource = {
            id: 'fork:example/godot-fork',
            kind: 'fork',
            owner: 'example',
            repo: 'godot-fork',
            displayName: 'Example fork',
            requiresAuth: false,
            builtIn: false,
        };
        const release = {
            id: 9,
            name: null,
            tag_name: '4.3-stable',
            published_at: '2026-10-01T00:00:00Z',
            draft: false,
            prerelease: false,
            target_commitish: 'master',
            assets: [
                {
                    id: 90,
                    url: 'https://api.github.com/repos/example/godot-fork/releases/assets/90',
                    name: 'Godot_v4.3-stable_linux.x86_64.zip',
                    browser_download_url:
                        'https://github.com/example/godot-fork/releases/download/4.3-stable/Godot_v4.3-stable_linux.x86_64.zip',
                    digest: `sha256:${'b'.repeat(64)}`,
                    size: 1,
                },
            ],
        };
        const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
            if (url.pathname.endsWith('/commits/4.3-stable')) {
                expect(init?.headers).toMatchObject({
                    Accept: 'application/vnd.github.sha',
                });
                return new Response(revision);
            }
            return Response.json([release]);
        });
        vi.stubGlobal('fetch', fetchMock);
        const adapter = createAdapter();

        const first = await adapter.fetchProvider(fork, null, null);
        const second = await adapter.fetchProvider(fork, null, null);

        for (const result of [first, second]) {
            expect(result.releases).toHaveLength(1);
            expect(result.releases[0]).toMatchObject({
                version: '4.3.stable.77dcf97d8',
                fork: { source: 'example/godot-fork', revision },
                variants: [
                    {
                        flavor: 'gdscript',
                        assets: [
                            expect.objectContaining({
                                platform: 'linux',
                                architecture: 'x64',
                                downloadUrl: release.assets[0].url,
                            }),
                        ],
                    },
                ],
            });
        }
        expect(
            fetchMock.mock.calls.filter(([url]) =>
                url.pathname.includes('/commits/'),
            ),
        ).toHaveLength(1);
    });
});

/** Raw GitHub release response used by adapter tests. */
type GithubReleaseResponse = ReturnType<typeof createGithubRelease>;

/**
 * Creates a fetch mock that returns one GitHub response page per call.
 *
 * @param pages - The response pages to return in order.
 * @returns A fetch mock for the configured pages.
 */
function createPagedFetchMock(pages: GithubReleaseResponse[][]) {
    let pageIndex = 0;
    return vi.fn(async (_url: URL, _init?: RequestInit) =>
        Response.json(pages[pageIndex++] ?? []),
    );
}

/**
 * Creates a page of GitHub release responses.
 *
 * @param startId - The first release ID and version component.
 * @param length - The number of releases to create.
 * @param publishedAt - Fixed publication time, or undefined to derive it from each ID.
 * @returns A page of GitHub release responses.
 */
function createGithubReleasePage(
    startId: number,
    length: number,
    publishedAt?: string | null,
): GithubReleaseResponse[] {
    return Array.from({ length }, (_, index) =>
        createGithubRelease(
            startId + index,
            publishedAt === undefined
                ? createPublishedAt(startId + index)
                : publishedAt,
        ),
    );
}

/**
 * Creates one valid GitHub release response.
 *
 * @param id - The release ID and version component.
 * @param publishedAt - The release publication time.
 * @returns A valid GitHub release response.
 */
function createGithubRelease(
    id: number,
    publishedAt: string | null = createPublishedAt(id),
) {
    const tag = `4.${id}-stable`;
    return {
        id,
        name: `Godot ${tag}`,
        tag_name: tag,
        published_at: publishedAt,
        draft: false,
        prerelease: false,
        assets: [
            {
                id,
                name: `Godot_v${tag}_win64.exe.zip`,
                browser_download_url: `https://example.com/${tag}.zip`,
            },
        ],
    };
}

/**
 * Creates a stable ISO publication time from a numeric offset.
 *
 * @param offset - The number of days after the test epoch.
 * @returns The derived ISO publication time.
 */
function createPublishedAt(offset: number): string {
    return new Date(Date.UTC(2020, 0, 1 + offset)).toISOString();
}
