import type {
    AddProjectOptions,
    EditorFlavor,
    ProjectImportInspection,
    ReleaseSummary,
} from '@shared/contracts';
import { findDownloadableProjectEditor } from './project-editor-resolution.model';

export type LocalImportEditorAction = {
    id: string;
    version?: string;
    name?: string;
    flavor?: EditorFlavor;
    /** `add-source` adds `pinnedSource`, then installs the exact pinned build. */
    kind: 'use' | 'download' | 'add-source' | 'missing';
    recommended?: boolean;
    options: AddProjectOptions;
    download?: ReleaseSummary;
    /** GitHub `owner/repo` of a fork pin whose source is not added yet. */
    pinnedSource?: string;
};
export type LocalImportRow = ProjectImportInspection & {
    editorActions: LocalImportEditorAction[];
    editorActionId: string;
};

/** Names the editor version a review action will install, if any.
 * @param action - Chosen review action.
 * @returns The downloaded or pinned version that adding its source installs.
 */
export function getActionInstallVersion(
    action: LocalImportEditorAction | undefined,
): string | undefined {
    return (
        action?.download?.version ??
        (action?.kind === 'add-source' ? action.version : undefined)
    );
}

/** Builds review actions without starting registration or editor downloads.
 * Fork pins only offer the exact pinned fork build, never an official one.
 * When their source is not added, the exact build is offered through
 * adding that source first.
 * @param row - Read-only main-process inspection.
 * @param stable - Stable catalogue for legacy exact requirements.
 * @param prereleases - Prerelease catalogue for exact requirements.
 * @param forkReleases - Fork source builds for exact fork pins.
 * @param forkSources - GitHub `owner/repo` of every added fork source; omit
 * to never offer adding a source.
 */
export function prepareLocalImportRow(
    row: ProjectImportInspection,
    stable: ReleaseSummary[],
    prereleases: ReleaseSummary[],
    forkReleases: ReleaseSummary[] = [],
    forkSources?: readonly string[],
): LocalImportRow {
    const resolution = row.editorResolution;
    const actions: LocalImportEditorAction[] = [];
    if (resolution?.choices !== undefined) {
        for (const choice of resolution.choices) {
            if (!choice.installed && !choice.release) continue;
            actions.push({
                id: choice.id,
                version: choice.version,
                name: choice.name,
                flavor: choice.flavor,
                kind: choice.installed ? 'use' : 'download',
                recommended: choice.recommended,
                options: choice.installed
                    ? { resolution: 'use_selected', editorChoiceId: choice.id }
                    : { resolution: 'add_missing', editorChoiceId: choice.id },
                download: choice.installed ? undefined : choice.release,
            });
        }
    } else if (resolution) {
        const download = findDownloadableProjectEditor(
            resolution,
            stable,
            prereleases,
            forkReleases,
        );
        if (download)
            actions.push({
                id: 'download',
                version: download.version,
                flavor:
                    resolution.downloadable?.flavor ??
                    resolution.requested.flavor,
                kind: 'download',
                options: { resolution: 'add_missing' },
                download,
            });
        const pin =
            resolution.downloadable?.match === 'exact'
                ? resolution.downloadable
                : undefined;
        const pinnedSource = pin?.fork?.source;
        if (
            !download &&
            pin &&
            pinnedSource &&
            forkSources &&
            !forkSources.some(
                (source) => source.toLowerCase() === pinnedSource.toLowerCase(),
            )
        )
            actions.push({
                id: 'add-source',
                version: pin.version,
                flavor: pin.flavor,
                kind: 'add-source',
                recommended: true,
                options: { resolution: 'add_missing' },
                pinnedSource,
            });
        if (resolution.fallback)
            actions.push({
                id: 'fallback',
                version: resolution.fallback.version,
                flavor: resolution.fallback.mono ? 'dotnet' : 'gdscript',
                kind: 'use',
                options: {
                    resolution: 'use_fallback',
                    release: resolution.fallback,
                },
            });
    } else {
        actions.push({
            id: 'automatic',
            version: row.editor?.version,
            flavor: row.editor
                ? row.editor.mono
                    ? 'dotnet'
                    : 'gdscript'
                : undefined,
            kind: 'use',
            options: {},
        });
    }
    if (resolution)
        actions.push({
            id: 'missing',
            kind: 'missing',
            options: { resolution: 'add_missing' },
        });
    return {
        ...row,
        editorActions: actions,
        editorActionId:
            actions.find((a) => a.recommended)?.id ?? actions[0]?.id ?? '',
    };
}

/** Replaces the add-source action of a row whose source was just added with
 * the exact pinned build, now listed by that source.
 * @param row - Reviewed row.
 * @param forkReleases - Fork builds listed after adding the source.
 * @returns The row offering the exact build, or only adding it as missing
 * when the source does not publish that build for this computer.
 */
export function resolveAddedSourceAction(
    row: LocalImportRow,
    forkReleases: ReleaseSummary[],
): LocalImportRow {
    const index = row.editorActions.findIndex(
        (action) => action.kind === 'add-source',
    );
    if (index < 0 || !row.editorResolution) return row;
    const download = findDownloadableProjectEditor(
        row.editorResolution,
        [],
        [],
        forkReleases,
    );
    const replaced = row.editorActions[index];
    const editorActions = row.editorActions.flatMap((action, actionIndex) =>
        actionIndex !== index
            ? [action]
            : download
              ? [
                    {
                        id: 'download',
                        version: download.version,
                        flavor: replaced.flavor,
                        kind: 'download' as const,
                        recommended: true,
                        options: { resolution: 'add_missing' as const },
                        download,
                    },
                ]
              : [],
    );
    return {
        ...row,
        editorActions,
        editorActionId:
            row.editorActionId !== replaced.id
                ? row.editorActionId
                : download
                  ? 'download'
                  : 'missing',
    };
}
