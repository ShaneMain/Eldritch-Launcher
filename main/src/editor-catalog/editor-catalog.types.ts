import type {
    EditorCatalogProviderId,
    EditorCatalogRelease,
} from '@shared/contracts';

/** Storage settings supplied by the application. */
export type EditorCatalogModuleOptions = {
    directory: string;
    fileName: string;
    /** File holding user-configured engine sources. */
    sourcesFileName: string;
};

/** GitHub asset fields used by the catalog mapper. */
export type GithubEditorAsset = {
    id: number;
    name: string;
    browserDownloadUrl: string;
    /** GitHub API asset URL used for authenticated downloads. */
    apiUrl?: string;
    digest: string | null;
    size?: number;
};

/** GitHub release fields used by the catalog mapper. */
export type GithubEditorRelease = {
    id: number;
    name: string | null;
    tagName: string;
    publishedAt: string | null;
    draft: boolean;
    prerelease: boolean;
    /** Branch or commit the release tag was created from. */
    targetCommitish?: string;
    assets: GithubEditorAsset[];
};

/** Last refresh failure kept with cached provider data. */
export type EditorCatalogRefreshFailure = {
    state: 'auth-required' | 'error';
    message: string;
};

/** Cached data for one catalog provider. */
export type EditorCatalogProviderState = {
    integrityMetadataRefreshed?: boolean;
    templateMetadataRefreshed?: boolean;
    lastFetchedAt: number | null;
    lastPublishedAt: string | null;
    lastFailure?: EditorCatalogRefreshFailure;
    releases: EditorCatalogRelease[];
};

/** Complete catalog data stored in the JSON file. */
export type EditorCatalogFile = {
    schemaVersion: 1;
    providers: Record<EditorCatalogProviderId, EditorCatalogProviderState>;
};

/** New provider data returned by a GitHub refresh. */
export type FetchedEditorCatalogProvider = {
    providerId: EditorCatalogProviderId;
    lastPublishedAt: string | null;
    releases: EditorCatalogRelease[];
};

/** One user-configured GitHub fork source as stored on disk. */
export type StoredForkSource = {
    owner: string;
    repo: string;
    displayName: string;
    requiresAuth: boolean;
};

/** Engine source file stored in the config directory. */
export type EngineSourcesFile = {
    schemaVersion: 1;
    forks: StoredForkSource[];
};
