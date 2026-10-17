// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { Injectable, Logger } from '@mariodebono/di';
import type {
    RemoteProjectGitLfsFailureReason,
    RemoteProjectGitLfsOutcome,
} from '@shared/contracts';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ToolIntegrationService } from '../../tool-integration.service.js';
import type { ToolStreamingExecutionResult } from '../../tool-integration.types.js';
import { GIT_LFS_TOOL_ID } from '../git-lfs/git-lfs-tool.constants.js';
import type {
    GitCloneLfsRequest,
    GitCloneLfsResult,
} from './git-clone.types.js';
import {
    createGitCommandConfigEnvironment,
    createGitLfsEndpoint,
} from './git-network-process.util.js';

const GIT_LFS_DETECTION_TIMEOUT_MS = 5 * 60 * 1_000;
const GIT_LFS_SETUP_TIMEOUT_MS = 60 * 1_000;
/** Multi-gigabyte LFS checkouts on slow links; cancellation stays available. */
const GIT_LFS_PULL_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const GIT_LFS_OUTPUT_BUFFER_LENGTH = 2_048;
/** Every tracked path whose `.gitattributes` rules resolve to `filter=lfs`. */
const GIT_LFS_TRACKED_PATHSPEC = ':(attr:filter=lfs)';

@Injectable()
export class GitCloneLfsService {
    /**
     * Creates the post-clone Git LFS content service.
     *
     * @param tools - Revalidated tool execution boundary.
     * @param logger - Application logger backed by the configured Electron logger.
     */
    constructor(
        private readonly tools: ToolIntegrationService,
        private readonly logger: Logger,
    ) {}

    /**
     * Replaces LFS pointer files in a fresh clone with their real content.
     *
     * Detection uses Git alone, so a missing Git LFS executable is still
     * reported. Setup and download reuse the clone's isolated environment and
     * askpass session; the LFS endpoint is pinned to the cloned repository so
     * repository `.lfsconfig` cannot redirect credentials elsewhere.
     *
     * @param request - Fresh clone, credential environment and cancellation.
     * @returns Whether LFS content arrived, or cancellation.
     */
    async pull(request: GitCloneLfsRequest): Promise<GitCloneLfsResult> {
        const tracked = await this.countTrackedFiles(request);
        if (tracked === 'cancelled') {
            return { status: 'cancelled' };
        }
        if (tracked === null) {
            return this.fail('unknown', 'detect', null);
        }
        if (tracked === 0) {
            return { status: 'not-used' };
        }

        request.onStart();
        const environment = createGitLfsPullEnvironment(request);
        const setup = await this.tools.executeStreaming(GIT_LFS_TOOL_ID, {
            args: ['install', '--local'],
            cwd: request.repositoryPath,
            env: environment,
            signal: request.signal,
            timeoutMs: GIT_LFS_SETUP_TIMEOUT_MS,
        });
        if (!setup.success) {
            return this.toFailure(setup, '', 'install', tracked);
        }

        let bufferedOutput = '';
        let lastPercent = -1;
        const pulled = await this.tools.executeStreaming(GIT_LFS_TOOL_ID, {
            args: ['pull'],
            cwd: request.repositoryPath,
            env: { ...environment, GIT_LFS_FORCE_PROGRESS: '1' },
            signal: request.signal,
            timeoutMs: GIT_LFS_PULL_TIMEOUT_MS,
            onStderr: (chunk) => {
                bufferedOutput = `${bufferedOutput}${chunk}`.slice(
                    -GIT_LFS_OUTPUT_BUFFER_LENGTH,
                );
                const percent = readGitLfsPercent(bufferedOutput);
                if (percent !== null && percent > lastPercent) {
                    lastPercent = percent;
                    request.onProgress(percent);
                }
            },
        });
        if (!pulled.success) {
            return this.toFailure(pulled, bufferedOutput, 'pull', tracked);
        }
        this.logger.debug?.('Remote Git LFS content downloaded', {
            event: 'remote_git_lfs_pulled',
            trackedFileCount: tracked,
        });
        if (lastPercent < 100) {
            request.onProgress(100);
        }
        return { status: 'pulled' };
    }

    /**
     * Counts tracked paths that Git resolves to the LFS filter.
     *
     * @param request - Fresh clone and cancellation.
     * @returns The count, `cancelled`, or null when Git could not answer.
     */
    private async countTrackedFiles(
        request: GitCloneLfsRequest,
    ): Promise<number | 'cancelled' | null> {
        let count = 0;
        const result = await this.tools.executeStreaming('git', {
            args: ['ls-files', '-z', '--', GIT_LFS_TRACKED_PATHSPEC],
            cwd: request.repositoryPath,
            env: request.environment,
            signal: request.signal,
            timeoutMs: GIT_LFS_DETECTION_TIMEOUT_MS,
            onStdout: (chunk) => {
                for (const character of chunk) {
                    if (character === '\0') count += 1;
                }
            },
        });
        if (result.success) {
            return count;
        }
        return result.reason === 'cancelled' ? 'cancelled' : null;
    }

