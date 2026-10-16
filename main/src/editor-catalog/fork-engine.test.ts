import type { AssetSummary, EditorCatalogRelease } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../i18n/index.js', () => ({ t: (key: string) => key }));
vi.mock('@mariodebono/di', () => ({ Injectable: () => () => undefined }));
vi.mock('../projects/projects.store.js', () => ({ ProjectsStore: class {} }));
vi.mock('./editor-catalog.service.js', () => ({
    EditorCatalogService: class {},
}));
vi.mock('./engine-sources.service.js', () => ({
    EngineSourcesService: class {},
}));
vi.mock('./github-source-access.service.js', () => ({
    GithubSourceAccessService: class {},
}));

import {
    isTrustedForkAssetUrl,
    resolveArchiveIntegrity,
} from '../utils/archive-integrity.util.js';
import {
    createProjectLauncherConfig,
    getProjectLauncherFork,
    getReleaseChannel,
    parseProjectLauncherConfig,
    serializeProjectLauncherConfig,
} from '../utils/projectLauncherConfig.utils.js';
import { getReleaseTemplateIdentity } from '../utils/template-identity.util.js';
import {
    findNewerForkBuild,
    parseEngineCompare,
} from './project-engine-status.service.js';

const REVISION = 'b90e2049efff97732d8dffa8af3f4ea48fb140d9';
const FORK = {
    sourceId: 'fork:eldritch-game-studio/eldritch-engine',
    source: 'Eldritch-Game-Studio/Eldritch-Engine',
    revision: REVISION,
};
const API_URL =
    'https://api.github.com/repos/Eldritch-Game-Studio/Eldritch-Engine/releases/assets/643149811';
const TRUSTED = [{ owner: 'Eldritch-Game-Studio', repo: 'Eldritch-Engine' }];

/**
 * Creates a fork editor asset.
 *
 * @param digest - Optional GitHub digest.
 * @param url - Download URL.
 * @returns The asset.
 */
function forkAsset(digest?: string, url = API_URL): AssetSummary {
    return {
        name: 'godot-native-attenuation-linux-x86_64-mono-editor.tar.gz',
        download_url: url,
        ...(digest ? { digest } : {}),
        platform_tags: ['linux', 'x64'],
        mono: true,
    };
}

describe('fork archive integrity', () => {
    it('uses the GitHub digest of a configured fork asset', async () => {
        await expect(
            resolveArchiveIntegrity(forkAsset(`sha256:${'a'.repeat(64)}`), {
                expectedReleaseTag: 'native-import-thread-safety-b90e204',
                trustedForkRepositories: TRUSTED,
            }),
        ).resolves.toEqual({ algorithm: 'sha256', digest: 'a'.repeat(64) });
    });

    it('requires a digest for fork assets', async () => {
        await expect(
            resolveArchiveIntegrity(forkAsset(), {
                expectedReleaseTag: 'native-import-thread-safety-b90e204',
                trustedForkRepositories: TRUSTED,
            }),
        ).rejects.toThrow('engineSources:errors.integrityUnavailable');
    });

    it('trusts only configured fork repositories', async () => {
        await expect(
            resolveArchiveIntegrity(forkAsset(`sha256:${'a'.repeat(64)}`), {
                expectedReleaseTag: 'x',
            }),
        ).rejects.toThrow('installEditor:errors.archiveIntegrityUnavailable');
        expect(
            isTrustedForkAssetUrl(
                'https://api.github.com/repos/evil/Eldritch-Engine/releases/assets/1',
                TRUSTED,
            ),
        ).toBe(false);
        expect(isTrustedForkAssetUrl(`${API_URL}?token=x`, TRUSTED)).toBe(
            false,
        );
        expect(isTrustedForkAssetUrl(API_URL.toLowerCase(), TRUSTED)).toBe(
            true,
        );
    });
});

