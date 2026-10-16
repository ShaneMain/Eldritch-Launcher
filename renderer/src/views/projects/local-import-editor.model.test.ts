import type {
    InstalledRelease,
    ProjectImportInspection,
    ReleaseSummary,
} from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { prepareLocalImportRow } from './local-import-editor.model';

const beta: ReleaseSummary = {
    version: '4.8-beta2',
    version_number: 4.8,
    name: '4.8 beta 2',
    published_at: null,
    draft: false,
    prerelease: true,
    assets: [],
};
const row: ProjectImportInspection = {
    projectFilePath: '/fixture/project.godot',
    name: 'Chosen name',
};

const FORK = {
    sourceId: 'fork:eldritch-game-studio/eldritch-engine',
    source: 'Eldritch-Game-Studio/Eldritch-Engine',
    revision: 'b90e2049efff97732d8dffa8af3f4ea48fb140d9',
};
const FORK_VERSION = '4.7.2.stable.mono.custom_build.b90e2049e';

/**
 * Creates a .NET release summary for linux x64.
 *
 * @param version - Release version.
 * @param fork - Optional fork identity.
 * @returns The release summary.
 */
function dotnetRelease(
    version: string,
    fork?: ReleaseSummary['fork'],
): ReleaseSummary {
    return {
        version,
        version_number: 4.7,
        name: version,
        published_at: null,
        draft: false,
        prerelease: false,
        assets: [
            {
                name: `${version}.tar.gz`,
                download_url:
                    'https://api.github.com/repos/x/y/releases/assets/1',
                platform_tags: ['linux', 'x64'],
                mono: true,
            },
        ],
        ...(fork ? { fork } : {}),
    };
}

/** Inspection of a project pinned to the b90e204 fork build that is not installed. */
const missingForkRow: ProjectImportInspection = {
    ...row,
    editorResolution: {
        requested: {
            kind: 'exact',
            channel: 'fork',
            flavor: 'dotnet',
            base_version: '4.7',
            version: FORK_VERSION,
            fork: FORK,
        },
        downloadable: {
            match: 'exact',
            version: FORK_VERSION,
            flavor: 'dotnet',
            prerelease: false,
            fork: FORK,
        },
    },
};

