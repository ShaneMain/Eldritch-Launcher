import * as fs from 'node:fs';
import type { EngineSource } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import type { GithubEditorRelease } from './editor-catalog.types.js';
import {
    type ForkManifest,
    ForkManifestSchema,
    mapForkRelease,
    mapGodotPlatformName,
    parseForkAssetName,
    parseForkEngineVersion,
} from './fork-release.mapper.js';
import {
    type GithubReleaseResponse,
    githubReleasePageSchema,
} from './github-editor-catalog.schema.js';

const SOURCE: EngineSource = {
    id: 'fork:eldritch-game-studio/eldritch-engine',
    kind: 'fork',
    owner: 'Eldritch-Game-Studio',
    repo: 'Eldritch-Engine',
    displayName: 'Eldritch Engine',
    requiresAuth: true,
    builtIn: false,
};

/**
 * Reads one JSON fixture captured from the real Eldritch-Engine releases.
 *
 * @param name - Fixture file name.
 * @returns Parsed fixture contents.
 */
function fixture(name: string): unknown {
    return JSON.parse(
        fs.readFileSync(
            new URL(`./__fixtures__/${name}`, import.meta.url),
            'utf8',
        ),
    );
}

/**
 * Loads the real release page in the internal mapper input shape.
 *
 * @returns Releases keyed by tag.
 */
function loadReleases(): Map<string, GithubEditorRelease> {
    const page = githubReleasePageSchema.parse(
        fixture('eldritch-engine-releases.json'),
    );
    return new Map(
        page.map((value: GithubReleaseResponse) => [
            value.tag_name,
            {
                id: value.id,
                name: value.name,
                tagName: value.tag_name,
                publishedAt: value.published_at,
                draft: value.draft,
                prerelease: value.prerelease,
                assets: value.assets.map((asset) => ({
                    id: asset.id,
                    name: asset.name,
                    browserDownloadUrl: asset.browser_download_url,
                    ...(asset.url ? { apiUrl: asset.url } : {}),
                    digest: asset.digest ?? null,
                    size: asset.size,
                })),
            },
        ]),
    );
}

/**
 * Loads the real manifests keyed by their release asset IDs.
 *
 * @returns Manifests by asset ID.
 */
function loadManifests(): Map<number, ForkManifest> {
    return new Map([
        [
            643149815,
            ForkManifestSchema.parse(
                fixture('eldritch-engine-manifest-b90e204.json'),
            ),
        ],
        [
            639139572,
            ForkManifestSchema.parse(
                fixture('eldritch-engine-manifest-9301bad.json'),
            ),
        ],
    ]);
}

describe('mapForkRelease', () => {
    it('maps the real b90e204 build, whose revision contains "32", to linux x64 .NET', () => {
        const release = loadReleases().get(
            'native-import-thread-safety-b90e204',
        ) as GithubEditorRelease;
        expect(release.assets[0].name).toContain('97732d8');

        const mapped = mapForkRelease(SOURCE, release, loadManifests());

        expect(mapped).toEqual({
            ok: true,
            release: {
                id: `${SOURCE.id}:native-import-thread-safety-b90e204`,
                sourceReleaseId: '413553680',
                providerId: SOURCE.id,
                tag: 'native-import-thread-safety-b90e204',
                version: '4.7.2.stable.mono.custom_build.b90e2049e',
                baseVersion: '4.7',
                name: 'Import thread-safety ClassDB/ShaderFile — b90e204 (.NET editor and templates)',
                publishedAt: '2026-10-15T08:04:20.000Z',
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
                        id: `${SOURCE.id}:native-import-thread-safety-b90e204:dotnet`,
                        flavor: 'dotnet',
                        assets: [
                            {
                                id: `${SOURCE.id}:native-import-thread-safety-b90e204:dotnet:643149811:linux:x64`,
                                name: 'godot-native-attenuation-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux-x86_64-mono-editor.tar.gz',
                                downloadUrl:
                                    'https://api.github.com/repos/Eldritch-Game-Studio/Eldritch-Engine/releases/assets/643149811',
                                digest: 'sha256:43da0be9ccd1d3fe69e01cbf63b8e3828e1fd9aaaa86efde96f3f5209c1d60e7',
                                platform: 'linux',
                                architecture: 'x64',
                            },
                        ],
                    },
                ],
                templateAssets: [
                    {
                        id: `${SOURCE.id}:native-import-thread-safety-b90e204:templates:643149817`,
                        name: 'godot-native-attenuation-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux-x86_64-mono-templates.tpz',
                        flavor: 'dotnet',
                        downloadUrl:
                            'https://api.github.com/repos/Eldritch-Game-Studio/Eldritch-Engine/releases/assets/643149817',
                        sizeBytes: 374649783,
                        digest: 'sha256:1b8f84ed53813acbb109ac96f5a625e0d67f11e59774f3d0dc11ee40ad7a38af',
                        templateIdentity: '4.7.2.stable.mono',
                    },
                ],
                fork: {
                    sourceId: SOURCE.id,
                    source: 'Eldritch-Game-Studio/Eldritch-Engine',
                    revision: 'b90e2049efff97732d8dffa8af3f4ea48fb140d9',
                    upstreamBase: 'ed1daf0bf001b61586d9930840f2f1394092c079',
                },
            },
        });
    });

    it('skips a release without a manifest asset with a reason', () => {
        const release = loadReleases().get(
            'native-attenuation-9301bad',
        ) as GithubEditorRelease;
        const withoutManifest = {
            ...release,
            assets: release.assets.filter(
                (asset) => !asset.name.endsWith('-manifest.json'),
            ),
        };

        expect(
            mapForkRelease(SOURCE, withoutManifest, loadManifests()),
        ).toEqual({ ok: false, reason: 'no build manifest asset' });
    });

    it('skips a release whose manifest could not be read', () => {
        const release = loadReleases().get(
            'native-attenuation-9301bad',
        ) as GithubEditorRelease;

        const mapped = mapForkRelease(SOURCE, release, new Map());

        expect(mapped.ok).toBe(false);
        expect(!mapped.ok && mapped.reason).toContain('manifest unavailable');
    });

    it('skips a manifest whose target disagrees with its asset name', () => {
        const release = loadReleases().get(
            'native-attenuation-9301bad',
        ) as GithubEditorRelease;
        const manifests = loadManifests();
        manifests.set(639139572, {
            ...(manifests.get(639139572) as ForkManifest),
            arch: 'arm64',
        });

        const mapped = mapForkRelease(SOURCE, release, manifests);

        expect(mapped.ok).toBe(false);
        expect(!mapped.ok && mapped.reason).toContain(
            'manifest target does not match',
        );
    });

    it('skips drafts', () => {
        const release = loadReleases().get(
            'native-attenuation-9301bad',
        ) as GithubEditorRelease;

        expect(
            mapForkRelease(SOURCE, { ...release, draft: true }, loadManifests())
                .ok,
        ).toBe(false);
    });
});

