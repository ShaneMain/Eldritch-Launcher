import { KeyRound } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useRelease } from '../../hooks/release.hook';
import { GitHubConnectionDialog } from './github-connection-dialog.component';

type GitHubSignInButtonProps = {
    label: string;
    className?: string;
    'data-testid'?: string;
    /** Continues the interrupted task once GitHub access is restored. */
    onSignedIn?: () => void | Promise<void>;
};

/**
 * Signs in to GitHub without leaving the current view, then reloads the
 * editor catalog, which retries fork sources blocked by GitHub access, so
 * their builds appear where the user already is.
 *
 * @param props - Button label and the task to resume after signing in.
 * @returns The sign-in button and, while open, the GitHub connection dialog.
 */
export const GitHubSignInButton: React.FC<GitHubSignInButtonProps> = ({
    label,
    className = 'btn btn-sm btn-primary',
    'data-testid': testId,
    onSignedIn,
}) => {
    const [open, setOpen] = useState(false);
    const { reloadReleases } = useRelease();

    /** Closes the dialog, unblocks fork sources, and resumes the task. */
    const handleConnected = async (): Promise<void> => {
        setOpen(false);
        try {
            await reloadReleases();
        } finally {
            await onSignedIn?.();
        }
    };

    return (
        <>
            <button
                type="button"
                className={className}
                data-testid={testId}
                onClick={() => setOpen(true)}
            >
                <KeyRound size={14} aria-hidden="true" />
                {label}
            </button>
            {open && (
                <GitHubConnectionDialog
                    autoStart
                    onConnected={() => void handleConnected()}
                    onCancel={() => setOpen(false)}
                />
            )}
        </>
    );
};
