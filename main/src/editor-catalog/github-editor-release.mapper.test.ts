import { describe, expect, it } from 'vitest';
import type { GithubEditorRelease } from './editor-catalog.types.js';
import {
    findEditorVersion,
    mapGithubEditorRelease,
    parseEditorAssetName,
    parseEditorVersion,
} from './github-editor-release.mapper.js';

describe('github editor release mapper', () => {
    it('groups supported assets by flavor and target', () => {
        const release = mapGithubEditorRelease(
            'official-stable',
            false,
            createGithubRelease(),
        );

        expect(release).toMatchObject({
            id: 'official-stable:4.5-stable',
            baseVersion: '4.5',
            prerelease: false,
            versionParts: {
                major: 4,
                minor: 5,
                patch: 0,
                channel: 'stable',
                iteration: 0,
            },
        });
        expect(release?.variants).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    flavor: 'gdscript',
                    assets: expect.arrayContaining([
                        expect.objectContaining({
                            platform: 'win32',
                            architecture: 'x64',
                            digest: `sha256:${'a'.repeat(64)}`,
                            checksumManifestUrl:
                                'https://example.com/SHA512-SUMS.txt',
                        }),
                        expect.objectContaining({
                            platform: 'darwin',
                            architecture: 'arm64',
                        }),
                    ]),
                }),
                expect.objectContaining({
                    flavor: 'dotnet',
                    assets: [
                        expect.objectContaining({
                            platform: 'linux',
                            architecture: 'x64',
                        }),
                    ],
                }),
            ]),
        );
    });

    it('rejects old, invalid, draft, and assetless releases', () => {
        const base = createGithubRelease();

        expect(
            mapGithubEditorRelease('official-stable', false, {
                ...base,
                tagName: '3.6-stable',
            }),
        ).toBeNull();
        expect(
            mapGithubEditorRelease('official-stable', false, {
                ...base,
                draft: true,
            }),
        ).toBeNull();
        expect(
            mapGithubEditorRelease('official-stable', false, {
                ...base,
                assets: [],
            }),
        ).toBeNull();
    });

    it('keeps complete template packages separate from editor binaries with integrity and size metadata', () => {
        const base = createGithubRelease();
        const release = mapGithubEditorRelease('official-stable', false, {
            ...base,
            assets: [
                ...base.assets,
                ...['', '_mono'].map((edition, index) => ({
                    id: 100 + index,
                    name: `Godot_v4.5-stable${edition}_export_templates.tpz`,
                    browserDownloadUrl: `https://example.com/templates-${index}.tpz`,
                    size: 1024 + index,
                    digest: `sha256:${'a'.repeat(64)}`,
                })),
            ],
        });
        expect(release?.templateAssets).toEqual([
            expect.objectContaining({
                flavor: 'gdscript',
                sizeBytes: 1024,
                digest: `sha256:${'a'.repeat(64)}`,
                checksumManifestUrl: 'https://example.com/SHA512-SUMS.txt',
            }),
            expect.objectContaining({ flavor: 'dotnet', sizeBytes: 1025 }),
        ]);
        expect(
            release?.variants
                .flatMap((variant) => variant.assets)
                .some((asset) => asset.name.endsWith('.tpz')),
        ).toBe(false);
    });

    it('parses supported release channels', () => {
        expect(parseEditorVersion('v4.6-rc2')).toEqual({
            major: 4,
            minor: 6,
            patch: 0,
            channel: 'rc',
            iteration: 2,
        });
        expect(parseEditorVersion('not-a-version')).toBeNull();
    });

    it('classifies releases by their tag channel instead of the provider', () => {
        const stableFromPrereleaseProvider = mapGithubEditorRelease(
            'official-prerelease',
            true,
            {
                ...createGithubRelease(),
                prerelease: true,
            },
        );
        const betaFromStableProvider = mapGithubEditorRelease(
            'official-stable',
            false,
            {
                ...createGithubRelease(),
                tagName: '4.6-beta1',
                prerelease: false,
            },
        );

        expect(stableFromPrereleaseProvider?.prerelease).toBe(false);
        expect(betaFromStableProvider?.prerelease).toBe(true);
    });
});

