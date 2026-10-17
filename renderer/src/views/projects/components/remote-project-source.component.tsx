import type { RemoteRepositorySummary } from '@shared/contracts';
import type { TFunction } from 'i18next';
import {
    Check,
    FolderGit2,
    KeyRound,
    SearchX,
    TriangleAlert,
} from 'lucide-react';
import type { RefObject } from 'react';
import { SearchField } from '../../../components/ui/search-field.component';
import { TextField } from '../../../components/ui/text-field.component';
import {
    getRemoteProjectPublicSourceFailureKey,
    getRemoteProjectRepositoryFailureKey,
} from '../remote-project-import.messages';
import { getRemoteRepositoryRowClassName } from '../remote-project-import.model';
import type {
    RemoteProjectPublicSourceFailure,
    RemoteProjectRepositoryFailure,
} from '../remote-project-import.types';
import { RemoteProjectAccessMenu } from './remote-project-access-menu.component';

type RemoteProjectPublicSourceProps = {
    url: string;
    error: RemoteProjectPublicSourceFailure | null;
    inspecting: boolean;
    inputRef: RefObject<HTMLInputElement | null>;
    t: TFunction;
    onUrlChange: (value: string) => void;
    onContinue: () => void;
};

/** Renders anonymous public Git URL entry. */
export function RemoteProjectPublicSource({
    url,
    error,
    inspecting,
    inputRef,
    t,
    onUrlChange,
    onContinue,
}: RemoteProjectPublicSourceProps) {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-base text-base-content/75">
                {t('addProject.remote.public.description')}
            </p>
            <TextField
                inputRef={inputRef}
                id="inputPublicGitRepositoryUrl"
                testId="inputPublicGitRepositoryUrl"
                type="url"
                label={t('addProject.remote.public.urlLabel')}
                value={url}
                placeholder={t('addProject.remote.public.urlPlaceholder')}
                onChange={onUrlChange}
                onKeyDown={(event) => {
                    if (
                        event.key !== 'Enter' ||
                        event.repeat ||
                        event.nativeEvent.isComposing
                    )
                        return;
                    event.preventDefault();
                    if (!url.trim() || inspecting) return;
                    onContinue();
                }}
            />
            {error && (
                <div
                    className="alert alert-error alert-soft text-base"
                    role="alert"
                >
                    <TriangleAlert aria-hidden="true" size={18} />
                    <span>
                        {t(
                            `addProject.remote.public.errors.${getRemoteProjectPublicSourceFailureKey(error)}`,
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}

/** Repository failures that a GitHub sign-in fixes. */
const SIGN_IN_FAILURES: readonly RemoteProjectRepositoryFailure[] = [
    'no-usable-connection',
    'secure-storage-unavailable',
    'reauthorisation-required',
];

type RemoteProjectRepositorySourceProps = {
    loading: boolean;
    loadingMore: boolean;
    error: RemoteProjectRepositoryFailure | null;
    repositories: RemoteRepositorySummary[];
    selectedRepository: RemoteRepositorySummary | null;
    search: string;
    cursor: string | null;
    t: TFunction;
    onSearchChange: (value: string) => void;
    onSelect: (repository: RemoteRepositorySummary) => void;
    onContinue: (repository: RemoteRepositorySummary) => void;
    onRetry: () => void;
    onLoadMore: (cursor: string) => void;
    onOpenConnections: () => void;
    onRefreshRepositories: () => Promise<void>;
};

/** Renders connected GitHub repository selection. */
export function RemoteProjectRepositorySource({
    loading,
    loadingMore,
    error,
    repositories,
    selectedRepository,
    search,
    cursor,
    t,
    onSearchChange,
    onSelect,
    onContinue,
    onRetry,
    onLoadMore,
    onOpenConnections,
    onRefreshRepositories,
}: RemoteProjectRepositorySourceProps) {
    // Signed out, or the sign-in needs renewing: one neutral sign-in prompt.
    const signInRequired = error !== null && SIGN_IN_FAILURES.includes(error);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <p className="text-base text-base-content/75">
                {t('addProject.remote.github.description')}
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-base text-base-content/75">
                <span>{t('addProject.remote.github.missingRepository')}</span>
                <RemoteProjectAccessMenu
                    onAdd={onOpenConnections}
                    onRefresh={onRefreshRepositories}
                />
            </div>

            {loading ? (
                <div className="flex items-center gap-2" role="status">
                    <span className="loading loading-spinner loading-sm" />
                    {t('addProject.remote.github.loading')}
                </div>
            ) : signInRequired ? (
                <div
                    className="flex flex-col items-start gap-3 rounded-md bg-base-200/70 p-4 text-base"
                    data-testid="remoteProjectSignInPrompt"
                >
                    <p className="flex items-center gap-2">
                        <KeyRound aria-hidden="true" size={18} />
                        {t(
                            'addProject.remote.github.errors.connectionRequired',
                        )}
                    </p>
                    <button
                        type="button"
                        className="btn btn-primary text-base"
                        data-testid="btnRemoteProjectSignIn"
                        onClick={onOpenConnections}
                    >
                        {t('addProject.remote.github.openConnections')}
                    </button>
                </div>
            ) : error ? (
                <div className="flex flex-col gap-3">
                    <div
                        className="alert alert-error alert-soft text-base"
                        role="alert"
                    >
                        <TriangleAlert aria-hidden="true" size={18} />
                        <span>
                            {t(
                                `addProject.remote.github.errors.${getRemoteProjectRepositoryFailureKey(error)}`,
                            )}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="btn btn-ghost text-base"
                            onClick={onRetry}
                        >
                            {t('common:buttons.retry')}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <SearchField
                        placeholder={t(
                            'addProject.remote.github.searchPlaceholder',
                        )}
                        value={search}
                        onChange={onSearchChange}
                        focusOnMount
                        data-testid="inputGitHubRepositorySearch"
                    />
                    {cursor && (
                        <p className="text-sm text-base-content/60">
                            {t('addProject.remote.github.loadedSearchOnly')}
                        </p>
                    )}
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-1 pr-3 [scrollbar-gutter:stable]">
                        {repositories.length === 0 ? (
                            <p className="flex flex-col items-center gap-3 rounded-md bg-base-content/2 px-4 py-8 text-base text-base-content/60">
                                <SearchX size={24} aria-hidden="true" />
                                {t(
                                    search.trim()
                                        ? 'addProject.remote.github.empty'
                                        : 'addProject.remote.github.noRepositories',
                                )}
                            </p>
                        ) : (
                            repositories.map((repository) => (
                                <button
                                    type="button"
                                    key={repository.repositoryRef}
                                    disabled={repository.alreadyImported}
                                    title={
                                        repository.alreadyImported
                                            ? t(
                                                  'addProject.remote.github.alreadyAdded',
                                              )
                                            : undefined
                                    }
                                    aria-pressed={
                                        selectedRepository?.repositoryRef ===
                                        repository.repositoryRef
                                    }
                                    className={getRemoteRepositoryRowClassName(
                                        selectedRepository?.repositoryRef ===
                                            repository.repositoryRef,
                                    )}
                                    onClick={() => onSelect(repository)}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter') return;
                                        event.preventDefault();
                                        onContinue(repository);
                                    }}
                                >
                                    <FolderGit2
                                        size={20}
                                        aria-hidden="true"
                                        className="shrink-0 text-base-content/60"
                                    />
                                    <span className="min-w-0 flex-1 break-all">
                                        {repository.owner}/{repository.name}
                                    </span>
                                    {repository.alreadyImported && (
                                        <span className="text-sm text-base-content/60">
                                            {t(
                                                'addProject.remote.github.alreadyAdded',
                                            )}
                                        </span>
                                    )}
                                    {selectedRepository?.repositoryRef ===
                                        repository.repositoryRef && (
                                        <Check
                                            aria-hidden="true"
                                            className="h-5 w-5 shrink-0"
                                        />
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                    {cursor && (
                        <button
                            type="button"
                            className="btn btn-ghost text-base self-start"
                            disabled={loadingMore}
                            onClick={() => onLoadMore(cursor)}
                        >
                            {loadingMore && (
                                <span className="loading loading-spinner loading-xs" />
                            )}
                            {t('addProject.remote.github.loadMore')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
