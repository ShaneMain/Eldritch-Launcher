import type { EngineSourceSummary } from '@shared/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appBridge } from '../renderer.bridge.ts';
import { useEngineSources } from './engine-sources.hook.ts';
import {
    buildForkEngineChannels,
    type ForkEngineChannel,
    type ForkEngineHost,
} from './fork-engine-channels.model.ts';
import { useRelease } from './release.hook.tsx';

/** Fork channels and host platform used by editor pickers. */
export type ForkEngineChannels = {
    channels: ForkEngineChannel[];
    /** Unknown until the main process reports it. */
    host: ForkEngineHost | null;
};

/**
 * Loads fork engine sources and the host platform while a picker is active.
 * Sources blocked by GitHub access are retried on activation, so builds
 * appear after the user signs in or grants the GitHub App access without a
 * manual refresh.
 *
 * @param active - Whether the picker showing the channels is open.
 * @returns Fork channels and the host platform.
 */
export function useForkEngineChannels(active: boolean): ForkEngineChannels {
    const { listSources } = useEngineSources();
    const { forkReleases, catalogProviders, reloadReleases } = useRelease();
    const reloadReleasesRef = useRef(reloadReleases);
    reloadReleasesRef.current = reloadReleases;
    const [sources, setSources] = useState<EngineSourceSummary[]>([]);
    const [host, setHost] = useState<ForkEngineHost | null>(null);

    useEffect(() => {
        if (!active) {
            return;
        }

        let cancelled = false;
        const load = async (): Promise<void> => {
            const listed = await listSources();
            if (cancelled) {
                return;
            }
            setSources(listed);
            if (
                listed.some(
                    (source) =>
                        source.state === 'auth-required' ||
                        source.state === 'no-access',
                )
            ) {
                await reloadReleasesRef.current();
                const relisted = await listSources();
                if (!cancelled) {
                    setSources(relisted);
                }
            }
        };
        load().catch(() => undefined);
        Promise.all([appBridge.getPlatform(), appBridge.getArch()])
            .then(
                ([platform, arch]) => !cancelled && setHost({ platform, arch }),
            )
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [active, listSources]);

    const channels = useMemo(
        () => buildForkEngineChannels(sources, catalogProviders, forkReleases),
        [sources, catalogProviders, forkReleases],
    );
    return { channels, host };
}
