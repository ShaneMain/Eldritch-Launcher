import { Injectable } from '@mariodebono/di';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ConfigService } from '@mariodebono/di-config';
import type {
    EditorCatalogProviderId,
    EditorCatalogProviderStatus,
    EditorCatalogQuery,
    EditorCatalogRelease,
    EditorCatalogResult,
    EngineSource,
    GetEditorCatalogOptions,
} from '@shared/contracts';
import logger from 'electron-log';
import type { AppConfig } from '../config/index.js';
import { EDITOR_CATALOG_CACHE_TTL_MS } from './editor-catalog.constants.js';
import {
    compareEditorReleases,
    createEmptyEditorCatalog,
    createEmptyProviderState,
} from './editor-catalog.schema.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EditorCatalogStore } from './editor-catalog.store.js';
import type {
    EditorCatalogFile,
    EditorCatalogProviderState,
    EditorCatalogRefreshFailure,
    FetchedEditorCatalogProvider,
} from './editor-catalog.types.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EngineSourcesService } from './engine-sources.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GithubEditorCatalogAdapter } from './github-editor-catalog.adapter.js';
import { EngineSourceAuthError } from './github-source.errors.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GithubSourceAccessService } from './github-source-access.service.js';

/** Reads, refreshes, and filters the editor catalog. */
@Injectable()
export class EditorCatalogService {
    private activeRefresh: ActiveRefresh | null = null;

    /**
     * Creates the catalog service.
     *
     * @param store - The store used for cached catalog data.
     * @param githubAdapter - The adapter used to read GitHub releases.
     * @param configService - Runtime application configuration.
     * @param sources - Built-in and configured engine sources.
     * @param access - GitHub credential access for refreshes.
     */
    constructor(
        private readonly store: EditorCatalogStore,
        private readonly githubAdapter: GithubEditorCatalogAdapter,
        private readonly configService: ConfigService<AppConfig>,
        private readonly sources: EngineSourcesService,
        private readonly access: GithubSourceAccessService,
    ) {}

    /**
     * Gets releases from the cache and refreshes stale data by default.
     * An unreadable cache is rebuilt from GitHub.
     *
     * @param options - Optional refresh and filter settings.
     * @returns The matching releases and provider status.
     */
    async getCatalog(
        options: GetEditorCatalogOptions = {},
    ): Promise<EditorCatalogResult> {
        const sources = await this.sources.list();
        let catalog: EditorCatalogFile;
        try {
            catalog = await this.store.read();
        } catch (error) {
            logger.error('Editor catalog cache is unreadable', error);
            if (
                this.configService.get('e2eFixtures') ||
                options.refreshIfStale === false
            ) {
                return this.createResult(
                    createEmptyEditorCatalog(),
                    sources,
                    options.query,
                );
            }
            return this.refresh(sources, sources, options.query);
        }
        if (this.configService.get('e2eFixtures')) {
            return this.createResult(catalog, sources, options.query);
        }
        const staleSources = sources.filter((source) =>
            isStale(catalog, source.id),
        );

        if (options.refreshIfStale !== false && staleSources.length > 0) {
            return this.refresh(sources, staleSources, options.query);
        }

        return this.createResult(catalog, sources, options.query);
    }

    /**
     * Finds one release by its exact catalog ID.
     *
     * @param id - The release ID to find.
     * @returns The release, or null when it does not exist.
     */
    async getReleaseById(id: string): Promise<EditorCatalogRelease | null> {
        const result = await this.getCatalog();
        return result.releases.find((release) => release.id === id) ?? null;
    }

    /**
     * Refreshes every provider and returns matching releases.
     *
     * @param query - Optional filters for the returned releases.
     * @returns The refreshed releases and provider status.
     */
    async refreshCatalog(
        query?: EditorCatalogQuery,
    ): Promise<EditorCatalogResult> {
        const sources = await this.sources.list();
        if (this.configService.get('e2eFixtures')) {
            return this.createResult(await this.store.read(), sources, query);
        }
        return this.refresh(sources, sources, query);
    }

    /**
     * Refreshes one provider and returns the full catalog.
     *
     * @param providerId - The provider to refresh.
     * @returns The catalog after the refresh.
     */
    async refreshProvider(
        providerId: EditorCatalogProviderId,
    ): Promise<EditorCatalogResult> {
        const sources = await this.sources.list();
        const source = sources.find((candidate) => candidate.id === providerId);
        if (!source || this.configService.get('e2eFixtures')) {
            return this.createResult(await this.store.read(), sources);
        }
        return this.refresh(sources, [source]);
    }

    /**
     * Removes cached releases of a provider that is no longer configured.
     *
     * @param providerId - The provider whose cache should be dropped.
     * @returns A promise that ends when the cache is updated.
     */
    async removeProvider(providerId: EditorCatalogProviderId): Promise<void> {
        await this.store.update((current) => {
            const { [providerId]: _removed, ...providers } = current.providers;
            return { ...current, providers };
        });
    }

