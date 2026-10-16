import { Injectable } from '@mariodebono/di';
import type { EngineSource } from '@shared/contracts';
import logger from 'electron-log';
import {
    EDITOR_CATALOG_PAGE_LIMIT,
    EDITOR_CATALOG_PAGE_SIZE,
    FORK_MANIFEST_MAX_BYTES,
} from './editor-catalog.constants.js';
import type {
    FetchedEditorCatalogProvider,
    GithubEditorAsset,
    GithubEditorRelease,
} from './editor-catalog.types.js';
import {
    type ForkManifest,
    ForkManifestSchema,
    findForkManifestAssets,
    mapForkRelease,
} from './fork-release.mapper.js';
import {
    type GithubReleaseResponse,
    githubReleasePageSchema,
} from './github-editor-catalog.schema.js';
import { mapGithubEditorRelease } from './github-editor-release.mapper.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GithubSourceAccessService } from './github-source-access.service.js';

const MANIFEST_DOWNLOAD_CONCURRENCY = 4;
const MANIFEST_TIMEOUT_MS = 60_000;

/** Fetches editor releases from official and fork GitHub sources. */
@Injectable()
export class GithubEditorCatalogAdapter {
    /** Parsed fork manifests by immutable GitHub asset ID. */
    private readonly manifests = new Map<number, ForkManifest>();

    /**
     * Creates the catalog adapter.
     *
     * @param access - GitHub REST access used for every request.
     */
    constructor(private readonly access: GithubSourceAccessService) {}

    /**
     * Remaps fetched releases, using the cached publication time only to stop pagination.
     *
     * @param source - The source to fetch.
     * @param publishedAfter - The newest stored publication time for pagination.
     * @param token - Optional GitHub bearer token valid during this call.
     * @returns Fetched releases and the latest publication time.
     */
    async fetchProvider(
        source: EngineSource,
        publishedAfter: string | null,
        token: string | null,
    ): Promise<FetchedEditorCatalogProvider> {
        const releases: FetchedEditorCatalogProvider['releases'] = [];
        const afterTime = publishedAfter
            ? new Date(publishedAfter).getTime()
            : 0;
        let latestPublishedAt = publishedAfter;

        for (let page = 1; page <= EDITOR_CATALOG_PAGE_LIMIT; page += 1) {
            const path = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases?page=${page}&per_page=${EDITOR_CATALOG_PAGE_SIZE}`;
            logger.debug(`Fetching editor catalog from ${path}`);

            const response = await this.access.request(path, token, source);
            const pageReleases = githubReleasePageSchema
                .parse(await response.json())
                .map(toGithubEditorRelease);
            const reachedBoundary =
                publishedAfter !== null &&
                pageReleases.some((release) => {
                    if (!release.publishedAt) {
                        return false;
                    }
                    return new Date(release.publishedAt).getTime() <= afterTime;
                });
            const mappedPage =
                source.kind === 'fork'
                    ? await this.mapForkPage(source, pageReleases, token)
                    : pageReleases
                          .map((release) =>
                              mapGithubEditorRelease(
                                  source.id,
                                  source.id === 'official-prerelease',
                                  release,
                              ),
                          )
                          .filter((release) => release !== null);
            releases.push(...mappedPage);
            latestPublishedAt = mappedPage.reduce<string | null>(
                (latest, release) => laterDate(latest, release.publishedAt),
                latestPublishedAt,
            );

            if (
                pageReleases.length < EDITOR_CATALOG_PAGE_SIZE ||
                reachedBoundary
            ) {
                break;
            }
        }

        return {
            providerId: source.id,
            lastPublishedAt: latestPublishedAt,
            releases,
        };
    }

    /**
     * Loads missing manifests and maps one page of fork releases.
     *
     * @param source - Fork source that owns the releases.
     * @param releases - Releases on one GitHub page.
     * @param token - Optional GitHub bearer token.
     * @returns Releases with a usable build manifest.
     */
    private async mapForkPage(
        source: EngineSource,
        releases: GithubEditorRelease[],
        token: string | null,
    ): Promise<FetchedEditorCatalogProvider['releases']> {
        const pending = releases
            .filter((release) => !release.draft)
            .flatMap(findForkManifestAssets)
            .filter((asset) => !this.manifests.has(asset.id));
        let nextIndex = 0;
        const loadNext = async (): Promise<void> => {
            while (nextIndex < pending.length) {
                const asset = pending[nextIndex++];
                try {
                    this.manifests.set(
                        asset.id,
                        await this.fetchManifest(source, asset, token),
                    );
                } catch (error) {
                    logger.warn(
                        `Failed to read fork build manifest ${asset.name} from ${source.owner}/${source.repo}`,
                        error,
                    );
                }
            }
        };
        await Promise.all(
            Array.from(
                {
                    length: Math.min(
                        pending.length,
                        MANIFEST_DOWNLOAD_CONCURRENCY,
                    ),
                },
                () => loadNext(),
            ),
        );

        return releases.flatMap((release) => {
            const mapped = mapForkRelease(source, release, this.manifests);
            if (!mapped.ok) {
                logger.info(
                    `Skipping ${source.owner}/${source.repo} release ${release.tagName}: ${mapped.reason}`,
                );
                return [];
            }
            return [mapped.release];
        });
    }

    /**
     * Downloads and parses one fork build manifest with a size limit.
     *
     * @param source - Fork source that owns the manifest.
     * @param asset - Manifest release asset.
     * @param token - Optional GitHub bearer token.
     * @returns The parsed manifest.
     */
    private async fetchManifest(
        source: EngineSource,
        asset: GithubEditorAsset,
        token: string | null,
    ): Promise<ForkManifest> {
        if (!asset.apiUrl) {
            throw new Error('Manifest asset has no API URL');
        }
        if (asset.size !== undefined && asset.size > FORK_MANIFEST_MAX_BYTES) {
            throw new Error('Manifest is too large');
        }
        const signal = AbortSignal.timeout(MANIFEST_TIMEOUT_MS);
        const url = await this.access.resolveAssetDownloadUrl(
            asset.apiUrl,
            token,
            source,
            signal,
        );
        const response = await fetch(url, { signal });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(`Manifest download failed: ${response.status}`);
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > FORK_MANIFEST_MAX_BYTES) {
                throw new Error('Manifest is too large');
            }
            chunks.push(chunk);
        }
        return ForkManifestSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
        );
    }
}

/**
 * Converts a checked GitHub API release into the internal input shape.
 *
 * @param value - The checked GitHub API release.
 * @returns The release fields used by the catalog mapper.
 */
function toGithubEditorRelease(
    value: GithubReleaseResponse,
): GithubEditorRelease {
    return {
        id: value.id,
        name: value.name,
        tagName: value.tag_name,
        publishedAt: value.published_at,
        draft: value.draft,
        prerelease: value.prerelease,
        assets: value.assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            browserDownloadUrl: asset.browser_download_url,
            ...(asset.url ? { apiUrl: asset.url } : {}),
            digest: asset.digest ?? null,
            size: asset.size,
        })),
    };
}

/**
 * Chooses the later of two publication times.
 *
 * @param current - The current latest publication time.
 * @param candidate - The publication time to compare.
 * @returns The later time in ISO format.
 */
function laterDate(
    current: string | null,
    candidate: string | null,
): string | null {
    if (!candidate) {
        return current;
    }
    if (
        !current ||
        new Date(candidate).getTime() > new Date(current).getTime()
    ) {
        return new Date(candidate).toISOString();
    }
    return current;
}
