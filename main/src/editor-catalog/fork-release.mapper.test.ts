import * as fs from 'node:fs';
import type { EngineSource } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import type { GithubEditorRelease } from './editor-catalog.types.js';
import {
    type ForkManifest,
    ForkManifestSchema,
    mapForkRelease,
    mapGodotPlatformName,
    needsForkTagRevision,
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

const NO_TAG_REVISIONS = new Map<string, string>();

/** Fork that publishes official-style Godot archives without manifests. */
const GENERIC_SOURCE: EngineSource = {
    id: 'fork:example/godot-fork',
    kind: 'fork',
    owner: 'example',
    repo: 'godot-fork',
    displayName: 'Example fork',
    requiresAuth: false,
    builtIn: false,
};
const GENERIC_REVISION = '77dcf97d82cbfe4e4615475fa52ca03da645dbd8';
const GENERIC_DIGEST = `sha256:${'a'.repeat(64)}`;

/** Asset names of an official Godot 4.3 release. */
const OFFICIAL_STYLE_ASSETS = [
    'Godot_v4.3-stable_linux.x86_64.zip',
    'Godot_v4.3-stable_linux.arm64.zip',
    'Godot_v4.3-stable_mono_linux_x86_64.zip',
    'Godot_v4.3-stable_win64.exe.zip',
    'Godot_v4.3-stable_mono_win64.zip',
    'Godot_v4.3-stable_macos.universal.zip',
    'Godot_v4.3-stable_export_templates.tpz',
    'Godot_v4.3-stable_mono_export_templates.tpz',
    'Godot_v4.3-stable_android_editor.apk',
    'Godot_v4.3-stable_web_editor.zip',
    'godot-4.3-stable.tar.xz',
    'SHA512-SUMS.txt',
];

/**
 * Creates a fork release whose assets have GitHub digests and API URLs.
 *
 * @param tagName - Release tag.
 * @param names - Asset names.
 * @param overrides - Release fields to replace.
 * @returns The release.
 */
function genericRelease(
    tagName: string,
    names: string[],
    overrides: Partial<GithubEditorRelease> = {},
): GithubEditorRelease {
    return {
        id: 7,
        name: null,
        tagName,
        publishedAt: '2026-10-01T00:00:00Z',
        draft: false,
        prerelease: false,
        targetCommitish: 'master',
        assets: names.map((name, index) => ({
            id: 100 + index,
            name,
            browserDownloadUrl: `https://github.com/example/godot-fork/releases/download/${tagName}/${name}`,
            apiUrl: `https://api.github.com/repos/example/godot-fork/releases/assets/${100 + index}`,
            digest: GENERIC_DIGEST,
            size: 1000,
        })),
        ...overrides,
    };
}

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

        const mapped = mapForkRelease(
            SOURCE,
            release,
            loadManifests(),
            NO_TAG_REVISIONS,
        );

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

    it('maps a release without a manifest from archive names and skips it without a Godot version', () => {
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
            mapForkRelease(
                SOURCE,
                withoutManifest,
                loadManifests(),
                NO_TAG_REVISIONS,
            ),
        ).toEqual({
            ok: false,
            reason: 'no Godot version in the tag or editor archive names',
        });
    });

    it('skips a release whose manifest could not be read', () => {
        const release = loadReleases().get(
            'native-attenuation-9301bad',
        ) as GithubEditorRelease;

        const mapped = mapForkRelease(
            SOURCE,
            release,
            new Map(),
            NO_TAG_REVISIONS,
        );

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

        const mapped = mapForkRelease(
            SOURCE,
            release,
            manifests,
            NO_TAG_REVISIONS,
        );

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
            mapForkRelease(
                SOURCE,
                { ...release, draft: true },
                loadManifests(),
                NO_TAG_REVISIONS,
            ).ok,
        ).toBe(false);
    });
});