    /**
     * Refreshes sources and builds the filtered result.
     *
     * @param sources - Every configured source.
     * @param refreshSources - The sources to refresh.
     * @param query - Optional filters for the returned releases.
     * @returns The refreshed releases and provider status.
     */
    private async refresh(
        sources: EngineSource[],
        refreshSources: EngineSource[],
        query?: EditorCatalogQuery,
    ): Promise<EditorCatalogResult> {
        const catalog = await this.refreshProviders(refreshSources);
        return this.createResult(catalog, sources, query);
    }

    /**
     * Shares the active refresh and queues sources it does not cover.
     *
     * @param sources - The sources the caller needs refreshed.
     * @returns The updated catalog.
     */
    private async refreshProviders(
        sources: EngineSource[],
    ): Promise<EditorCatalogFile> {
        if (!this.activeRefresh) {
            const activeRefresh: ActiveRefresh = {
                providerIds: new Set(sources.map((source) => source.id)),
                promise: this.runRefresh(sources),
            };
            activeRefresh.promise = activeRefresh.promise.finally(() => {
                if (this.activeRefresh === activeRefresh) {
                    this.activeRefresh = null;
                }
            });
            this.activeRefresh = activeRefresh;
        }

        const activeRefresh = this.activeRefresh;
        const missingSources = sources.filter(
            (source) => !activeRefresh.providerIds.has(source.id),
        );
        const catalog = await activeRefresh.promise;
        return missingSources.length > 0
            ? this.refreshProviders(missingSources)
            : catalog;
    }

    /**
     * Fetches provider updates and stores successful results and failures.
     *
     * @param sources - The sources to fetch.
     * @returns The updated catalog.
     */
    private async runRefresh(
        sources: EngineSource[],
    ): Promise<EditorCatalogFile> {
        let catalog: EditorCatalogFile;
        let catalogReadable = true;
        try {
            catalog = await this.store.read();
        } catch (error) {
            catalogReadable = false;
            catalog = createEmptyEditorCatalog();
            logger.error('Failed to read editor catalog before refresh', error);
        }

        const integrityRefreshProviderIds = new Set(
            sources
                .filter((source) =>
                    providerNeedsIntegrityRefresh(
                        providerState(catalog, source.id),
                    ),
                )
                .map((source) => source.id),
        );

        const refreshResults = await this.access.withToken((token) =>
            Promise.allSettled(
                sources.map((source) =>
                    this.fetchSource(
                        source,
                        integrityRefreshProviderIds.has(source.id)
                            ? null
                            : providerState(catalog, source.id).lastPublishedAt,
                        token,
                    ),
                ),
            ),
        );
        const updates: FetchedEditorCatalogProvider[] = [];
        const failures = new Map<
            EditorCatalogProviderId,
            EditorCatalogRefreshFailure
        >();

        refreshResults.forEach((result, index) => {
            const source = sources[index];
            if (result.status === 'fulfilled') {
                updates.push(result.value);
                return;
            }

            failures.set(source.id, {
                state:
                    result.reason instanceof EngineSourceAuthError
                        ? 'auth-required'
                        : 'error',
                message: getErrorMessage(result.reason),
            });
            logger.error(
                `Failed to refresh editor catalog provider ${source.id}`,
                result.reason,
            );
        });

        const applyUpdates = (current: EditorCatalogFile) =>
            mergeProviderUpdates(
                current,
                updates,
                failures,
                Date.now(),
                integrityRefreshProviderIds,
            );
        return catalogReadable
            ? this.store.update(applyUpdates)
            : this.store.replace(applyUpdates(catalog));
    }

    /**
     * Fetches one source with the optional token. Official sources retry
     * anonymously when the token is refused, because they never need it.
     *
     * @param source - The source to fetch.
     * @param publishedAfter - Pagination boundary.
     * @param token - Optional GitHub bearer token.
     * @returns Fetched provider data.
     */
    private async fetchSource(
        source: EngineSource,
        publishedAfter: string | null,
        token: string | null,
    ): Promise<FetchedEditorCatalogProvider> {
        if (source.requiresAuth && !token) {
            throw new EngineSourceAuthError(`${source.owner}/${source.repo}`);
        }
        try {
            return await this.githubAdapter.fetchProvider(
                source,
                publishedAfter,
                token,
            );
        } catch (error) {
            if (
                source.kind === 'official' &&
                token &&
                error instanceof EngineSourceAuthError
            ) {
                return this.githubAdapter.fetchProvider(
                    source,
                    publishedAfter,
                    null,
                );
            }
            throw error;
        }
    }

