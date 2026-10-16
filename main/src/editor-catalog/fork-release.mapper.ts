import type {
    EditorCatalogArchitecture,
    EditorCatalogAsset,
    EditorCatalogFlavor,
    EditorCatalogPlatform,
    EditorCatalogRelease,
    EngineSource,
    ExportTemplateAsset,
} from '@shared/contracts';
import { z } from 'zod';
import { normalizeGithubAssetDigest } from '../utils/archive-integrity.util.js';
import { getEngineVersionTemplateIdentity } from '../utils/template-identity.util.js';
import {
    EDITOR_CATALOG_MIN_VERSION,
    FORK_MANIFEST_SCHEMA,
} from './editor-catalog.constants.js';
import type {
    GithubEditorAsset,
    GithubEditorRelease,
} from './editor-catalog.types.js';

const Sha40Schema = z.string().regex(/^[0-9a-f]{40}$/);

/** Fields of a fork build manifest used by the catalog. */
export const ForkManifestSchema = z.object({
    schema: z.literal(FORK_MANIFEST_SCHEMA),
    version: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9._+-]+$/),
    revision: Sha40Schema,
    upstreamBase: Sha40Schema,
    platform: z.string().min(1),
    arch: z.string().min(1),
    mono: z.boolean(),
});

/** Parsed fork build manifest. */
export type ForkManifest = z.infer<typeof ForkManifestSchema>;

/**
 * Anchored fork asset suffix. Anchoring on the full suffix avoids treating
 * digits inside a revision hash (for example `32`) as an architecture.
 */
const FORK_ASSET_PATTERN =
    /^(.+)-(linux|windows|macos)-(x86_64|arm64|x86_32|universal)-(mono|standard)-(editor\.(?:tar\.gz|zip)|templates\.tpz|manifest\.json)$/;

const PLATFORMS: Record<string, EditorCatalogPlatform> = {
    linux: 'linux',
    windows: 'win32',
    macos: 'darwin',
};

const ARCHITECTURES: Record<string, EditorCatalogArchitecture[]> = {
    x86_64: ['x64'],
    arm64: ['arm64'],
    x86_32: ['ia32'],
    universal: ['x64', 'arm64'],
};

/** Godot platform names written by engine builds, mapped to asset names. */
const GODOT_PLATFORM_NAMES: Record<string, string> = {
    linuxbsd: 'linux',
    linux: 'linux',
    x11: 'linux',
    windows: 'windows',
    macos: 'macos',
    osx: 'macos',
};

/** Target and role encoded in one fork asset name. */
export type ForkAssetName = {
    stem: string;
    platform: 'linux' | 'windows' | 'macos';
    arch: 'x86_64' | 'arm64' | 'x86_32' | 'universal';
    flavor: 'mono' | 'standard';
    kind: 'editor' | 'templates' | 'manifest';
};

/** Outcome of mapping one fork release. */
export type ForkReleaseMapping =
    | { ok: true; release: EditorCatalogRelease }
    | { ok: false; reason: string };

/**
 * Reads the target and role from a fork asset name.
 *
 * @param name - GitHub asset file name.
 * @returns The parsed name, or null when it does not use the fork layout.
 */
export function parseForkAssetName(name: string): ForkAssetName | null {
    const match = name.match(FORK_ASSET_PATTERN);
    if (!match) {
        return null;
    }
    return {
        stem: match[1],
        platform: match[2] as ForkAssetName['platform'],
        arch: match[3] as ForkAssetName['arch'],
        flavor: match[4] as ForkAssetName['flavor'],
        kind: match[5].startsWith('editor')
            ? 'editor'
            : match[5] === 'templates.tpz'
              ? 'templates'
              : 'manifest',
    };
}

/**
 * Maps a Godot platform name such as `linuxbsd` to the fork asset name.
 *
 * @param platform - Platform written in the build manifest.
 * @returns The asset platform name, or undefined when unknown.
 */
export function mapGodotPlatformName(platform: string): string | undefined {
    return GODOT_PLATFORM_NAMES[platform.toLowerCase()];
}

/**
 * Lists the manifest assets of one release.
 *
 * @param release - GitHub release.
 * @returns Assets whose names follow the fork manifest layout.
 */
export function findForkManifestAssets(
    release: GithubEditorRelease,
): GithubEditorAsset[] {
    return release.assets.filter(
        (asset) => parseForkAssetName(asset.name)?.kind === 'manifest',
    );
}

/**
 * Reads catalog version parts from a Godot engine version string such as
 * `4.7.2.stable.mono.custom_build.b90e2049e`.
 *
 * @param version - Engine version from a build manifest.
 * @returns Version parts, or null when the version is not a Godot version.
 */
export function parseForkEngineVersion(
    version: string,
): EditorCatalogRelease['versionParts'] | null {
    const match = version.match(
        /^(\d+)\.(\d+)(?:\.(\d+))?\.([a-z]+)(\d*)(?:\.|$)/,
    );
    if (!match) {
        return null;
    }
    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: match[3] ? Number.parseInt(match[3], 10) : 0,
        channel: match[4],
        iteration: match[5] ? Number.parseInt(match[5], 10) : 0,
    };
}

/** One manifest-backed editor build inside a release. */
type ForkBuild = {
    manifest: ForkManifest;
    target: ForkAssetName;
    editor: GithubEditorAsset;
    templates?: GithubEditorAsset;
};

