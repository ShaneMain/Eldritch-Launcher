import type {
    AddEngineSourceFailure,
    EngineSourceSummary,
} from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
    EngineSourcesPanelView,
    findAddedSourceWithBuilds,
} from './engine-sources-settings-panel.component';

vi.mock('../../../hooks/release.hook', () => ({
    useRelease: () => ({ reloadReleases: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../renderer.bridge', () => ({
    appBridge: { openExternal: vi.fn() },
}));

const translate = (key: string) => key;
const installUrl =
    'https://github.com/apps/eldritch-launcher/installations/new';

const officialStable: EngineSourceSummary = {
    id: 'official-stable',
    kind: 'official',
    owner: 'godotengine',
    repo: 'godot',
    displayName: 'Godot',
    requiresAuth: false,
    builtIn: true,
    state: 'ok',
    lastFetchedAt: Date.now(),
    buildCount: 120,
};

const privateFork: EngineSourceSummary = {
    id: 'fork:eldritch-game-studio/eldritch-engine',
    kind: 'fork',
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: 'Eldritch Engine',
    requiresAuth: true,
    builtIn: false,
    state: 'auth-required',
    lastFetchedAt: null,
    buildCount: 0,
    githubAppInstallUrl: installUrl,
};

/**
 * Renders the Engine sources panel with stable test props.
 *
 * @param overrides - Props to replace for the rendered state.
 * @returns Static panel markup.
 */
function renderPanel(
    overrides: Partial<
        React.ComponentProps<typeof EngineSourcesPanelView>
    > = {},
): string {
    return renderToStaticMarkup(
        <EngineSourcesPanelView
            active
            t={translate}
            locale="en"
            sources={[officialStable, privateFork]}
            loading={false}
            loadError={false}
            pendingIds={[]}
            actionErrors={{}}
            adding={false}
            addError={null}
            onRetry={vi.fn()}
            onRefresh={vi.fn()}
            onRemove={vi.fn()}
            onInstallBuilds={vi.fn()}
            onSignedIn={vi.fn(async () => undefined)}
            onAdd={vi.fn(async () => true)}
            {...overrides}
        />,
    );
}

describe('EngineSourcesPanelView', () => {
    it('lists sources with built-in, auth, and state details', () => {
        const html = renderPanel();

        expect(html).toContain('Eldritch Engine');
        expect(html).toContain('Eldritch-Game-Studio/Eldritch-Engine');
        expect(html).toContain('settings.builtIn');
        expect(html).toContain('settings.requiresAuth');
        expect(html).toContain('settings.state.ok');
        expect(html).toContain('settings.state.authRequired');
        expect(html).toContain('settings.neverRefreshed');
        expect(html).toContain('settings.lastRefreshed');
        expect(html).toContain(`btnRefreshEngineSource_${privateFork.id}`);
        expect(html).toContain(`btnRemoveEngineSource_${privateFork.id}`);
        expect(html).not.toContain('btnRemoveEngineSource_official-stable');
    });

    it('shows how many builds a refreshed source lists', () => {
        const html = renderPanel();

        expect(html).toContain('engineSourceBuildCount_official-stable');
        expect(html).toContain('settings.buildCount');
        expect(html).not.toContain(`engineSourceBuildCount_${privateFork.id}`);
    });

    it('explains a reachable fork that lists no builds', () => {
        const html = renderPanel({
            sources: [
                {
                    ...privateFork,
                    requiresAuth: false,
                    state: 'ok',
                    lastFetchedAt: Date.now(),
                },
            ],
        });

        expect(html).toContain('drawer.emptyHint');
        expect(html).not.toContain('btnInstallEngineSourceBuild_');
    });

    it('offers to install a build from a reachable fork with builds', () => {
        const html = renderPanel({
            sources: [
                officialStable,
                { ...privateFork, state: 'ok', buildCount: 3 },
            ],
        });

        expect(html).toContain(`btnInstallEngineSourceBuild_${privateFork.id}`);
        expect(html).not.toContain(
            'btnInstallEngineSourceBuild_official-stable',
        );
    });

    it('offers sign-in and the GitHub App for a source that needs a login', () => {
        const html = renderPanel({ sources: [privateFork] });

        expect(html).toContain('forkSourceAccess_auth-required');
        expect(html).toContain('btnForkSourceSignIn');
        expect(html).toContain('btnForkSourceInstallApp');
    });

    it('asks to install the GitHub App when the signed-in account has no access', () => {
        const html = renderPanel({
            sources: [{ ...privateFork, state: 'no-access' }],
        });

        expect(html).toContain('settings.state.noAccess');
        expect(html).toContain('forkSourceAccess_no-access');
        expect(html).toContain('btnForkSourceInstallApp');
        expect(html).not.toContain('btnForkSourceSignIn');
    });

    it('shows the refresh error message for failed sources', () => {
        const html = renderPanel({
            sources: [
                { ...privateFork, state: 'error', error: 'Bad credentials' },
            ],
        });

        expect(html).toContain('settings.state.error');
        expect(html).toContain('Bad credentials');
    });

    it.each([
        ['invalid', 'settings.add.errors.invalid'],
        ['duplicate', 'settings.add.errors.duplicate'],
        ['auth-required', 'settings.add.errors.authRequired'],
        ['no-access', 'settings.add.errors.noAccess'],
        ['network', 'settings.add.errors.network'],
    ] satisfies [AddEngineSourceFailure, string][])(
        'renders the %s add-source error',
        (reason, key) => {
            const html = renderPanel({ addError: reason });

            expect(html).toContain('addEngineSourceError');
            expect(html).toContain(key);
        },
    );

    it('offers the GitHub App install with a no-access add failure', () => {
        const html = renderPanel({
            addError: 'no-access',
            addErrorInstallUrl: installUrl,
        });

        expect(html).toContain('btnAddEngineSourceInstallApp');
        expect(renderPanel({ addError: 'network' })).not.toContain(
            'btnAddEngineSourceInstallApp',
        );
    });

    it('renders no add-source error without a failure', () => {
        expect(renderPanel()).not.toContain('addEngineSourceError');
    });

    it('asks for one repository URL and starts without a validation error', () => {
        const html = renderPanel();

        expect(html).toContain('inputEngineSourceUrl');
        expect(html).toContain('settings.add.url');
        expect(html).not.toContain('inputEngineSourceOwner');
        expect(html).not.toContain('inputEngineSourceRepo');
        expect(html).not.toContain('engineSourceUrlInvalid');
    });

    it('invites adding a fork when only built-in sources exist', () => {
        const html = renderPanel({ sources: [officialStable] });

        expect(html).toContain('engineSourcesNoForks');
        expect(html).toContain('settings.noForks');
        expect(html).toContain('addEngineSourceForm');
    });

    it('hides the no-forks hint once a fork is configured', () => {
        expect(renderPanel()).not.toContain('engineSourcesNoForks');
    });
});

describe('findAddedSourceWithBuilds', () => {
    const added = { ...privateFork, state: 'ok' as const, buildCount: 4 };

    it('finds the added fork by its URL, ignoring case', () => {
        expect(
            findAddedSourceWithBuilds(
                [officialStable, added],
                'https://github.com/eldritch-game-studio/eldritch-engine',
            ),
        ).toBe(added);
    });

    it('stays on Settings when the fork has no installable builds yet', () => {
        expect(
            findAddedSourceWithBuilds(
                [{ ...added, buildCount: 0 }],
                'Eldritch-Game-Studio/Eldritch-Engine',
            ),
        ).toBeUndefined();
        expect(
            findAddedSourceWithBuilds(
                [{ ...added, state: 'pending' }],
                'Eldritch-Game-Studio/Eldritch-Engine',
            ),
        ).toBeUndefined();
    });
});
