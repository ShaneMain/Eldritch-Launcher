import { z } from 'zod';
import {
    EDITOR_CATALOG_SCHEMA_VERSION,
    OFFICIAL_ENGINE_SOURCE_IDS,
} from './editor-catalog.constants.js';
import type {
    EditorCatalogFile,
    EditorCatalogProviderState,
} from './editor-catalog.types.js';

const EditorCatalogProviderIdSchema = z.string().min(1);
const Sha40Schema = z.string().regex(/^[0-9a-f]{40}$/);
const EditorCatalogFlavorSchema = z.enum(['gdscript', 'dotnet']);
const EditorCatalogPlatformSchema = z.enum(['win32', 'darwin', 'linux']);
const EditorCatalogArchitectureSchema = z.enum(['x64', 'arm64', 'ia32', 'arm']);

const EditorCatalogAssetSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    downloadUrl: z.url(),
    digest: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional(),
    checksumManifestUrl: z.url().optional(),
    platform: EditorCatalogPlatformSchema,
    architecture: EditorCatalogArchitectureSchema,
});

const EditorCatalogVariantSchema = z.object({
    id: z.string().min(1),
    flavor: EditorCatalogFlavorSchema,
    assets: z.array(EditorCatalogAssetSchema).min(1),
});

/** Checks the stored shape of one catalog release. */
export const EditorCatalogReleaseSchema = z.object({
    id: z.string().min(1),
    sourceReleaseId: z.string().min(1),
    providerId: EditorCatalogProviderIdSchema,
    tag: z.string().min(1),
    version: z.string().min(1),
    baseVersion: z.string().min(1),
    name: z.string().min(1),
    publishedAt: z.iso.datetime().nullable(),
    prerelease: z.boolean(),
    versionParts: z.object({
        major: z.number().int().nonnegative(),
        minor: z.number().int().nonnegative(),
        patch: z.number().int().nonnegative(),
        channel: z.string().min(1),
        iteration: z.number().int().nonnegative(),
    }),
    variants: z.array(EditorCatalogVariantSchema).min(1),
    templateAssets: z
        .array(
            z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                flavor: EditorCatalogFlavorSchema,
                downloadUrl: z.url(),
                sizeBytes: z.number().nonnegative(),
                digest: z.string().optional(),
                checksumManifestUrl: z.url().optional(),
                templateIdentity: z.string().min(1).optional(),
            }),
        )
        .optional(),
    fork: z
        .object({
            sourceId: EditorCatalogProviderIdSchema,
            source: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
            revision: Sha40Schema,
            upstreamBase: Sha40Schema.optional(),
        })
        .optional(),
});

const EditorCatalogProviderStateSchema = z.object({
    integrityMetadataRefreshed: z.boolean().optional().default(false),
    templateMetadataRefreshed: z.boolean().optional().default(false),
    lastFetchedAt: z.number().int().nonnegative().nullable(),
    lastPublishedAt: z.iso.datetime().nullable(),
    lastFailure: z
        .object({
            state: z.enum(['auth-required', 'error']),
            message: z.string(),
        })
        .optional(),
    releases: z.array(EditorCatalogReleaseSchema),
});

/** Checks the full stored catalog file. */
export const EditorCatalogFileSchema = z.object({
    schemaVersion: z.literal(EDITOR_CATALOG_SCHEMA_VERSION),
    providers: z.record(
        EditorCatalogProviderIdSchema,
        EditorCatalogProviderStateSchema,
    ),
});

/**
 * Creates a catalog with empty official provider data.
 *
 * @returns A valid empty catalog.
 */
export function createEmptyEditorCatalog(): EditorCatalogFile {
    return {
        schemaVersion: EDITOR_CATALOG_SCHEMA_VERSION,
        providers: Object.fromEntries(
            OFFICIAL_ENGINE_SOURCE_IDS.map((providerId) => [
                providerId,
                createEmptyProviderState(),
            ]),
        ),
    };
}