describe('parseForkAssetName', () => {
    it.each([
        [
            'x-linux-x86_64-mono-editor.tar.gz',
            {
                platform: 'linux',
                arch: 'x86_64',
                flavor: 'mono',
                kind: 'editor',
            },
        ],
        [
            'x-windows-arm64-standard-editor.zip',
            {
                platform: 'windows',
                arch: 'arm64',
                flavor: 'standard',
                kind: 'editor',
            },
        ],
        [
            'x-macos-universal-mono-templates.tpz',
            {
                platform: 'macos',
                arch: 'universal',
                flavor: 'mono',
                kind: 'templates',
            },
        ],
        [
            'x-linux-x86_32-standard-manifest.json',
            {
                platform: 'linux',
                arch: 'x86_32',
                flavor: 'standard',
                kind: 'manifest',
            },
        ],
    ])('reads %s', (name, expected) => {
        expect(parseForkAssetName(name)).toMatchObject({
            stem: 'x',
            ...expected,
        });
    });

    it('does not read architecture digits inside a revision hash', () => {
        expect(
            parseForkAssetName(
                'godot-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux.zip',
            ),
        ).toBeNull();
        expect(
            parseForkAssetName(
                'godot-native-attenuation-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux-x86_64-mono-editor.tar.gz',
            ),
        ).toMatchObject({ arch: 'x86_64' });
    });

    it('rejects unknown suffixes', () => {
        expect(
            parseForkAssetName('x-linux-x86_64-mono-editor.tar.xz'),
        ).toBeNull();
        expect(
            parseForkAssetName('x-freebsd-x86_64-mono-editor.zip'),
        ).toBeNull();
    });
});

describe('mapGodotPlatformName', () => {
    it.each([
        ['linuxbsd', 'linux'],
        ['linux', 'linux'],
        ['windows', 'windows'],
        ['macos', 'macos'],
        ['android', undefined],
    ])('maps %s to %s', (platform, expected) => {
        expect(mapGodotPlatformName(platform)).toBe(expected);
    });
});

describe('parseForkEngineVersion', () => {
    it('reads custom build and prerelease versions', () => {
        expect(
            parseForkEngineVersion('4.7.2.stable.mono.custom_build.b90e2049e'),
        ).toEqual({
            major: 4,
            minor: 7,
            patch: 2,
            channel: 'stable',
            iteration: 0,
        });
        expect(parseForkEngineVersion('4.8.beta3.custom_build.abc')).toEqual({
            major: 4,
            minor: 8,
            patch: 0,
            channel: 'beta',
            iteration: 3,
        });
        expect(parseForkEngineVersion('native-attenuation-9301bad')).toBeNull();
    });
});
