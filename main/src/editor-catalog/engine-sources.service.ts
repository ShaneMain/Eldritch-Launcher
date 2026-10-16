import { Injectable } from '@mariodebono/di';
import type {
    AddEngineSourceFailure,
    AddEngineSourceInput,
    EditorCatalogProviderId,
    EngineSource,
} from '@shared/contracts';
import { z } from 'zod';
import { isTrustedForkAssetUrl } from '../utils/archive-integrity.util.js';
import {
    forkSourceId,
    GITHUB_NAME_PATTERN,
    OFFICIAL_ENGINE_SOURCES,
} from './editor-catalog.constants.js';
import type { StoredForkSource } from './editor-catalog.types.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { EngineSourcesStore } from './engine-sources.store.js';
import {
    EngineSourceAuthError,
    GithubRequestError,
} from './github-source.errors.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GithubSourceAccessService } from './github-source-access.service.js';

const GithubRepositorySchema = z.object({
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    owner: z.object({ login: z.string() }),
});

/** Result of adding a fork source before catalog state is attached. */
export type AddForkSourceOutcome =
    | { ok: true; source: EngineSource }
    | { ok: false; reason: AddEngineSourceFailure };

/** Owns the built-in and user-configured engine source registry. */
@Injectable()
export class EngineSourcesService {
    /**
     * Creates the engine source registry.
     *
     * @param store - Stored fork sources.
     * @param access - GitHub access used to validate new sources.
     */
    constructor(
        private readonly store: EngineSourcesStore,
        private readonly access: GithubSourceAccessService,
    ) {}

    /**
     * Lists built-in official sources followed by configured fork sources.
     *
     * @returns Every engine source.
     */
    async list(): Promise<EngineSource[]> {
        const file = await this.store.read();
        return [...OFFICIAL_ENGINE_SOURCES, ...file.forks.map(toForkSource)];
    }

    /**
     * Finds one source by catalog ID.
     *
     * @param id - Catalog source ID.
     * @returns The source, or undefined when it is not configured.
     */
    async get(id: EditorCatalogProviderId): Promise<EngineSource | undefined> {
        return (await this.list()).find((source) => source.id === id);
    }

    /**
     * Finds the configured fork source that publishes `owner/repo`.
     *
     * @param source - GitHub `owner/repo`, compared case-insensitively.
     * @returns The configured fork source, or undefined.
     */
    async findFork(source: string): Promise<EngineSource | undefined> {
        const [owner, repo] = source.split('/');
        if (!owner || !repo) {
            return undefined;
        }
        return this.get(forkSourceId(owner, repo));
    }

    /**
     * Validates a GitHub repository and stores it as a fork source.
     *
     * @param input - Repository owner, name, and optional display name.
     * @returns The new source or the reason it was refused.
     */
    async add(input: AddEngineSourceInput): Promise<AddForkSourceOutcome> {
        const owner = input.owner.trim();
        const repo = input.repo.trim();
        const displayName = input.displayName?.trim();
        if (
            !GITHUB_NAME_PATTERN.test(owner) ||
            !GITHUB_NAME_PATTERN.test(repo) ||
            (displayName !== undefined && displayName.length > 100)
        ) {
            return { ok: false, reason: 'invalid' };
        }
        const sources = await this.list();
        const key = `${owner}/${repo}`.toLowerCase();
        if (
            sources.some(
                (source) =>
                    `${source.owner}/${source.repo}`.toLowerCase() === key,
            )
        ) {
            return { ok: false, reason: 'duplicate' };
        }

        let repository: z.infer<typeof GithubRepositorySchema>;
        try {
            repository = await this.access.withToken(async (token) => {
                // Without a login a private repository answers 404, so ask
                // for sign-in instead of reporting it missing.
                const response = await this.access.request(
                    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
                    token,
                    { owner, repo, requiresAuth: !token },
                );
                return GithubRepositorySchema.parse(await response.json());
            });
        } catch (error) {
            if (error instanceof EngineSourceAuthError) {
                return { ok: false, reason: 'auth-required' };
            }
            if (error instanceof GithubRequestError && error.status !== 0) {
                return {
                    ok: false,
                    reason: error.status === 404 ? 'not-found' : 'network',
                };
            }
            return { ok: false, reason: 'network' };
        }

        const stored: StoredForkSource = {
            owner: repository.owner.login,
            repo: repository.name,
            displayName: displayName || repository.name,
            requiresAuth: repository.private,
        };
        let duplicate = false;
        await this.store.update((current) => {
            duplicate = current.forks.some(
                (fork) =>
                    forkSourceId(fork.owner, fork.repo) ===
                    forkSourceId(stored.owner, stored.repo),
            );
            return duplicate
                ? current
                : { ...current, forks: [...current.forks, stored] };
        });
        return duplicate
            ? { ok: false, reason: 'duplicate' }
            : { ok: true, source: toForkSource(stored) };
    }

    /**
     * Removes one configured fork source. Built-in sources are kept.
     *
     * @param id - Fork source ID.
     * @returns Whether a source was removed.
     */
    async remove(id: EditorCatalogProviderId): Promise<boolean> {
        let removed = false;
        await this.store.update((current) => {
            const forks = current.forks.filter(
                (fork) => forkSourceId(fork.owner, fork.repo) !== id,
            );
            removed = forks.length !== current.forks.length;
            return removed ? { ...current, forks } : current;
        });
        return removed;
    }

    /**
     * Converts a fork release asset API URL into a signed download URL using
     * the GitHub credential. Other URLs are returned unchanged.
     *
     * @param downloadUrl - Catalog asset download URL.
     * @param signal - Optional cancellation signal.
     * @returns A URL that can be downloaded without credentials.
     */
    async resolveDownloadUrl(
        downloadUrl: string,
        signal?: AbortSignal,
    ): Promise<string> {
        const source = await this.findAssetSource(downloadUrl);
        if (!source) {
            return downloadUrl;
        }
        return this.access.withToken(async (token) => {
            if (!token && source.requiresAuth) {
                throw new EngineSourceAuthError(
                    `${source.owner}/${source.repo}`,
                );
            }
            return this.access.resolveAssetDownloadUrl(
                downloadUrl,
                token,
                source,
                signal,
            );
        });
    }

    /**
     * Finds the configured fork source owning a release asset API URL.
     *
     * @param downloadUrl - Candidate GitHub API asset URL.
     * @returns The owning fork source, or undefined for any other URL.
     */
    async findAssetSource(
        downloadUrl: string,
    ): Promise<EngineSource | undefined> {
        return (await this.listForks()).find((source) =>
            isTrustedForkAssetUrl(downloadUrl, [source]),
        );
    }

    /**
     * Lists configured fork sources, which are trusted for asset downloads.
     *
     * @returns Fork sources only.
     */
    async listForks(): Promise<EngineSource[]> {
        return (await this.list()).filter((source) => source.kind === 'fork');
    }
}

/**
 * Converts a stored fork source into the shared source shape.
 *
 * @param fork - Stored fork source.
 * @returns The fork source with its catalog ID.
 */
function toForkSource(fork: StoredForkSource): EngineSource {
    return {
        id: forkSourceId(fork.owner, fork.repo),
        kind: 'fork',
        owner: fork.owner,
        repo: fork.repo,
        displayName: fork.displayName,
        requiresAuth: fork.requiresAuth,
        builtIn: false,
    };
}
