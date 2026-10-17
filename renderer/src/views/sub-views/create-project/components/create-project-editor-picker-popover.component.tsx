import type {
    InstalledRelease,
    ReleaseInstallProgress,
} from '@shared/contracts';
import clsx from 'clsx';
import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ForkSourceAccessNotice } from '../../../../components/fork-source-access-notice.component';
import { SearchField } from '../../../../components/ui/search-field.component';
import type { ForkEngineChannel } from '../../../../hooks/fork-engine-channels.model';
import type {
    CreateProjectCatalogueVariant,
    CreateProjectEditorSelection,
    CreateProjectReleaseRow,
} from '../create-project.model';
import { getCreateProjectReleaseKey } from '../create-project.model';
import { groupCreateProjectCatalogueVariants } from '../create-project-catalogue-groups.util';
import { CreateProjectEditorOption } from './create-project-editor-option.component';

export type CreateProjectEditorPickerTab = 'installed' | 'catalogue';
export type CreateProjectEditorPickerChannel = 'stable' | 'prerelease';

type CreateProjectEditorPickerPopoverProps = {
    id: string;
    labelledBy: string;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    style: React.CSSProperties;
    open: boolean;
    tab: CreateProjectEditorPickerTab;
    channel: CreateProjectEditorPickerChannel;
    /** Fork engine sources offered as extra channels. */
    forkChannels: ForkEngineChannel[];
    /** Selected fork channel, replacing the official channel. */
    forkChannel: ForkEngineChannel | undefined;
    /** Whether the host platform used to filter fork builds is known. */
    hostKnown: boolean;
    search: string;
    installedRows: CreateProjectReleaseRow[];
    installedReleases: InstalledRelease[];
    catalogueVariants: CreateProjectCatalogueVariant[];
    releaseInstallProgress: ReleaseInstallProgress[];
    loading: boolean;
    catalogueError: string | undefined;
    hasCachedCatalogueReleases: boolean;
    retryingCatalogue: boolean;
    selection: CreateProjectEditorSelection | null;
    onTabChange: (tab: CreateProjectEditorPickerTab) => void;
    onChannelChange: (channel: CreateProjectEditorPickerChannel) => void;
    onForkChannelChange: (channelId: string) => void;
    onSearchChange: (search: string) => void;
    onSelectionChange: (selection: CreateProjectEditorSelection) => void;
    onCancelInstall: (jobId: string) => void;
    onRetryCatalogue: () => Promise<void>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
    registerInstalledOption: (
        key: string,
        element: HTMLButtonElement | null,
    ) => void;
};

/**
 * Renders the rich editor selection controls inside an anchored popover.
 *
 * @param props - Picker state, editor collections, and interaction callbacks.
 * @returns The native popover panel for Create Project editor selection.
 */
export const CreateProjectEditorPickerPopover: React.FC<
    CreateProjectEditorPickerPopoverProps
