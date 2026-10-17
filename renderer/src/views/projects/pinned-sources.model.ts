import type {
    AddEngineSourceInput,
    AddEngineSourceResult,
    EngineSourceSummary,
    ReleaseSummary,
} from '@shared/contracts';
import {
    type LocalImportRow,
    resolveAddedSourceAction,
} from './local-import-editor.model';

/** Why a reviewed fork pin's source could not be added yet. */
export type PinnedSourceState =
    | { kind: 'adding' }
    | { kind: 'auth-required' }
    | { kind: 'no-access'; installUrl?: string }
    | { kind: 'failed' }
    | { kind: 'build-missing' };

/** States keyed by lower-case GitHub `owner/repo`. */
export type PinnedSourceStates = Record<string, PinnedSourceState>;

/**
 * Names every added fork source, so review can offer adding a missing one.
 *
 * @param sources - Engine sources.
 * @returns GitHub `owner/repo` of each fork source.
 */
export function getForkSourceNames(sources: EngineSourceSummary[]): string[] {
    return sources
        .filter((source) => source.kind === 'fork')
        .map((source) => `${source.owner}/${source.repo}`);
}

/**
 * Names the fork source a reviewed row is pinned to.
 *
 * @param row - Reviewed row.
 * @returns GitHub `owner/repo` of an exact fork pin, if any.
 */
export function getRowPinnedSource(row: LocalImportRow): string | undefined {
    const downloadable = row.editorResolution?.downloadable;
    return downloadable?.match === 'exact'
        ? downloadable.fork?.source
        : undefined;
}

/** Bridge operations used to add pinned sources. */
export type PinnedSourceDeps = {
    addSource: (input: AddEngineSourceInput) => Promise<AddEngineSourceResult>;
    /** Fork builds listed once the added sources were refreshed. */
    loadForkReleases: () => Promise<ReleaseSummary[]>;
};

/** Outcome of adding the sources of selected add-source actions. */
export type PinnedSourcesResult = {
    /** Rows in the same order, with added sources' exact builds offered. */
    rows: LocalImportRow[];
    /** Sources that are still blocked, keyed by lower-case `owner/repo`. */
    blocked: PinnedSourceStates;
};

/**
 * Adds the source of every selected add-source action, then offers the
 * exact pinned builds those sources list. Never substitutes another build.
 *
 * @param rows - Reviewed rows with their chosen editor actions.
 * @param deps - Source registration and catalog reads.
 * @returns Updated rows and the sources that are still blocked.
 */
export async function addPinnedSources(
    rows: LocalImportRow[],
    deps: PinnedSourceDeps,
): Promise<PinnedSourcesResult> {
    const sources = [
        ...new Set(
            rows.flatMap((row) => {
                const action = row.editorActions.find(
                    (candidate) => candidate.id === row.editorActionId,
                );
                return action?.kind === 'add-source' && action.pinnedSource
                    ? [action.pinnedSource]
                    : [];
            }),
        ),
    ];
    if (sources.length === 0) return { rows, blocked: {} };

    const blocked: PinnedSourceStates = {};
    const added = new Set<string>();
    for (const source of sources) {
        const key = source.toLowerCase();
        try {
            const result = await deps.addSource({
                url: `https://github.com/${source}`,
            });
            if (result.ok || result.reason === 'duplicate') {
                added.add(key);
            } else if (result.reason === 'auth-required') {
                blocked[key] = { kind: 'auth-required' };
            } else if (result.reason === 'no-access') {
                blocked[key] = {
                    kind: 'no-access',
                    ...(result.githubAppInstallUrl
                        ? { installUrl: result.githubAppInstallUrl }
                        : {}),
                };
            } else {
                blocked[key] = { kind: 'failed' };
            }
        } catch {
            blocked[key] = { kind: 'failed' };
        }
    }
    if (added.size === 0) return { rows, blocked };

    const forkReleases = await deps.loadForkReleases();
    const resolved = rows.map((row) => {
        const source = getRowPinnedSource(row)?.toLowerCase();
        if (!source || !added.has(source)) return row;
        const next = resolveAddedSourceAction(row, forkReleases);
        if (
            row.editorActionId === 'add-source' &&
            next.editorActionId !== 'download'
        ) {
            blocked[source] = { kind: 'build-missing' };
        }
        return next;
    });
    return { rows: resolved, blocked };
}
