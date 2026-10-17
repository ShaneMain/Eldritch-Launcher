import { describe, expect, it } from 'vitest';
import {
    appRoutePaths,
    installSourceParam,
    isConnectionsPathname,
    isSettingsTab,
    settingsTabs,
} from './app.routes';

describe('settings routes', () => {
    it('registers Export Templates after Installs', () => {
        expect(settingsTabs).toEqual([
            'projects',
            'installs',
            'engineSources',
            'exportTemplates',
            'appearance',
            'behavior',
            'codeEditors',
            'tools',
            'connections',
        ]);
        expect(isSettingsTab('connections')).toBe(true);
    });

    it('activates the Connections shortcut only for its canonical route', () => {
        expect(
            isConnectionsPathname(appRoutePaths.settingsTab('connections')),
        ).toBe(true);
        expect(
            isConnectionsPathname(appRoutePaths.settingsTab('projects')),
        ).toBe(false);
        expect(isConnectionsPathname('/settings/connections/extra')).toBe(
            false,
        );
    });
});

describe('install routes', () => {
    it('opens the install drawer on one fork source', () => {
        const url = new URL(
            appRoutePaths.installForkBuilds('fork:redot-engine/redot-engine'),
            'app://launcher',
        );

        expect(url.pathname).toBe(appRoutePaths.installEditor);
        expect(url.searchParams.get(installSourceParam)).toBe(
            'fork:redot-engine/redot-engine',
        );
    });
});
