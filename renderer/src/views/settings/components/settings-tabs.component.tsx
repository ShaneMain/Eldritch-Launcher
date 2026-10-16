import {
    Code,
    Download,
    Folder,
    FolderArchive,
    GitFork,
    Palette,
    Plug,
    SlidersHorizontal,
    Wrench,
} from 'lucide-react';
import type React from 'react';
import { type SettingsTab, settingsTabs } from '../../../app.routes';
import { VerticalTabMenu } from '../../../components/ui/vertical-tab-menu.component';

type Translate = (key: string) => string;

const settingsTabTestIds: Record<SettingsTab, string> = {
    projects: 'tabProjects',
    installs: 'tabInstalls',
    engineSources: 'tabEngineSources',
    exportTemplates: 'tabExportTemplates',
    appearance: 'tabAppearance',
    behavior: 'tabBehavior',
    codeEditors: 'tabCodeEditors',
    tools: 'tabTools',
    connections: 'tabConnections',
};

const settingsTabIcons = {
    projects: Folder,
    installs: Download,
    engineSources: GitFork,
    exportTemplates: FolderArchive,
    appearance: Palette,
    behavior: SlidersHorizontal,
    codeEditors: Code,
    tools: Wrench,
    connections: Plug,
};

type SettingsTabsProps = {
    activeTab: SettingsTab;
    t: Translate;
    onActiveTabChange: (tab: SettingsTab) => void;
};

/**
 * Renders the vertical settings menu with keyboard navigation.
 * @param props - Active section, translated labels and navigation callback.
 */
export const SettingsTabs: React.FC<SettingsTabsProps> = ({
    activeTab,
    t,
    onActiveTabChange,
}) => (
    <VerticalTabMenu
        ariaLabel={t('title')}
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
        items={settingsTabs.map((tab) => ({
            value: tab,
            // The Engine sources label lives in its own namespace.
            label:
                tab === 'engineSources'
                    ? t('engineSources:title')
                    : t(`tabs.${tab}`),
            icon: settingsTabIcons[tab],
            id: `settings-tab-${tab}`,
            panelId: 'settings-panel',
            testId: settingsTabTestIds[tab],
        }))}
    />
);
