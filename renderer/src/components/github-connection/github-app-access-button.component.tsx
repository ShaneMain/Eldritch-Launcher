import { ExternalLink } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { appBridge } from '../../renderer.bridge.ts';

/**
 * Runs a callback once, the next time the target gains focus.
 *
 * @param target - Window or other focus event target.
 * @param callback - Runs on the next focus event.
 * @returns Removes the listener when the callback has not run yet.
 */
export function onNextFocus(
    target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    callback: () => void,
): () => void {
    const handle = (): void => {
        target.removeEventListener('focus', handle);
        callback();
    };
    target.addEventListener('focus', handle);
    return () => target.removeEventListener('focus', handle);
}

type GitHubAppAccessButtonProps = {
    /** GitHub App installation page that grants the app a repository. */
    installUrl: string;
    label: string;
    className?: string;
    'data-testid'?: string;
    /** Re-checks access once the user returns to the launcher window. */
    onReturn: () => void | Promise<void>;
};

/**
 * Opens the GitHub App installation page in the browser, where the user
 * grants the app access to a repository, then re-checks access when the
 * launcher window regains focus.
 *
 * @param props - Installation page, label and the re-check to run.
 * @returns The button.
 */
export const GitHubAppAccessButton: React.FC<GitHubAppAccessButtonProps> = ({
    installUrl,
    label,
    className = 'btn btn-sm btn-primary',
    'data-testid': testId,
    onReturn,
}) => {
    const disarm = useRef<(() => void) | null>(null);
    useEffect(() => () => disarm.current?.(), []);

    /** Opens the installation page and arms the re-check on return. */
    const open = (): void => {
        disarm.current?.();
        disarm.current = onNextFocus(window, () => {
            disarm.current = null;
            void onReturn();
        });
        void appBridge.openExternal(installUrl);
    };

    return (
        <button
            type="button"
            className={className}
            data-testid={testId}
            onClick={open}
        >
            <ExternalLink size={12} aria-hidden="true" />
            {label}
        </button>
    );
};
