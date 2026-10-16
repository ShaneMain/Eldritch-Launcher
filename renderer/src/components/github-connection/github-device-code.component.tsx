import type { AppIntegrationDeviceAuthorization } from '@shared/contracts';
import { ExternalLink } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appBridge } from '../../renderer.bridge.ts';
import { CopyButton } from '../ui/copy-button.component';
import { formatDeviceCodeRemaining } from './github-connection-flow.model';

type GitHubDeviceCodeProps = {
    /** The code to confirm, or `null` while Launcher is still requesting it. */
    authorization: AppIntegrationDeviceAuthorization | null;
};

/**
 * Shows the GitHub device-flow user code, a link to GitHub's device page, and
 * the time left before the code expires.
 *
 * @param props - The active device authorisation.
 * @returns The device-code step of the GitHub connection flow.
 */
export const GitHubDeviceCode: React.FC<GitHubDeviceCodeProps> = ({
    authorization,
}) => {
    const { t } = useTranslation('githubAuth');
    const [now, setNow] = useState(() => Date.now());
    const [openFailed, setOpenFailed] = useState(false);

    useEffect(() => {
        if (!authorization) return;
        setNow(Date.now());
        setOpenFailed(false);
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [authorization]);

    if (!authorization) {
        return (
            <div className="flex items-center gap-3" role="status">
                <span className="loading loading-spinner loading-sm" />
                <span>{t('requestingCode')}</span>
            </div>
        );
    }

    const remainingMs = Date.parse(authorization.expiresAt) - now;

    return (
        <div className="flex flex-col gap-[12px]">
            <p>{t('enterCode')}</p>
            <div className="flex items-center gap-2">
                <output
                    className="select-all font-mono text-3xl font-semibold tracking-[0.2em]"
                    aria-label={t('userCodeLabel')}
                    data-testid="github-device-user-code"
                >
                    {authorization.userCode}
                </output>
                <CopyButton value={authorization.userCode} />
            </div>
            <div>
                <button
                    type="button"
                    data-external-link=""
                    className="btn btn-primary text-base"
                    onClick={() => {
                        setOpenFailed(false);
                        void appBridge
                            .openExternal(authorization.verificationUri)
                            .catch(() => setOpenFailed(true));
                    }}
                >
                    {t('openGitHub')}
                    <ExternalLink
                        className="size-3.5 shrink-0 opacity-45"
                        aria-hidden="true"
                    />
                </button>
            </div>
            {openFailed && (
                <p className="text-error" role="alert">
                    {t('openFailed', { url: authorization.verificationUri })}
                </p>
            )}
            <div className="flex items-center gap-3" role="status">
                {remainingMs > 0 && (
                    <span className="loading loading-spinner loading-sm" />
                )}
                <span>
                    {remainingMs > 0
                        ? t('waiting', {
                              time: formatDeviceCodeRemaining(remainingMs),
                          })
                        : t('codeExpired')}
                </span>
            </div>
        </div>
    );
};
