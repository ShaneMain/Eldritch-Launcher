import { Injectable } from '@mariodebono/di';
import type {
    EditorCatalogRelease,
    ForkBuildIdentity,
    ProjectEngineStatus,
} from '@shared/contracts';
import logger from 'electron-log';
import { z } from 'zod';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectsStore } from '../projects/projects.store.js';
import {
    getProjectLauncherFork,
    readProjectLauncherConfig,
} from '../utils/projectLauncherConfig.utils.js';
import {
    PROJECT_ENGINE_STATUS_CONCURRENCY,
    PROJECT_ENGINE_STATUS_TTL_MS,
} from './editor-catalog.constants.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EditorCatalogService } from './editor-catalog.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EngineSourcesService } from './engine-sources.service.js';
import { EngineSourceAuthError } from './github-source.errors.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GithubSourceAccessService } from './github-source-access.service.js';

const RepositorySchema = z.object({ default_branch: z.string().min(1) });
const CompareSchema = z.object({
    status: z.string(),
    ahead_by: z.number().int().nonnegative(),
    behind_by: z.number().int().nonnegative(),
});

/** Commit distance between a pinned revision and the default branch. */
export type EngineRevisionDistance = {
    compareStatus: string;
    behindBy: number;
    aheadBy: number;
};

/**
 * Reads the distance from a `compare/{revision}...{branch}` response. GitHub
 * reports `ahead_by` as commits on the branch (head) missing from the pinned
 * revision (base), so that is how far the pin is behind the branch.
 *
 * @param value - GitHub compare response body.
 * @returns The commit distance.
 */
export function parseEngineCompare(value: unknown): EngineRevisionDistance {
    const compare = CompareSchema.parse(value);
    return {
        compareStatus: compare.status,
        behindBy: compare.ahead_by,
        aheadBy: compare.behind_by,
    };
}

/**
 * Finds the newest catalog build of the pinned source for this platform and
 * flavor that was published after the pinned build.
 *
 * @param releases - Catalog releases.
 * @param fork - Pinned fork build.
 * @param target - Current platform, architecture, and flavor.
 * @returns The newer build, or undefined when the pin is the newest.
 */
export function findNewerForkBuild(
    releases: readonly EditorCatalogRelease[],
    fork: ForkBuildIdentity,
    target: { platform: string; architecture: string; mono: boolean },
): EditorCatalogRelease | undefined {
    const source = fork.source.toLowerCase();
    const candidates = releases.filter(
        (release) =>
            release.fork?.source.toLowerCase() === source &&
            release.variants.some(
                (variant) =>
                    (variant.flavor === 'dotnet') === target.mono &&
                    variant.assets.some(
                        (asset) =>
                            asset.platform === target.platform &&
                            asset.architecture === target.architecture,
                    ),
            ),
    );
    const publishedTime = (release: EditorCatalogRelease) =>
        release.publishedAt ? Date.parse(release.publishedAt) : 0;
    const pinned = releases.find(
        (release) =>
            release.fork?.source.toLowerCase() === source &&
            release.fork.revision === fork.revision,
    );
    const newest = candidates.sort(
        (a, b) => publishedTime(b) - publishedTime(a),
    )[0];
    if (
        !newest ||
        newest.fork?.revision === fork.revision ||
        (pinned && publishedTime(newest) <= publishedTime(pinned))
    ) {
        return undefined;
    }
    return newest;
}

/** Cached status of one project pin. */
type CachedStatus = {
    key: string;
    checkedAt: number;
    promise: Promise<ProjectEngineStatus>;
};

/** Reports how far fork-pinned projects are behind their engine source. */
@Injectable()
export class ProjectEngineStatusService {
    private readonly cache = new Map<string, CachedStatus>();
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    /**
     * Creates the engine status service.
     *
     * @param projects - Registered projects.
     * @param sources - Configured engine sources.
     * @param catalog - Editor catalog with fork builds.
     * @param access - GitHub REST access.
     */
    constructor(
        private readonly projects: ProjectsStore,
        private readonly sources: EngineSourcesService,
        private readonly catalog: EditorCatalogService,
        private readonly access: GithubSourceAccessService,
    ) {}

