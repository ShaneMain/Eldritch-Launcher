import type { ReleaseSummary } from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InstallEditorFork } from './install-editor-fork.component.tsx';

vi.mock('../../../hooks/release.hook.tsx', () => ({
    useRelease: () => ({
        cancelInstall: vi.fn(),
        getInstalledRelease: vi.fn(() => undefined),
        getReleaseInstallProgress: vi.fn(() => undefined),
    }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const revision = 'b90e2049e'.padEnd(40, '0');
const forkRelease: ReleaseSummary = {
    tag: 'native-import-thread-safety-b90e204',
    version: '4.7.2.stable.mono.custom_build.b90e2049e',
    version_number: 4.7,
    name: 'Native import thread safety',
    published_at: '2026-10-01T00:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
        {
            name: 'godot-linux-x64-dotnet.zip',
            download_url: 'https://example.com/linux.zip',
            platform_tags: ['linux', 'x64'],
            mono: true,
        },
    ],
    fork: {
        sourceId: 'fork:eldritch/engine',
        source: 'Eldritch/Engine',
        revision,
    },
};

/**
 * Renders the fork list with stable test props.
 *
 * @param overrides - Props to replace.
 * @returns Static markup.
 */
function renderFork(
    overrides: Partial<React.ComponentProps<typeof InstallEditorFork>> = {},
): string {
    return renderToStaticMarkup(
        <InstallEditorFork
            sourceId="fork:eldritch/engine"
            releases={[forkRelease]}
            host={{ platform: 'linux', arch: 'x64' }}
            authRequired={false}
            search=""
            searchPlaceholder="Search"
            t={(key) => key}
            onSearchChange={vi.fn()}
            onInstall={vi.fn(async () => undefined)}
            onReinstall={vi.fn(async () => undefined)}
            {...overrides}
        />,
    );
}

describe('InstallEditorFork', () => {
    it('shows the build name, tag, version, and short revision', () => {
        const html = renderFork();

        expect(html).toContain('Native import thread safety');
        expect(html).toContain('native-import-thread-safety-b90e204');
        expect(html).toContain('4.7.2.stable.mono.custom_build.b90e2049e');
        expect(html).toContain('>b90e204<');
        expect(html).toContain(
            'btnDownload4.7.2.stable.mono.custom_build.b90e2049e-mono',
        );
        expect(html).not.toContain('drawer.noPlatformBuild');
    });

    it('replaces install actions when the host platform has no build', () => {
        const html = renderFork({ host: { platform: 'win32', arch: 'x64' } });

        expect(html).toContain('drawer.noPlatformBuild');
        expect(html).not.toContain('btnDownload');
    });

    it('asks the user to sign in for sources that require auth', () => {
        const html = renderFork({ authRequired: true, releases: [] });

        expect(html).toContain('drawer.authRequired');
        expect(html).not.toContain('drawer.empty');
    });
});
