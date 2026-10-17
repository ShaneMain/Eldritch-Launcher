import { TriangleAlert } from 'lucide-react';
import { GitHubAppAccessButton } from '../../../components/github-connection/github-app-access-button.component';
import { GitHubSignInButton } from '../../../components/github-connection/github-sign-in-button.component';
import type { PinnedSourceState } from '../pinned-sources.model';

type PinnedSourceNoticeProps = {
    /** GitHub `owner/repo` of the pin. */
    source: string;
    state: PinnedSourceState;
    t: (key: string, options?: Record<string, unknown>) => string;
    /** Adds the source again once access is restored. */
    onRetry: () => void | Promise<void>;
};

/**
 * Shows, inside an import review row, why the pinned fork source is not
 * added yet and the one action that fixes it.
 *
 * @param props - Source, state and the retry after restoring access.
 * @returns The notice.
 */
export function PinnedSourceNotice({
    source,
    state,
    t,
    onRetry,
}: PinnedSourceNoticeProps) {
    if (state.kind === 'adding') {
        return (
            <p
                className="flex items-center gap-2 text-sm text-base-content/60"
                role="status"
                data-testid="pinnedSourceAdding"
            >
                <span className="loading loading-spinner loading-xs" />
                {t('addProject.editorReview.pinnedSource.adding', { source })}
            </p>
        );
    }
    const message = {
        'auth-required': 'authRequired',
        'no-access': 'noAccess',
        failed: 'failed',
        'build-missing': 'buildMissing',
    }[state.kind];
    return (
        <div
            className="flex flex-col items-start gap-2 text-sm text-warning"
            data-testid={`pinnedSource_${state.kind}`}
        >
            <span className="flex items-start gap-1">
                <TriangleAlert
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                />
                {t(`addProject.editorReview.pinnedSource.${message}`, {
                    source,
                })}
            </span>
            {state.kind === 'auth-required' && (
                <GitHubSignInButton
                    label={t('addProject.editorReview.pinnedSource.signIn')}
                    className="btn btn-primary btn-sm"
                    data-testid="btnPinnedSourceSignIn"
                    onSignedIn={onRetry}
                />
            )}
            {state.kind === 'no-access' && state.installUrl && (
                <GitHubAppAccessButton
                    installUrl={state.installUrl}
                    label={t(
                        'addProject.editorReview.pinnedSource.giveAppAccess',
                    )}
                    className="btn btn-primary btn-sm"
                    data-testid="btnPinnedSourceGiveAccess"
                    onReturn={onRetry}
                />
            )}
        </div>
    );
}
