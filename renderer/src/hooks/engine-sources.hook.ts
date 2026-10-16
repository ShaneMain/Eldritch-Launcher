import type {
    AddEngineSourceInput,
    AddEngineSourceResult,
    EditorCatalogProviderId,
    EngineSourceSummary,
    ProjectEngineStatus,
} from '@shared/contracts';
import { useCallback } from 'react';
import { engineSourcesBridge } from '../renderer.bridge.ts';

/** Engine source operations used by renderer views. */
export type EngineSourcesHook = {
    listSources: () => Promise<EngineSourceSummary[]>;
    addSource: (input: AddEngineSourceInput) => Promise<AddEngineSourceResult>;
    removeSource: (
        id: EditorCatalogProviderId,
    ) => Promise<EngineSourceSummary[]>;
    refreshSource: (
        id: EditorCatalogProviderId,
    ) => Promise<EngineSourceSummary[]>;
    getProjectEngineStatus: (
        projectPath: string,
        options?: { force?: boolean },
    ) => Promise<ProjectEngineStatus>;
};

/**
 * Provides stable functions for the engine sources bridge.
 *
 * @returns The engine sources bridge operations.
 */
export function useEngineSources(): EngineSourcesHook {
    const listSources = useCallback(
        () => engineSourcesBridge.listSources(),
        [],
    );
    const addSource = useCallback(
        (input: AddEngineSourceInput) => engineSourcesBridge.addSource(input),
        [],
    );
    const removeSource = useCallback(
        (id: EditorCatalogProviderId) => engineSourcesBridge.removeSource(id),
        [],
    );
    const refreshSource = useCallback(
        (id: EditorCatalogProviderId) => engineSourcesBridge.refreshSource(id),
        [],
    );
    const getProjectEngineStatus = useCallback(
        (projectPath: string, options?: { force?: boolean }) =>
            engineSourcesBridge.getProjectEngineStatus(projectPath, options),
        [],
    );

    return {
        listSources,
        addSource,
        removeSource,
        refreshSource,
        getProjectEngineStatus,
    };
}
