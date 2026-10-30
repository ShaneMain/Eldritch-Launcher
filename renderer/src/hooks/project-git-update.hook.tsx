import type {
    ProjectGitStatus,
    ProjectGitUpdateOptions,
    ProjectGitUpdateProgress,
    ProjectGitUpdateResult,
} from '@shared/contracts';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { projectGitStatusBridge, subscribeAppEvent } from '../renderer.bridge';
import { useAlerts } from './alerts.hook';

export type ProjectGitUpdateToast = {
    id: number;
    tone: 'success' | 'warning' | 'error';
    lines: string[];
};

type ProjectGitUpdateSnapshot = {
    running: ReadonlyMap<string, ProjectGitUpdateProgress>;
    toasts: readonly ProjectGitUpdateToast[];
};

export const PROJECT_GIT_UPDATE_TOAST_MS = 6_000;

let snapshot: ProjectGitUpdateSnapshot = { running: new Map(), toasts: [] };
const listeners = new Set<() => void>();
let connected = false;
let nextToastId = 1;

/**
 * Replaces the shared snapshot and notifies subscribed components.
 *
 * @param next - Partial snapshot fields to replace.
 */
function update(next: Partial<ProjectGitUpdateSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
}

/**
 * Stores one running update's step.
 *
 * @param progress - Latest progress, or null once the update finished.
 * @param projectPath - Project being updated.
 */
function setRunning(
    projectPath: string,
    progress: ProjectGitUpdateProgress | null,
): void {
    const running = new Map(snapshot.running);
    if (progress) {
        running.set(projectPath, progress);
    } else {
        running.delete(projectPath);
    }
    update({ running });
}

/** Subscribes to pushed progress once per renderer. */
function connect(): void {
    if (connected) return;
    connected = true;
    subscribeAppEvent('project-git-update-progress', (progress) => {
        if (snapshot.running.has(progress.projectPath)) {
            setRunning(progress.projectPath, progress);
        }
    });
}

/**
 * Registers one component with the shared update store.
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
function getSnapshot(): ProjectGitUpdateSnapshot {
    return snapshot;
}

/**
 * Removes one toast.
 *
 * @param id - Toast identifier.
 */
export function dismissProjectGitUpdateToast(id: number): void {
    update({ toasts: snapshot.toasts.filter((toast) => toast.id !== id) });
}

/**
 * Shows one toast that dismisses itself.
 *
 * @param tone - Toast colour.
 * @param lines - Message lines.
 */
function showToast(tone: ProjectGitUpdateToast['tone'], lines: string[]): void {
    const id = nextToastId++;
    update({ toasts: [...snapshot.toasts, { id, tone, lines }] });
    setTimeout(
        () => dismissProjectGitUpdateToast(id),
        PROJECT_GIT_UPDATE_TOAST_MS,
    );
}

/**
 * Whether a status allows a one-click fast-forward update.
 *
 * @param status - Latest project Git status.
 * @returns True when the branch is only behind its freshly fetched upstream.
 */
export function canUpdateProjectGitStatus(
    status: ProjectGitStatus | undefined,
): boolean {
    return (
        status?.state === 'ok' && status.ahead === 0 && (status.behind ?? 0) > 0
    );
}

/**
 * Reads the running update of one project.
 *
 * @param projectPath - Registered project path.
 * @returns Current step, or undefined when no update runs.
 */
export function useProjectGitUpdateProgress(
    projectPath: string,
): ProjectGitUpdateProgress | undefined {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return current.running.get(projectPath);
}

/**
 * Reads the visible update toasts.
 *
 * @returns Toasts in display order.
 */
export function useProjectGitUpdateToasts(): readonly ProjectGitUpdateToast[] {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).toasts;
}

/**
 * Provides the one-click update action and its result handling.
 *
 * @returns Function that updates one project.
 */
export function useProjectGitUpdateAction() {
    const { t } = useTranslation('projectStatus');
    const { addCustomConfirm } = useAlerts();

    const run = useCallback(
        async (
            projectPath: string,
            options?: ProjectGitUpdateOptions,
        ): Promise<void> => {
            if (snapshot.running.has(projectPath)) return;
            setRunning(projectPath, {
                projectPath,
                stage: 'fetching',
                percent: null,
            });
            let result: ProjectGitUpdateResult;
            try {
                result = await projectGitStatusBridge.updateProject(
                    projectPath,
                    options,
                );
            } catch {
                result = { status: 'failed', message: null, stash: null };
            } finally {
                setRunning(projectPath, null);
            }

            switch (result.status) {
                case 'updated': {
                    const lines = [t('update.applied', { n: result.commits })];
                    if (result.stash) {
                        lines.push(
                            t('update.stashed', {
                                ref: result.stash.ref,
                                interpolation: { escapeValue: false },
                            }),
                        );
                    }
                    const lfsFailed =
                        result.lfs.status === 'failed' ||
                        result.lfs.status === 'unavailable';
                    if (lfsFailed) {
                        lines.push(t(`update.lfs.${result.lfs.status}`));
                    }
                    showToast(lfsFailed ? 'warning' : 'success', lines);
                    return;
                }
                case 'up-to-date':
                    showToast('success', [t('update.upToDate')]);
                    return;
                case 'cancelled':
                    return;
                case 'local-changes':
                    addCustomConfirm(
                        t('update.localChanges.title'),
                        <div className="flex flex-col gap-3 text-base">
                            <p>{t('update.localChanges.message')}</p>
                            <ul className="flex max-h-48 flex-col gap-1 overflow-auto rounded-box bg-base-200/60 p-3">
                                {result.paths.map((file) => (
                                    <li key={file}>
                                        <code className="break-all font-mono text-sm">
                                            {file}
                                        </code>
                                    </li>
                                ))}
                            </ul>
                            {result.totalPaths > result.paths.length && (
                                <p className="text-base-content/75">
                                    {t('update.localChanges.more', {
                                        n:
                                            result.totalPaths -
                                            result.paths.length,
                                    })}
                                </p>
                            )}
                            <p className="text-base-content/75">
                                {t('update.localChanges.detail')}
                            </p>
                        </div>,
                        [
                            {
                                isCancel: true,
                                typeClass: 'btn-ghost text-base',
                                text: t('update.localChanges.cancel'),
                                onClick: () => true,
                            },
                            {
                                typeClass: 'btn-warning text-base',
                                text: t('update.localChanges.stash'),
                                onClick: () => {
                                    void run(projectPath, {
                                        discardGeneratedChanges: true,
                                    });
                                    return true;
                                },
                            },
                        ],
                        undefined,
                        'warning',
                    );
                    return;
                case 'refused':
                    showToast('error', [t(`update.refused.${result.reason}`)]);
                    return;
                case 'fetch-failed':
                    showToast('error', [
                        t(`update.fetchFailed.${result.kind}`),
                    ]);
                    return;
                case 'failed': {
                    const lines = [result.message ?? t('update.failed')];
                    if (result.stash) {
                        lines.push(
                            t('update.stashed', {
                                ref: result.stash.ref,
                                interpolation: { escapeValue: false },
                            }),
                        );
                    }
                    showToast('error', lines);
                    return;
                }
            }
        },
        [t, addCustomConfirm],
    );

    return run;
}

/**
 * Cancels a running update of one project.
 *
 * @param projectPath - Project being updated.
 */
export function cancelProjectGitUpdate(projectPath: string): void {
    void projectGitStatusBridge.cancelUpdate(projectPath).catch(() => false);
}
