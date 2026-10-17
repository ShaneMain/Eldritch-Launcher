import type {
    AddEngineSourceFailure,
    EngineSourceSummary,
} from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EngineSourcesPanelView } from './engine-sources-settings-panel.component';

const translate = (key: string) => key;

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
        ['not-found', 'settings.add.errors.notFound'],
        ['auth-required', 'settings.add.errors.authRequired'],
        ['network', 'settings.add.errors.network'],
    ] satisfies [AddEngineSourceFailure, string][])(
        'renders the %s add-source error',
        (reason, key) => {
            const html = renderPanel({ addError: reason });

            expect(html).toContain('addEngineSourceError');
            expect(html).toContain(key);
        },
    );

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
