import type { ExportTemplateAsset } from '../export-templates/index.js';
/**
 * Identifies a source of editor releases: `official-stable`,
 * `official-prerelease`, or a configured fork source ID.
 */
export type EditorCatalogProviderId = string;

/** Identifies the scripting support included in an editor build. */
export type EditorCatalogFlavor = 'gdscript' | 'dotnet';
/** Identifies an operating system supported by an editor asset. */
export type EditorCatalogPlatform = 'win32' | 'darwin' | 'linux';
/** Identifies a processor architecture supported by an editor asset. */
export type EditorCatalogArchitecture = 'x64' | 'arm64' | 'ia32' | 'arm';

/** Describes one downloadable editor file. */
export type EditorCatalogAsset = {
    id: string;
    name: string;
    downloadUrl: string;
    digest?: string;
    checksumManifestUrl?: string;
    platform: EditorCatalogPlatform;
    architecture: EditorCatalogArchitecture;
};

/** Groups release assets by editor flavor. */
export type EditorCatalogVariant = {
    id: string;
    flavor: EditorCatalogFlavor;
    assets: EditorCatalogAsset[];
};

/** Contains version values used for sorting releases. */
export type EditorCatalogVersionParts = {
    major: number;
    minor: number;
    patch: number;
    channel: string;
    iteration: number;
};

/** Identifies the exact fork build described by a release manifest. */
export type EditorCatalogForkBuild = {
    sourceId: EditorCatalogProviderId;
    /** GitHub `owner/repo` that publishes the build. */
    source: string;
    /** Full 40-hex engine commit the build was produced from. */
    revision: string;
    /**
     * Full 40-hex upstream Godot commit the fork is based on, when the
     * release publishes a build manifest.
     */
    upstreamBase?: string;
};

/** Describes one editor release in the catalog. */
export type EditorCatalogRelease = {
    id: string;
    sourceReleaseId: string;
    providerId: EditorCatalogProviderId;
    tag: string;
    version: string;
    baseVersion: string;
    name: string;
    publishedAt: string | null;
    prerelease: boolean;
    versionParts: EditorCatalogVersionParts;
    variants: EditorCatalogVariant[];
    templateAssets?: ExportTemplateAsset[];
    /** Present for releases of fork sources. */
    fork?: EditorCatalogForkBuild;
};

/** Reports whether a provider's latest refresh succeeded. */
export type EditorCatalogProviderHealth = 'ok' | 'auth-required' | 'error';

/** Reports the cache state of one catalog provider. */
export type EditorCatalogProviderStatus = {
    id: EditorCatalogProviderId;
    lastFetchedAt: number | null;
    isStale: boolean;
    state: EditorCatalogProviderHealth;
    refreshError?: string;
};

/** Filters editor releases returned by the catalog. */
export type EditorCatalogQuery = {
    search?: string;
    prerelease?: boolean;
    flavor?: EditorCatalogFlavor;
    platform?: EditorCatalogPlatform;
    architecture?: EditorCatalogArchitecture;
};

/** Contains matching releases and provider cache state. */
export type EditorCatalogResult = {
    releases: EditorCatalogRelease[];
    providers: EditorCatalogProviderStatus[];
};

/** Controls catalog refresh and filtering behavior. */
export type GetEditorCatalogOptions = {
    refreshIfStale?: boolean;
    query?: EditorCatalogQuery;
};

/** Defines the catalog requests available to the renderer. */
export type EditorCatalogBridge = {
    /**
     * Gets releases from the editor catalog.
     *
     * @param options - Optional refresh and filter settings.
     * @returns The matching releases and provider status.
     */
    getCatalog(options?: GetEditorCatalogOptions): Promise<EditorCatalogResult>;

    /**
     * Finds one release by its exact catalog ID.
     *
     * @param id - The release ID to find.
     * @returns The release, or null when it does not exist.
     */
    getReleaseById(id: string): Promise<EditorCatalogRelease | null>;

    /**
     * Refreshes the catalog and returns matching releases.
     *
     * @param query - Optional filters for the returned releases.
     * @returns The refreshed releases and provider status.
     */
    refreshCatalog(query?: EditorCatalogQuery): Promise<EditorCatalogResult>;
};
