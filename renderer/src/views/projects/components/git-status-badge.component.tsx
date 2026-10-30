import type {
    ProjectGitStatus,
    ProjectGitUpdateProgress,
} from '@shared/contracts';
import clsx from 'clsx';
import {
    ArrowDownToLine,
    Check,
    GitCommitHorizontal,
    KeyRound,
    TriangleAlert,
    Unlink,
    WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GitHubSignInButton } from '../../../components/github-connection/github-sign-in-button.component';
import { StatusBadge } from '../../../components/ui/status-badge.component';
import { Tooltip } from '../../../components/ui/tooltip.component';
import { useProjectGitStatus } from '../../../hooks/project-git-status.hook';
import {
    cancelProjectGitUpdate,
    canUpdateProjectGitStatus,
    useProjectGitUpdateAction,
    useProjectGitUpdateProgress,
} from '../../../hooks/project-git-update.hook';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type GitStatusBadgeViewProps = {
    status: ProjectGitStatus | undefined;
    refreshing: boolean;
    compact: boolean;
    onRefresh: () => void;
    /** Running update step, when an update runs. */
    updateProgress?: ProjectGitUpdateProgress;
    /** Starts a fast-forward update; shown only when one is possible. */
    onUpdate?: () => void;
    onCancelUpdate?: () => void;
};

const STATE_ICONS: Partial<Record<ProjectGitStatus['state'], ReactNode>> = {
    'no-upstream': <Unlink size={14} aria-hidden="true" />,
    detached: <GitCommitHorizontal size={14} aria-hidden="true" />,
    'auth-required': <KeyRound size={14} aria-hidden="true" />,
    offline: <WifiOff size={14} aria-hidden="true" />,
    error: <TriangleAlert size={14} aria-hidden="true" />,
};

const STATE_LABEL_KEYS: Partial<Record<ProjectGitStatus['state'], string>> = {
    'no-upstream': 'git.noUpstream',
    detached: 'git.detached',
    'auth-required': 'git.authRequired',
    offline: 'git.offline',
    error: 'git.error',
};
/**
 * Shows a project's commits behind and ahead of its upstream.
 * @param props - Project path and presentation mode.
 */
export function GitStatusBadge({
    projectPath,
    compact,
}: {
    projectPath: string;
    compact: boolean;
}) {
    const { status, refreshing, refresh } = useProjectGitStatus(projectPath);
    const updateProgress = useProjectGitUpdateProgress(projectPath);
    const updateProject = useProjectGitUpdateAction();
    return (
        <GitStatusBadgeView
            status={status}
            refreshing={refreshing}
            compact={compact}
            onRefresh={() => void refresh()}
            updateProgress={updateProgress}
            onUpdate={() => void updateProject(projectPath)}
            onCancelUpdate={() => cancelProjectGitUpdate(projectPath)}
        />
    );
}

/**
 * Renders one Git status badge with an explanatory tooltip and, when the
 * branch is only behind, an Update action.
 * @param props - Status, refresh and update state, presentation mode and actions.
 */
