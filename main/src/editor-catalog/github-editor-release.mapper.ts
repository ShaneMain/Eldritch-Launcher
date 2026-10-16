import type {
    EditorCatalogArchitecture,
    EditorCatalogAsset,
    EditorCatalogFlavor,
    EditorCatalogPlatform,
    EditorCatalogProviderId,
    EditorCatalogRelease,
} from '@shared/contracts';
import { normalizeGithubAssetDigest } from '../utils/archive-integrity.util.js';
import { EDITOR_CATALOG_MIN_VERSION } from './editor-catalog.constants.js';
import type {
    GithubEditorAsset,
    GithubEditorRelease,
} from './editor-catalog.types.js';

/** Platform, architectures, and edition read from an editor archive name. */
export type EditorAssetTarget = {
    platform: EditorCatalogPlatform;
    architectures: EditorCatalogArchitecture[];
    flavor: EditorCatalogFlavor;
};

/** Editor archive formats the launcher can extract. */
const EDITOR_ARCHIVE_EXTENSION = /\.(?:zip|tar\.gz)$/i;

/** Export template archive suffix used by Godot releases. */
const EXPORT_TEMPLATES_PATTERN = /[._-]export[._-]templates\.tpz$/i;

/** Name parts of release archives that are not editors. */
const NON_EDITOR_TOKENS = [
    'template',
    'templates',
    'symbols',
    'debugsymbols',
    'dsym',
    'web',
];

/** Godot version text, such as `4.3`, `4.4.1-stable`, or `4.5-rc.2`. */
const VERSION_PATTERN = String.raw`(\d+)\.(\d+)(?:\.(\d+))?(?:-(stable|rc|beta|alpha|dev)\.?(\d+)?)?`;
const EXACT_VERSION = new RegExp(`^v?${VERSION_PATTERN}$`, 'i');
const EMBEDDED_VERSION = new RegExp(
    `(?:^|[^0-9A-Za-z.])v?${VERSION_PATTERN}(?![0-9A-Za-z])`,
    'i',
);

/**
 * Converts one GitHub release into a catalog release.
 *
 * @param providerId - The provider that supplied the release.
 * @param _providerPrerelease - Provider channel metadata retained for the adapter boundary.
 * @param release - The GitHub release to convert.
 * @returns A catalog release, or null when the release is unsupported.
 */
export function mapGithubEditorRelease(
    providerId: EditorCatalogProviderId,
    _providerPrerelease: boolean,
    release: GithubEditorRelease,
): EditorCatalogRelease | null {
    if (release.draft || !release.tagName.trim()) {
        return null;
    }

    const versionParts = parseEditorVersion(release.tagName);
    if (!versionParts || versionParts.major < EDITOR_CATALOG_MIN_VERSION) {
        return null;
    }

    const releaseId = `${providerId}:${release.tagName}`;
    const checksumManifestUrl = release.assets.find(
        (asset) => asset.name === 'SHA512-SUMS.txt',
    )?.browserDownloadUrl;
    const assetsByFlavor = Map.groupBy(
        release.assets.flatMap((asset) =>
            mapGithubAsset(releaseId, asset, checksumManifestUrl),
        ),
        ({ flavor }) => flavor,
    );
    const variants = (
        [...assetsByFlavor.entries()] as Array<
            [
                EditorCatalogFlavor,
                Array<{
                    flavor: EditorCatalogFlavor;
                    asset: EditorCatalogAsset;
                }>,
            ]
        >
    ).map(([flavor, entries]) => ({
        id: `${releaseId}:${flavor}`,
        flavor,
        assets: entries.map(({ asset }) => asset),
    }));

    if (variants.length === 0) {
        return null;
    }

    return {
        id: releaseId,
        sourceReleaseId: String(release.id),
        providerId,
        tag: release.tagName,
        version: release.tagName,
        baseVersion: `${versionParts.major}.${versionParts.minor}`,
        name: release.name?.trim() || release.tagName,
        publishedAt: normalizePublishedAt(release.publishedAt),
        prerelease: versionParts.channel !== 'stable',
        versionParts,
        variants,
        templateAssets: release.assets
            .filter((asset) => isExportTemplatesAssetName(asset.name))
            .map((asset) => ({
                id: `${releaseId}:templates:${asset.id}`,
                name: asset.name,
                flavor: getExportTemplatesFlavor(asset.name),
                downloadUrl: asset.browserDownloadUrl,
                sizeBytes: asset.size ?? 0,
                digest: normalizeGithubAssetDigest(asset.digest),
                checksumManifestUrl,
            })),
    };
}