/**
 * Converts one fork GitHub release into a catalog release using its build
 * manifests. Releases without a usable manifest are skipped.
 *
 * @param source - Fork source that published the release.
 * @param release - GitHub release.
 * @param manifests - Parsed manifests by GitHub asset ID.
 * @returns The catalog release, or the reason it was skipped.
 */
export function mapForkRelease(
    source: EngineSource,
    release: GithubEditorRelease,
    manifests: ReadonlyMap<number, ForkManifest>,
): ForkReleaseMapping {
    if (release.draft || !release.tagName.trim()) {
        return { ok: false, reason: 'draft or untagged release' };
    }
    const manifestAssets = findForkManifestAssets(release);
    if (manifestAssets.length === 0) {
        return { ok: false, reason: 'no build manifest asset' };
    }

    const builds: ForkBuild[] = [];
    const problems: string[] = [];
    for (const asset of manifestAssets) {
        const target = parseForkAssetName(asset.name) as ForkAssetName;
        const manifest = manifests.get(asset.id);
        if (!manifest) {
            problems.push(`${asset.name}: manifest unavailable`);
            continue;
        }
        if (
            mapGodotPlatformName(manifest.platform) !== target.platform ||
            manifest.arch !== target.arch ||
            manifest.mono !== (target.flavor === 'mono')
        ) {
            problems.push(`${asset.name}: manifest target does not match`);
            continue;
        }
        const sibling = (kind: ForkAssetName['kind']) =>
            release.assets.find((candidate) => {
                const parsed = parseForkAssetName(candidate.name);
                return (
                    parsed?.kind === kind &&
                    parsed.stem === target.stem &&
                    parsed.platform === target.platform &&
                    parsed.arch === target.arch &&
                    parsed.flavor === target.flavor &&
                    candidate.apiUrl !== undefined
                );
            });
        const editor = sibling('editor');
        if (!editor) {
            problems.push(`${asset.name}: no editor archive`);
            continue;
        }
        builds.push({
            manifest,
            target,
            editor,
            templates: sibling('templates'),
        });
    }

    if (builds.length === 0) {
        return {
            ok: false,
            reason: `no usable build (${problems.join('; ')})`,
        };
    }
    const [{ manifest }] = builds;
    if (
        builds.some(
            (build) =>
                build.manifest.revision !== manifest.revision ||
                build.manifest.version !== manifest.version ||
                build.manifest.upstreamBase !== manifest.upstreamBase,
        )
    ) {
        return { ok: false, reason: 'manifests disagree on the engine build' };
    }
    const versionParts = parseForkEngineVersion(manifest.version);
    if (!versionParts || versionParts.major < EDITOR_CATALOG_MIN_VERSION) {
        return {
            ok: false,
            reason: `unsupported engine version ${manifest.version}`,
        };
    }

    const releaseId = `${source.id}:${release.tagName}`;
    const assetsByFlavor = new Map<EditorCatalogFlavor, EditorCatalogAsset[]>();
    const templateAssets: ExportTemplateAsset[] = [];
    for (const build of builds) {
        const flavor: EditorCatalogFlavor =
            build.target.flavor === 'mono' ? 'dotnet' : 'gdscript';
        const digest = normalizeGithubAssetDigest(build.editor.digest);
        const assets = assetsByFlavor.get(flavor) ?? [];
        for (const architecture of ARCHITECTURES[build.target.arch]) {
            const platform = PLATFORMS[build.target.platform];
            assets.push({
                id: `${releaseId}:${flavor}:${build.editor.id}:${platform}:${architecture}`,
                name: build.editor.name,
                downloadUrl: build.editor.apiUrl as string,
                ...(digest ? { digest } : {}),
                platform,
                architecture,
            });
        }
        assetsByFlavor.set(flavor, assets);

        const templateIdentity = getEngineVersionTemplateIdentity(
            manifest.version,
            flavor === 'dotnet',
        );
        if (build.templates && templateIdentity) {
            const templateDigest = normalizeGithubAssetDigest(
                build.templates.digest,
            );
            templateAssets.push({
                id: `${releaseId}:templates:${build.templates.id}`,
                name: build.templates.name,
                flavor,
                downloadUrl: build.templates.apiUrl as string,
                sizeBytes: build.templates.size ?? 0,
                ...(templateDigest ? { digest: templateDigest } : {}),
                templateIdentity,
            });
        }
    }

    return {
        ok: true,
        release: {
            id: releaseId,
            sourceReleaseId: String(release.id),
            providerId: source.id,
            tag: release.tagName,
            version: manifest.version,
            baseVersion: `${versionParts.major}.${versionParts.minor}`,
            name: release.name?.trim() || release.tagName,
            publishedAt: normalizePublishedAt(release.publishedAt),
            prerelease: release.prerelease || versionParts.channel !== 'stable',
            versionParts,
            variants: [...assetsByFlavor.entries()].map(([flavor, assets]) => ({
                id: `${releaseId}:${flavor}`,
                flavor,
                assets,
            })),
            ...(templateAssets.length > 0 ? { templateAssets } : {}),
            fork: {
                sourceId: source.id,
                source: `${source.owner}/${source.repo}`,
                revision: manifest.revision,
                upstreamBase: manifest.upstreamBase,
            },
        },
    };
}

/**
 * Converts a publication time into a valid ISO value.
 *
 * @param value - The publication time to normalize.
 * @returns The ISO time, or null when the value is missing or invalid.
 */
function normalizePublishedAt(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
