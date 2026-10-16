import type {
    ProjectDetails,
    ProjectEngineStatus,
    ReleaseSummary,
} from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type EngineSourcesHook,
    useEngineSources,
} from '../../../hooks/engine-sources.hook';
import {
    EngineStatusBadge,
    EngineStatusBadgeContent,
} from './engine-status-badge.component';

const getProjectEngineStatus =
    vi.fn<
        (
            projectPath: string,
            options?: { force?: boolean },
        ) => Promise<ProjectEngineStatus>
    >();

vi.mock('../../../renderer.bridge.ts', () => ({
    engineSourcesBridge: {
        getProjectEngineStatus: (
            projectPath: string,
            options?: { force?: boolean },
        ) => getProjectEngineStatus(projectPath, options),
    },
}));

vi.mock('../../../hooks/release.hook', () => ({
    useRelease: () => ({ forkReleases: [], installRelease: vi.fn() }),
}));

vi.mock('../../../hooks/projects.hook', () => ({
    useProjects: () => ({ setProjectEditor: vi.fn() }),
}));

vi.mock('../../../hooks/alerts.hook', () => ({
    useAlerts: () => ({ addAlert: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

/**
 * Renders translation keys with their interpolation values.
 *
 * @param key - Translation key.
 * @param options - Interpolation values.
 * @returns The key followed by its values.
 */
function translate(key: string, options?: Record<string, unknown>): string {
    return options
        ? `${key}(${Object.entries(options)
              .map(([name, value]) => `${name}=${String(value)}`)
              .join(',')})`
        : key;
}

const revision = 'b90e2049e'.padEnd(40, '0');
const newerRevision = 'c0ffee123'.padEnd(40, '0');

/**
 * Creates a project fixture, optionally pinned to a fork build.
 *
 * @param fork - Whether the project uses a fork build.
 * @returns A project fixture.
 */
function createProject(fork: boolean): ProjectDetails {
    return {
        name: 'Kraken',
        version: '4.7',
        version_number: 4.7,
        renderer: 'FORWARD_PLUS',
        path: '/projects/kraken',
        editor_settings_path: '',
        editor_settings_file: '',
        last_opened: null,
        release: {
            version: '4.7.2.stable.mono.custom_build.b90e2049e',
            version_number: 4.7,
            install_path: '',
            editor_path: '',
            platform: 'linux',
            arch: 'x64',
            mono: true,
            prerelease: false,
            config_version: 5,
            published_at: null,
            valid: true,
            ...(fork
                ? {
                      fork: {
                          sourceId: 'fork:eldritch/engine',
                          source: 'Eldritch/Engine',
                          revision,
                      },
                  }
                : {}),
        },
        launch_path: '',
        config_version: 5,
        codeEditorId: null,
        withGit: false,
        valid: true,
    };
}

/**
 * Loads one status through the mocked bridge and renders it.
 *
 * @param status - Status returned by the mocked bridge.
 * @param newerRelease - Catalog build matching the newer build.
 * @returns Static markup.
 */
async function renderStatus(
    status: ProjectEngineStatus,
    newerRelease?: ReleaseSummary,
): Promise<string> {
    getProjectEngineStatus.mockResolvedValueOnce(status);
    let hook: EngineSourcesHook | undefined;
    const Capture = () => {
        hook = useEngineSources();
        return null;
    };
    renderToStaticMarkup(<Capture />);
    const loaded = await hook?.getProjectEngineStatus('/projects/kraken');

    return renderToStaticMarkup(
        <EngineStatusBadgeContent
            status={loaded ?? null}
            checking={false}
            updating={false}
            newerRelease={newerRelease}
            t={translate}
            onRefresh={vi.fn()}
            onInstallNewerBuild={vi.fn()}
        />,
    );
}

const okStatus: Extract<ProjectEngineStatus, { kind: 'ok' }> = {
    kind: 'ok',
    source: 'Eldritch/Engine',
    sourceId: 'fork:eldritch/engine',
    revision,
    branch: 'main',
    behindBy: 0,
    aheadBy: 0,
    compareStatus: 'identical',
    checkedAt: 1,
};

describe('EngineStatusBadge', () => {
    beforeEach(() => {
        getProjectEngineStatus.mockReset();
    });

    it('renders nothing and makes no request for non-fork projects', () => {
        const html = renderToStaticMarkup(
            <EngineStatusBadge project={createProject(false)} />,
        );

        expect(html).toBe('');
        expect(getProjectEngineStatus).not.toHaveBeenCalled();
    });

    it('renders a pending check for fork projects', () => {
        const html = renderToStaticMarkup(
            <EngineStatusBadge project={createProject(true)} />,
        );

        expect(html).toContain('engineStatusBadge');
    });

    it('renders how many commits the engine is behind', async () => {
        const html = await renderStatus({
            ...okStatus,
            behindBy: 12,
            aheadBy: 2,
            compareStatus: 'diverged',
        });

        expect(getProjectEngineStatus).toHaveBeenCalledWith(
            '/projects/kraken',
            undefined,
        );
        expect(html).toContain('badge.behind(count=12,branch=main)');
        expect(html).toContain('badge.ahead(count=2,branch=main)');
        expect(html).not.toContain('btnInstallEngineUpdate');
    });

    it('renders a subtle up-to-date state', async () => {
        const html = await renderStatus(okStatus);

        expect(html).toContain('badge.upToDate');
        expect(html).not.toContain('badge.behind');
        expect(html).not.toContain('badge.ahead');
    });

    it('offers to install a newer build found in the catalog', async () => {
        const newerRelease: ReleaseSummary = {
            version: '4.7.2.stable.mono.custom_build.c0ffee123',
            version_number: 4.7,
            name: 'Newer',
            published_at: null,
            draft: false,
            prerelease: false,
            assets: [],
            fork: {
                sourceId: 'fork:eldritch/engine',
                source: 'Eldritch/Engine',
                revision: newerRevision,
            },
        };
        const html = await renderStatus(
            {
                ...okStatus,
                behindBy: 3,
                newerBuild: {
                    releaseId: '42',
                    tag: 'native-import-c0ffee1',
                    version: newerRelease.version,
                    revision: newerRevision,
                    publishedAt: null,
                },
            },
            newerRelease,
        );

        expect(html).toContain('badge.newerBuild(tag=native-import-c0ffee1)');
        expect(html).toContain('badge.installUpdate');
        expect(html).toMatch(
            /<button[^>]*data-testid="btnInstallEngineUpdate"(?![^>]*disabled)/,
        );
    });

    it('renders an auth-required badge', async () => {
        const html = await renderStatus({
            kind: 'auth-required',
            source: 'Eldritch/Engine',
        });

        expect(html).toContain('badge.authRequired');
    });

    it('renders a muted warning for errors', async () => {
        const html = await renderStatus({
            kind: 'error',
            source: 'Eldritch/Engine',
            message: 'boom',
        });

        expect(html).toContain('badge.unavailable');
        expect(html).toContain('message=boom');
    });
});
