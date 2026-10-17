import { ExternalLink, KeyRound } from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ForkEngineAccess } from '../hooks/fork-engine-channels.model.ts';
import { appBridge } from '../renderer.bridge.ts';
import { GitHubSignInButton } from './github-connection/github-sign-in-button.component';

type ForkSourceAccessNoticeProps = {
    access: Extract<ForkEngineAccess, { kind: 'auth-required' | 'no-access' }>;
    /** GitHub `owner/repo` of the source. */
    source: string;
    /** Reloads view-local source state after signing in. */
    onSignedIn?: () => void | Promise<void>;
};

/**
 * Explains why the builds of a private fork source cannot be listed and
 * offers the fix in place: signing in to GitHub, or installing the GitHub
 * App on the repository owner when the signed-in account cannot see it.
 *
 * @param props - The access failure and the source repository.
 * @returns A warning with the actions that restore access.
 */
export const ForkSourceAccessNotice: React.FC<ForkSourceAccessNoticeProps> = ({
    access,
    source,
    onSignedIn,
}) => {
    const { t } = useTranslation('engineSources');
    const owner = source.split('/')[0];
    const installUrl = access.installUrl;

    return (
        <div
            role="alert"
            className="alert alert-warning alert-soft items-start text-warning-content dark:text-warning"
            data-testid={`forkSourceAccess_${access.kind}`}
        >
            <KeyRound size={16} aria-hidden="true" className="mt-0.5" />
            <div className="flex flex-col gap-2">
                <span>
                    {access.kind === 'no-access'
                        ? t('access.noAccess', { source, owner })
                        : t('access.authRequired', { source, owner })}
                </span>
                <div className="flex flex-wrap gap-2">
                    {access.kind === 'auth-required' && (
                        <GitHubSignInButton
                            label={t('access.signIn')}
                            data-testid="btnForkSourceSignIn"
                            onSignedIn={onSignedIn}
                        />
                    )}
                    {installUrl && (
                        <button
                            type="button"
                            className="btn btn-sm"
                            data-testid="btnForkSourceInstallApp"
                            onClick={() =>
                                void appBridge.openExternal(installUrl)
                            }
                        >
                            <ExternalLink size={14} aria-hidden="true" />
                            {t('access.installApp', { owner })}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
