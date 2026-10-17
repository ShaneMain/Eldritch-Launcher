import type {
    EditorCatalogRelease,
    EditorCatalogResult,
    ReleaseSummary,
} from '@shared/contracts';

/** Built-in providers that publish the official Godot channels. */
const OFFICIAL_PROVIDER_IDS: Record<string, true> = {
    'official-stable': true,
    'official-prerelease': true,
};

/** Catalog data in the shape still used by the release provider. */
export type LegacyEditorCatalog = {
    availableReleases: ReleaseSummary[];
    availablePrereleases: ReleaseSummary[];
    /** Builds published by fork sources, kept apart from official channels. */
    forkReleases: ReleaseSummary[];
    refreshError?: string;
};

/**
 * Converts one catalog release into the legacy install shape.
 *
 * @param release - The catalog release to convert.
 * @returns A release that the current installer can use.
 */
export function mapEditorCatalogRelease(
    release: EditorCatalogRelease,
): ReleaseSummary {
    return {
        tag: release.tag,
        version: release.version,
        version_number: Number.parseFloat(release.baseVersion),
        name: release.name,
        published_at: release.publishedAt,
        draft: false,
        prerelease: release.versionParts.channel !== 'stable',
        assets: release.variants.flatMap((variant) =>
            variant.assets.map((asset) => ({
                name: asset.name,
                download_url: asset.downloadUrl,
                digest: asset.digest,
                checksum_manifest_url: asset.checksumManifestUrl,
                platform_tags: [asset.platform, asset.architecture],
                mono: variant.flavor === 'dotnet',
            })),
        ),
        ...(release.fork
            ? {
                  fork: {
                      sourceId: release.fork.sourceId,
                      source: release.fork.source,
                      revision: release.fork.revision,
                  },
              }
            : {}),
    };
}

/**
 * Splits catalog releases into the lists used by the current UI.
 *
 * Fork builds are returned separately so official channels stay unchanged.
 * Fork providers that need a GitHub login are reported by the engine sources
 * UI rather than as a generic catalog failure.
 *
 * @param result - The catalog result to convert.
 * @returns Official stable and prerelease lists, fork builds, and any refresh error.
 */
export function mapEditorCatalogResult(
    result: EditorCatalogResult,
): LegacyEditorCatalog {
    const officialReleases = deduplicateEditorCatalogReleases(
        result.releases.filter((release) => !release.fork),
    ).map(mapEditorCatalogRelease);

    return {
        availableReleases: officialReleases.filter(
            (release) => !release.prerelease,
        ),
        availablePrereleases: officialReleases.filter(
            (release) => release.prerelease,
        ),
        forkReleases: result.releases
            .filter((release) => release.fork)
            .map(mapEditorCatalogRelease),
        // Fork sources blocked by GitHub access are explained by the engine
        // sources UI, not as a generic catalog failure.
        refreshError: result.providers.find(
            (provider) =>
                provider.refreshError &&
                !(
                    (provider.state === 'auth-required' ||
                        provider.state === 'no-access') &&
                    OFFICIAL_PROVIDER_IDS[provider.id] !== true
                ),
        )?.refreshError,
    };
}

/**
 * Keeps one coherent catalog release for each exact version.
 *
 * @param releases - Catalog releases in provider order.
 * @returns Unique releases in the order their versions first appeared.
 */
export function deduplicateEditorCatalogReleases(
    releases: EditorCatalogRelease[],
): EditorCatalogRelease[] {
    const releasesByVersion = new Map<string, EditorCatalogRelease>();

    for (const release of releases) {
        const existingRelease = releasesByVersion.get(release.version);

        if (
            !existingRelease ||
            (!isPreferredProvider(existingRelease) &&
                isPreferredProvider(release))
        ) {
            releasesByVersion.set(release.version, release);
        }
    }

    return [...releasesByVersion.values()];
}

/**
 * Checks whether a release comes from the provider responsible for its channel.
 *
 * @param release - The release whose provider should be checked.
 * @returns Whether the provider is preferred for the release channel.
 */
function isPreferredProvider(release: EditorCatalogRelease): boolean {
    return release.versionParts.channel === 'stable'
        ? release.providerId === 'official-stable'
        : release.providerId === 'official-prerelease';
}