describe('parseEditorAssetName', () => {
    it.each([
        ['Godot_v4.3-stable_linux.x86_64.zip', 'linux', ['x64'], 'gdscript'],
        ['Godot_v4.3-stable_linux.x86_32.zip', 'linux', ['ia32'], 'gdscript'],
        ['Godot_v4.3-stable_linux.arm64.zip', 'linux', ['arm64'], 'gdscript'],
        ['Godot_v4.3-stable_linux.arm32.zip', 'linux', ['arm'], 'gdscript'],
        ['Godot_v4.3-stable_mono_linux_x86_64.zip', 'linux', ['x64'], 'dotnet'],
        ['Godot_v4.3-stable_win64.exe.zip', 'win32', ['x64'], 'gdscript'],
        ['Godot_v4.3-stable_win32.exe.zip', 'win32', ['ia32'], 'gdscript'],
        [
            'Godot_v4.3-stable_windows_arm64.exe.zip',
            'win32',
            ['arm64'],
            'gdscript',
        ],
        ['Godot_v4.3-stable_mono_win64.zip', 'win32', ['x64'], 'dotnet'],
        [
            'Godot_v4.3-stable_macos.universal.zip',
            'darwin',
            ['x64', 'arm64'],
            'gdscript',
        ],
        ['Godot_v4.0-alpha1_linux.64.zip', 'linux', ['x64'], 'gdscript'],
        ['Redot_v26.3-stable_linux_mono_x64.zip', 'linux', ['x64'], 'dotnet'],
        [
            'Redot_v26.3-stable_windows_mono_win64.zip',
            'win32',
            ['x64'],
            'dotnet',
        ],
        [
            'BlaziumEditor_v0.6.927_windows.32bit.zip',
            'win32',
            ['ia32'],
            'gdscript',
        ],
        [
            'godot-fork-b90e2049efff97732d8dffa8af3f4ea48fb140d9_linux.x86_64.tar.gz',
            'linux',
            ['x64'],
            'gdscript',
        ],
    ])('reads %s', (name, platform, architectures, flavor) => {
        expect(parseEditorAssetName(name)).toEqual({
            platform,
            architectures,
            flavor,
        });
    });

    it('does not read architecture digits inside a revision hash', () => {
        expect(
            parseEditorAssetName(
                'godot-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux.zip',
            ),
        ).toBeNull();
    });

    it.each([
        'Godot_v4.3-stable_linux.x86_64.tar.xz',
        'Godot_v4.3-stable_android_editor.apk',
        'Godot_v4.3-stable_web_editor.zip',
        'Godot_v4.3-stable_export_templates.tpz',
        'Godot_v4.8-beta1_debugsymbols_linux_debug.x86_64.zip',
        'Godot_v4.8-beta1_macos.arm64.dSYM.zip',
        'Godot_v4.3-stable_freebsd.x86_64.zip',
        'godot-4.3-stable.tar.xz',
    ])('rejects %s', (name) => {
        expect(parseEditorAssetName(name)).toBeNull();
    });
});

describe('findEditorVersion', () => {
    it.each([
        ['4.3-stable', [4, 3, 0, 'stable', 0]],
        ['v4.4.1-stable', [4, 4, 1, 'stable', 0]],
        ['Godot_v4.3-stable_mono_linux_x86_64.zip', [4, 3, 0, 'stable', 0]],
        ['redot-26.3-rc.3', [26, 3, 0, 'rc', 3]],
        ['Godot_v4.5-dev2_win64.exe.zip', [4, 5, 0, 'dev', 2]],
    ])('reads %s', (text, [major, minor, patch, channel, iteration]) => {
        expect(findEditorVersion(text)).toEqual({
            major,
            minor,
            patch,
            channel,
            iteration,
        });
    });

    it.each([
        'native-attenuation-9301bad',
        'godot-b90e2049efff97732d8dffa8af3f4ea48fb140d9-linux.zip',
        'nightly',
    ])('finds no version in %s', (text) => {
        expect(findEditorVersion(text)).toBeNull();
    });
});

function createGithubRelease(): GithubEditorRelease {
    return {
        id: 45,
        name: 'Godot 4.5',
        tagName: '4.5-stable',
        publishedAt: '2026-01-01T00:00:00.000Z',
        draft: false,
        prerelease: false,
        assets: [
            {
                id: 1,
                name: 'Godot_v4.5-stable_win64.exe.zip',
                browserDownloadUrl: 'https://example.com/windows.zip',
                digest: `SHA256:${'A'.repeat(64)}`,
            },
            {
                id: 2,
                name: 'Godot_v4.5-stable_macos.universal.zip',
                browserDownloadUrl: 'https://example.com/macos.zip',
                digest: null,
            },
            {
                id: 3,
                name: 'Godot_v4.5-stable_mono_linux.x86_64.zip',
                browserDownloadUrl: 'https://example.com/linux-dotnet.zip',
                digest: null,
            },
            {
                id: 4,
                name: 'Godot_v4.5-stable_web_editor.zip',
                browserDownloadUrl: 'https://example.com/web.zip',
                digest: 'sha256:not-a-digest',
            },
            {
                id: 5,
                name: 'SHA512-SUMS.txt',
                browserDownloadUrl: 'https://example.com/SHA512-SUMS.txt',
                digest: null,
            },
        ],
    };
}