/**
 * Reads version parts from a Godot editor tag.
 *
 * @param version - The editor version or tag to read.
 * @returns Parsed version parts, or null when the value is invalid.
 */
export function parseEditorVersion(
    version: string,
): EditorCatalogRelease['versionParts'] | null {
    return toVersionParts(version.trim().match(EXACT_VERSION));
}

/**
 * Finds a Godot version inside a longer name such as a fork tag
 * (`redot-26.3-rc.3`) or an editor archive
 * (`Godot_v4.3-stable_mono_linux_x86_64.zip`). The version must stand
 * alone between separators, so digits inside a commit hash are ignored.
 *
 * @param text - Tag or asset name to search.
 * @returns Parsed version parts, or null when no version is present.
 */
export function findEditorVersion(
    text: string,
): EditorCatalogRelease['versionParts'] | null {
    return toVersionParts(
        text.replace(EDITOR_ARCHIVE_EXTENSION, '').match(EMBEDDED_VERSION),
    );
}

/**
 * Converts a version pattern match into catalog version parts.
 *
 * @param match - Match of {@link VERSION_PATTERN}, or null.
 * @returns Parsed version parts, or null without a match.
 */
function toVersionParts(
    match: RegExpMatchArray | null,
): EditorCatalogRelease['versionParts'] | null {
    if (!match) {
        return null;
    }
    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: match[3] ? Number.parseInt(match[3], 10) : 0,
        channel: match[4]?.toLowerCase() ?? 'stable',
        iteration: match[5] ? Number.parseInt(match[5], 10) : 0,
    };
}

/**
 * Checks whether an asset is a Godot export template archive.
 *
 * @param name - The GitHub asset file name.
 * @returns Whether the asset holds export templates.
 */
export function isExportTemplatesAssetName(name: string): boolean {
    return EXPORT_TEMPLATES_PATTERN.test(name);
}

/**
 * Reads the edition of an export template archive.
 *
 * @param name - The export template asset file name.
 * @returns `dotnet` for .NET templates, otherwise `gdscript`.
 */
export function getExportTemplatesFlavor(name: string): EditorCatalogFlavor {
    return hasToken(name, ['mono']) ? 'dotnet' : 'gdscript';
}

/**
 * Reads the target of a Godot editor archive from its name, using the
 * naming of official Godot releases (`Godot_v4.3-stable_linux.x86_64.zip`,
 * `Godot_v4.3-stable_mono_win64.zip`, `Godot_v4.3-stable_macos.universal.zip`)
 * and close variants used by forks (`Redot_v26.3-stable_linux_mono_x64.zip`).
 * Platform, architecture, and `mono` are only read as whole name parts
 * between `.`, `_`, or `-`, so digits inside a commit hash such as `97732d8`
 * are never taken as an architecture.
 *
 * @param name - The GitHub asset file name.
 * @returns The editor target, or null when the asset is not an editor archive
 * for a supported platform and archive format.
 */
