import type {
    EditorCatalogProviderStatus,
    EngineSourceSummary,
    ReleaseSummary,
} from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import {
    buildForkEngineChannels,
    toHostRelease,
} from './fork-engine-channels.model';

const installUrl =
    'https://github.com/apps/eldritch-launcher/installations/new';

const redotSource: EngineSourceSummary = {
    id: 'fork:redot-engine/redot-engine',
    kind: 'fork',
    owner: 'Redot-Engine',
    repo: 'redot-engine',
    displayName: 'Redot',
    requiresAuth: false,
    builtIn: false,
    state: 'ok',
    lastFetchedAt: 1,
    buildCount: 1,
};

const privateSource: EngineSourceSummary = {
    id: 'fork:eldritch-game-studio/eldritch-engine',
    kind: 'fork',
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: '',
    requiresAuth: true,
    builtIn: false,
    state: 'auth-required',
    lastFetchedAt: null,
    buildCount: 0,
    githubAppInstallUrl: installUrl,
};

const officialSource: EngineSourceSummary = {
    id: 'official-stable',
    kind: 'official',
    owner: 'godotengine',
    repo: 'godot',
    displayName: 'Godot',
    requiresAuth: false,
    builtIn: true,
    state: 'ok',
    lastFetchedAt: 1,
    buildCount: 120,
};

/**
 * Creates a fork build of one source.
 *
 * @param sourceId - Fork source ID.
 * @param source - Fork `owner/repo`.
 * @returns A fork build with Linux and Windows assets.
 */
function forkRelease(sourceId: string, source: string): ReleaseSummary {
    return {
        version: '26.3.stable.85e520394',
        version_number: 26.3,
        name: 'Redot 26.3',
        published_at: '2026-10-15T18:44:57.000Z',
        draft: false,
        prerelease: false,
        assets: [
            {
                name: 'linux.zip',
                download_url: 'https://example.com/linux.zip',
                platform_tags: ['linux', 'x64'],
                mono: false,
            },
            {
                name: 'windows.zip',
                download_url: 'https://example.com/windows.zip',
                platform_tags: ['win32', 'x64'],
                mono: false,
            },
        ],
        fork: {
            sourceId,
            source,
            revision: '85e5203945af15755dd2f66cb6fdf7545fd88c0b',
        },
    };
}

describe('buildForkEngineChannels', () => {
    it('gives every fork source a channel with its builds, even before builds load', () => {
        const release = forkRelease(
            redotSource.id,
            'Redot-Engine/redot-engine',
        );
        const channels = buildForkEngineChannels(
            [officialSource, redotSource, privateSource],
            [],
            [release],
        );

        expect(channels.map((channel) => channel.id)).toEqual([
            redotSource.id,
            privateSource.id,
        ]);
        expect(channels[0]).toMatchObject({
            label: 'Redot',
            source: 'Redot-Engine/redot-engine',
            access: { kind: 'ok' },
            releases: [release],
        });
        expect(channels[1]).toMatchObject({
            label: 'Eldritch-Game-Studio/Eldritch-Engine',
            releases: [],
        });
    });

    it('keeps builds selectable while their source summary is still loading', () => {
        const release = forkRelease(
            redotSource.id,
            'Redot-Engine/redot-engine',
        );

        expect(buildForkEngineChannels([], [], [release])).toEqual([
            {
                id: redotSource.id,
                label: 'Redot-Engine/redot-engine',
                source: 'Redot-Engine/redot-engine',
                access: { kind: 'ok' },
                releases: [release],
            },
        ]);
    });

    it('reports sign-in and GitHub App access failures with the install page', () => {
        const signedOut = buildForkEngineChannels([privateSource], [], []);
        const noAccess = buildForkEngineChannels(
            [privateSource],
            [
                {
                    id: privateSource.id,
                    lastFetchedAt: null,
                    isStale: true,
                    state: 'no-access',
                    refreshError: 'cannot access',
                },
            ],
            [],
        );

        expect(signedOut[0].access).toEqual({
            kind: 'auth-required',
            installUrl,
        });
        expect(noAccess[0].access).toEqual({ kind: 'no-access', installUrl });
    });

    it('prefers the catalog provider state that produced the builds', () => {
        const providers: EditorCatalogProviderStatus[] = [
            {
                id: privateSource.id,
                lastFetchedAt: 2,
                isStale: false,
                state: 'ok',
            },
        ];

        expect(
            buildForkEngineChannels([privateSource], providers, [])[0].access,
        ).toEqual({ kind: 'ok' });
    });

    it('carries refresh errors', () => {
        const channels = buildForkEngineChannels(
            [{ ...redotSource, state: 'error', error: 'rate limited' }],
            [],
            [],
        );

        expect(channels[0].access).toEqual({
            kind: 'error',
            message: 'rate limited',
        });
    });
});

describe('toHostRelease', () => {
    it('keeps only the assets that run on the host', () => {
        const release = forkRelease(
            redotSource.id,
            'Redot-Engine/redot-engine',
        );

        expect(
            toHostRelease(release, { platform: 'linux', arch: 'x64' }).assets,
        ).toEqual([release.assets[0]]);
        expect(
            toHostRelease(release, { platform: 'darwin', arch: 'arm64' })
                .assets,
        ).toEqual([]);
    });
});