/**
 * Checks and sorts catalog data before it is stored or returned.
 *
 * @param value - The catalog data to check.
 * @returns Valid catalog data in a stable order.
 */
export function normalizeEditorCatalog(value: unknown): EditorCatalogFile {
    const catalog = EditorCatalogFileSchema.parse(value);

    return EditorCatalogFileSchema.parse({
        ...catalog,
        providers: Object.fromEntries(
            [
                ...new Set([
                    ...OFFICIAL_ENGINE_SOURCE_IDS,
                    ...Object.keys(catalog.providers),
                ]),
            ].map((providerId) => [
                providerId,
                normalizeProviderState(
                    providerId,
                    catalog.providers[providerId] ?? createEmptyProviderState(),
                ),
            ]),
        ),
    });
}

/**
 * Creates empty cached data for one provider.
 *
 * @returns Empty provider data.
 */
export function createEmptyProviderState(): EditorCatalogProviderState {
    return {
        integrityMetadataRefreshed: false,
        templateMetadataRefreshed: false,
        lastFetchedAt: null,
        lastPublishedAt: null,
        releases: [],
    };
}

/**
 * Removes invalid provider releases and sorts the remaining releases.
 *
 * @param providerId - The provider that owns the releases.
 * @param state - The provider data to normalize.
 * @returns Normalized provider data.
 */
function normalizeProviderState(
    providerId: string,
    state: EditorCatalogProviderState,
): EditorCatalogProviderState {
    const releasesById = new Map(
        state.releases
            .filter((release) => release.providerId === providerId)
            .map((release) => [release.id, normalizeRelease(release)]),
    );

    return {
        integrityMetadataRefreshed: state.integrityMetadataRefreshed ?? false,
        templateMetadataRefreshed: state.templateMetadataRefreshed ?? false,
        lastFetchedAt: state.lastFetchedAt,
        lastPublishedAt: state.lastPublishedAt,
        ...(state.lastFailure ? { lastFailure: state.lastFailure } : {}),
        releases: [...releasesById.values()].sort(compareEditorReleases),
    };
}

/**
 * Sorts the variants and assets inside one release.
 *
 * @param release - The release to normalize.
 * @returns A copy of the release in a stable order.
 */
function normalizeRelease(
    release: EditorCatalogProviderState['releases'][number],
): EditorCatalogProviderState['releases'][number] {
    return {
        ...release,
        variants: [...release.variants]
            .map((variant) => ({
                ...variant,
                assets: [...variant.assets].sort((a, b) =>
                    a.id.localeCompare(b.id),
                ),
            }))
            .sort((a, b) => a.flavor.localeCompare(b.flavor)),
    };
}

/**
 * Compares two releases so newer versions come first. Releases with the same
 * version parts, such as fork builds of one Godot version, are ordered by
 * publication time.
 *
 * @param a - The first release.
 * @param b - The second release.
 * @returns A sort value for the two releases.
 */
export function compareEditorReleases(
    a: EditorCatalogProviderState['releases'][number],
    b: EditorCatalogProviderState['releases'][number],
): number {
    const fields = ['major', 'minor', 'patch'] as const;
    for (const field of fields) {
        const difference = b.versionParts[field] - a.versionParts[field];
        if (difference !== 0) {
            return difference;
        }
    }

    const channelDifference =
        channelPriority(a.versionParts.channel) -
        channelPriority(b.versionParts.channel);
    if (channelDifference !== 0) {
        return channelDifference;
    }

    return (
        b.versionParts.iteration - a.versionParts.iteration ||
        (b.publishedAt ? Date.parse(b.publishedAt) : 0) -
            (a.publishedAt ? Date.parse(a.publishedAt) : 0)
    );
}

/**
 * Gets the sort priority for a release channel.
 *
 * @param channel - The release channel name.
 * @returns The channel sort priority.
 */
function channelPriority(channel: string): number {
    return ['stable', 'rc', 'beta', 'alpha', 'dev'].indexOf(channel) === -1
        ? 99
        : ['stable', 'rc', 'beta', 'alpha', 'dev'].indexOf(channel);
}
