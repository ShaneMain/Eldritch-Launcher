// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ConfigService } from '@mariodebono/di-config';
import {
    BridgeController,
    createIpcHandleTyped,
} from '@mariodebono/di-electron';
import type {
    AddEngineSourceInput,
    AddEngineSourceResult,
    EditorCatalogProviderId,
    EditorCatalogResult,
    EngineSourceSummary,
    EngineSourcesBridge,
    ProjectEngineStatus,
} from '@shared/contracts';
import { githubAppInstallationUrl } from '../app-integrations/providers/github/github-app-integration.constants.js';
import type { AppConfig } from '../config/index.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EditorCatalogService } from './editor-catalog.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EngineSourcesService } from './engine-sources.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectEngineStatusService } from './project-engine-status.service.js';

const EngineSourcesHandler = createIpcHandleTyped<EngineSourcesBridge>();

/** Handles engine source and engine pin status requests from the renderer. */
@BridgeController({ namespace: 'engineSources' })
export class EngineSourcesController implements EngineSourcesBridge {
    /**
     * Creates the engine source controller.
     *
     * @param sources - Engine source registry.
     * @param catalog - Editor catalog holding source refresh state.
     * @param engineStatus - Project engine pin status checks.
     * @param configService - Runtime configuration naming the GitHub App.
     */
    constructor(
        private readonly sources: EngineSourcesService,
        private readonly catalog: EditorCatalogService,
        private readonly engineStatus: ProjectEngineStatusService,
        private readonly configService: ConfigService<AppConfig>,
    ) {}

    /**
     * Lists sources with their cached refresh state, without refreshing.
     *
     * @returns Every engine source with its state.
     */
    @EngineSourcesHandler('listSources')
    async listSources(): Promise<EngineSourceSummary[]> {
        return this.summarize(
            await this.catalog.getCatalog({ refreshIfStale: false }),
        );
    }

    /**
     * Validates and adds a fork source, then loads its releases.
     *
     * @param input - Repository owner, name, and optional display name.
     * @returns The updated sources or the refusal reason.
     */
    @EngineSourcesHandler('addSource')
    async addSource(
        input: AddEngineSourceInput,
    ): Promise<AddEngineSourceResult> {
        const added = await this.sources.add(input);
        if (!added.ok) {
            return added.reason === 'no-access'
                ? { ...added, githubAppInstallUrl: this.githubAppInstallUrl() }
                : added;
        }
        return {
            ok: true,
            sources: await this.summarize(
                await this.catalog.refreshProvider(added.source.id),
            ),
        };
    }

    /**
     * Removes a configured fork source and its cached releases.
     *
     * @param id - Fork source ID.
     * @returns The remaining sources.
     */
    @EngineSourcesHandler('removeSource')
    async removeSource(
        id: EditorCatalogProviderId,
    ): Promise<EngineSourceSummary[]> {
        if (await this.sources.remove(id)) {
            await this.catalog.removeProvider(id);
        }
        return this.listSources();
    }

    /**
     * Refreshes the releases of one source.
     *
     * @param id - Source ID.
     * @returns Every source with its state after the refresh.
     */
    @EngineSourcesHandler('refreshSource')
    async refreshSource(
        id: EditorCatalogProviderId,
    ): Promise<EngineSourceSummary[]> {
        return this.summarize(await this.catalog.refreshProvider(id));
    }

    /**
     * Reports how far a project's pinned fork revision is behind its source.
     *
     * @param projectPath - Registered project directory.
     * @param options - Set `force` to bypass the cache.
     * @returns The engine pin status.
     */
    @EngineSourcesHandler('getProjectEngineStatus')
    getProjectEngineStatus(
        projectPath: string,
        options?: { force?: boolean },
    ): Promise<ProjectEngineStatus> {
        return this.engineStatus.getProjectEngineStatus(projectPath, options);
    }

    /**
     * Combines configured sources with catalog refresh state.
     *
     * @param catalog - Catalog result holding provider states.
     * @returns Source summaries in registry order.
     */
    private async summarize(
        catalog: EditorCatalogResult,
    ): Promise<EngineSourceSummary[]> {
        const installUrl = this.githubAppInstallUrl();
        return (await this.sources.list()).map((source) => {
            const status = catalog.providers.find(
                (provider) => provider.id === source.id,
            );
            return {
                ...source,
                state:
                    status?.state === 'ok' && status.lastFetchedAt === null
                        ? 'pending'
                        : (status?.state ?? 'pending'),
                lastFetchedAt: status?.lastFetchedAt ?? null,
                ...(status?.refreshError ? { error: status.refreshError } : {}),
                buildCount: catalog.releases.filter(
                    (release) => release.providerId === source.id,
                ).length,
                ...(source.requiresAuth
                    ? { githubAppInstallUrl: installUrl }
                    : {}),
            };
        });
    }

    /**
     * Builds the page where the GitHub App is installed on an account or
     * organisation, granting it access to private engine repositories.
     *
     * @returns The GitHub App installation URL.
     */
    private githubAppInstallUrl(): string {
        return githubAppInstallationUrl(
            this.configService.getOrThrow('githubAppSlug'),
        );
    }
}
