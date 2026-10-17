import type {
    AddProjectEditorResolution,
    ForkBuildIdentity,
    ProjectDetails,
    ReleaseSummary,
} from '@shared/contracts';

/**
 * Returns the Godot major/minor branch represented by a release version.
 *
 * @param version - Release version or tag-like version text.
 * @returns The major/minor branch, or null when it cannot be parsed.
 */
function getReleaseBaseVersion(version: string): string | null {
    const match = version.match(/^v?(\d+)\.(\d+)/i);
    return match ? `${match[1]}.${match[2]}` : null;
}

/**
 * Parses the numeric version parts used to order stable releases.
 *
 * @param version - Release version or tag-like version text.
 * @returns Major, minor, patch, and revision numbers.
 */
function getReleaseVersionParts(version: string): number[] {
    const match = version.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
    return match
        ? [
              Number.parseInt(match[1], 10),
              Number.parseInt(match[2], 10),
              Number.parseInt(match[3] ?? '0', 10),
              Number.parseInt(match[4] ?? '0', 10),
          ]
        : [0, 0, 0, 0];
}

/**
 * Compares release versions by patch, then stable/RC/beta/dev and iteration.
 *
 * @param first - First release to compare.
 * @param second - Second release to compare.
 * @returns A negative value when the first release is newer.
 */
function compareEditorReleases(
    first: ReleaseSummary,
    second: ReleaseSummary,
): number {
    const firstParts = getReleaseVersionParts(first.version);
    const secondParts = getReleaseVersionParts(second.version);

    for (let index = 0; index < firstParts.length; index++) {
        if (firstParts[index] !== secondParts[index]) {
            return secondParts[index] - firstParts[index];
        }
    }

    const firstChannel = first.version.match(/-(stable|rc|beta|dev)(\d*)$/i);
    const secondChannel = second.version.match(/-(stable|rc|beta|dev)(\d*)$/i);
    const channels = ['dev', 'beta', 'rc', 'stable'];
    return (
        channels.indexOf(secondChannel?.[1]?.toLowerCase() ?? '') -
            channels.indexOf(firstChannel?.[1]?.toLowerCase() ?? '') ||
        Number(secondChannel?.[2] || 0) - Number(firstChannel?.[2] || 0)
    );
}

/**
 * Reports whether a catalogue release contains the requested editor flavour.
 *
 * @param release - Catalogue release to inspect.
 * @param flavor - Requested standard or .NET flavour.
 * @returns Whether the release has a matching downloadable asset.
 */
function hasEditorFlavor(
    release: ReleaseSummary,
    flavor: 'gdscript' | 'dotnet',
): boolean {
    const mono = flavor === 'dotnet';
    return release.assets.some((asset) => asset.mono === mono);
}

/**
 * Finds the one fork build that exactly matches a pinned fork identity.
 *
 * Fork pins never fall back to another revision, source, or official build.
 *
 * @param fork - Pinned fork source and revision.
 * @param mono - Whether the pin uses the .NET flavour.
 * @param forkReleases - Available fork builds.
 * @returns The exact fork build, when it publishes the pinned flavour.
 */
function findExactForkRelease(
    fork: ForkBuildIdentity,
    mono: boolean,
    forkReleases: ReleaseSummary[],
): ReleaseSummary | undefined {
    const source = fork.source.toLowerCase();
    const revision = fork.revision.toLowerCase();
    return forkReleases.find(
        (release) =>
            release.fork !== undefined &&
            release.fork.source.toLowerCase() === source &&
            release.fork.revision.toLowerCase() === revision &&
            release.assets.some((asset) => asset.mono === mono),
    );
}

/**
 * Resolves a project editor request against the renderer's release catalogue.
 *
 * @param resolution - Missing-editor resolution returned by the main process.
 * @param availableReleases - Available stable releases.
 * @param availablePrereleases - Available prereleases.
 * @param forkReleases - Available fork builds, used only for fork pins.
 * @returns The exact or newest matching stable release, when downloadable.
 */