    /**
     * Builds the catalog result returned to callers.
     *
     * @param catalog - The stored catalog data.
     * @param sources - The configured sources to include.
     * @param query - Optional release filters.
     * @returns Matching releases and provider status.
     */
    private createResult(
        catalog: EditorCatalogFile,
        sources: EngineSource[],
        query?: EditorCatalogQuery,
    ): EditorCatalogResult {
        const releases = sources
            .flatMap((source) => providerState(catalog, source.id).releases)
            .filter((release) => matchesQuery(release, query))
            .sort(compareEditorReleases);
        const providers: EditorCatalogProviderStatus[] = sources.map(
            (source) => {
                const state = providerState(catalog, source.id);
                return {
                    id: source.id,
                    lastFetchedAt: state.lastFetchedAt,
                    isStale: isStale(catalog, source.id),
                    state: state.lastFailure?.state ?? 'ok',
                    ...(state.lastFailure
                        ? { refreshError: state.lastFailure.message }
                        : {}),
                };
            },
        );

        return { releases, providers };
    }
}

/**
 * Gets the cached state of one provider, or an empty state.
 *
 * @param catalog - The stored catalog data.
 * @param providerId - The provider to read.
 * @returns The cached provider state.
 */
function providerState(
    catalog: EditorCatalogFile,
    providerId: EditorCatalogProviderId,
): EditorCatalogProviderState {
    return catalog.providers[providerId] ?? createEmptyProviderState();
}

/**
 * Checks whether one provider should be refreshed.
 *
 * @param catalog - The stored catalog data.
 * @param providerId - The provider to check.
 * @returns True when the provider data is stale.
 */
function isStale(
    catalog: EditorCatalogFile,
    providerId: EditorCatalogProviderId,
): boolean {
    const state = providerState(catalog, providerId);
    return (
        state.lastFetchedAt === null ||
        state.lastFetchedAt + EDITOR_CATALOG_CACHE_TTL_MS < Date.now() ||
        providerNeedsIntegrityRefresh(state)
    );
}

/**
 * Checks whether cached assets predate required integrity metadata.
 *
 * @param provider - The cached provider data to inspect.
 * @returns Whether the provider needs one complete metadata refresh.
 */
function providerNeedsIntegrityRefresh(
    provider: EditorCatalogProviderState,
): boolean {
    return (
        provider.integrityMetadataRefreshed !== true ||
        provider.templateMetadataRefreshed !== true
    );
}

/**
 * Merges fetched provider data and refresh failures into the stored catalog.
 *
 * @param catalog - The current catalog.
 * @param updates - The provider updates to merge.
 * @param failures - Providers whose refresh failed.
 * @param fetchedAt - The time when the updates were fetched.
 * @param integrityRefreshProviderIds - Providers fetched from the beginning.
 * @returns A catalog containing the provider updates.
 */
function mergeProviderUpdates(
    catalog: EditorCatalogFile,
    updates: FetchedEditorCatalogProvider[],
    failures: ReadonlyMap<EditorCatalogProviderId, EditorCatalogRefreshFailure>,
    fetchedAt: number,
    integrityRefreshProviderIds: ReadonlySet<EditorCatalogProviderId>,
): EditorCatalogFile {
    const providers = { ...catalog.providers };
    for (const update of updates) {
        const current = providerState(catalog, update.providerId);
        const releasesById = new Map(
            [...current.releases, ...update.releases].map((release) => [
                release.id,
                release,
            ]),
        );
        providers[update.providerId] = {
            templateMetadataRefreshed:
                current.templateMetadataRefreshed === true ||
                integrityRefreshProviderIds.has(update.providerId),
            integrityMetadataRefreshed:
                current.integrityMetadataRefreshed === true ||
                integrityRefreshProviderIds.has(update.providerId),
            lastFetchedAt: fetchedAt,
            lastPublishedAt: update.lastPublishedAt,
            releases: [...releasesById.values()],
        };
    }
    for (const [providerId, lastFailure] of failures) {
        providers[providerId] = {
            ...providerState(catalog, providerId),
            lastFailure,
        };
    }

    return { ...catalog, providers };
}

/** One active provider refresh shared by concurrent callers. */
type ActiveRefresh = {
    providerIds: Set<EditorCatalogProviderId>;
    promise: Promise<EditorCatalogFile>;
};

/**
 * Checks whether a release matches all requested filters.
 *
 * @param release - The release to check.
 * @param query - The filters to apply.
 * @returns True when the release matches the query.
 */
function matchesQuery(
    release: EditorCatalogRelease,
    query?: EditorCatalogQuery,
): boolean {
    if (!query) {
        return true;
    }
    if (
        query.prerelease !== undefined &&
        release.prerelease !== query.prerelease
    ) {
        return false;
    }

    const search = query.search?.trim().toLowerCase();
    if (
        search &&
        ![release.version, release.tag, release.name].some((value) =>
            value.toLowerCase().includes(search),
        )
    ) {
        return false;
    }

    return release.variants.some(
        (variant) =>
            (!query.flavor || variant.flavor === query.flavor) &&
            variant.assets.some(
                (asset) =>
                    (!query.platform || asset.platform === query.platform) &&
                    (!query.architecture ||
                        asset.architecture === query.architecture),
            ),
    );
}

/**
 * Converts an unknown error value into a message.
 *
 * @param error - The error value to convert.
 * @returns A readable error message.
 */
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