export function parseEditorAssetName(name: string): EditorAssetTarget | null {
    if (!EDITOR_ARCHIVE_EXTENSION.test(name)) {
        return null;
    }
    const stem = name.replace(EDITOR_ARCHIVE_EXTENSION, '');
    if (hasToken(stem, NON_EDITOR_TOKENS)) {
        return null;
    }

    const platforms = (
        Object.entries(PLATFORM_TOKENS) as Array<
            [EditorCatalogPlatform, string[]]
        >
    ).filter(([, tokens]) => hasToken(stem, tokens));
    if (platforms.length !== 1) {
        return null;
    }
    const [[platform]] = platforms;
    const architectures = getArchitectures(stem, platform);
    if (!architectures) {
        return null;
    }
    return {
        platform,
        architectures,
        flavor: hasToken(stem, ['mono']) ? 'dotnet' : 'gdscript',
    };
}

/** Name parts that identify each desktop platform. */
const PLATFORM_TOKENS: Record<EditorCatalogPlatform, string[]> = {
    win32: ['windows', 'win64', 'win32'],
    darwin: ['macos', 'osx'],
    linux: ['linux', 'linuxbsd', 'x11'],
};

/**
 * Reads the architectures of an editor archive name, in priority order.
 *
 * @param stem - Asset name without the archive extension.
 * @param platform - Platform already read from the name.
 * @returns Supported architectures, or null when none is named.
 */
function getArchitectures(
    stem: string,
    platform: EditorCatalogPlatform,
): EditorCatalogArchitecture[] | null {
    if (hasToken(stem, ['universal'])) {
        return platform === 'darwin' ? ['x64', 'arm64'] : null;
    }
    if (hasToken(stem, ['arm64', 'aarch64'])) {
        return ['arm64'];
    }
    if (hasToken(stem, ['arm32', 'armv7', 'armhf'])) {
        return platform === 'linux' ? ['arm'] : null;
    }
    if (
        hasToken(stem, [
            'x86_64',
            'x86-64',
            'x64',
            'amd64',
            'win64',
            '64bit',
            '64',
        ])
    ) {
        return ['x64'];
    }
    if (
        hasToken(stem, [
            'x86_32',
            'x86-32',
            'i686',
            'ia32',
            'win32',
            '32bit',
            '32',
        ])
    ) {
        return platform === 'darwin' ? null : ['ia32'];
    }
    return platform === 'darwin' ? ['x64', 'arm64'] : null;
}

/**
 * Checks whether a name contains one of the tokens as a whole part between
 * `.`, `_`, `-`, or the start and end of the name.
 *
 * @param name - Name to search.
 * @param tokens - Lowercase tokens without regular expression characters.
 * @returns Whether any token is present as a whole part.
 */
function hasToken(name: string, tokens: readonly string[]): boolean {
    return new RegExp(
        `(?:^|[._-])(?:${tokens.join('|')})(?=$|[._-])`,
        'i',
    ).test(name);
}

/**
 * Converts one GitHub asset into catalog assets.
 *
 * @param releaseId - The catalog ID of the parent release.
 * @param source - The GitHub asset to convert.
 * @param checksumManifestUrl - The release checksum manifest URL, when present.
 * @returns Catalog assets for each supported architecture.
 */
function mapGithubAsset(
    releaseId: string,
    source: GithubEditorAsset,
    checksumManifestUrl?: string,
): Array<{ flavor: EditorCatalogFlavor; asset: EditorCatalogAsset }> {
    const target = parseEditorAssetName(source.name);
    if (!target) {
        return [];
    }

    const { flavor } = target;
    const digest = normalizeGithubAssetDigest(source.digest);
    return target.architectures.map((architecture) => ({
        flavor,
        asset: {
            id: `${releaseId}:${flavor}:${source.id}:${target.platform}:${architecture}`,
            name: source.name,
            downloadUrl: source.browserDownloadUrl,
            ...(digest ? { digest } : {}),
            ...(checksumManifestUrl ? { checksumManifestUrl } : {}),
            platform: target.platform,
            architecture,
        },
    }));
}

/**
 * Converts a publication time into a valid ISO value.
 *
 * @param value - The publication time to normalize.
 * @returns The ISO time, or null when the value is missing or invalid.
 */
export function normalizePublishedAt(value: string | null): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
