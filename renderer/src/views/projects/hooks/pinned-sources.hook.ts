import { useState } from 'react';
import { useEditorCatalog } from '../../../hooks/editor-catalog.hook';
import { mapEditorCatalogResult } from '../../../hooks/editor-catalog-release.mapper';
import { useEngineSources } from '../../../hooks/engine-sources.hook';
import { useRelease } from '../../../hooks/release.hook';
import type { LocalImportRow } from '../local-import-editor.model';
import {
    addPinnedSources,
    getRowPinnedSource,
    type PinnedSourceStates,
} from '../pinned-sources.model';

/**
 * Adds the sources of reviewed fork pins in place, tracking which sources
 * still need a sign-in or GitHub App access before their builds install.
 *
 * @returns Per-source states and the add operation.
 */
export function usePinnedSources() {
    const { addSource } = useEngineSources();
    const { getCatalog } = useEditorCatalog();
    const { reloadReleases } = useRelease();
    const [states, setStates] = useState<PinnedSourceStates>({});

    /**
     * Adds the sources of the selected add-source actions.
     *
     * @param rows - Reviewed rows with their chosen editor actions.
     * @returns Updated rows, and whether every pinned build can install.
     */
    const add = async (
        rows: LocalImportRow[],
    ): Promise<{ rows: LocalImportRow[]; ready: boolean }> => {
        const pending = Object.fromEntries(
            rows.flatMap((row) => {
                const action = row.editorActions.find(
                    (candidate) => candidate.id === row.editorActionId,
                );
                const source = getRowPinnedSource(row);
                return action?.kind === 'add-source' && source
                    ? [[source.toLowerCase(), { kind: 'adding' as const }]]
                    : [];
            }),
        );
        setStates(pending);
        const result = await addPinnedSources(rows, {
            addSource,
            loadForkReleases: async () => {
                const catalog = mapEditorCatalogResult(
                    await getCatalog({ refreshIfStale: false }),
                );
                await reloadReleases();
                return catalog.forkReleases;
            },
        });
        setStates(result.blocked);
        return {
            rows: result.rows,
            ready: Object.keys(result.blocked).length === 0,
        };
    };

    return { states, add };
}
