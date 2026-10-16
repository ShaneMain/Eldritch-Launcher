import type { ProjectGitStatus } from '@shared/contracts';
import { useCallback, useSyncExternalStore } from 'react';
import { projectGitStatusBridge, subscribeAppEvent } from '../renderer.bridge';

type ProjectGitStatusSnapshot = {
    statuses: ReadonlyMap<string, ProjectGitStatus>;
    refreshing: ReadonlySet<string>;
    refreshingAll: boolean;
};

let snapshot: ProjectGitStatusSnapshot = {
    statuses: new Map(),
    refreshing: new Set(),
    refreshingAll: false,
};
const listeners = new Set<() => void>();
let connected = false;

/**
 * Replaces the shared snapshot and notifies subscribed components.
 *
 * @param next - Partial snapshot fields to replace.
 */
function update(next: Partial<ProjectGitStatusSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
}

/**
 * Stores newer statuses without replacing them with older results.
 *
 * @param statuses - Statuses received from the main process.
 */
function storeStatuses(statuses: readonly ProjectGitStatus[]): void {
    const merged = new Map(snapshot.statuses);
    for (const status of statuses) {
        const current = merged.get(status.projectPath);
        if (!current || current.checkedAt <= status.checkedAt) {
            merged.set(status.projectPath, status);
        }
    }
    update({ statuses: merged });
}

/** Subscribes to pushed statuses and loads the cache once per renderer. */
function connect(): void {
    if (connected) return;
    connected = true;
    subscribeAppEvent('project-git-status-updated', (status) =>
        storeStatuses([status]),
    );
    void Promise.resolve()
        .then(() => projectGitStatusBridge.getStatuses())
        .then(storeStatuses)
        .catch(() => undefined);
}

/**
 * Registers one component with the shared status store.
 *
 * @param listener - React store-change callback.
 * @returns Function that removes the listener.
 */
function subscribe(listener: () => void): () => void {
    connect();
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Returns the current shared snapshot. */
function getSnapshot(): ProjectGitStatusSnapshot {
    return snapshot;
}

/**
 * Reads and refreshes the Git upstream status of one project.
 *
 * @param projectPath - Registered project path.
 * @returns Latest status, whether a refresh is running, and a refresh action.
 */
export function useProjectGitStatus(projectPath: string) {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const refresh = useCallback(async () => {
        if (snapshot.refreshing.has(projectPath)) return;
        update({ refreshing: new Set(snapshot.refreshing).add(projectPath) });
        try {
            const status =
                await projectGitStatusBridge.refreshProject(projectPath);
            if (status) storeStatuses([status]);
        } catch {
            // The badge keeps its previous state; the next refresh retries.
        } finally {
            const refreshing = new Set(snapshot.refreshing);
            refreshing.delete(projectPath);
            update({ refreshing });
        }
    }, [projectPath]);
    return {
        status: current.statuses.get(projectPath),
        refreshing:
            current.refreshingAll || current.refreshing.has(projectPath),
        refresh,
    };
}

/**
 * Refreshes the Git upstream status of every project.
 *
 * @returns Whether a refresh-all is running and the refresh action.
 */
export function useRefreshAllProjectGitStatuses() {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const refreshAll = useCallback(async () => {
        if (snapshot.refreshingAll) return;
        update({ refreshingAll: true });
        try {
            storeStatuses(await projectGitStatusBridge.refreshAll());
        } catch {
            // Individual pushed updates still arrive; the next refresh retries.
        } finally {
            update({ refreshingAll: false });
        }
    }, []);
    return { refreshingAll: current.refreshingAll, refreshAll };
}
