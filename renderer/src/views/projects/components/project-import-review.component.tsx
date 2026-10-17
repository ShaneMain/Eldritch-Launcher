import type { ProjectDetails } from '@shared/contracts';
import { useState } from 'react';
import { Dialog } from '../../../components/dialog.component';
import { usePinnedSources } from '../hooks/pinned-sources.hook';
import {
    getActionInstallVersion,
    type LocalImportRow,
} from '../local-import-editor.model';
import { getImportConflicts } from '../project-import-conflict.model';
import {
    ProjectImportReviewList,
    type ProjectImportReviewListItem,
} from './project-import-review-list.component';

type Props = {
    rows: LocalImportRow[];
    existing: ProjectDetails[];
    platform?: string;
    t: (key: string, options?: Record<string, unknown>) => string;
    onConfirm: (rows: LocalImportRow[]) => void;
    onCancel: () => void;
};

/** Reviews conflicting imports using the app's compact item presentation.
 * @param props - Inspected files, existing projects and completion callbacks.
 */
export function ProjectImportReview({
    rows,
    existing,
    platform,
    t,
    onConfirm,
    onCancel,
}: Props) {
    const [currentRows, setCurrentRows] = useState(rows);
    const [editorIds, setEditorIds] = useState(
        rows.map((row) => row.editorActionId),
    );
    const [names, setNames] = useState(rows.map((row) => row.name));
    const [skipped, setSkipped] = useState(new Set<number>());
    const [editing, setEditing] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [confirming, setConfirming] = useState(false);
    const pinnedSources = usePinnedSources();
    const selected = currentRows.flatMap((row, index) =>
        skipped.has(index)
            ? []
            : [
                  {
                      ...row,
                      name: names[index],
                      editorActionId: editorIds[index],
                  },
              ],
    );
    const conflicts = getImportConflicts(selected, existing, platform);
    let selectedIndex = 0;
    const items: ProjectImportReviewListItem[] = currentRows.map(
        (row, index) => {
            const selected = !skipped.has(index);
            return {
                id: String(index),
                row,
                name: names[index],
                selected,
                editorActionId: editorIds[index],
                conflict: selected ? conflicts[selectedIndex++] : undefined,
                path:
                    row.directory ??
                    row.projectFilePath.replace(/[\\/][^\\/]*$/, ''),
            };
        },
    );

    /** Saves the current inline name and returns to the compact display.
     * @param id - Stable row index being edited.
     */
    const saveName = (id: string) => {
        const index = Number(id);
        setNames((current) =>
            current.map((name, itemIndex) =>
                itemIndex === index ? draft.trim() : name,
            ),
        );
        setEditing(null);
    };

    /** Adds pinned fork sources first, then confirms once every chosen
     * editor can be installed; blocked rows show their fix in place. */
    const confirm = async () => {
        if (confirming) return;
        setConfirming(true);
        try {
            const result = await pinnedSources.add(selected);
            const resolved = new Map(
                result.rows.map((row) => [row.projectFilePath, row]),
            );
            setCurrentRows((current) =>
                current.map((row) => {
                    const next = resolved.get(row.projectFilePath);
                    return next ? { ...next, name: row.name } : row;
                }),
            );
            setEditorIds((current) =>
                current.map(
                    (id, index) =>
                        resolved.get(currentRows[index].projectFilePath)
                            ?.editorActionId ?? id,
                ),
            );
            if (result.ready) onConfirm(result.rows);
        } finally {
            setConfirming(false);
        }
    };

    return (
        <Dialog
            title={t('addProject.conflicts.title')}
            panelClassName="max-w-5xl"
            bodyClassName="overflow-y-auto pr-6"
            onRequestClose={onCancel}
            footer={
                <>
                    <span className="mr-auto self-center text-sm text-base-content/60">
                        {t('addProject.editorReview.summary', {
                            count: selected.length,
                            downloads: new Set(
                                selected.flatMap((row) => {
                                    const version = getActionInstallVersion(
                                        row.editorActions.find(
                                            (candidate) =>
                                                candidate.id ===
                                                row.editorActionId,
                                        ),
                                    );
                                    return version
                                        ? [
                                              `${version}:${row.editorRequest?.flavor}`,
                                          ]
                                        : [];
                                }),
                            ).size,
                        })}
                    </span>
                    <button
                        type="button"
                        className="btn btn-ghost text-base"
                        onClick={onCancel}
                    >
                        {t('common:buttons.cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary text-base"
                        disabled={
                            confirming ||
                            editing !== null ||
                            selected.length === 0 ||
                            conflicts.some(Boolean)
                        }
                        onClick={() => void confirm()}
                    >
                        {confirming && (
                            <span className="loading loading-spinner loading-xs" />
                        )}
                        {t('addProject.conflicts.continue')}
                    </button>
                </>
            }
        >
            <p className="mb-4 text-base text-base-content/75">
                {t('addProject.editorReview.description')}
            </p>
            <ProjectImportReviewList
                items={items}
                editingId={editing === null ? null : String(editing)}
                draft={draft}
                t={t}
                onToggle={(id, isSelected) => {
                    const index = Number(id);
                    setSkipped((current) => {
                        const next = new Set(current);
                        isSelected ? next.delete(index) : next.add(index);
                        return next;
                    });
                    if (editing === index) setEditing(null);
                }}
                onEdit={(id) => {
                    const index = Number(id);
                    setDraft(names[index]);
                    setEditing(index);
                }}
                onDraftChange={setDraft}
                onSave={saveName}
                onCancel={() => setEditing(null)}
                onEditorChange={(id, editorActionId) => {
                    const index = Number(id);
                    setEditorIds((current) =>
                        current.map((value, itemIndex) =>
                            itemIndex === index ? editorActionId : value,
                        ),
                    );
                }}
                pinnedSources={pinnedSources.states}
                onPinnedSourceRetry={() => void confirm()}
            />
        </Dialog>
    );
}