describe('mapForkRelease without a build manifest', () => {
    it('maps official-style archives to platform, architecture, edition, version, and tag commit', () => {
        const release = genericRelease('v4.3-stable', OFFICIAL_STYLE_ASSETS);

        const mapped = mapForkRelease(
            GENERIC_SOURCE,
            release,
            new Map(),
            new Map([['v4.3-stable', GENERIC_REVISION]]),
        );

        expect(mapped.ok).toBe(true);
        const mappedRelease = mapped.ok ? mapped.release : undefined;
        expect(mappedRelease).toMatchObject({
            id: 'fork:example/godot-fork:v4.3-stable',
            providerId: GENERIC_SOURCE.id,
            tag: 'v4.3-stable',
            version: '4.3.stable.77dcf97d8',
            baseVersion: '4.3',
            name: 'v4.3-stable',
            publishedAt: '2026-10-01T00:00:00.000Z',
            prerelease: false,
            versionParts: {
                major: 4,
                minor: 3,
                patch: 0,
                channel: 'stable',
                iteration: 0,
            },
            fork: {
                sourceId: GENERIC_SOURCE.id,
                source: 'example/godot-fork',
                revision: GENERIC_REVISION,
            },
        });
        expect(mappedRelease?.fork).not.toHaveProperty('upstreamBase');
        expect(
            mappedRelease?.variants.map(({ flavor, assets }) => [
                flavor,
                assets.map(
                    ({ name, platform, architecture, downloadUrl, digest }) =>
                        [
                            name,
                            platform,
                            architecture,
                            downloadUrl.startsWith(
                                'https://api.github.com/repos/example/godot-fork/releases/assets/',
                            ),
                            digest,
                        ].join(' '),
                ),
            ]),
        ).toEqual([
            [
                'gdscript',
                [
                    `Godot_v4.3-stable_linux.x86_64.zip linux x64 true ${GENERIC_DIGEST}`,
                    `Godot_v4.3-stable_linux.arm64.zip linux arm64 true ${GENERIC_DIGEST}`,
                    `Godot_v4.3-stable_win64.exe.zip win32 x64 true ${GENERIC_DIGEST}`,
                    `Godot_v4.3-stable_macos.universal.zip darwin x64 true ${GENERIC_DIGEST}`,
                    `Godot_v4.3-stable_macos.universal.zip darwin arm64 true ${GENERIC_DIGEST}`,
                ],
            ],
            [
                'dotnet',
                [
                    `Godot_v4.3-stable_mono_linux_x86_64.zip linux x64 true ${GENERIC_DIGEST}`,
                    `Godot_v4.3-stable_mono_win64.zip win32 x64 true ${GENERIC_DIGEST}`,
                ],
            ],
        ]);
        expect(
            mappedRelease?.templateAssets?.map(
                ({ name, flavor, templateIdentity }) => [
                    name,
                    flavor,
                    templateIdentity,
                ],
            ),
        ).toEqual([
            [
                'Godot_v4.3-stable_export_templates.tpz',
                'gdscript',
                '4.3.stable',
            ],
            [
                'Godot_v4.3-stable_mono_export_templates.tpz',
                'dotnet',
                '4.3.stable.mono',
            ],
        ]);
    });

    it('uses a commit target_commitish without a tag lookup', () => {
        const release = genericRelease('4.3-stable', OFFICIAL_STYLE_ASSETS, {
            targetCommitish: GENERIC_REVISION,
        });

        expect(needsForkTagRevision(release)).toBe(false);
        const mapped = mapForkRelease(
            GENERIC_SOURCE,
            release,
            new Map(),
            NO_TAG_REVISIONS,
        );
        expect(mapped.ok && mapped.release.fork?.revision).toBe(
            GENERIC_REVISION,
        );
    });

    it('asks for the tag commit when the target is a branch, and skips the release without it', () => {
        const release = genericRelease('4.3-stable', OFFICIAL_STYLE_ASSETS);

        expect(needsForkTagRevision(release)).toBe(true);
        expect(
            mapForkRelease(
                GENERIC_SOURCE,
                release,
                new Map(),
                NO_TAG_REVISIONS,
            ),
        ).toEqual({ ok: false, reason: 'tag commit unavailable' });
    });

    it('labels a release whose tag has no version with its tag and the archive version', () => {
        const release = genericRelease(
            'nightly-2026-10-01',
            [
                'Godot_v4.4.1-rc2_linux.x86_64.zip',
                'Godot_v4.4.1-rc2_mono_export_templates.tpz',
            ],
            { targetCommitish: GENERIC_REVISION },
        );

        const mapped = mapForkRelease(
            GENERIC_SOURCE,
            release,
            new Map(),
            NO_TAG_REVISIONS,
        );

        expect(mapped.ok).toBe(true);
        expect(mapped.ok && mapped.release).toMatchObject({
            tag: 'nightly-2026-10-01',
            version: '4.4.1.rc2.nightly-2026-10-01',
            baseVersion: '4.4',
            prerelease: true,
            versionParts: {
                major: 4,
                minor: 4,
                patch: 1,
                channel: 'rc',
                iteration: 2,
            },
            templateAssets: [
                expect.objectContaining({
                    flavor: 'dotnet',
                    templateIdentity: '4.4.1.rc2.mono',
                }),
            ],
        });
    });

    it('skips a release with only unsupported assets', () => {
        const release = genericRelease('4.3-stable', [
            'Godot_v4.3-stable_android_editor.apk',
            'Godot_v4.3-stable_web_editor.zip',
            'Godot_v4.3-stable_linux.x86_64.tar.xz',
            'Godot_v4.3-stable_freebsd.x86_64.zip',
            'Godot_v4.3-stable_export_templates.tpz',
            'godot-4.3-stable.tar.xz',
        ]);

        expect(needsForkTagRevision(release)).toBe(false);
        expect(
            mapForkRelease(
                GENERIC_SOURCE,
                release,
                new Map(),
                new Map([['4.3-stable', GENERIC_REVISION]]),
            ),
        ).toEqual({
            ok: false,
            reason: 'no build manifest and no editor archive for a supported platform',
        });
    });

    it('skips editor archives without a GitHub digest', () => {
        const release = genericRelease('4.3-stable', OFFICIAL_STYLE_ASSETS, {
            targetCommitish: GENERIC_REVISION,
        });

        expect(
            mapForkRelease(
                GENERIC_SOURCE,
                {
                    ...release,
                    assets: release.assets.map((asset) => ({
                        ...asset,
                        digest: null,
                    })),
                },
                new Map(),
                NO_TAG_REVISIONS,
            ),
        ).toEqual({
            ok: false,
            reason: 'editor archives have no GitHub SHA-256 digest',
        });
    });

    it('skips engine versions older than Godot 4', () => {
        const release = genericRelease(
            'v0.6.927',
            ['BlaziumEditor_v0.6.927_linux.x86_64.zip'],
            { targetCommitish: GENERIC_REVISION },
        );

        expect(
            mapForkRelease(
                GENERIC_SOURCE,
                release,
                new Map(),
                NO_TAG_REVISIONS,
            ),
        ).toEqual({
            ok: false,
            reason: 'unsupported engine version 0.6.927.stable',
        });
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