export function GitStatusBadgeView({
    status,
    refreshing,
    compact,
    onRefresh,
    updateProgress,
    onUpdate,
    onCancelUpdate,
}: GitStatusBadgeViewProps) {
    const { t } = useTranslation('projectStatus');
    if (!status) {
        return refreshing ? (
            <StatusBadge className="h-[22px] rounded-full px-[6px]">
                <span
                    className="loading loading-spinner loading-xs"
                    aria-hidden="true"
                />
                <span className="sr-only">{t('git.refreshing')}</span>
            </StatusBadge>
        ) : null;
    }
    if (status.state === 'not-a-repo') {
        return null;
    }

    const hasCounts = status.ahead !== null && status.behind !== null;
    const upToDate = hasCounts && status.ahead === 0 && status.behind === 0;
    const labelKey = STATE_LABEL_KEYS[status.state];
    const warning =
        status.state === 'auth-required' || status.state === 'error';
    const content = (
        <>
            {refreshing ? (
                <span
                    className="loading loading-spinner loading-xs"
                    aria-hidden="true"
                />
            ) : (
                STATE_ICONS[status.state]
            )}
            {hasCounts ? (
                <span
                    data-testid="gitStatusCounts"
                    className={clsx(
                        'inline-flex items-center gap-1 tabular-nums',
                        status.stale && 'opacity-60',
                    )}
                >
                    {upToDate && (
                        <>
                            <Check size={14} aria-hidden="true" />
                            <span className="sr-only">{t('git.upToDate')}</span>
                        </>
                    )}
                    {(status.behind ?? 0) > 0 && (
                        <span>
                            <span aria-hidden="true">↓{status.behind}</span>
                            <span className="sr-only">
                                {t('git.behind', { n: status.behind })}
                            </span>
                        </span>
                    )}
                    {(status.ahead ?? 0) > 0 && (
                        <span>
                            <span aria-hidden="true">↑{status.ahead}</span>
                            <span className="sr-only">
                                {t('git.ahead', { n: status.ahead })}
                            </span>
                        </span>
                    )}
                </span>
            ) : (
                labelKey && (
                    <span className={compact ? 'sr-only' : undefined}>
                        {t(labelKey)}
                    </span>
                )
            )}
        </>
    );
    const authRequired = status.state === 'auth-required';
    const className = clsx(
        'inline-flex cursor-pointer items-center gap-1 focus-visible:outline-2',
        !compact &&
            clsx(
                'badge badge-sm badge-soft h-[22px] shrink-0 rounded-full px-[6px]',
                warning
                    ? 'badge-warning text-warning-content dark:text-warning'
                    : 'text-base-content',
            ),
        compact && warning && 'text-warning',
    );

    const canUpdate = Boolean(onUpdate) && canUpdateProjectGitStatus(status);
    const badge = (
        <Tooltip
            placement="top"
            tone="default"
            variant="panel"
            tip={
                <GitStatusTooltip status={status} t={t} canUpdate={canUpdate} />
            }
        >
            {authRequired ? (
                <GitHubSignInButton
                    label={t('git.signIn')}
                    data-testid="gitStatusBadge"
                    className={className}
                    onSignedIn={onRefresh}
                >
                    {content}
                </GitHubSignInButton>
            ) : (
                <button
                    type="button"
                    data-testid="gitStatusBadge"
                    className={className}
                    disabled={refreshing}
                    onClick={onRefresh}
                >
                    {content}
                </button>
            )}
        </Tooltip>
    );
    if (!updateProgress && !canUpdate) {
        return badge;
    }
    const stageLabel = updateProgress
        ? updateProgress.stage === 'lfs' && updateProgress.percent !== null
            ? t('update.stage.lfsPercent', { percent: updateProgress.percent })
            : t(`update.stage.${updateProgress.stage}`)
        : null;
    return (
        <span className="inline-flex items-center gap-1">
            {badge}
            {updateProgress ? (
                <Tooltip placement="top" tip={t('update.cancel')}>
                    <button
                        type="button"
                        data-testid="gitUpdateRunning"
                        className="badge badge-sm badge-soft badge-info h-[22px] shrink-0 cursor-pointer gap-1 rounded-full px-[6px]"
                        aria-label={`${stageLabel} ${t('update.cancel')}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onCancelUpdate?.();
                        }}
                    >
                        <span
                            className="loading loading-spinner loading-xs"
                            aria-hidden="true"
                        />
                        <span className={compact ? 'sr-only' : undefined}>
                            {stageLabel}
                        </span>
                    </button>
                </Tooltip>
            ) : (
                <Tooltip
                    placement="top"
                    tip={t('update.tooltip', { n: status.behind })}
                >
                    <button
                        type="button"
                        data-testid="gitUpdateButton"
                        className="badge badge-sm badge-soft badge-primary h-[22px] shrink-0 cursor-pointer gap-1 rounded-full px-[6px]"
                        onClick={(event) => {
                            event.stopPropagation();
                            onUpdate?.();
                        }}
                    >
                        <ArrowDownToLine size={14} aria-hidden="true" />
                        <span className={compact ? 'sr-only' : undefined}>
                            {t('update.action')}
                        </span>
                    </button>
                </Tooltip>
            )}
        </span>
    );
}

/**
 * Explains a status: tracking branches, state, staleness and check time.
 * @param props - Status and translation function.
 */
function GitStatusTooltip({
    status,
    t,
    canUpdate,
}: {
    status: ProjectGitStatus;
    t: Translate;
    canUpdate: boolean;
}) {
    const lines: string[] = [];
    if (status.branch && status.upstream) {
        lines.push(
            t('git.tracking', {
                branch: status.branch,
                upstream: status.upstream,
                interpolation: { escapeValue: false },
            }),
        );
    }
    if (status.state === 'ok') {
        lines.push(
            status.ahead === 0 && status.behind === 0
                ? t('git.upToDate')
                : [
                      t('git.behind', { n: status.behind }),
                      t('git.ahead', { n: status.ahead }),
                  ].join(' · '),
        );
    } else {
        lines.push(
            t(`git.descriptions.${status.state}`, {
                branch: status.branch ?? '',
                interpolation: { escapeValue: false },
            }),
        );
    }
    if (status.stale) {
        lines.push(t('git.stale'));
    }
    if (status.message) {
        lines.push(status.message);
    }
    lines.push(
        t('git.checkedAt', {
            time: new Date(status.checkedAt).toLocaleString(),
            interpolation: { escapeValue: false },
        }),
    );
    if (canUpdate) {
        lines.push(t('update.hint'));
    }
    lines.push(
        t(
            status.state === 'auth-required'
                ? 'git.openConnections'
                : 'git.refreshHint',
        ),
    );
    return (
        <div className="flex max-w-72 flex-col gap-1 text-left">
            {lines.map((line, index) => (
                <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and rebuilt together
                    key={index}
                    className={index === 0 ? 'font-medium' : undefined}
                >
                    {line}
                </span>
            ))}
        </div>
    );
}
