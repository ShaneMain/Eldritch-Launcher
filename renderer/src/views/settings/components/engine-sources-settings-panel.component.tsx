import type {
    AddEngineSourceFailure,
    AddEngineSourceInput,
    EditorCatalogProviderId,
    EngineSourceSummary,
} from '@shared/contracts';
import { Plus, RefreshCcw, Trash2, TriangleAlert } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../../components/ui/status-badge.component';
import { useAlerts } from '../../../hooks/alerts.hook';
import { useEngineSources } from '../../../hooks/engine-sources.hook';
import { useRelease } from '../../../hooks/release.hook';
import { formatRelativeTime } from '../../../i18n/relative-time.util';
import { SettingsPanelSection } from './settings-panel-section.component';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type EngineSourcesSettingsPanelProps = {
    active: boolean;
};

/**
 * Loads engine sources and handles add, refresh, and remove actions.
 *
 * @param props - Whether the panel is the active settings tab.
 * @returns The Engine sources settings panel.
 */
export const EngineSourcesSettingsPanel: React.FC<
    EngineSourcesSettingsPanelProps
> = ({ active }) => {
    const { t, i18n } = useTranslation(['engineSources', 'common']);
    const { addAlert, addCustomConfirm } = useAlerts();
    const { listSources, addSource, removeSource, refreshSource } =
        useEngineSources();
    const { reloadReleases } = useRelease();
    const [sources, setSources] = useState<EngineSourceSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [pendingIds, setPendingIds] = useState<string[]>([]);
    const [actionErrors, setActionErrors] = useState<Record<string, string>>(
        {},
    );
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<AddEngineSourceFailure | null>(
        null,
    );

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            setSources(await listSources());
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [listSources]);

    useEffect(() => {
        if (active) {
            void load();
        }
    }, [active, load]);

    /**
     * Runs one source action while marking the source busy.
     *
     * @param id - Source being changed.
     * @param action - Bridge call returning the updated source list.
     * @returns A promise that ends after the list and catalog are updated.
     */
    const runSourceAction = async (
        id: EditorCatalogProviderId,
        action: () => Promise<EngineSourceSummary[]>,
    ): Promise<void> => {
        setPendingIds((current) => [...current, id]);
        setActionErrors(({ [id]: _previous, ...rest }) => rest);
        try {
            setSources(await action());
            await reloadReleases();
        } catch (error) {
            setActionErrors((current) => ({
                ...current,
                [id]: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setPendingIds((current) =>
                current.filter((pendingId) => pendingId !== id),
            );
        }
    };

    /**
     * Asks for confirmation, then removes one configured fork source.
     *
     * @param source - The source to remove.
     * @returns Nothing.
     */
    const confirmRemove = (source: EngineSourceSummary): void => {
        addCustomConfirm(
            t('settings.removeConfirm.title', { name: source.displayName }),
            <p>
                {t('settings.removeConfirm.message', {
                    name: source.displayName,
                    source: `${source.owner}/${source.repo}`,
                })}
            </p>,
            [
                {
                    isCancel: true,
                    typeClass: 'btn-ghost',
                    text: t('common:buttons.cancel'),
                },
                {
                    typeClass: 'btn-error',
                    text: t('common:buttons.remove'),
                    onClick: async () => {
                        await runSourceAction(source.id, () =>
                            removeSource(source.id),
                        );
                        return true;
                    },
                },
            ],
            <TriangleAlert className="inline text-warning" />,
        );
    };

    /**
     * Adds a fork source and reports a failure reason inline.
     *
     * @param input - Repository owner, name, and optional display name.
     * @returns Whether the source was added.
     */
    const handleAdd = async (input: AddEngineSourceInput): Promise<boolean> => {
        setAdding(true);
        setAddError(null);
        try {
            const result = await addSource(input);
            if (!result.ok) {
                setAddError(result.reason);
                return false;
            }
            setSources(result.sources);
            await reloadReleases();
            return true;
        } catch (error) {
            setAddError('network');
            addAlert(
                t('common:error'),
                error instanceof Error ? error.message : String(error),
            );
            return false;
        } finally {
            setAdding(false);
        }
    };

    return (
        <EngineSourcesPanelView
            active={active}
            t={t}
            locale={i18n.resolvedLanguage ?? i18n.language ?? 'en'}
            sources={sources}
            loading={loading}
            loadError={loadError}
            pendingIds={pendingIds}
            actionErrors={actionErrors}
            adding={adding}
            addError={addError}
            onRetry={() => void load()}
            onRefresh={(source) =>
                void runSourceAction(source.id, () => refreshSource(source.id))
            }
            onRemove={confirmRemove}
            onAdd={handleAdd}
        />
    );
};

type EngineSourcesPanelViewProps = {
    active: boolean;
    t: Translate;
    locale: string;
    sources: EngineSourceSummary[];
    loading: boolean;
    loadError: boolean;
    pendingIds: string[];
    actionErrors: Record<string, string>;
    adding: boolean;
    addError: AddEngineSourceFailure | null;
    onRetry: () => void;
    onRefresh: (source: EngineSourceSummary) => void;
    onRemove: (source: EngineSourceSummary) => void;
    onAdd: (input: AddEngineSourceInput) => Promise<boolean>;
};

/**
 * Presents engine sources, their refresh state, and the add form.
 *
 * @param props - Source state, translations, and actions.
 * @returns The Engine sources settings content.
 */
export const EngineSourcesPanelView: React.FC<EngineSourcesPanelViewProps> = ({
    active,
    t,
    locale,
    sources,
    loading,
    loadError,
    pendingIds,
    actionErrors,
    adding,
    addError,
    onRetry,
    onRefresh,
    onRemove,
    onAdd,
}) => (
    <SettingsPanelSection active={active}>
        <div className="flex flex-col gap-[4px] text-base">
            <h2 className="font-semibold">{t('title')}</h2>
            <p className="text-base-content/75">{t('settings.overview')}</p>
        </div>

        {loading && sources.length === 0 && (
            <div className="flex items-center gap-2" role="status">
                <span className="loading loading-spinner loading-sm" />
                <span>{t('settings.loading')}</span>
            </div>
        )}

        {!loading && loadError && (
            <div
                className="flex items-center justify-between gap-4 p-4"
                role="alert"
            >
                <span>{t('settings.loadError')}</span>
                <button
                    type="button"
                    className="btn btn-ghost text-base"
                    onClick={onRetry}
                >
                    {t('common:buttons.retry')}
                </button>
            </div>
        )}

        {sources.length > 0 && (
            <ul className="grid gap-3" data-testid="engineSourcesList">
                {sources.map((source) => (
                    <EngineSourceRow
                        key={source.id}
                        source={source}
                        t={t}
                        locale={locale}
                        pending={pendingIds.includes(source.id)}
                        actionError={actionErrors[source.id]}
                        onRefresh={onRefresh}
                        onRemove={onRemove}
                    />
                ))}
            </ul>
        )}

        {!loading &&
            !loadError &&
            !sources.some((source) => !source.builtIn) && (
                <p
                    className="text-base text-base-content/75"
                    data-testid="engineSourcesNoForks"
                >
                    {t('settings.noForks')}
                </p>
            )}

        <AddEngineSourceForm
            t={t}
            adding={adding}
            addError={addError}
            onAdd={onAdd}
        />
    </SettingsPanelSection>
);

type EngineSourceRowProps = {
    source: EngineSourceSummary;
    t: Translate;
    locale: string;
    pending: boolean;
    actionError?: string;
    onRefresh: (source: EngineSourceSummary) => void;
    onRemove: (source: EngineSourceSummary) => void;
};

/**
 * Renders one engine source with its state and actions.
 *
 * @param props - The source, its pending state, and actions.
 * @returns One source row.
 */
const EngineSourceRow: React.FC<EngineSourceRowProps> = ({
    source,
    t,
    locale,
    pending,
    actionError,
    onRefresh,
    onRemove,
}) => {
    const repository = `${source.owner}/${source.repo}`;

    return (
        <li
            className="flex flex-col gap-2 bg-base-200/40 p-4 text-base"
            data-testid={`engineSource_${source.id}`}
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{source.displayName}</span>
                <span className="text-sm text-base-content/60">
                    {repository}
                </span>
                {source.builtIn && (
                    <StatusBadge>{t('settings.builtIn')}</StatusBadge>
                )}
                {source.requiresAuth && (
                    <StatusBadge tone="info">
                        {t('settings.requiresAuth')}
                    </StatusBadge>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => onRefresh(source)}
                        data-testid={`btnRefreshEngineSource_${source.id}`}
                    >
                        {pending ? (
                            <span className="loading loading-spinner loading-xs" />
                        ) : (
                            <RefreshCcw size={14} aria-hidden="true" />
                        )}
                        {t('settings.refresh')}
                    </button>
                    {!source.builtIn && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm text-error"
                            disabled={pending}
                            onClick={() => onRemove(source)}
                            data-testid={`btnRemoveEngineSource_${source.id}`}
                        >
                            <Trash2 size={14} aria-hidden="true" />
                            {t('common:buttons.remove')}
                        </button>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
                {source.state === 'ok' && (
                    <StatusBadge tone="success">
                        {t('settings.state.ok')}
                    </StatusBadge>
                )}
                {source.state === 'auth-required' && (
                    <StatusBadge tone="warning">
                        {t('settings.state.authRequired')}
                    </StatusBadge>
                )}
                {source.state === 'error' && (
                    <StatusBadge tone="error">
                        {t('settings.state.error')}
                    </StatusBadge>
                )}
                {source.state === 'pending' && (
                    <StatusBadge>{t('settings.state.pending')}</StatusBadge>
                )}
                <span className="text-base-content/60">
                    {source.lastFetchedAt === null
                        ? t('settings.neverRefreshed')
                        : t('settings.lastRefreshed', {
                              age: formatRelativeTime(
                                  source.lastFetchedAt,
                                  locale,
                              ),
                          })}
                </span>
            </div>
            {source.state === 'auth-required' && (
                <p className="text-sm text-warning">
                    {t('settings.authRequiredHint')}
                </p>
            )}
            {source.state === 'error' && source.error && (
                <p className="text-sm text-error">{source.error}</p>
            )}
            {actionError && (
                <p className="text-sm text-error" role="alert">
                    {actionError}
                </p>
            )}
        </li>
    );
};

type AddEngineSourceFormProps = {
    t: Translate;
    adding: boolean;
    addError: AddEngineSourceFailure | null;
    onAdd: (input: AddEngineSourceInput) => Promise<boolean>;
};

const addErrorKeys: Record<AddEngineSourceFailure, string> = {
    invalid: 'settings.add.errors.invalid',
    duplicate: 'settings.add.errors.duplicate',
    'not-found': 'settings.add.errors.notFound',
    'auth-required': 'settings.add.errors.authRequired',
    network: 'settings.add.errors.network',
};

/**
 * Renders the form that adds a GitHub fork as an engine source.
 *
 * @param props - Pending state, last failure, and add action.
 * @returns The add-source form.
 */
const AddEngineSourceForm: React.FC<AddEngineSourceFormProps> = ({
    t,
    adding,
    addError,
    onAdd,
}) => {
    const [owner, setOwner] = useState('');
    const [repo, setRepo] = useState('');
    const [displayName, setDisplayName] = useState('');

    /**
     * Submits the form and clears it after a successful add.
     *
     * @param event - Form submission event.
     * @returns A promise that ends after the add request.
     */
    const handleSubmit = async (
        event: React.FormEvent<HTMLFormElement>,
    ): Promise<void> => {
        event.preventDefault();
        const added = await onAdd({
            owner: owner.trim(),
            repo: repo.trim(),
            ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        });
        if (added) {
            setOwner('');
            setRepo('');
            setDisplayName('');
        }
    };

    return (
        <form
            className="flex flex-col gap-3 text-base"
            onSubmit={(event) => void handleSubmit(event)}
            data-testid="addEngineSourceForm"
        >
            <h3 className="font-semibold">{t('settings.add.title')}</h3>
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-sm">{t('settings.add.owner')}</span>
                    <input
                        className="input input-sm"
                        value={owner}
                        required
                        onChange={(event) => setOwner(event.target.value)}
                        data-testid="inputEngineSourceOwner"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-sm">{t('settings.add.repo')}</span>
                    <input
                        className="input input-sm"
                        value={repo}
                        required
                        onChange={(event) => setRepo(event.target.value)}
                        data-testid="inputEngineSourceRepo"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-sm">
                        {t('settings.add.displayName')}
                    </span>
                    <input
                        className="input input-sm"
                        value={displayName}
                        placeholder={t('settings.add.displayNamePlaceholder')}
                        onChange={(event) => setDisplayName(event.target.value)}
                        data-testid="inputEngineSourceDisplayName"
                    />
                </label>
                <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={adding || !owner.trim() || !repo.trim()}
                    data-testid="btnAddEngineSource"
                >
                    {adding ? (
                        <span className="loading loading-spinner loading-xs" />
                    ) : (
                        <Plus size={14} aria-hidden="true" />
                    )}
                    {t('settings.add.submit')}
                </button>
            </div>
            {addError && (
                <p
                    className="text-sm text-error"
                    role="alert"
                    data-testid="addEngineSourceError"
                >
                    {t(addErrorKeys[addError])}
                </p>
            )}
        </form>
    );
};