    /**
     * Converts a failed Git LFS process into a clone-preserving outcome.
     *
     * @param result - Failed Git LFS process state.
     * @param output - Bounded recent Git LFS standard error.
     * @param stage - Step that failed, for credential-safe logging.
     * @param trackedFileCount - LFS-tracked paths left as pointers.
     * @returns Cancellation, unavailability, or a classified failure.
     */
    private toFailure(
        result: Extract<ToolStreamingExecutionResult, { success: false }>,
        output: string,
        stage: 'install' | 'pull',
        trackedFileCount: number,
    ): GitCloneLfsResult {
        if (result.reason === 'cancelled') {
            return { status: 'cancelled' };
        }
        if (
            result.reason === 'disabled' ||
            result.reason === 'invalid' ||
            result.reason === 'unavailable'
        ) {
            this.logger.warn('Git LFS is unavailable for a cloned repository', {
                event: 'remote_git_lfs_unavailable',
                processReason: result.reason,
                trackedFileCount,
            });
            return { status: 'unavailable' };
        }
        return this.fail(
            result.reason === 'timed-out'
                ? 'timed-out'
                : classifyGitLfsFailure(output),
            stage,
            trackedFileCount,
            result.exitCode,
        );
    }

    /** Logs and returns one credential-safe Git LFS failure. */
    private fail(
        reason: RemoteProjectGitLfsFailureReason,
        stage: 'detect' | 'install' | 'pull',
        trackedFileCount: number | null,
        exitCode: number | null = null,
    ): RemoteProjectGitLfsOutcome {
        this.logger.warn('Remote Git LFS content was not downloaded', {
            event: 'remote_git_lfs_failed',
            exitCode,
            reason,
            stage,
            trackedFileCount,
        });
        return { status: 'failed', reason };
    }
}

/**
 * Builds the Git LFS environment for one fresh clone. Command-scoped config
 * outranks the cloned repository's `.lfsconfig`, so the endpoint, credential
 * helpers and transfer agents stay launcher-controlled.
 *
 * @param request - Fresh clone request.
 * @returns Environment for `git-lfs install --local` and `git-lfs pull`.
 */
function createGitLfsPullEnvironment(
    request: GitCloneLfsRequest,
): NodeJS.ProcessEnv {
    const endpoint = createGitLfsEndpoint(request.canonicalUrl);
    return createGitCommandConfigEnvironment(request.environment, [
        ['credential.helper', ''],
        ['credential.interactive', request.interactive ? 'true' : 'false'],
        ['credential.useHttpPath', 'true'],
        ['http.sslVerify', 'true'],
        ['lfs.url', endpoint],
        ['lfs.standalonetransferagent', ''],
        ['lfs.basictransfersonly', 'true'],
    ]);
}

/**
 * Reads the latest Git LFS download percentage from forced progress output.
 *
 * @param value - Bounded recent Git LFS standard error text.
 * @returns Latest percentage, or null when no progress is present.
 */
export function readGitLfsPercent(value: string): number | null {
    const latest = [
        ...value.matchAll(/Downloading LFS objects:\s+(\d{1,3})%/gu),
    ].at(-1)?.[1];
    return latest ? Math.min(100, Number.parseInt(latest, 10)) : null;
}

/**
 * Classifies bounded Git LFS error output without retaining or logging it.
 *
 * @param value - Bounded recent Git LFS standard error text.
 * @returns A renderer-safe failure reason.
 */
export function classifyGitLfsFailure(
    value: string,
): RemoteProjectGitLfsFailureReason {
    if (
        /(?:over its data quota|exceeded its lfs budget|bandwidth limit|quota exceeded)/iu.test(
            value,
        )
    ) {
        return 'quota-exceeded';
    }
    if (
        /(?:credentials for .* not found|could not read (?:username|password)|authentication (?:required|failed)|access denied|unauthori[sz]ed|forbidden|\b40[13]\b)/iu.test(
            value,
        )
    ) {
        return 'authentication-failed';
    }
    if (
        /(?:does not exist on the server|object (?:does not exist|not found)|missing object|\b404\b)/iu.test(
            value,
        )
    ) {
        return 'objects-missing';
    }
    if (
        /(?:dial tcp|no such host|connection (?:refused|reset|timed out)|i\/o timeout|tls|ssl|certificate|unexpected eof|network is unreachable)/iu.test(
            value,
        )
    ) {
        return 'network-failed';
    }
    return 'unknown';
}
