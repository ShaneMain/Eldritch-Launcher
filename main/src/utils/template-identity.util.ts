import type { InstalledRelease } from '@shared/contracts';

/**
 * Gets Godot's export template directory name for an engine version string
 * such as `4.7.2.stable.mono.custom_build.b90e2049e`. Godot names template
 * directories by version, status, and module configuration only
 * (`4.7.2.stable.mono`), without the custom build name or hash.
 *
 * @param version - Full engine version reported by a build.
 * @param mono - Whether the templates belong to the .NET edition.
 * @returns The template directory name, or undefined for other formats.
 */
export function getEngineVersionTemplateIdentity(
    version: string,
    mono: boolean,
): string | undefined {
    const base = version.match(/^(\d+\.\d+(?:\.\d+)?\.[a-z]+\d*)(?:\.|$)/)?.[1];
    return base ? `${base}${mono ? '.mono' : ''}` : undefined;
}

/**
 * Gets the export template directory an installed or pinned editor reads.
 * Official versions map `4.4-stable` to `4.4.stable`; fork versions use the
 * engine version's template prefix.
 *
 * @param release - Editor version, edition, and fork identity.
 * @returns The template directory name.
 */
export function getReleaseTemplateIdentity(
    release: Pick<InstalledRelease, 'version' | 'mono' | 'fork'>,
): string {
    return (
        (release.fork
            ? getEngineVersionTemplateIdentity(release.version, release.mono)
            : undefined) ??
        `${release.version.replace('-', '.')}${release.mono ? '.mono' : ''}`
    );
}
