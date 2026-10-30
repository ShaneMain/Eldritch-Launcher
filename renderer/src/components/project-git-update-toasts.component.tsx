import clsx from 'clsx';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    dismissProjectGitUpdateToast,
    useProjectGitUpdateToasts,
} from '../hooks/project-git-update.hook';

/** Shows project Git update results as dismissible toasts. */
export function ProjectGitUpdateToasts() {
    const { t } = useTranslation('projectStatus');
    const toasts = useProjectGitUpdateToasts();
    if (toasts.length === 0) return null;
    return (
        <div className="toast toast-end toast-bottom z-50" aria-live="polite">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    role={toast.tone === 'error' ? 'alert' : 'status'}
                    data-testid="projectGitUpdateToast"
                    className={clsx(
                        'alert alert-soft flex max-w-96 items-start',
                        toast.tone === 'success' && 'alert-success',
                        toast.tone === 'warning' && 'alert-warning',
                        toast.tone === 'error' && 'alert-error',
                    )}
                >
                    <div className="flex flex-1 flex-col gap-1">
                        {toast.lines.map((line) => (
                            <span key={line} className="break-words">
                                {line}
                            </span>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square"
                        aria-label={t('update.dismiss')}
                        onClick={() => dismissProjectGitUpdateToast(toast.id)}
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            ))}
        </div>
    );
}
