import type {
    EditorCatalogProviderStatus,
    EngineSourceSummary,
    ReleaseSummary,
} from '@shared/contracts';

/** Current operating system and processor architecture. */
export type ForkEngineHost = {
    platform: string;
    arch: string;
};

/** Whether the builds of one fork source can be listed. */
export type ForkEngineAccess =
    | { kind: 'ok' }
    | { kind: 'auth-required'; installUrl?: string }
    | { kind: 'no-access'; installUrl?: string }
    | { kind: 'error'; message?: string };

/** One fork engine source offered as an editor channel. */
export type ForkEngineChannel = {
    id: string;
    label: string;
    /** GitHub `owner/repo`. */
    source: string;
    access: ForkEngineAccess;
    /** Builds published by the source, for every platform. */
    releases: ReleaseSummary[];
};

/**
 * Builds one channel per fork source from the configured sources, the
 * catalog provider states, and the fork builds in the catalog. Builds of a
 * source missing from `sources` still get a channel named after the
 * repository, so they stay selectable while sources load.
 *
 * @param sources - Engine sources with their refresh state.
 * @param providers - Catalog provider states that produced `forkReleases`.
 * @param forkReleases - Builds published by fork sources.
 * @returns Fork channels in source order.
 */
export function buildForkEngineChannels(
    sources: EngineSourceSummary[],
    providers: EditorCatalogProviderStatus[],
    forkReleases: ReleaseSummary[],
): ForkEngineChannel[] {
    const channels = new Map<string, ForkEngineChannel>();
    for (const source of sources) {
        if (source.kind !== 'fork') {
            continue;
        }
        const repository = `${source.owner}/${source.repo}`;
        channels.set(source.id, {
            id: source.id,
            label: source.displayName || repository,
            source: repository,
            access: { kind: 'ok' },
            releases: [],
        });
    }
    for (const release of forkReleases) {
        if (!release.fork) {
            continue;
        }
        const channel = channels.get(release.fork.sourceId) ?? {
            id: release.fork.sourceId,
            label: release.fork.source,
            source: release.fork.source,
            access: { kind: 'ok' },
            releases: [],
        };
        channel.releases.push(release);
        channels.set(channel.id, channel);
    }

    return [...channels.values()].map((channel) => {
        const source = sources.find((candidate) => candidate.id === channel.id);
        const provider = providers.find(
            (candidate) => candidate.id === channel.id,
        );
        // The provider state belongs to the same catalog read as the
        // releases; the source state covers sources not yet in that read.
        const state = provider?.state ?? source?.state;
        const installUrl = source?.githubAppInstallUrl;
        const access: ForkEngineAccess =
            state === 'auth-required' || state === 'no-access'
                ? { kind: state, ...(installUrl ? { installUrl } : {}) }
                : state === 'error'
                  ? {
                        kind: 'error',
                        message: provider?.refreshError ?? source?.error,
                    }
                  : { kind: 'ok' };
        return { ...channel, access };
    });
}

/**
 * Keeps only the assets of a build that run on the host.
 *
 * @param release - Fork build for every platform.
 * @param host - Current platform and architecture.
 * @returns The build with host assets only.
 */
export function toHostRelease(
    release: ReleaseSummary,
    host: ForkEngineHost,
): ReleaseSummary {
    return {
        ...release,
        assets: release.assets.filter(
            (asset) =>
                asset.platform_tags[0] === host.platform &&
                asset.platform_tags[1] === host.arch,
        ),
    };
}
