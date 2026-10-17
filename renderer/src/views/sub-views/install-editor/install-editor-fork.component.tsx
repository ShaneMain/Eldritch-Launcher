import type { ReleaseSummary } from '@shared/contracts';
import type React from 'react';
import { ForkSourceAccessNotice } from '../../../components/fork-source-access-notice.component.tsx';
import { SearchField } from '../../../components/ui/search-field.component.tsx';
import {
    type ForkEngineChannel,
    type ForkEngineHost,
    toHostRelease,
} from '../../../hooks/fork-engine-channels.model.ts';
import { InstallEditorVariantAction } from './install-editor-variant-action.component.tsx';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type InstallEditorForkProps = {
    channel: ForkEngineChannel;
    /** Unknown until the main process reports it. */
    host: ForkEngineHost | null;
    search: string;
    searchPlaceholder: string;
    t: Translate;
    onSearchChange: (search: string) => void;
    onInstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
    onReinstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
};

/**
 * Renders the builds published by one fork engine source, or why none can
 * be listed.
 *
 * @param props - The fork channel, search, and install actions.
 * @returns The fork build list.
 */
export const InstallEditorFork: React.FC<InstallEditorForkProps> = ({
    channel,
    host,
    search,
    searchPlaceholder,
    t,
    onSearchChange,
    onInstall,
    onReinstall,
}) => {
    const { access } = channel;
    if (access.kind === 'auth-required' || access.kind === 'no-access') {
        return (
            <ForkSourceAccessNotice access={access} source={channel.source} />
        );
    }

    const query = search.trim().toLowerCase();
    const rows = channel.releases
        .filter(
            (release) =>
                !query ||
                [
                    release.name,
                    release.tag ?? '',
                    release.version,
                    release.fork?.revision ?? '',
                ].some((value) => value.toLowerCase().includes(query)),
        )
        .sort((first, second) =>
            (second.published_at ?? '').localeCompare(first.published_at ?? ''),
        );

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex shrink-0 justify-end">
                <SearchField
                    key={channel.id}
                    placeholder={searchPlaceholder}
                    value={search}
                    onChange={onSearchChange}
                    className="max-w-sm"
                    data-testid="inputInstallForkSearch"
                />
            </div>

            {rows.length === 0 ? (
                <div
                    className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-base-content/75"
                    data-testid="installEditorForkEmpty"
                >
                    <span>{t('drawer.empty')}</span>
                    {access.kind === 'error'
                        ? access.message && (
                              <span className="text-sm text-error">
                                  {access.message}
                              </span>
                          )
                        : !query && (
                              <span className="text-sm">
                                  {t('drawer.emptyHint', {
                                      source: channel.source,
                                  })}
                              </span>
                          )}
                </div>
            ) : (
                <div
                    className="flex min-h-0 flex-1 flex-col overflow-auto pr-3"
                    data-testid="installEditorForkList"
                >
                    {rows.map((release) => (
                        <ForkReleaseRow
                            key={`${release.fork?.revision}:${release.version}`}
                            release={release}
                            host={host}
                            t={t}
                            onInstall={onInstall}
                            onReinstall={onReinstall}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

type ForkReleaseRowProps = {
    release: ReleaseSummary;
    host: ForkEngineHost | null;
    t: Translate;
    onInstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
    onReinstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
};

/**
 * Renders one fork build with its identity and host-platform install actions.
 *
 * @param props - The fork build, host platform, and install actions.
 * @returns One fork build row.
 */
const ForkReleaseRow: React.FC<ForkReleaseRowProps> = ({
    release,
    host,
    t,
    onInstall,
    onReinstall,
}) => {
    // Fork sources may publish only some platforms; offer only host assets.
    const hostRelease = host ? toHostRelease(release, host) : null;
    const revision = release.fork?.revision ?? '';

    return (
        // Rows keep their height so the scrolling list never overlaps them.
        <article
            className="flex min-h-14 shrink-0 flex-col items-stretch gap-3 px-3 py-3 hover:bg-base-content/5 sm:flex-row sm:items-center"
            data-testid={`forkReleaseRow_${revision.slice(0, 7)}`}
        >
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="truncate font-semibold">{release.name}</span>
                {release.tag && release.tag !== release.name && (
                    <span className="truncate text-sm text-base-content/75">
                        {release.tag}
                    </span>
                )}
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-base-content/60">
                    <span className="truncate">{release.version}</span>
                    <span
                        className="badge badge-sm badge-ghost font-mono"
                        title={revision}
                    >
                        {revision.slice(0, 7)}
                    </span>
                    {release.published_at && (
                        <span>{release.published_at.split('T')[0]}</span>
                    )}
                </span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {!hostRelease ? (
                    <span
                        className="loading loading-spinner loading-sm"
                        aria-hidden="true"
                    />
                ) : hostRelease.assets.length === 0 ? (
                    <span
                        className="text-sm text-base-content/60"
                        data-testid="forkNoPlatformBuild"
                    >
                        {t('drawer.noPlatformBuild')}
                    </span>
                ) : (
                    <>
                        <InstallEditorVariantAction
                            release={hostRelease}
                            mono={false}
                            onInstall={onInstall}
                            onReinstall={onReinstall}
                        />
                        <InstallEditorVariantAction
                            release={hostRelease}
                            mono
                            onInstall={onInstall}
                            onReinstall={onReinstall}
                        />
                    </>
                )}
            </div>
        </article>
    );
};
