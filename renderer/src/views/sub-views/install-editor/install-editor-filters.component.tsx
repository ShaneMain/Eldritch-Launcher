import clsx from 'clsx';
import { RefreshCcw } from 'lucide-react';
import type React from 'react';
import { Tooltip } from '../../../components/ui/tooltip.component.tsx';
import type {
    InstallEditorChannel,
    InstallEditorShow,
} from './install-editor.model.ts';

type InstallEditorFiltersProps = {
    show: InstallEditorShow;
    channel: InstallEditorChannel;
    /** Fork engine sources offered as extra channels. */
    forkSources?: { id: string; label: string }[];
    /** Selected fork source, or null for the official channel. */
    forkSourceId?: string | null;
    loading: boolean;
    refreshCooldownSeconds: number;
    showLabel: string;
    latestLabel: string;
    allLabel: string;
    channelLabel: string;
    stableLabel: string;
    prereleaseLabel: string;
    refreshLabel: string;
    loadingLabel: string;
    cooldownLabel: string;
    cooldownTooltip: string;
    onShowChange: (show: InstallEditorShow) => void;
    onChannelChange: (channel: InstallEditorChannel) => void;
    onForkSourceChange?: (sourceId: string) => void;
    onRefresh: () => void;
};

/**
 * Renders the catalogue controls used by the drawer.
 *
 * @param props - The current filters, labels, and filter actions.
 * @returns The catalog filter row.
 */
export const InstallEditorFilters: React.FC<InstallEditorFiltersProps> = ({
    show,
    channel,
    forkSources = [],
    forkSourceId = null,
    loading,
    refreshCooldownSeconds,
    showLabel,
    latestLabel,
    allLabel,
    channelLabel,
    stableLabel,
    prereleaseLabel,
    refreshLabel,
    loadingLabel,
    cooldownLabel,
    cooldownTooltip,
    onShowChange,
    onChannelChange,
    onForkSourceChange,
    onRefresh,
}) => (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-base">
        {forkSourceId === null && (
            <div className="flex items-center gap-2">
                <span className="text-base-content/75">{showLabel}</span>
                <div role="tablist" className="tabs tabs-box tabs-sm">
                    <button
                        type="button"
                        role="tab"
                        data-testid="tabInstallsLatest"
                        aria-selected={show === 'latest'}
                        className={clsx('tab text-base', {
                            'tab-active': show === 'latest',
                        })}
                        onClick={() => onShowChange('latest')}
                    >
                        {latestLabel}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        data-testid="tabInstallsAll"
                        aria-selected={show === 'all'}
                        className={clsx('tab text-base', {
                            'tab-active': show === 'all',
                        })}
                        onClick={() => onShowChange('all')}
                    >
                        {allLabel}
                    </button>
                </div>
            </div>
        )}

        <div className="flex items-center gap-2">
            <span className="text-base-content/75">{channelLabel}</span>
            <div role="tablist" className="tabs tabs-box tabs-sm">
                <button
                    type="button"
                    role="tab"
                    data-testid="tabInstallsRelease"
                    aria-selected={
                        forkSourceId === null && channel === 'stable'
                    }
                    className={clsx('tab text-base', {
                        'tab-active':
                            forkSourceId === null && channel === 'stable',
                    })}
                    onClick={() => onChannelChange('stable')}
                >
                    {stableLabel}
                </button>
                <button
                    type="button"
                    role="tab"
                    data-testid="tabInstallsPrerelease"
                    aria-selected={
                        forkSourceId === null && channel === 'prerelease'
                    }
                    className={clsx('tab text-base', {
                        'tab-active':
                            forkSourceId === null && channel === 'prerelease',
                    })}
                    onClick={() => onChannelChange('prerelease')}
                >
                    {prereleaseLabel}
                </button>
                {forkSources.map((source) => (
                    <button
                        key={source.id}
                        type="button"
                        role="tab"
                        data-testid={`tabInstallsFork_${source.id}`}
                        aria-selected={forkSourceId === source.id}
                        className={clsx('tab text-base', {
                            'tab-active': forkSourceId === source.id,
                        })}
                        onClick={() => onForkSourceChange?.(source.id)}
                    >
                        {source.label}
                    </button>
                ))}
            </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center">
                {loading && (
                    <span
                        className="loading loading-spinner loading-sm"
                        role="status"
                        aria-label={loadingLabel}
                    />
                )}
            </div>
            {refreshCooldownSeconds > 0 && (
                <span className="whitespace-nowrap text-sm text-base-content/60">
                    {cooldownLabel}
                </span>
            )}
            <Tooltip
                placement="top"
                tip={
                    refreshCooldownSeconds > 0 ? cooldownTooltip : refreshLabel
                }
            >
                <button
                    type="button"
                    data-testid="btnRefreshInstallEditorCatalog"
                    className="btn btn-sm btn-ghost btn-square"
                    aria-label={refreshLabel}
                    onClick={onRefresh}
                    disabled={loading || refreshCooldownSeconds > 0}
                >
                    <RefreshCcw size={16} aria-hidden="true" />
                </button>
            </Tooltip>
        </div>
    </div>
);