export function findDownloadableProjectEditor(
    resolution: AddProjectEditorResolution,
    availableReleases: ReleaseSummary[],
    availablePrereleases: ReleaseSummary[],
    forkReleases: ReleaseSummary[] = [],
): ReleaseSummary | undefined {
    const downloadable = resolution.downloadable;
    if (resolution.choices !== undefined || !downloadable) {
        return undefined;
    }

    if (downloadable.match === 'exact') {
        if (downloadable.fork) {
            return findExactForkRelease(
                downloadable.fork,
                downloadable.flavor === 'dotnet',
                forkReleases,
            );
        }
        return [...availableReleases, ...availablePrereleases].find(
            (release) => release.version === downloadable.version,
        );
    }

    return availableReleases
        .filter(
            (release) =>
                !release.prerelease &&
                getReleaseBaseVersion(release.version) ===
                    downloadable.base_version &&
                hasEditorFlavor(release, downloadable.flavor),
        )
        .sort(compareEditorReleases)[0];
}

/**
 * Finds a downloadable editor for an exact or unresolved stored requirement.
 *
 * @param project - Project whose editor is missing.
 * @param availableReleases - Available stable releases.
 * @param availablePrereleases - Available prereleases.
 * @param forkReleases - Available fork builds, used only for fork pins.
 * @returns The exact release, or latest compatible stable/prerelease for a bare branch.
 */
export function findDownloadableMissingProjectEditor(
    project: ProjectDetails,
    availableReleases: ReleaseSummary[],
    availablePrereleases: ReleaseSummary[],
    forkReleases: ReleaseSummary[] = [],
): ReleaseSummary | undefined {
    if (
        project.invalid_reason !== 'missing_editor' ||
        project.release.source === 'custom'
    ) {
        return undefined;
    }

    if (project.release.fork) {
        return findExactForkRelease(
            project.release.fork,
            project.release.mono,
            forkReleases,
        );
    }

    const baseVersion = getReleaseBaseVersion(project.release.version);
    if (project.release.version === baseVersion) {
        const compatible = [
            ...availableReleases,
            ...availablePrereleases,
        ].filter(
            (release) =>
                getReleaseBaseVersion(release.version) === baseVersion &&
                release.assets.some(
                    (asset) => asset.mono === project.release.mono,
                ),
        );
        const stable = compatible.filter((release) => !release.prerelease);
        return (stable.length ? stable : compatible).sort(
            compareEditorReleases,
        )[0];
    }

    return [...availableReleases, ...availablePrereleases].find(
        (release) =>
            release.version === project.release.version &&
            release.assets.some((asset) => asset.mono === project.release.mono),
    );
}

/** What a project's primary button does. */
export type ProjectLaunchAction =
    | 'open'
    | 'install-and-open'
    | 'installing'
    | 'unavailable';

/**
 * Chooses the primary project action: open it, or install its exact missing
 * editor first and then open it, so a missing editor is never a dead end.
 *
 * @param project - Stored project and its health.
 * @param releaseInstalled - Whether the project's editor is installed.
 * @param downloadable - Exact downloadable editor for a missing one.
 * @param downloading - Whether that editor is installing now.
 * @returns The action for the primary button.
 */
export function getProjectLaunchAction(
    project: Pick<ProjectDetails, 'valid' | 'invalid_reason'>,
    releaseInstalled: boolean,
    downloadable: ReleaseSummary | undefined,
    downloading: boolean,
): ProjectLaunchAction {
    if (downloading) return 'installing';
    if (project.valid && releaseInstalled) return 'open';
    const onlyEditorMissing =
        project.valid || project.invalid_reason === 'missing_editor';
    return onlyEditorMissing && downloadable
        ? 'install-and-open'
        : 'unavailable';
}
