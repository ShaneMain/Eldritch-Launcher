import type {
    EditorCatalogProviderHealth,
    EditorCatalogProviderId,
} from './editor-catalog.bridge.js';

/** Distinguishes built-in official sources from configured GitHub forks. */
export type EngineSourceKind = 'official' | 'fork';

/** Describes one GitHub repository that publishes editor builds. */
export type EngineSource = {
    id: EditorCatalogProviderId;
    kind: EngineSourceKind;
    owner: string;
    repo: string;
    displayName: string;
    /** Whether release listing and downloads need a GitHub login. */
    requiresAuth: boolean;
    /** Built-in sources cannot be removed. */
    builtIn: boolean;
};

/** Describes one source with its latest catalog refresh state. */
export type EngineSourceSummary = EngineSource & {
    state: EditorCatalogProviderHealth | 'pending';
    lastFetchedAt: number | null;
    error?: string;
};

/** Input accepted when adding a fork source. */
export type AddEngineSourceInput = {
    owner: string;
    repo: string;
    displayName?: string;
};

/** Reports why a fork source could not be added. */
export type AddEngineSourceFailure =
    | 'invalid'
    | 'duplicate'
    | 'not-found'
    | 'auth-required'
    | 'network';

/** Result of adding a fork source. */
export type AddEngineSourceResult =
    | { ok: true; sources: EngineSourceSummary[] }
    | { ok: false; reason: AddEngineSourceFailure };

/** Engine-pin freshness for a project pinned to a fork build. */
export type ProjectEngineStatus =
    | { kind: 'not-fork' }
    | { kind: 'auth-required'; source: string }
    | { kind: 'unknown-source'; source: string }
    | { kind: 'error'; source: string; message: string }
    | {
          kind: 'ok';
          source: string;
          sourceId: EditorCatalogProviderId;
          revision: string;
          branch: string;
          /** Commits on the default branch that the pinned revision lacks. */
          behindBy: number;
          /** Commits in the pinned revision that are not on the default branch. */
          aheadBy: number;
          compareStatus: string;
          /** Newest catalog build for this platform published after the pin. */
          newerBuild?: {
              releaseId: string;
              tag: string;
              version: string;
              revision: string;
              publishedAt: string | null;
          };
          checkedAt: number;
      };

/** Engine source management and fork engine-pin status requests. */
export type EngineSourcesBridge = {
    /** Lists built-in and configured sources with refresh state. */
    listSources(): Promise<EngineSourceSummary[]>;

    /** Validates a GitHub repository and adds it as a fork source. */
    addSource(input: AddEngineSourceInput): Promise<AddEngineSourceResult>;

    /** Removes one configured fork source and its cached releases. */
    removeSource(id: EditorCatalogProviderId): Promise<EngineSourceSummary[]>;

    /** Refreshes the catalog for one source. */
    refreshSource(id: EditorCatalogProviderId): Promise<EngineSourceSummary[]>;

    /**
     * Reports how far a project's pinned fork revision is behind its source.
     *
     * @param projectPath - Registered project directory.
     * @param options - Set `force` to bypass the per-project cache.
     */
    getProjectEngineStatus(
        projectPath: string,
        options?: { force?: boolean },
    ): Promise<ProjectEngineStatus>;
};
