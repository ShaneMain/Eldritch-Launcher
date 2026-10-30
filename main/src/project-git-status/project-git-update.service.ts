import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@mariodebono/di';
import type {
    ProjectGitUpdateOptions,
    ProjectGitUpdateResult,
    ProjectGitUpdateStage,
    ProjectGitUpdateStash,
    RemoteProjectGitLfsOutcome,
} from '@shared/contracts';
import logger from 'electron-log';
import { getMainWindow } from '../mainWindow.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectsStore } from '../projects/projects.store.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GitService } from '../tool-integration/integrations/git/git.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GitCloneLfsService } from '../tool-integration/integrations/git/git-clone-lfs.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ToolIntegrationService } from '../tool-integration/tool-integration.service.js';
import type {
    ToolExecutionResult,
    ToolExecutionSession,
} from '../tool-integration/tool-integration.types.js';
import { ipcWebContentsSend } from '../utils.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import {
    FETCH_SIDE_EFFECT_ARGUMENTS,
    LOCAL_ENVIRONMENT,
    type LocalGitRunner,
    ProjectGitStatusService,
    type RemoteLfsAccess,
    readUpstream,
    type UpstreamDetails,
} from './project-git-status.service.js';
import {
    parseHeadBranch,
    parseLeftRightCount,
    parseOverwrittenPaths,
    sanitizeGitMessage,
} from './project-git-status.util.js';

/** Conflicting paths returned to the renderer; the full list is re-derived on retry. */
export const MAX_REPORTED_LOCAL_CHANGES = 10;
const GIT_LOCAL_TIMEOUT_MS = 30_000;
/** Checking out a large fast-forward can rewrite many files. */
const GIT_MERGE_TIMEOUT_MS = 10 * 60 * 1_000;
/** Used only when the repository has no committer identity for the stash. */
const FALLBACK_IDENTITY_ARGUMENTS = [
    '-c',
    'user.name=Eldritch Launcher',
    '-c',
    'user.email=launcher@eldritch.invalid',
] as const;

type RunningUpdate = {
    controller: AbortController;
    result: Promise<ProjectGitUpdateResult>;
};

type MergeOutcome =
    | { ok: true }
    | { ok: false; tracked: string[]; untracked: string[] }
    | { ok: false; message: string | null };

/**
 * Fast-forwards registered projects to their upstream and pulls Git LFS
 * content.
 *
 * Only `git merge --ff-only` touches the work tree: no rebase, merge commit,
 * reset or clean. Local changes that block it are only ever stashed, on
 * explicit request, and the stash is reported.
 */
@Injectable()
export class ProjectGitUpdateService {
    private readonly running = new Map<string, RunningUpdate>();

    /**
     * Creates the project Git update service.
     *
     * @param projects - Registered project store.
     * @param git - Repository inspection service.
     * @param tools - Validated Git execution boundary.
     * @param statuses - Status service sharing fetch, credentials and locking.
     * @param lfs - Git LFS content service shared with cloning.
     */
    constructor(
        private readonly projects: ProjectsStore,
        private readonly git: GitService,
        private readonly tools: ToolIntegrationService,
        private readonly statuses: ProjectGitStatusService,
        private readonly lfs: GitCloneLfsService,
    ) {}

    /**
     * Updates one registered project, joining an update already running.
     *
     * @param projectPath - Exact registered project path.
     * @param options - Optional stash-and-retry for blocking local changes.
     * @returns The update outcome.
     */
    updateProject(
        projectPath: string,
        options: ProjectGitUpdateOptions = {},
    ): Promise<ProjectGitUpdateResult> {
        const existing = this.running.get(projectPath);
        if (existing) {
            return existing.result;
        }
        const controller = new AbortController();
        const result = this.projects
            .list()
            .then((projects) =>
                projects.some((project) => project.path === projectPath)
                    ? this.statuses.runExclusiveUpdate(projectPath, () =>
                          this.run(projectPath, options, controller.signal),
                      )
                    : ({
                          status: 'refused',
                          reason: 'not-registered',
                      } as const),
            )
            .catch((error: unknown): ProjectGitUpdateResult => {
                logger.warn('Project Git update failed unexpectedly', error);
                return { status: 'failed', message: null, stash: null };
            })
            .then(async (outcome) => {
                if (
                    outcome.status === 'updated' ||
                    outcome.status === 'up-to-date'
                ) {
                    await this.statuses
                        .refreshProject(projectPath)
                        .catch(() => undefined);
                }
                return outcome;
            })
            .finally(() => {
                if (this.running.get(projectPath)?.result === result) {
                    this.running.delete(projectPath);
                }
            });
        this.running.set(projectPath, { controller, result });
        return result;
    }