> = ({
    id,
    labelledBy,
    popoverRef,
    style,
    open,
    tab,
    channel,
    forkChannels,
    forkChannel,
    hostKnown,
    search,
    installedRows,
    installedReleases,
    catalogueVariants,
    releaseInstallProgress,
    loading,
    catalogueError,
    hasCachedCatalogueReleases,
    retryingCatalogue,
    selection,
    onTabChange,
    onChannelChange,
    onForkChannelChange,
    onSearchChange,
    onSelectionChange,
    onCancelInstall,
    onRetryCatalogue,
    onKeyDown,
    registerInstalledOption,
}) => {
    const { t } = useTranslation([
        'createProject',
        'installEditor',
        'engineSources',
    ]);
    const forkAccess = forkChannel?.access;
    const catalogueGroups = useMemo(
        () => groupCreateProjectCatalogueVariants(catalogueVariants),
        [catalogueVariants],
    );
    const labels = {
        standard: t('editorPicker.standard'),
        dotNet: t('project.dotNetBadge'),
        prerelease: t('project.prereleaseBadge'),
        custom: t('editorPicker.custom'),
        installed: t('editorPicker.installed'),
        selected: t('editorPicker.selected'),
        unavailable: t('editorPicker.unavailable'),
        downloadRequired: t('editorPicker.downloadRequired'),
    };

    return (
        <div
            ref={popoverRef}
            id={id}
            popover="auto"
            role="dialog"
            aria-modal="false"
            aria-labelledby={labelledBy}
            data-testid="createProjectEditorPickerPopover"
            onKeyDown={onKeyDown}
            className="fixed inset-auto m-0 w-[min(34rem,calc(100vw-2rem))] h-[min(28rem,calc(100vh-2rem))] overflow-hidden rounded-md border border-base-content/20 bg-base-100 p-3 text-base shadow-md"
            style={style}
        >
            <div className="flex h-full min-h-0 flex-col gap-3">
                <div
                    role="tablist"
                    className="tabs tabs-box tabs-sm shrink-0 self-start"
                >
                    <button
                        type="button"
                        role="tab"
                        data-testid="tabCreateProjectInstalledEditors"
                        aria-selected={tab === 'installed'}
                        className={clsx('tab text-base', {
                            'tab-active': tab === 'installed',
                        })}
                        onClick={() => onTabChange('installed')}
                    >
                        {t('editorPicker.installed')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        data-testid="tabCreateProjectBrowseEditors"
                        aria-selected={tab === 'catalogue'}
                        className={clsx('tab text-base', {
                            'tab-active': tab === 'catalogue',
                        })}
                        onClick={() => onTabChange('catalogue')}
                    >
                        {t('editorPicker.browse')}
                    </button>
                </div>

                {tab === 'installed' ? (
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pl-1 pr-3 pt-1">
                        {installedRows.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                                <p className="text-lg font-semibold">
                                    {t('editorPicker.noInstalled')}
                                </p>
                                <p className="max-w-xs text-base-content/75">
                                    {t('editorPicker.noInstalledDescription')}
                                </p>
                                <button
                                    type="button"
                                    className="btn btn-primary text-base"
                                    onClick={() => onTabChange('catalogue')}
                                >
                                    {t('editorPicker.browse')}
                                </button>
                            </div>
                        ) : (
                            <div
                                role="listbox"
                                aria-labelledby={labelledBy}
                                className="space-y-3"
                            >
                                {installedRows.map((release) => {
                                    const key =
                                        getCreateProjectReleaseKey(release);

                                    return (
                                        <CreateProjectEditorOption
                                            key={key}
                                            kind="installed"
                                            release={release}
                                            optionKey={key}
                                            selected={
                                                selection?.source ===
                                                    'installed' &&
                                                selection.key === key
                                            }
                                            labels={labels}
                                            buttonRef={(element) =>
                                                registerInstalledOption(
                                                    key,
                                                    element,
                                                )
                                            }
                                            onSelect={() =>
                                                onSelectionChange({
                                                    source: 'installed',
                                                    key,
                                                    release,
                                                })
                                            }
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <SearchField
                                id="inputCreateProjectEditorSearch"
                                data-testid="inputCreateProjectEditorSearch"
                                value={search}
                                onChange={onSearchChange}
                                placeholder={t('editorPicker.search')}
                                clearLabel={t('editorPicker.clearSearch')}
                                className="min-w-48 flex-1 max-w-none"
                                focusOnMount={open}
                            />
                            <div
                                role="tablist"
                                className="tabs tabs-box tabs-sm"
                                aria-label={t('editorPicker.channel')}
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    data-testid="tabCreateProjectStableEditors"
                                    aria-selected={
                                        !forkChannel && channel === 'stable'
                                    }
                                    className={clsx('tab text-base', {
                                        'tab-active':
                                            !forkChannel &&
                                            channel === 'stable',
                                    })}
                                    onClick={() => onChannelChange('stable')}
                                >
                                    {t('editorPicker.stable')}
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    data-testid="tabCreateProjectPrereleaseEditors"
                                    aria-selected={
                                        !forkChannel && channel === 'prerelease'
                                    }
                                    className={clsx('tab text-base', {
                                        'tab-active':
                                            !forkChannel &&
                                            channel === 'prerelease',
                                    })}
                                    onClick={() =>
                                        onChannelChange('prerelease')
                                    }
                                >
                                    {t('editorPicker.prereleases')}
                                </button>
                                {forkChannels.map((candidate) => (
                                    <button
                                        key={candidate.id}
                                        type="button"
                                        role="tab"
                                        data-testid={`tabCreateProjectForkEditors_${candidate.id}`}
                                        aria-selected={
                                            forkChannel?.id === candidate.id
                                        }
                                        className={clsx('tab text-base', {
                                            'tab-active':
                                                forkChannel?.id ===
                                                candidate.id,
                                        })}
                                        onClick={() =>
                                            onForkChannelChange(candidate.id)
                                        }
                                    >
                                        {candidate.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {!forkChannel &&
                            (catalogueError || retryingCatalogue) && (
                                <div
                                    className="alert alert-warning alert-soft shrink-0 text-warning-content dark:text-warning"
                                    data-testid="createProjectEditorCatalogueError"
                                    role="alert"
                                >
                                    <span>
                                        {hasCachedCatalogueReleases
                                            ? t('editorPicker.refreshFailed')
                                            : t('editorPicker.loadFailed')}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-ghost text-base"
                                        data-testid="btnRetryCreateProjectEditorCatalogue"
                                        disabled={retryingCatalogue}
                                        onClick={() => void onRetryCatalogue()}
                                    >
                                        {retryingCatalogue
                                            ? t('editorPicker.retrying')
                                            : t('editorPicker.retry')}
                                    </button>
                                </div>
                            )}

                        {forkChannel &&
                        (forkAccess?.kind === 'auth-required' ||
                            forkAccess?.kind === 'no-access') ? (
                            <ForkSourceAccessNotice
                                access={forkAccess}
                                source={forkChannel.source}
                            />
                        ) : (
                            <div
                                role="listbox"
                                aria-labelledby={labelledBy}
                                data-testid="createProjectEditorCatalogueList"
                                className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pl-1 pr-3"
                            >
                                {(forkChannel
                                    ? !hostKnown
                                    : loading && !catalogueError) &&
                                catalogueVariants.length === 0 ? (
                                    <p
                                        className="py-4 text-center text-base-content/75"
                                        role="status"
                                    >
                                        {t('editorPicker.loading')}
                                    </p>
                                ) : forkChannel &&
                                  catalogueVariants.length === 0 ? (
                                    <div
                                        className="flex flex-col items-center gap-1 px-4 py-4 text-center text-base-content/75"
                                        data-testid="createProjectForkEditorsEmpty"
                                    >
                                        <span>
                                            {t(
                                                forkChannel.releases.length ===
                                                    0
                                                    ? 'engineSources:drawer.empty'
                                                    : 'editorPicker.noMatches',
                                            )}
                                        </span>
                                        {forkAccess?.kind === 'error'
                                            ? forkAccess.message && (
                                                  <span className="text-sm text-error">
                                                      {forkAccess.message}
                                                  </span>
                                              )
                                            : !search.trim() && (
                                                  <span className="text-sm">
                                                      {t(
                                                          forkChannel.releases
                                                              .length === 0
                                                              ? 'engineSources:drawer.emptyHint'
                                                              : 'engineSources:drawer.noHostBuilds',
                                                          {
                                                              source: forkChannel.source,
                                                          },
                                                      )}
                                                  </span>
                                              )}
                                    </div>
                                ) : catalogueVariants.length === 0 &&
                                  !catalogueError ? (
                                    <p className="py-4 text-center text-base-content/75">
                                        {t('editorPicker.noMatches')}
                                    </p>
                                ) : catalogueVariants.length > 0 ? (
                                    catalogueGroups.map((group) => (
                                        <fieldset
                                            key={group.key}
                                            aria-label={group.key}
                                            data-testid={`createProjectEditorCatalogueGroup_${group.key}`}
                                            className="min-w-0 space-y-3 p-0"
                                        >
                                            <div
                                                aria-hidden="true"
                                                className="px-3 pt-2 pb-1 text-sm font-semibold text-base-content/50"
                                            >
                                                {group.key}
                                            </div>
                                            {group.variants.map((variant) => {
                                                const installedRelease =
                                                    installedReleases.find(
                                                        (candidate) =>
                                                            candidate.version ===
                                                                variant.release
                                                                    .version &&
                                                            candidate.mono ===
                                                                variant.mono &&
                                                            candidate.valid !==
                                                                false &&
                                                            Boolean(
                                                                candidate.editor_path,
                                                            ),
                                                    );
                                                const progress =
                                                    releaseInstallProgress.find(
                                                        (candidate) =>
                                                            candidate.version ===
                                                                variant.release
                                                                    .version &&
                                                            candidate.mono ===
                                                                variant.mono,
                                                    );

                                                return (
                                                    <CreateProjectEditorOption
                                                        key={variant.key}
                                                        kind="catalogue"
                                                        release={
                                                            variant.release
                                                        }
                                                        mono={variant.mono}
                                                        optionKey={variant.key}
                                                        selected={
                                                            selection?.source ===
                                                                'catalogue' &&
                                                            selection.key ===
                                                                variant.key
                                                        }
                                                        installedRelease={
                                                            installedRelease
                                                        }
                                                        progress={progress}
                                                        labels={labels}
                                                        onSelect={() =>
                                                            onSelectionChange({
                                                                source: 'catalogue',
                                                                key: variant.key,
                                                                release:
                                                                    variant.release,
                                                                mono: variant.mono,
                                                                installedRelease,
                                                            })
                                                        }
                                                        onCancelInstall={
                                                            onCancelInstall
                                                        }
                                                    />
                                                );
                                            })}
                                        </fieldset>
                                    ))
                                ) : null}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
