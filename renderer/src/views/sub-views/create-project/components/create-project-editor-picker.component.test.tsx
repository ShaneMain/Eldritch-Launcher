import type { InstalledRelease, ReleaseSummary } from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ForkEngineChannel } from '../../../../hooks/fork-engine-channels.model';
import {
    getCreateProjectCatalogueVariants,
    getCreateProjectForkVariants,
    getCreateProjectReleaseKey,
} from '../create-project.model';
import { CreateProjectEditorPicker } from './create-project-editor-picker.component';
import { CreateProjectEditorPickerPopover } from './create-project-editor-picker-popover.component';

const forkChannels = vi.hoisted(() => ({ value: [] as ForkEngineChannel[] }));

vi.mock('../../../../hooks/fork-engine-channels.hook', () => ({
    useForkEngineChannels: () => ({
        channels: forkChannels.value,
        host: { platform: 'linux', arch: 'x64' },
    }),
}));

vi.mock('../../../../renderer.bridge', () => ({
    appBridge: { openExternal: vi.fn() },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, string | number>) =>
            ({
                'editorPicker.title': 'Godot editor',
                'editorPicker.installed': 'Installed',
                'editorPicker.browse': 'Browse releases',
                'editorPicker.search': 'Search versions',
                'editorPicker.clearSearch': 'Clear search',
                'editorPicker.channel': 'Release channel',
                'editorPicker.stable': 'Stable',
                'editorPicker.prereleases': 'Pre-releases',
                'editorPicker.downloadRequired': 'Download required',
                'editorPicker.standard': 'Standard',
                'editorPicker.custom': 'Custom',
                'editorPicker.selected': 'Selected',
                'editorPicker.unavailable': 'Unavailable',
                'editorPicker.noInstalled': 'No installed editors',
                'editorPicker.noneSelected': 'Choose an editor',
                'editorPicker.loading': 'Loading releases...',
                'editorPicker.noMatches': 'No matching releases',
                'editorPicker.loadFailed': "Couldn't load releases. Try again.",
                'editorPicker.refreshFailed':
                    "Couldn't refresh releases. Showing previously loaded releases.",
                'editorPicker.retry': 'Retry',
                'editorPicker.retrying': 'Retrying...',
                'project.dotNetBadge': '.NET',
                'project.prereleaseBadge': 'Pre-release',
                'progress.queuedPosition': `Queued #${options?.position}`,
                'progress.cancelLabel': 'Cancel editor install',
            })[key] ?? key,
    }),
}));

