import type {
    ProjectDetails,
    ProjectEngineStatus,
    ReleaseSummary,
} from '@shared/contracts';
import { Download, Plus, RefreshCcw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitHubSignInButton } from '../../../components/github-connection/github-sign-in-button.component';
import { Tooltip } from '../../../components/ui/tooltip.component';
import { useAlerts } from '../../../hooks/alerts.hook';
import { useEngineSources } from '../../../hooks/engine-sources.hook';
import { useProjects } from '../../../hooks/projects.hook';
import { useRelease } from '../../../hooks/release.hook';

type EngineStatusBadgeProps = {
    project: ProjectDetails;
};

/**
 * Shows how far a fork-pinned project's engine is behind its source.
 *
 * Projects not pinned to a fork build render nothing and make no request.
 *
 * @param props - The project whose engine pin should be checked.
 * @returns The engine status badge, or nothing for non-fork projects.
 */
export function EngineStatusBadge({ project }: EngineStatusBadgeProps) {
    if (!project.release.fork) {
        return null;
    }
    return <ForkEngineStatusBadge project={project} />;
}

/**
 * Loads and renders engine status for a project pinned to a fork build.
 *
 * @param props - The fork-pinned project.
 * @returns The engine status badge.
 */
function ForkEngineStatusBadge({ project }: EngineStatusBadgeProps) {
    const { t } = useTranslation('engineSources');
    const { getProjectEngineStatus, addSource } = useEngineSources();
    const { forkReleases, installRelease, reloadReleases } = useRelease();
    const { setProjectEditor } = useProjects();
    const { addAlert, addCustomConfirm } = useAlerts();
    const [addingSource, setAddingSource] = useState(false);
    const [status, setStatus] = useState<ProjectEngineStatus | null>(null);
    const [checking, setChecking] = useState(true);
    const [updating, setUpdating] = useState(false);
    const pinnedRevision = project.release.fork?.revision;

    const loadStatus = useCallback(
        async (force: boolean) => {
            setChecking(true);
            try {
                setStatus(
                    await getProjectEngineStatus(
                        project.path,
                        force ? { force } : undefined,
                    ),
                );
            } catch (error) {
                setStatus({
                    kind: 'error',
                    source: project.release.fork?.source ?? '',
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            } finally {
                setChecking(false);
            }
        },
        [getProjectEngineStatus, project.path, project.release.fork?.source],
    );

    // Re-check when the project or its pinned revision changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: pinnedRevision triggers a re-check after the pin changes
    useEffect(() => {
        void loadStatus(false);
    }, [loadStatus, pinnedRevision]);

    const newerBuild = status?.kind === 'ok' ? status.newerBuild : undefined;
    const newerRelease = newerBuild
        ? forkReleases.find(
              (release) =>
                  release.fork?.revision.toLowerCase() ===
                  newerBuild.revision.toLowerCase(),
          )
        : undefined;

    /**
     * Adds the pinned fork source so its exact build can be installed.
     *
     * @param source - GitHub `owner/repo` of the pin.
     * @returns A promise that ends after the status is re-checked.
     */
    const addPinnedSource = async (source: string): Promise<void> => {
        setAddingSource(true);
        try {
            const result = await addSource({
                url: `https://github.com/${source}`,
            });
            if (!result.ok && result.reason !== 'duplicate') {
                throw new Error(
                    t(`settings.add.errors.${addErrorKey[result.reason]}`),
                );
            }
            await reloadReleases();
            await loadStatus(true);
        } catch (error) {
            addAlert(
                t('badge.addSourceFailed'),
                error instanceof Error ? error.message : String(error),
                <TriangleAlert className="inline text-error" />,
            );
        } finally {
            setAddingSource(false);
        }
    };

    /**
     * Confirms, then installs the newer fork build and pins the project to
     * it; the pin is written to the project's .godotlauncher file.
     *
     * @param release - The newer fork build to install.
     */
    const confirmInstallNewerBuild = (release: ReleaseSummary): void => {
        addCustomConfirm(
            t('badge.updateConfirmTitle', { tag: newerBuild?.tag }),
            <p>
                {t('badge.updateConfirmMessage', { version: release.version })}
            </p>,
            [
                {
                    isCancel: true,
                    typeClass: 'btn-ghost',
                    text: t('common:buttons.cancel'),
                },
                {
                    typeClass: 'btn-primary',
                    text: t('badge.update'),
                    onClick: () => {
                        void installNewerBuild(release);
                        return true;
                    },
                },
            ],
        );
    };

    /**
     * Installs the newer fork build and pins the project to it.
     *
     * @param release - The newer fork build to install.
     * @returns A promise that ends after the pin is updated or fails.
     */
    const installNewerBuild = async (
        release: ReleaseSummary,
    ): Promise<void> => {
        const mono = project.release.mono;
        setUpdating(true);
        try {
            const result = await installRelease(release, mono, 'project');
            if (result.cancelled) {
                return;
            }
            if (!result.success || !result.release) {
                throw new Error(result.error || t('badge.updateFailed'));
            }
            const assignment = await setProjectEditor(project, result.release, {
                version: project.release.version,
                mono,
            });
            if (!assignment.success) {
                throw new Error(assignment.error || t('badge.updateFailed'));
            }
        } catch (error) {
            addAlert(
                t('badge.updateFailed'),
                error instanceof Error ? error.message : String(error),
                <TriangleAlert className="inline text-error" />,
            );
        } finally {
            setUpdating(false);
        }
    };

    return (
        <EngineStatusBadgeContent
            status={status}
            checking={checking}
            updating={updating}
            addingSource={addingSource}
            newerRelease={newerRelease}
            t={t}
            onRefresh={() => void loadStatus(true)}
            onInstallNewerBuild={confirmInstallNewerBuild}
            onAddSource={(source) => void addPinnedSource(source)}
            onSignedIn={() => loadStatus(true)}
        />
    );
}

const addErrorKey = {
    invalid: 'invalid',
    duplicate: 'duplicate',
    'auth-required': 'authRequired',
    'no-access': 'noAccess',
    network: 'network',
} as const;

type EngineStatusBadgeContentProps = {
    status: ProjectEngineStatus | null;
    checking: boolean;
    updating: boolean;
    addingSource?: boolean;
    /** Catalog build matching `status.newerBuild`, when available. */
    newerRelease: ReleaseSummary | undefined;
    t: (key: string, options?: Record<string, unknown>) => string;
    onRefresh: () => void;
    onInstallNewerBuild: (release: ReleaseSummary) => void;
    onAddSource: (source: string) => void;
    onSignedIn: () => Promise<void>;
};

/**
 * Renders one engine status without loading it.
 *
 * @param props - The loaded status, pending flags, and actions.
 * @returns The engine status presentation.
 */
export function EngineStatusBadgeContent({
    status,
    checking,
    updating,
    addingSource = false,
    newerRelease,
    t,
    onRefresh,
    onInstallNewerBuild,
    onAddSource,
    onSignedIn,
}: EngineStatusBadgeContentProps) {
    const refreshButton = (
        <Tooltip placement="top" tip={t('badge.refresh')} tone="default">
            <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label={t('badge.refresh')}
                data-testid="btnRefreshEngineStatus"
                disabled={checking || updating}
                onClick={onRefresh}
            >
                {checking ? (
                    <span className="loading loading-spinner loading-xs" />
                ) : (
                    <RefreshCcw size={12} aria-hidden="true" />
                )}
            </button>
        </Tooltip>
    );

    if (!status || status.kind === 'not-fork') {
        return checking ? (
            <span data-testid="engineStatusBadge">{refreshButton}</span>
        ) : null;
    }

    // Each blocked state says why in one line and offers the one fix.
    if (status.kind === 'auth-required') {
        return (
            <span
                className="flex flex-wrap items-center gap-1 text-xs text-warning"
                data-testid="engineStatusBadge"
            >
                <TriangleAlert size={12} aria-hidden="true" />
                {t('badge.privateSource', { source: status.source })}
                <GitHubSignInButton
                    label={t('access.signIn')}
                    className="btn btn-primary btn-outline btn-xs"
                    data-testid="btnEngineStatusSignIn"
                    onSignedIn={onSignedIn}
                />
            </span>
        );
    }

    if (status.kind === 'unknown-source') {
        return (
            <span
                className="flex flex-wrap items-center gap-1 text-xs text-warning"
                data-testid="engineStatusBadge"
            >
                <TriangleAlert size={12} aria-hidden="true" />
                {t('badge.sourceNotAdded', { source: status.source })}
                <button
                    type="button"
                    className="btn btn-primary btn-outline btn-xs"
                    data-testid="btnEngineStatusAddSource"
                    disabled={addingSource}
                    onClick={() => onAddSource(status.source)}
                >
                    {addingSource ? (
                        <span className="loading loading-spinner loading-xs" />
                    ) : (
                        <Plus size={12} aria-hidden="true" />
                    )}
                    {t('badge.addSource')}
                </button>
            </span>
        );
    }

    if (status.kind === 'no-access' || status.kind === 'error') {
        const tip =
            status.kind === 'error'
                ? t('badge.errorTooltip', {
                      source: status.source,
                      message: status.message,
                  })
                : t('badge.noAccessTooltip', { source: status.source });
        return (
            <span
                className="flex items-center gap-1 text-base-content/50"
                data-testid="engineStatusBadge"
            >
                <Tooltip placement="top" tip={tip} tone="warning">
                    <span
                        className="flex items-center gap-1 text-xs"
                        role="img"
                        aria-label={tip}
                    >
                        <TriangleAlert size={12} aria-hidden="true" />
                        {t(
                            status.kind === 'no-access'
                                ? 'badge.noAccess'
                                : 'badge.unavailable',
                        )}
                    </span>
                </Tooltip>
                {refreshButton}
            </span>
        );
    }

    const { newerBuild } = status;
    return (
        <span
            className="flex flex-wrap items-center gap-1"
            data-testid="engineStatusBadge"
        >
            {newerBuild ? (
                <Tooltip
                    placement="top"
                    tone="default"
                    tip={
                        newerRelease
                            ? t('badge.newerBuild', { tag: newerBuild.tag })
                            : t('badge.newerBuildUnavailable')
                    }
                >
                    <button
                        type="button"
                        className="btn btn-primary btn-outline btn-xs"
                        data-testid="btnInstallEngineUpdate"
                        disabled={!newerRelease || updating}
                        onClick={() =>
                            newerRelease && onInstallNewerBuild(newerRelease)
                        }
                    >
                        {updating ? (
                            <span className="loading loading-spinner loading-xs" />
                        ) : (
                            <Download size={12} aria-hidden="true" />
                        )}
                        {t('badge.updateAvailable')}
                    </button>
                </Tooltip>
            ) : (
                <span className="text-xs text-base-content/50">
                    {status.behindBy > 0
                        ? t('badge.behind', {
                              count: status.behindBy,
                              branch: status.branch,
                          })
                        : t('badge.upToDate')}
                </span>
            )}
            {status.aheadBy > 0 && (
                <span className="text-xs text-base-content/50">
                    {t('badge.ahead', {
                        count: status.aheadBy,
                        branch: status.branch,
                    })}
                </span>
            )}
            {refreshButton}
        </span>
    );
}
