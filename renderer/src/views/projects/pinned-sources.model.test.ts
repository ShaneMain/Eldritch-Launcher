import type {
    AddEngineSourceResult,
    ProjectImportInspection,
    ReleaseSummary,
} from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { prepareLocalImportRow } from './local-import-editor.model';
import { addPinnedSources, getForkSourceNames } from './pinned-sources.model';

const FORK = {
    sourceId: 'fork:redot-engine/redot-engine',
    source: 'Redot-Engine/redot-engine',
    revision: 'a'.repeat(40),
};
const VERSION = '26.1.stable.custom_build.aaaaaaa';
const INSTALL_URL =
    'https://github.com/apps/eldritch-launcher/installations/new';

const inspection: ProjectImportInspection = {
    projectFilePath: '/projects/redot/project.godot',
    name: 'Redot game',
    editorResolution: {
        requested: {
            kind: 'exact',
            channel: 'fork',
            flavor: 'gdscript',
            base_version: '4.3',
            version: VERSION,
            fork: FORK,
        },
        downloadable: {
            match: 'exact',
            version: VERSION,
            flavor: 'gdscript',
            prerelease: false,
            fork: FORK,
        },
    },
};

/**
 * Creates a linux x64 standard fork build.
 *
 * @param revision - Engine revision the build was made from.
 * @returns The release summary.
 */
function forkBuild(revision: string): ReleaseSummary {
    return {
        version: VERSION,
        version_number: 4.3,
        name: VERSION,
        published_at: null,
        draft: false,
        prerelease: false,
        assets: [
            {
                name: 'redot.zip',
                download_url: 'https://example.com/redot.zip',
                platform_tags: ['linux', 'x64'],
                mono: false,
            },
        ],
        fork: { ...FORK, revision },
    };
}

/** A review row pinned to a source that is not added. */
const reviewRow = prepareLocalImportRow(inspection, [], [], [], []);

/**
 * Adds the row's pinned source with a stubbed bridge.
 *
 * @param result - Add-source result.
 * @param releases - Fork builds listed afterwards.
 * @returns The outcome and the stubs.
 */
async function addWith(
    result: AddEngineSourceResult,
    releases: ReleaseSummary[] = [],
) {
    const addSource = vi.fn(async () => result);
    const loadForkReleases = vi.fn(async () => releases);
    const outcome = await addPinnedSources([reviewRow], {
        addSource,
        loadForkReleases,
    });
    return { outcome, addSource, loadForkReleases };
}

describe('addPinnedSources', () => {
    it('adds the source, then offers exactly the pinned build', async () => {
        const pinned = forkBuild(FORK.revision);
        const { outcome, addSource } = await addWith(
            { ok: true, sources: [] },
            [forkBuild('b'.repeat(40)), pinned],
        );

        expect(addSource).toHaveBeenCalledWith({
            url: 'https://github.com/Redot-Engine/redot-engine',
        });
        expect(outcome.blocked).toEqual({});
        expect(outcome.rows[0].editorActionId).toBe('download');
        expect(
            outcome.rows[0].editorActions.find(
                (action) => action.id === 'download',
            )?.download,
        ).toBe(pinned);
    });

    it('treats an already added source as added', async () => {
        const { outcome } = await addWith({ ok: false, reason: 'duplicate' }, [
            forkBuild(FORK.revision),
        ]);

        expect(outcome.blocked).toEqual({});
        expect(outcome.rows[0].editorActionId).toBe('download');
    });

    it('asks a signed-out user to sign in for a private source', async () => {
        const { outcome, loadForkReleases } = await addWith({
            ok: false,
            reason: 'auth-required',
        });

        expect(outcome.blocked).toEqual({
            'redot-engine/redot-engine': { kind: 'auth-required' },
        });
        expect(outcome.rows[0].editorActionId).toBe('add-source');
        expect(loadForkReleases).not.toHaveBeenCalled();
    });

    it('offers the GitHub App installation when the app cannot see the source', async () => {
        const { outcome } = await addWith({
            ok: false,
            reason: 'no-access',
            githubAppInstallUrl: INSTALL_URL,
        });

        expect(outcome.blocked).toEqual({
            'redot-engine/redot-engine': {
                kind: 'no-access',
                installUrl: INSTALL_URL,
            },
        });
    });

    it('reports a source that lacks the pinned build without substituting one', async () => {
        const { outcome } = await addWith({ ok: true, sources: [] }, [
            forkBuild('b'.repeat(40)),
        ]);

        expect(outcome.blocked).toEqual({
            'redot-engine/redot-engine': { kind: 'build-missing' },
        });
        expect(outcome.rows[0].editorActionId).toBe('missing');
    });

    it('leaves rows without an add-source choice untouched', async () => {
        const row = { ...reviewRow, editorActionId: 'missing' };
        const addSource = vi.fn();

        const outcome = await addPinnedSources([row], {
            addSource,
            loadForkReleases: vi.fn(),
        });

        expect(outcome).toEqual({ rows: [row], blocked: {} });
        expect(addSource).not.toHaveBeenCalled();
    });
});

describe('getForkSourceNames', () => {
    it('names only fork sources', () => {
        expect(
            getForkSourceNames([
                { kind: 'official', owner: 'godotengine', repo: 'godot' },
                { kind: 'fork', owner: 'Redot-Engine', repo: 'redot-engine' },
            ] as never),
        ).toEqual(['Redot-Engine/redot-engine']);
    });
});
