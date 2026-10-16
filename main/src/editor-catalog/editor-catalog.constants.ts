import type { EditorCatalogProviderId, EngineSource } from '@shared/contracts';

/** Token used to inject the catalog module options. */
export const EDITOR_CATALOG_MODULE_OPTIONS = Symbol(
    'EDITOR_CATALOG_MODULE_OPTIONS',
);
/** Current version of the stored catalog format. */
export const EDITOR_CATALOG_SCHEMA_VERSION = 1 as const;
/** Current version of the stored engine source format. */
export const ENGINE_SOURCES_SCHEMA_VERSION = 1 as const;
/** Time before cached catalog data becomes stale. */
export const EDITOR_CATALOG_CACHE_TTL_MS = 1000 * 60 * 10;
/** Oldest supported Godot editor major version. */
export const EDITOR_CATALOG_MIN_VERSION = 4;
/** Number of GitHub releases requested on each page. */
export const EDITOR_CATALOG_PAGE_SIZE = 100;
/** Highest number of GitHub pages fetched in one refresh. */
export const EDITOR_CATALOG_PAGE_LIMIT = 100;
/** Largest accepted fork build manifest. */
export const FORK_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
/** Fork build manifest schema understood by the fork mapper. */
export const FORK_MANIFEST_SCHEMA = 'godot.native-attenuation-build/1';
/** Time before a cached project engine status is checked again. */
export const PROJECT_ENGINE_STATUS_TTL_MS = 1000 * 60 * 10;
/** Highest number of concurrent project engine status checks. */
export const PROJECT_ENGINE_STATUS_CONCURRENCY = 4;

/** Built-in official provider IDs. */
export const OFFICIAL_ENGINE_SOURCE_IDS = [
    'official-stable',
    'official-prerelease',
] as const satisfies readonly EditorCatalogProviderId[];

/** GitHub settings for the built-in official sources. */
export const OFFICIAL_ENGINE_SOURCES: readonly EngineSource[] = [
    {
        id: 'official-stable',
        kind: 'official',
        owner: 'godotengine',
        repo: 'godot',
        displayName: 'Godot',
        requiresAuth: false,
        builtIn: true,
    },
    {
        id: 'official-prerelease',
        kind: 'official',
        owner: 'godotengine',
        repo: 'godot-builds',
        displayName: 'Godot prereleases',
        requiresAuth: false,
        builtIn: true,
    },
];

/** Fork source added to a new engine source file. */
export const DEFAULT_FORK_SOURCE = {
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: 'Eldritch Engine',
    requiresAuth: true,
} as const;

/** GitHub owner or repository name accepted for a fork source. */
export const GITHUB_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/**
 * Creates the stable catalog ID for a GitHub fork source.
 *
 * @param owner - GitHub repository owner.
 * @param repo - GitHub repository name.
 * @returns A case-insensitive source ID shared by pins and the catalog.
 */
export function forkSourceId(owner: string, repo: string): string {
    return `fork:${owner}/${repo}`.toLowerCase();
}
