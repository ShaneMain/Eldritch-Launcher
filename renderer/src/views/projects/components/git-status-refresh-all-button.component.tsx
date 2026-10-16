import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../../components/ui/tooltip.component';
import { useRefreshAllProjectGitStatuses } from '../../../hooks/project-git-status.hook';

/** Fetches every project's upstream and recomputes its Git status badge. */
export function GitStatusRefreshAllButton() {
    const { t } = useTranslation('projectStatus');
    const { refreshingAll, refreshAll } = useRefreshAllProjectGitStatuses();
    return (
        <Tooltip placement="top" tone="default" tip={t('git.refreshAll')}>
            <button
                type="button"
                data-testid="btnRefreshGitStatuses"
                className="btn btn-ghost btn-square btn-sm"
                aria-label={t('git.refreshAll')}
                disabled={refreshingAll}
                onClick={() => void refreshAll()}
            >
                <RefreshCw
                    size={16}
                    aria-hidden="true"
                    className={clsx(refreshingAll && 'animate-spin')}
                />
            </button>
        </Tooltip>
    );
}
