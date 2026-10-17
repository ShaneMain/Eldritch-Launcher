import type { ProjectImportInspection } from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { prepareLocalImportRow } from '../local-import-editor.model';
import type { PinnedSourceStates } from '../pinned-sources.model';
import { ProjectImportReviewList } from './project-import-review-list.component';

vi.mock('../../../hooks/release.hook', () => ({
    useRelease: () => ({ reloadReleases: vi.fn() }),
}));

vi.mock('../../../renderer.bridge.ts', () => ({
    appBridge: { openExternal: vi.fn() },
}));

const FORK = {
    sourceId: 'fork:redot-engine/redot-engine',
    source: 'Redot-Engine/redot-engine',
    revision: 'a'.repeat(40),
};

const inspection: ProjectImportInspection = {
    projectFilePath: '/projects/redot/project.godot',
    name: 'Redot game',
    editorResolution: {
        requested: {
            kind: 'exact',
            channel: 'fork',
            flavor: 'gdscript',
            base_version: '4.3',
            version: '26.1.stable',
            fork: FORK,
        },
        downloadable: {
            match: 'exact',
            version: '26.1.stable',
            flavor: 'gdscript',
            prerelease: false,
            fork: FORK,
        },
    },
};

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

/**
 * Renders one review row pinned to a source that is not added.
 *
 * @param pinnedSources - Pinned source states.
 * @returns Static markup.
 */
function renderRow(pinnedSources: PinnedSourceStates = {}): string {
    const row = prepareLocalImportRow(inspection, [], [], [], []);
    return renderToStaticMarkup(
        <ProjectImportReviewList
            items={[
                {
                    id: '0',
                    row,
                    name: row.name,
                    selected: true,
                    editorActionId: row.editorActionId,
                    path: '/projects/redot',
                },
            ]}
            editingId={null}
            draft=""
            t={translate}
            onToggle={vi.fn()}
            onEdit={vi.fn()}
            onDraftChange={vi.fn()}
            onSave={vi.fn()}
            onCancel={vi.fn()}
            onEditorChange={vi.fn()}
            pinnedSources={pinnedSources}
        />,
    );
}

describe('ProjectImportReviewList pinned sources', () => {
    it('preselects adding the pinned source and installing its build', () => {
        const html = renderRow();

        expect(html).toContain(
            'addProject.editorResolution.addSourceAndInstall(source=Redot-Engine/redot-engine)',
        );
        expect(html).toContain('addProject.editorReview.download');
        expect(html).toContain('pinnedSourceAddHint');
        expect(html).not.toContain('pinnedSource_');
    });

    it('signs in in place when the source is private', () => {
        const html = renderRow({
            'redot-engine/redot-engine': { kind: 'auth-required' },
        });

        expect(html).toContain(
            'addProject.editorReview.pinnedSource.authRequired(source=Redot-Engine/redot-engine)',
        );
        expect(html).toContain('btnPinnedSourceSignIn');
    });

    it('offers to give the GitHub App access when it cannot see the source', () => {
        const html = renderRow({
            'redot-engine/redot-engine': {
                kind: 'no-access',
                installUrl:
                    'https://github.com/apps/eldritch-launcher/installations/new',
            },
        });

        expect(html).toContain('addProject.editorReview.pinnedSource.noAccess');
        expect(html).toContain('btnPinnedSourceGiveAccess');
        expect(html).toContain(
            'addProject.editorReview.pinnedSource.giveAppAccess',
        );
    });
});