describe('fork-pinned import rows', () => {
    const official = dotnetRelease(FORK_VERSION);
    const otherFork = dotnetRelease(
        '4.7.2.stable.mono.custom_build.e9c91112a',
        {
            ...FORK,
            revision: 'e9c91112ac16939a1ec74ec6f5dd0dc7441388da',
        },
    );

    it('uses the installed exact fork editor', () => {
        const editor = {
            version: FORK_VERSION,
            mono: true,
            fork: FORK,
        } as InstalledRelease;

        const prepared = prepareLocalImportRow(
            { ...row, editor },
            [official],
            [],
            [otherFork],
        );

        expect(prepared.editorActions).toEqual([
            expect.objectContaining({
                id: 'automatic',
                kind: 'use',
                version: FORK_VERSION,
                flavor: 'dotnet',
            }),
        ]);
    });

    it('offers only the exact pinned fork build for download', () => {
        const pinned = dotnetRelease(FORK_VERSION, {
            ...FORK,
            source: 'eldritch-game-studio/eldritch-engine',
        });

        const prepared = prepareLocalImportRow(
            missingForkRow,
            [official],
            [],
            [otherFork, pinned],
        );

        expect(prepared.editorActionId).toBe('download');
        expect(prepared.editorActions[0]).toMatchObject({
            kind: 'download',
            download: pinned,
            options: { resolution: 'add_missing' },
        });
        expect(prepared.editorActions.map((action) => action.id)).toEqual([
            'download',
            'missing',
        ]);
    });

    it('never substitutes an official or different fork build when the pin is unavailable', () => {
        const prepared = prepareLocalImportRow(
            missingForkRow,
            [official],
            [],
            [otherFork],
        );

        expect(prepared.editorActions).toEqual([
            expect.objectContaining({ id: 'missing', kind: 'missing' }),
        ]);
    });
});
describe('local import editor preparation', () => {
    it('keeps the inferred request while preselecting a recommended download', () => {
        const prepared = prepareLocalImportRow(
            {
                ...row,
                editorResolution: {
                    requested: {
                        kind: 'stable-base',
                        channel: 'official',
                        flavor: 'gdscript',
                        base_version: '4.8',
                    },
                    choices: [
                        {
                            id: 'beta',
                            version: beta.version,
                            source: 'official',
                            flavor: 'gdscript',
                            prerelease: true,
                            installed: false,
                            recommended: true,
                            release: beta,
                        },
                    ],
                },
            },
            [],
            [],
        );
        expect(prepared.editorActionId).toBe('beta');
        expect(prepared.editorActions[0]).toMatchObject({
            kind: 'download',
            download: beta,
            options: { resolution: 'add_missing', editorChoiceId: 'beta' },
        });
        expect(prepared.editorResolution?.requested).toMatchObject({
            kind: 'stable-base',
            base_version: '4.8',
        });
        expect(prepared.editorActions[1]).toMatchObject({
            kind: 'missing',
            options: { resolution: 'add_missing' },
        });
    });

    it('uses the exact prerelease catalogue for saved requirements', () => {
        const prepared = prepareLocalImportRow(
            {
                ...row,
                editorResolution: {
                    requested: {
                        kind: 'exact',
                        channel: 'official',
                        flavor: 'gdscript',
                        base_version: '4.8',
                        version: beta.version,
                    },
                    downloadable: {
                        match: 'exact',
                        version: beta.version,
                        flavor: 'gdscript',
                        prerelease: true,
                    },
                },
            },
            [],
            [beta],
        );
        expect(prepared.editorActions[0]).toMatchObject({
            kind: 'download',
            download: beta,
        });
        expect(prepared.name).toBe('Chosen name');
    });

    it('prefers an exact requested download over an installed fallback', () => {
        const requested = {
            ...beta,
            version: '4.7.2-stable',
            name: '4.7.2 stable',
            prerelease: false,
        };
        const prepared = prepareLocalImportRow(
            {
                ...row,
                editorResolution: {
                    requested: {
                        kind: 'exact',
                        channel: 'official',
                        flavor: 'gdscript',
                        base_version: '4.7',
                        version: requested.version,
                    },
                    fallback: {
                        version: '4.7-stable',
                    } as InstalledRelease,
                    downloadable: {
                        match: 'exact',
                        version: requested.version,
                        flavor: 'gdscript',
                        prerelease: false,
                    },
                },
            },
            [requested],
            [],
        );

        expect(prepared.editorActionId).toBe('download');
        expect(prepared.editorActions.map(({ id }) => id)).toEqual([
            'download',
            'fallback',
            'missing',
        ]);
        expect(prepared.editorActions[0]).toMatchObject({
            kind: 'download',
            version: requested.version,
            download: requested,
        });
    });

    it('leaves resolved imports automatic and excludes unusable download choices', () => {
        expect(prepareLocalImportRow(row, [], []).editorActions).toEqual([
            { id: 'automatic', version: undefined, kind: 'use', options: {} },
        ]);
        const prepared = prepareLocalImportRow(
            {
                ...row,
                editorResolution: {
                    requested: {
                        kind: 'stable-base',
                        channel: 'official',
                        flavor: 'gdscript',
                        base_version: '4.8',
                    },
                    choices: [
                        {
                            id: 'bad',
                            version: beta.version,
                            source: 'official',
                            flavor: 'gdscript',
                            prerelease: true,
                            installed: false,
                            recommended: true,
                        },
                    ],
                },
            },
            [],
            [],
        );
        expect(prepared.editorActionId).toBe('missing');
        expect(prepared.editorActions).toHaveLength(1);
    });
});