describe('CreateProjectEditorPicker', () => {
    it('accepts a contextual trigger identity and disabled state', () => {
        const html = renderToStaticMarkup(
            <CreateProjectEditorPicker
                open
                disabled
                triggerLabel="Godot Editor"
                installedReleases={[]}
                availableReleases={[]}
                availablePrereleases={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError={undefined}
                selection={null}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
            />,
        );

        expect(html).toContain('disabled=""');
        expect(html).toContain('aria-label="Godot Editor: Choose an editor"');
    });

    it('defaults to installed editors and retains custom editor labels', () => {
        const release = installedRelease('studio-godot', {
            name: 'Studio Godot',
            source: 'custom',
        });

        const html = renderToStaticMarkup(
            <CreateProjectEditorPicker
                open
                installedReleases={[release]}
                availableReleases={[]}
                availablePrereleases={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError={undefined}
                selection={{
                    source: 'installed',
                    key: getCreateProjectReleaseKey(release),
                    release,
                }}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
            />,
        );

        expect(html).toContain('popover="auto"');
        expect(html).toContain('aria-haspopup="dialog"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toMatch(
            /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Installed<\/button>/,
        );
        expect(html).toContain('Studio Godot');
        expect(html).toContain('Custom');
        expect(html).not.toContain('inputCreateProjectEditorSearch');
        expect(html).not.toContain('<fieldset');
    });

    it('does not repeat a version when an editor has no display name', () => {
        const release = installedRelease('4.7.2');

        const html = renderToStaticMarkup(
            <CreateProjectEditorPicker
                open
                installedReleases={[release]}
                availableReleases={[]}
                availablePrereleases={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError={undefined}
                selection={{
                    source: 'installed',
                    key: getCreateProjectReleaseKey(release),
                    release,
                }}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
            />,
        );

        expect(html).toContain('4.7.2 - Standard');
        expect(html).not.toContain('4.7.2 (4.7.2)');
    });

    it('defaults to Browse releases and renders every exact variant', () => {
        const releases = Array.from({ length: 7 }, (_, index) =>
            catalogueRelease(`4.${index + 1}-stable`),
        );

        const html = renderToStaticMarkup(
            <CreateProjectEditorPicker
                open
                installedReleases={[]}
                availableReleases={releases}
                availablePrereleases={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError={undefined}
                selection={null}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
            />,
        );

        expect(html).toMatch(
            /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Browse releases<\/button>/,
        );
        expect(html).toContain('placeholder="Search versions"');
        expect(html).toContain('>Stable<');
        expect(html).toContain('>Pre-releases<');
        expect(html.match(/Download required/g)).toHaveLength(14);
        expect(html).toContain('>Standard<');
        expect(html).toContain('>.NET<');
    });

    it.each(['stable', 'prerelease'] as const)(
        'labels major.minor groups in the %s list without changing exact variants',
        (channel) => {
            const suffix = channel === 'stable' ? 'stable' : 'beta1';
            const releases = ['4.9.1', '4.10.2', '4.10'].map((version) => ({
                ...catalogueRelease(`${version}-${suffix}`),
                prerelease: channel === 'prerelease',
            }));
            const html = renderToStaticMarkup(
                <CreateProjectEditorPickerPopover
                    id="picker"
                    labelledBy="editor"
                    popoverRef={{ current: null }}
                    style={{}}
                    open
                    tab="catalogue"
                    channel={channel}
                    forkChannels={[]}
                    forkChannel={undefined}
                    hostKnown
                    search=""
                    installedRows={[]}
                    installedReleases={[]}
                    catalogueVariants={getCreateProjectCatalogueVariants(
                        releases,
                        '',
                    )}
                    releaseInstallProgress={[]}
                    loading={false}
                    catalogueError={undefined}
                    hasCachedCatalogueReleases
                    retryingCatalogue={false}
                    selection={null}
                    onTabChange={vi.fn()}
                    onChannelChange={vi.fn()}
                    onForkChannelChange={vi.fn()}
                    onSearchChange={vi.fn()}
                    onSelectionChange={vi.fn()}
                    onCancelInstall={vi.fn()}
                    onRetryCatalogue={vi.fn()}
                    onKeyDown={vi.fn()}
                    registerInstalledOption={vi.fn()}
                />,
            );
            expect(html.match(/<fieldset/g)).toHaveLength(2);
            expect(html).toContain('<fieldset aria-label="4.10"');
            expect(html).toContain('<fieldset aria-label="4.9"');
            expect(html.match(/role="option"/g)).toHaveLength(6);
            expect(html).toContain(
                `createProjectCatalogueEditor_catalogue:4.10.2-${suffix}:std`,
            );
            expect(html).toContain(
                `createProjectCatalogueEditor_catalogue:4.10.2-${suffix}:mono`,
            );
        },
    );

    it('shows a retry action instead of no matches when the catalogue failed without cached releases', () => {
        const html = renderToStaticMarkup(
            <CreateProjectEditorPickerPopover
                id="picker"
                labelledBy="editor"
                popoverRef={{ current: null }}
                style={{}}
                open
                tab="catalogue"
                channel="stable"
                forkChannels={[]}
                forkChannel={undefined}
                hostKnown
                search=""
                installedRows={[]}
                installedReleases={[]}
                catalogueVariants={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError="Network unavailable"
                hasCachedCatalogueReleases={false}
                retryingCatalogue={false}
                selection={null}
                onTabChange={vi.fn()}
                onChannelChange={vi.fn()}
                onForkChannelChange={vi.fn()}
                onSearchChange={vi.fn()}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
                onKeyDown={vi.fn()}
                registerInstalledOption={vi.fn()}
            />,
        );

        expect(html).toContain('Couldn&#x27;t load releases. Try again.');
        expect(html).toContain('>Retry<');
        expect(html).not.toContain('No matching releases');
    });

    it('keeps cached releases visible when a catalogue refresh fails', () => {
        const release = catalogueRelease('4.8-stable');
        const html = renderToStaticMarkup(
            <CreateProjectEditorPickerPopover
                id="picker"
                labelledBy="editor"
                popoverRef={{ current: null }}
                style={{}}
                open
                tab="catalogue"
                channel="stable"
                forkChannels={[]}
                forkChannel={undefined}
                hostKnown
                search=""
                installedRows={[]}
                installedReleases={[]}
                catalogueVariants={getCreateProjectCatalogueVariants(
                    [release],
                    '',
                )}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError="Network unavailable"
                hasCachedCatalogueReleases
                retryingCatalogue={false}
                selection={null}
                onTabChange={vi.fn()}
                onChannelChange={vi.fn()}
                onForkChannelChange={vi.fn()}
                onSearchChange={vi.fn()}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
                onKeyDown={vi.fn()}
                registerInstalledOption={vi.fn()}
            />,
        );

        expect(html).toContain(
            'Couldn&#x27;t refresh releases. Showing previously loaded releases.',
        );
        expect(html).toContain(
            `createProjectCatalogueEditor_catalogue:${release.version}:std`,
        );
    });

    it('disables catalogue retry while a retry is in progress', () => {
        const html = renderToStaticMarkup(
            <CreateProjectEditorPickerPopover
                id="picker"
                labelledBy="editor"
                popoverRef={{ current: null }}
                style={{}}
                open
                tab="catalogue"
                channel="stable"
                forkChannels={[]}
                forkChannel={undefined}
                hostKnown
                search=""
                installedRows={[]}
                installedReleases={[]}
                catalogueVariants={[]}
                releaseInstallProgress={[]}
                loading={false}
                catalogueError="Network unavailable"
                hasCachedCatalogueReleases={false}
                retryingCatalogue
                selection={null}
                onTabChange={vi.fn()}
                onChannelChange={vi.fn()}
                onForkChannelChange={vi.fn()}
                onSearchChange={vi.fn()}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
                onKeyDown={vi.fn()}
                registerInstalledOption={vi.fn()}
            />,
        );

        expect(html).toMatch(
            /<button[^>]*disabled=""[^>]*>Retrying...<\/button>/,
        );
        expect(html).toContain('>Retrying...<');
    });

    it('shows queue progress and the existing cancellation action', () => {
        const release = catalogueRelease('4.8-stable');
        const html = renderToStaticMarkup(
            <CreateProjectEditorPicker
                open
                installedReleases={[]}
                availableReleases={[release]}
                availablePrereleases={[]}
                releaseInstallProgress={[
                    {
                        id: 'install-job',
                        version: release.version,
                        mono: false,
                        prerelease: false,
                        published_at: release.published_at,
                        stage: 'queued',
                        canCancel: true,
                        queuePosition: 2,
                    },
                ]}
                loading={false}
                catalogueError={undefined}
                selection={{
                    source: 'catalogue',
                    key: `catalogue:${release.version}:std`,
                    release,
                    mono: false,
                }}
                onSelectionChange={vi.fn()}
                onCancelInstall={vi.fn()}
                onRetryCatalogue={vi.fn()}
            />,
        );

        expect(html).toContain('Queued #2');
        expect(html).toContain('aria-label="Cancel editor install"');
    });
});

/**
 * Creates an installed editor for picker rendering tests.
 *
 * @param version - Installed editor version.
 * @param overrides - Optional installed editor fields.
 * @returns A valid installed editor.
 */
function installedRelease(
    version: string,
    overrides: Partial<InstalledRelease> = {},
): InstalledRelease {
    return {
        version,
        version_number: Number.parseFloat(version),
        install_path: `/Godot/${version}`,
        editor_path: `/Godot/${version}/Godot`,
        platform: 'linux',
        arch: 'x64',
        mono: false,
        prerelease: false,
        config_version: 5,
        published_at: null,
        valid: true,
        ...overrides,
    };
}

/**
 * Creates a catalogue release with Standard and .NET assets.
 *
 * @param version - Catalogue editor version.
 * @returns A release with both exact variants.
 */
function catalogueRelease(version: string): ReleaseSummary {
    return {
        version,
        version_number: Number.parseFloat(version),
        name: `Godot ${version}`,
        published_at: '2026-01-01T00:00:00.000Z',
        draft: false,
        prerelease: false,
        tag: version,
        assets: [
            {
                name: 'standard.zip',
                download_url: 'https://example.com/standard.zip',
                platform_tags: ['linux', 'x64'],
                mono: false,
            },
            {
                name: 'dotnet.zip',
                download_url: 'https://example.com/dotnet.zip',
                platform_tags: ['linux', 'x64'],
                mono: true,
            },
        ],
    };
}

describe('CreateProjectEditorPicker fork channels', () => {
    it('offers every fork source as a Browse releases channel', () => {
        forkChannels.value = [forkChannel()];
        try {
            const html = renderToStaticMarkup(
                <CreateProjectEditorPicker
                    open
                    installedReleases={[]}
                    availableReleases={[]}
                    availablePrereleases={[]}
                    releaseInstallProgress={[]}
                    loading={false}
                    catalogueError={undefined}
                    selection={null}
                    onSelectionChange={vi.fn()}
                    onCancelInstall={vi.fn()}
                    onRetryCatalogue={vi.fn()}
                />,
            );

            expect(html).toContain(
                'tabCreateProjectForkEditors_fork:redot-engine/redot-engine',
            );
            expect(html).toContain('>Redot<');
        } finally {
            forkChannels.value = [];
        }
    });

    it('lists selectable host builds of the selected fork source', () => {
        const channel = forkChannel();
        const html = renderPopover({
            forkChannels: [channel],
            forkChannel: channel,
            catalogueVariants: getCreateProjectForkVariants(
                channel.releases,
                { platform: 'linux', arch: 'x64' },
                0,
                '',
            ),
        });

        expect(html).toMatch(
            /aria-selected="true"[^>]*tabCreateProjectForkEditors_fork:redot-engine\/redot-engine|tabCreateProjectForkEditors_fork:redot-engine\/redot-engine"[^>]*aria-selected="true"/,
        );
        expect(html).toContain(
            'createProjectCatalogueEditor_catalogue:26.3.stable.85e520394:std',
        );
        expect(html).toContain(
            'createProjectCatalogueEditor_catalogue:26.3.stable.85e520394:mono',
        );
        expect(html).not.toContain('createProjectForkEditorsEmpty');
    });

    it('explains a private fork source instead of an empty list', () => {
        const channel = forkChannel({
            access: {
                kind: 'no-access',
                installUrl:
                    'https://github.com/apps/eldritch-launcher/installations/new',
            },
            releases: [],
        });
        const html = renderPopover({
            forkChannels: [channel],
            forkChannel: channel,
        });

        expect(html).toContain('forkSourceAccess_no-access');
        expect(html).toContain('btnForkSourceInstallApp');
        expect(html).not.toContain('createProjectEditorCatalogueList');
    });

    it('explains a fork source with no builds, or none for this computer', () => {
        const empty = forkChannel({ releases: [] });
        const emptyHtml = renderPopover({
            forkChannels: [empty],
            forkChannel: empty,
        });
        const otherPlatform = forkChannel();
        const otherPlatformHtml = renderPopover({
            forkChannels: [otherPlatform],
            forkChannel: otherPlatform,
            catalogueVariants: getCreateProjectForkVariants(
                otherPlatform.releases,
                { platform: 'darwin', arch: 'arm64' },
                0,
                '',
            ),
        });

        expect(emptyHtml).toContain('engineSources:drawer.empty');
        expect(emptyHtml).toContain('engineSources:drawer.emptyHint');
        expect(otherPlatformHtml).toContain(
            'engineSources:drawer.noHostBuilds',
        );
    });

    it('hides the official catalogue error on a fork channel', () => {
        const channel = forkChannel();
        const html = renderPopover({
            forkChannels: [channel],
            forkChannel: channel,
            catalogueError: 'Network unavailable',
        });

        expect(html).not.toContain('createProjectEditorCatalogueError');
    });
});

describe('getCreateProjectForkVariants', () => {
    it('offers only host builds at or above the minimum major version', () => {
        const current = forkRelease('26.3.stable.85e520394', 26.3);
        const old = forkRelease('3.6.stable.0123456789', 3.6);
        const variants = getCreateProjectForkVariants(
            [current, old],
            { platform: 'linux', arch: 'x64' },
            4,
            '',
        );

        expect(variants.map((variant) => variant.key)).toEqual([
            'catalogue:26.3.stable.85e520394:std',
            'catalogue:26.3.stable.85e520394:mono',
        ]);
        expect(
            variants.every((variant) =>
                variant.release.assets.every(
                    (asset) =>
                        asset.platform_tags[0] === 'linux' &&
                        asset.platform_tags[1] === 'x64',
                ),
            ),
        ).toBe(true);
        expect(variants[0].release.fork?.source).toBe(
            'Redot-Engine/redot-engine',
        );
    });

    it('offers nothing when the source has no build for the host', () => {
        expect(
            getCreateProjectForkVariants(
                [forkRelease('26.3.stable.85e520394', 26.3)],
                { platform: 'darwin', arch: 'arm64' },
                0,
                '',
            ),
        ).toEqual([]);
    });
});

/**
 * Renders the picker popover on the Browse releases tab.
 *
 * @param overrides - Props to replace.
 * @returns Static popover markup.
 */
function renderPopover(
    overrides: Partial<
        React.ComponentProps<typeof CreateProjectEditorPickerPopover>
    > = {},
): string {
    return renderToStaticMarkup(
        <CreateProjectEditorPickerPopover
            id="picker"
            labelledBy="editor"
            popoverRef={{ current: null }}
            style={{}}
            open
            tab="catalogue"
            channel="stable"
            forkChannels={[]}
            forkChannel={undefined}
            hostKnown
            search=""
            installedRows={[]}
            installedReleases={[]}
            catalogueVariants={[]}
            releaseInstallProgress={[]}
            loading={false}
            catalogueError={undefined}
            hasCachedCatalogueReleases
            retryingCatalogue={false}
            selection={null}
            onTabChange={vi.fn()}
            onChannelChange={vi.fn()}
            onForkChannelChange={vi.fn()}
            onSearchChange={vi.fn()}
            onSelectionChange={vi.fn()}
            onCancelInstall={vi.fn()}
            onRetryCatalogue={vi.fn()}
            onKeyDown={vi.fn()}
            registerInstalledOption={vi.fn()}
            {...overrides}
        />,
    );
}

/**
 * Creates a Redot-style fork channel with one Linux and Windows build.
 *
 * @param overrides - Channel fields to replace.
 * @returns A fork channel.
 */
function forkChannel(
    overrides: Partial<ForkEngineChannel> = {},
): ForkEngineChannel {
    return {
        id: 'fork:redot-engine/redot-engine',
        label: 'Redot',
        source: 'Redot-Engine/redot-engine',
        access: { kind: 'ok' },
        releases: [forkRelease('26.3.stable.85e520394', 26.3)],
        ...overrides,
    };
}

/**
 * Creates a fork build with Standard and .NET assets for Linux and Windows.
 *
 * @param version - Fork build version.
 * @param versionNumber - Godot major.minor of the build.
 * @returns A fork release.
 */
function forkRelease(version: string, versionNumber: number): ReleaseSummary {
    return {
        version,
        version_number: versionNumber,
        name: `Redot ${version}`,
        published_at: '2026-10-15T18:44:57.000Z',
        draft: false,
        prerelease: false,
        tag: `redot-${version}`,
        assets: (['linux', 'win32'] as const).flatMap((platform) =>
            [false, true].map((mono) => ({
                name: `${platform}-${mono ? 'mono' : 'std'}.zip`,
                download_url: `https://api.github.com/repos/Redot-Engine/redot-engine/releases/assets/${platform}${mono}`,
                platform_tags: [platform, 'x64'],
                mono,
            })),
        ),
        fork: {
            sourceId: 'fork:redot-engine/redot-engine',
            source: 'Redot-Engine/redot-engine',
            revision: '85e5203945af15755dd2f66cb6fdf7545fd88c0b',
        },
    };
}