describe('fork project pin', () => {
    const release = {
        version: '4.7.2.stable.mono.custom_build.b90e2049e',
        version_number: 4.7,
        install_path: '/e',
        editor_path: '/e/godot',
        platform: 'linux',
        arch: 'x64',
        mono: true,
        prerelease: false,
        config_version: 5 as const,
        published_at: null,
        valid: true,
        fork: FORK,
    };

    it('round-trips channel, source, revision and flavor', () => {
        const config = createProjectLauncherConfig({
            release,
            launcherVersion: '1.13.0',
            projectName: 'Krakens Keg',
        });
        const text = serializeProjectLauncherConfig(config);

        expect(text).toContain('channel=fork');
        expect(text).toContain('source=Eldritch-Game-Studio/Eldritch-Engine');
        expect(text).toContain(`revision=${REVISION}`);
        expect(text).toContain('flavor=dotnet');
        const parsed = parseProjectLauncherConfig(text);
        expect(parsed).toEqual(config);
        expect(parsed && getProjectLauncherFork(parsed)).toEqual(FORK);
        expect(getReleaseChannel(release)).toBe('fork');
    });

    it('rejects fork pins without an exact source and revision', () => {
        const base =
            '[config]\nversion=1\n[launcher]\nversion=1\n[editor]\nchannel=fork\nflavor=dotnet\nbase_version=4.7\nversion=4.7.2\n';
        expect(parseProjectLauncherConfig(base)).toBeNull();
        expect(
            parseProjectLauncherConfig(
                `${base}source=Eldritch-Game-Studio/Eldritch-Engine\nrevision=b90e204\n`,
            ),
        ).toBeNull();
    });

    it('keeps official pins unchanged', () => {
        const text = serializeProjectLauncherConfig(
            createProjectLauncherConfig({
                release: { ...release, version: '4.4-stable', fork: undefined },
                launcherVersion: '1.13.0',
            }),
        );
        expect(text).toContain('channel=official');
        expect(text).not.toContain('revision=');
    });

    it('uses the Godot template directory of the fork version', () => {
        expect(getReleaseTemplateIdentity(release)).toBe('4.7.2.stable.mono');
        expect(
            getReleaseTemplateIdentity({
                version: '4.4-stable',
                mono: true,
            }),
        ).toBe('4.4.stable.mono');
    });
});

describe('engine behind status', () => {
    it('reads how far the pin is behind the default branch', () => {
        // Real compare b90e204...parity/water-light-attenuation.
        expect(
            parseEngineCompare({ status: 'behind', ahead_by: 0, behind_by: 4 }),
        ).toEqual({ compareStatus: 'behind', behindBy: 0, aheadBy: 4 });
        // Real compare 9301bad...parity/water-light-attenuation.
        expect(
            parseEngineCompare({ status: 'ahead', ahead_by: 14, behind_by: 0 }),
        ).toEqual({ compareStatus: 'ahead', behindBy: 14, aheadBy: 0 });
        expect(() => parseEngineCompare({ status: 'ahead' })).toThrow();
    });

    /**
     * Creates a catalog fork release.
     *
     * @param revision - Build revision.
     * @param publishedAt - Publication time.
     * @param platform - Asset platform.
     * @returns The release.
     */
    function build(
        revision: string,
        publishedAt: string,
        platform: 'linux' | 'win32' = 'linux',
    ): EditorCatalogRelease {
        return {
            id: `fork:${revision}`,
            sourceReleaseId: revision,
            providerId: FORK.sourceId,
            tag: `tag-${revision.slice(0, 7)}`,
            version: `4.7.2.stable.mono.custom_build.${revision.slice(0, 9)}`,
            baseVersion: '4.7',
            name: revision,
            publishedAt,
            prerelease: false,
            versionParts: {
                major: 4,
                minor: 7,
                patch: 2,
                channel: 'stable',
                iteration: 0,
            },
            variants: [
                {
                    id: 'v',
                    flavor: 'dotnet',
                    assets: [
                        {
                            id: 'a',
                            name: 'a',
                            downloadUrl: API_URL,
                            platform,
                            architecture: 'x64',
                        },
                    ],
                },
            ],
            fork: { ...FORK, revision, upstreamBase: 'f'.repeat(40) },
        };
    }

    it('finds the newest platform build published after the pin', () => {
        const newer = build('e'.repeat(40), '2026-10-15T09:00:00Z');
        const releases = [
            build(REVISION, '2026-10-15T08:00:00Z'),
            newer,
            build('c'.repeat(40), '2026-10-16T00:00:00Z', 'win32'),
        ];
        const target = { platform: 'linux', architecture: 'x64', mono: true };

        expect(findNewerForkBuild(releases, FORK, target)).toBe(newer);
        expect(
            findNewerForkBuild(
                releases,
                { ...FORK, revision: newer.fork?.revision as string },
                target,
            ),
        ).toBeUndefined();
        expect(
            findNewerForkBuild(releases, FORK, { ...target, mono: false }),
        ).toBeUndefined();
    });
});
