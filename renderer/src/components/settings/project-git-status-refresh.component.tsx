import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../../hooks/preferences.hook';
import { projectGitStatusBridge } from '../../renderer.bridge';
import { SettingsSection } from './settings-section.component';

const DEFAULT_REFRESH_MINUTES = 10;
const REFRESH_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60];

/** Selects how often project Git status badges fetch their upstream. */
export const ProjectGitStatusRefreshSetting: React.FC = () => {
    const { t } = useTranslation('projectStatus');
    const { preferences, loadPreferences } = usePreferences();
    const current =
        preferences?.project_git_status_refresh_minutes ??
        DEFAULT_REFRESH_MINUTES;
    const options = REFRESH_MINUTE_OPTIONS.includes(current)
        ? REFRESH_MINUTE_OPTIONS
        : [...REFRESH_MINUTE_OPTIONS, current].sort((a, b) => a - b);

    const saveInterval = async (event: ChangeEvent<HTMLSelectElement>) => {
        await projectGitStatusBridge.setRefreshInterval(
            Number.parseInt(event.target.value, 10),
        );
        await loadPreferences();
    };

    return (
        <SettingsSection
            title={t('settings.refreshInterval.title')}
            description={t('settings.refreshInterval.description')}
        >
            <select
                data-testid="selectGitStatusRefreshInterval"
                className="select select-sm w-fit"
                aria-label={t('settings.refreshInterval.title')}
                value={current}
                disabled={!preferences}
                onChange={saveInterval}
            >
                {options.map((minutes) => (
                    <option key={minutes} value={minutes}>
                        {minutes === 0
                            ? t('settings.refreshInterval.off')
                            : t('settings.refreshInterval.minutes', {
                                  minutes,
                              })}
                    </option>
                ))}
            </select>
        </SettingsSection>
    );
};
