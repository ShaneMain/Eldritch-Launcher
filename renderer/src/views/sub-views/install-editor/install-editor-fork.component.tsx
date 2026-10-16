import type { ReleaseSummary } from '@shared/contracts';
import { KeyRound } from 'lucide-react';
import type React from 'react';
import { SearchField } from '../../../components/ui/search-field.component.tsx';
import { InstallEditorVariantAction } from './install-editor-variant-action.component.tsx';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Current operating system and processor architecture. */
export type InstallEditorHostPlatform = {
    platform: string;
    arch: string;
};

type InstallEditorForkProps = {
    sourceId: string;
    releases: ReleaseSummary[];
    /** Unknown until the main process reports it. */
    host: InstallEditorHostPlatform | null;
    authRequired: boolean;
    sourceError?: string;
    search: string;
    searchPlaceholder: string;
    t: Translate;
    onSearchChange: (search: string) => void;
    onInstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
    onReinstall: (release: ReleaseSummary, mono: boolean) => Promise<void>;
};

/**
 * Renders the builds published by one fork engine source.
 *
 * @param props - The source builds, host platform, and install actions.
 * @returns The fork build list, or a sign-in notice for private sources.
 */
export const InstallEditorFork: React.FC<InstallEditorForkProps> = ({
    sourceId,
    releases,
    host,
    authRequired,
    sourceError,
    search,
    searchPlaceholder,
    t,
    onSearchChange,
    onInstall,
    onReinstall,
}) => {
    if (authRequired) {
        return (
            <div
                role="alert"
                className="alert alert-warning alert-soft text-warning-content dark:text-warning"
                data-testid="forkSourceAuthRequired"
            >
                <KeyRound size={16} aria-hidden="true" />
                <span>{t('drawer.authRequired')}</span>
            </div>
        );
    }

    const query = search.trim().toLowerCase();
    const rows = releases
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
                    key={sourceId}
                    placeholder={searchPlaceholder}
                    value={search}
                    onChange={onSearchChange}
                    className="max-w-sm"
                    data-testid="inputInstallForkSearch"
                />
            </div>

            {rows.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-base-content/75">
                    <span>{t('drawer.empty')}</span>
                    {sourceError && (
                        <span className="text-sm text-error">
                            {sourceError}
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
    host: InstallEditorHostPlatform | null;
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
    const hostRelease: ReleaseSummary | null = host
        ? {
              ...release,
              assets: release.assets.filter(
                  (asset) =>
                      asset.platform_tags[0] === host.platform &&
                      asset.platform_tags[1] === host.arch,
              ),
          }
        : null;
    const revision = release.fork?.revision ?? '';

    return (
        <article
            className="flex min-h-14 flex-col items-stretch gap-3 px-3 py-3 hover:bg-base-content/5 sm:flex-row sm:items-center"
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