    /**
     * Cancels a running update.
     *
     * @param projectPath - Project path being updated.
     * @returns Whether an update was running.
     */
    cancelUpdate(projectPath: string): boolean {
        const running = this.running.get(projectPath);
        running?.controller.abort();
        return Boolean(running);
    }

    /**
     * Runs one update while the project's status refreshes are held.
     *
     * @param projectPath - Project path to update.
     * @param options - Update options.
     * @param signal - Cancellation signal.
     * @returns The update outcome.
     */
    private async run(
        projectPath: string,
        options: ProjectGitUpdateOptions,
        signal: AbortSignal,
    ): Promise<ProjectGitUpdateResult> {
        if (signal.aborted) return { status: 'cancelled' };
        const inspection = await this.git.inspectRepository(projectPath);
        if (inspection.status === 'not-a-repository') {
            return { status: 'refused', reason: 'not-a-repo' };
        }
        if (inspection.status !== 'inside-work-tree') {
            return {
                status: 'failed',
                message:
                    inspection.status === 'git-unavailable'
                        ? 'Git is unavailable'
                        : 'Git could not inspect this project',
                stash: null,
            };
        }

        const execute = this.createCancellableSession(signal);
        const local: LocalGitRunner = (args) =>
            execute({
                args,
                cwd: projectPath,
                env: LOCAL_ENVIRONMENT,
                timeoutMs: GIT_LOCAL_TIMEOUT_MS,
            });

        const head = await local(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (signal.aborted) return { status: 'cancelled' };
        const branch = head.success ? parseHeadBranch(head.stdout) : undefined;
        if (branch === undefined) {
            return {
                status: 'failed',
                message: sanitizeGitMessage(head.stderr),
                stash: null,
            };
        }
        if (branch === null) {
            return { status: 'refused', reason: 'detached' };
        }
        const upstream = await readUpstream(local, branch);
        if (signal.aborted) return { status: 'cancelled' };
        if (!upstream) {
            return { status: 'refused', reason: 'no-upstream' };
        }

        this.report(projectPath, 'fetching', null);
        const access = await this.statuses.openRemoteAccess(
            execute,
            local,
            projectPath,
            upstream,
            this.statuses.createCredentialSource(),
        );
        const supportDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), 'eldritch-launcher-git-update-'),
        );
        try {
            const fetched = await access.fetch();
            if (signal.aborted) return { status: 'cancelled' };
            if (!fetched.ok) {
                return {
                    status: 'fetch-failed',
                    kind: fetched.kind,
                    message: fetched.message,
                };
            }

            const counts = await local([
                'rev-list',
                '--left-right',
                '--count',
                'HEAD...@{u}',
            ]);
            if (signal.aborted) return { status: 'cancelled' };
            const parsed = counts.success
                ? parseLeftRightCount(counts.stdout)
                : null;
            if (!parsed) {
                return {
                    status: 'failed',
                    message: counts.success
                        ? 'Unexpected rev-list output'
                        : sanitizeGitMessage(counts.stderr),
                    stash: null,
                };
            }
            if (parsed.ahead > 0) {
                return { status: 'refused', reason: 'diverged' };
            }
            if (parsed.behind === 0) {
                return { status: 'up-to-date' };
            }

            this.report(projectPath, 'updating', null);
            const hooksDirectory = path.join(supportDirectory, 'hooks');
            await fs.mkdir(hooksDirectory, { mode: 0o700 });
            const merge = () =>
                this.fastForward(
                    execute,
                    projectPath,
                    upstream,
                    hooksDirectory,
                );
            let merged = await merge();
            let stash: ProjectGitUpdateStash | null = null;
            if (!merged.ok && 'tracked' in merged) {
                if (!options.discardGeneratedChanges) {
                    const paths = [...merged.tracked, ...merged.untracked];
                    return {
                        status: 'local-changes',
                        paths: paths.slice(0, MAX_REPORTED_LOCAL_CHANGES),
                        totalPaths: paths.length,
                    };
                }
                const stashed = await this.stash(
                    execute,
                    local,
                    projectPath,
                    supportDirectory,
                    merged,
                );
                if (!stashed.ok) {
                    return {
                        status: 'failed',
                        message: stashed.message,
                        stash: null,
                    };
                }
                stash = stashed.stash;
                merged = await merge();
            }
            if (!merged.ok) {
                if (signal.aborted && !stash) return { status: 'cancelled' };
                return {
                    status: 'failed',
                    message:
                        'message' in merged
                            ? merged.message
                            : 'Local changes still block the update',
                    stash,
                };
            }

            const lfs = await this.pullLfs(projectPath, access.lfs, signal);
            return { status: 'updated', commits: parsed.behind, lfs, stash };
        } finally {
            await access.close();
            await fs
                .rm(supportDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    }

    /**
     * Fast-forwards the checked-out branch to its fetched upstream.
     *
     * LFS smudging is deferred to `git lfs pull`, so checkout needs no
     * network credentials. Repository hooks and maintenance do not run.
     *
     * @param execute - Cancellable Git session.
     * @param projectPath - Project work tree.
     * @param upstream - Upstream whose tracking ref is merged.
     * @param hooksDirectory - Empty hooks directory.
     * @returns Success, the blocking local paths, or Git's message.
     */
    private async fastForward(
        execute: ToolExecutionSession,
        projectPath: string,
        upstream: UpstreamDetails,
        hooksDirectory: string,
    ): Promise<MergeOutcome> {
        const result = await execute({
            args: [
                '-c',
                `core.hooksPath=${hooksDirectory}`,
                '-c',
                'core.quotePath=false',
                ...FETCH_SIDE_EFFECT_ARGUMENTS,
                'merge',
                '--ff-only',
                '--no-stat',
                upstream.trackingRef,
            ],
            cwd: projectPath,
            env: { ...LOCAL_ENVIRONMENT, GIT_LFS_SKIP_SMUDGE: '1' },
            timeoutMs: GIT_MERGE_TIMEOUT_MS,
        });
        if (result.success) {
            return { ok: true };
        }
        const overwritten = parseOverwrittenPaths(result.stderr);
        if (overwritten) {
            return { ok: false, ...overwritten };
        }
        return {
            ok: false,
            message:
                sanitizeGitMessage(result.stderr) ??
                `git merge ${result.reason}`,
        };
    }

    /**
     * Stashes exactly the paths that block the fast-forward.
     *
     * Untracked blocking files are included so they are kept, never removed.
     *
     * @param execute - Cancellable Git session.
     * @param local - Local Git runner.
     * @param projectPath - Project work tree.
     * @param supportDirectory - Private directory for the pathspec file.
     * @param paths - Blocking tracked and untracked paths.
     * @returns The created stash, or Git's message.
     */
    private async stash(
        execute: ToolExecutionSession,
        local: LocalGitRunner,
        projectPath: string,
        supportDirectory: string,
        paths: { tracked: string[]; untracked: string[] },
    ): Promise<
        | { ok: true; stash: ProjectGitUpdateStash }
        | { ok: false; message: string | null }
    > {
        const allPaths = [...paths.tracked, ...paths.untracked];
        const pathspecFile = path.join(supportDirectory, 'stash-paths');
        await fs.writeFile(pathspecFile, `${allPaths.join('\0')}\0`, {
            mode: 0o600,
        });
        const identity = await local(['var', 'GIT_COMMITTER_IDENT']);
        const message = `Eldritch Launcher: changes before update ${new Date().toISOString()}`;
        const stashed = await execute({
            args: [
                '--literal-pathspecs',
                ...(identity.success ? [] : FALLBACK_IDENTITY_ARGUMENTS),
                '-c',
                'core.hooksPath=',
                'stash',
                'push',
                ...(paths.untracked.length > 0 ? ['--include-untracked'] : []),
                '--message',
                message,
                `--pathspec-from-file=${pathspecFile}`,
                '--pathspec-file-nul',
            ],
            cwd: projectPath,
            env: LOCAL_ENVIRONMENT,
            timeoutMs: GIT_MERGE_TIMEOUT_MS,
        });
        if (!stashed.success) {
            return {
                ok: false,
                message:
                    sanitizeGitMessage(stashed.stderr) ?? 'git stash failed',
            };
        }
        const commit = await local(['rev-parse', '--verify', 'refs/stash']);
        if (!commit.success) {
            return { ok: false, message: 'git stash created no stash entry' };
        }
        return {
            ok: true,
            stash: {
                ref: 'stash@{0}',
                commit: commit.stdout.trim(),
                message,
                paths: allPaths,
            },
        };
    }

    /**
     * Downloads Git LFS content for the new commits with the fetch credentials.
     *
     * @param projectPath - Updated work tree.
     * @param access - LFS settings of the opened remote.
     * @param signal - Cancellation signal.
     * @returns LFS outcome; failures keep the update.
     */
    private async pullLfs(
        projectPath: string,
        access: RemoteLfsAccess | null,
        signal: AbortSignal,
    ): Promise<RemoteProjectGitLfsOutcome> {
        if (!access) {
            return { status: 'failed', reason: 'unknown' };
        }
        const result = await this.lfs.pull({
            repositoryPath: projectPath,
            canonicalUrl: access.canonicalUrl,
            environment: access.environment,
            credentialHelper: access.credentialHelper,
            interactive: access.interactive,
            skipHooks: true,
            signal,
            onStart: () => this.report(projectPath, 'lfs', 0),
            onProgress: (percent) => this.report(projectPath, 'lfs', percent),
        });
        // Cancelling during LFS keeps the already applied fast-forward.
        return result.status === 'cancelled'
            ? { status: 'failed', reason: 'unknown' }
            : result;
    }

    /**
     * Adapts cancellable streaming execution to the buffered session shape
     * shared with the status refresh.
     *
     * @param signal - Cancellation signal for every command.
     * @returns Buffered Git session.
     */
    private createCancellableSession(
        signal: AbortSignal,
    ): ToolExecutionSession {
        return async (request): Promise<ToolExecutionResult> => {
            let stdout = '';
            let stderr = '';
            const result = await this.tools.executeStreaming('git', {
                args: request.args,
                cwd: request.cwd,
                env:
                    request.inheritEnv === false
                        ? { ...request.env }
                        : { ...process.env, ...request.env },
                signal,
                timeoutMs: request.timeoutMs ?? GIT_LOCAL_TIMEOUT_MS,
                onStdout: (chunk) => {
                    stdout += chunk;
                },
                onStderr: (chunk) => {
                    stderr += chunk;
                },
            });
            if (result.success) {
                return { success: true, stdout, stderr, exitCode: 0 };
            }
            return {
                success: false,
                reason:
                    result.reason === 'cancelled'
                        ? 'command-failed'
                        : result.reason,
                stdout,
                stderr,
                exitCode: result.exitCode,
            };
        };
    }

    /**
     * Pushes one progress step to the main window.
     *
     * @param projectPath - Project being updated.
     * @param stage - Current step.
     * @param percent - LFS percentage, when known.
     */
    private report(
        projectPath: string,
        stage: ProjectGitUpdateStage,
        percent: number | null,
    ): void {
        const webContents = getMainWindow()?.webContents;
        if (webContents && !webContents.isDestroyed?.()) {
            ipcWebContentsSend('project-git-update-progress', webContents, {
                projectPath,
                stage,
                percent,
            });
        }
    }
}