    /**
     * Gets the engine pin status of one registered project, cached per
     * project and pin for a limited time.
     *
     * @param projectPath - Registered project directory.
     * @param options - Set `force` to ignore the cache.
     * @returns The project's engine pin status.
     */
    async getProjectEngineStatus(
        projectPath: string,
        options: { force?: boolean } = {},
    ): Promise<ProjectEngineStatus> {
        const project = (await this.projects.list()).find(
            (candidate) => candidate.path === projectPath,
        );
        if (!project) {
            return { kind: 'not-fork' };
        }
        let fork: ForkBuildIdentity | undefined;
        try {
            const config = await readProjectLauncherConfig(projectPath);
            fork = config ? getProjectLauncherFork(config) : undefined;
        } catch (error) {
            logger.warn(`Failed to read engine pin for ${projectPath}`, error);
        }
        fork ??= project.release.fork;
        if (!fork) {
            return { kind: 'not-fork' };
        }

        const key = `${fork.source.toLowerCase()}@${fork.revision}:${project.release.mono}`;
        const cached = this.cache.get(projectPath);
        if (
            !options.force &&
            cached?.key === key &&
            Date.now() - cached.checkedAt < PROJECT_ENGINE_STATUS_TTL_MS
        ) {
            return cached.promise;
        }
        const pinned = fork;
        const promise = this.limit(() =>
            this.check(pinned, project.release.mono),
        );
        this.cache.set(projectPath, { key, checkedAt: Date.now(), promise });
        return promise;
    }

    /**
     * Runs one check under the shared concurrency limit.
     *
     * @param task - Check to run.
     * @returns The check result.
     */
    private async limit<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= PROJECT_ENGINE_STATUS_CONCURRENCY) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        }
        this.active += 1;
        try {
            return await task();
        } finally {
            this.active -= 1;
            this.waiting.shift()?.();
        }
    }

    /**
     * Compares a pinned revision with its source's default branch and the
     * newest published build.
     *
     * @param fork - Pinned fork build.
     * @param mono - Whether the project uses the .NET edition.
     * @returns The engine pin status.
     */
    private async check(
        fork: ForkBuildIdentity,
        mono: boolean,
    ): Promise<ProjectEngineStatus> {
        const source = await this.sources.findFork(fork.source);
        if (!source) {
            return { kind: 'unknown-source', source: fork.source };
        }
        try {
            const distance = await this.access.withToken(async (token) => {
                if (!token && source.requiresAuth) {
                    throw new EngineSourceAuthError(fork.source);
                }
                const base = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
                const repository = RepositorySchema.parse(
                    await (
                        await this.access.request(base, token, source)
                    ).json(),
                );
                const compare = parseEngineCompare(
                    await (
                        await this.access.request(
                            `${base}/compare/${fork.revision}...${encodeURIComponent(repository.default_branch)}`,
                            token,
                            source,
                        )
                    ).json(),
                );
                return { branch: repository.default_branch, ...compare };
            });
            const catalog = await this.catalog.getCatalog();
            const newer = findNewerForkBuild(catalog.releases, fork, {
                platform: process.platform,
                architecture: process.arch,
                mono,
            });
            return {
                kind: 'ok',
                source: fork.source,
                sourceId: source.id,
                revision: fork.revision,
                ...distance,
                ...(newer?.fork
                    ? {
                          newerBuild: {
                              releaseId: newer.id,
                              tag: newer.tag,
                              version: newer.version,
                              revision: newer.fork.revision,
                              publishedAt: newer.publishedAt,
                          },
                      }
                    : {}),
                checkedAt: Date.now(),
            };
        } catch (error) {
            if (error instanceof EngineSourceAuthError) {
                return { kind: 'auth-required', source: fork.source };
            }
            logger.warn(`Failed to check engine pin ${fork.source}`, error);
            return {
                kind: 'error',
                source: fork.source,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
