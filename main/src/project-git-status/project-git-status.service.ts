import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@mariodebono/di';
import type { ProjectGitStatus } from '@shared/contracts';
import logger from 'electron-log';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { AppIntegrationsService } from '../app-integrations/app-integrations.service.js';
import { GitHubStoredCredentialSchema } from '../app-integrations/providers/github/github-app-integration.schema.js';
import { getMainWindow } from '../mainWindow.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectsStore } from '../projects/projects.store.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GitService } from '../tool-integration/integrations/git/git.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GitCredentialSessionService } from '../tool-integration/integrations/git/git-credential-session.service.js';
import {
    createGitHttpsSafetyArguments,
    createGitNetworkEnvironment,
    createIsolatedGitConfig,
} from '../tool-integration/integrations/git/git-network-process.util.js';
import { normalizeGitRemoteUrl } from '../tool-integration/integrations/git/git-remote-url-normalizer.util.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ToolIntegrationService } from '../tool-integration/tool-integration.service.js';
import type {
    ToolExecutionResult,
    ToolExecutionSession,
} from '../tool-integration/tool-integration.types.js';
import { ipcWebContentsSend } from '../utils.js';
import {
    classifyFetchFailure,
    classifyRemoteUrl,
    type GitFetchFailureKind,
    parseHeadBranch,
    parseLeftRightCount,
    parseMergeRef,
    sanitizeGitMessage,
} from './project-git-status.util.js';

export const PROJECT_GIT_STATUS_CONCURRENCY = 4;
export const GIT_FETCH_TIMEOUT_MS = 30_000;
const GIT_LOCAL_TIMEOUT_MS = 5_000;
const LOCAL_ENVIRONMENT = {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C',
} as const;
/** Keeps fetch from running repository maintenance or recursing. */
const FETCH_SIDE_EFFECT_ARGUMENTS = [
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=false',
    '-c',
    'fetch.recurseSubmodules=false',
] as const;
/** Inherited variables that could launch an interactive credential prompt. */
const PROMPTING_ENVIRONMENT_KEYS: Record<string, true> = {
    GIT_ASKPASS: true,
    SSH_ASKPASS: true,
};

export type GitHubFetchCredential = { username: string; password: string };

/** Lazily reads at most one GitHub credential for one refresh batch. */
export type GitHubCredentialSource =
    () => Promise<GitHubFetchCredential | null>;

type UpstreamDetails = {
    branch: string;
    upstream: string;
    trackingRef: string;
    remote: string;
    mergeRef: string;
};

type FetchOutcome =
    | { ok: true }
    | { ok: false; kind: GitFetchFailureKind; message: string | null };

/**
 * Computes, caches and publishes read-only ahead/behind state for projects.
 *
 * Only remote-tracking refs are written (by `git fetch`); the work tree,
 * index, branches and FETCH_HEAD are never modified.
 */
@Injectable()
export class ProjectGitStatusService {
    private readonly cache = new Map<string, ProjectGitStatus>();
    private readonly inFlight = new Map<string, Promise<ProjectGitStatus>>();
    private readonly queue: Array<() => void> = [];
    private active = 0;

    /**
     * Creates the project Git status service.
     *
     * @param projects - Registered project store.
     * @param git - Repository inspection service.
     * @param tools - Validated Git execution boundary.
     * @param credentials - Loopback-only Git credential sessions.
     * @param integrations - Connected app integrations providing GitHub tokens.
     */
    constructor(
        private readonly projects: ProjectsStore,
        private readonly git: GitService,
        private readonly tools: ToolIntegrationService,
        private readonly credentials: GitCredentialSessionService,
        private readonly integrations: AppIntegrationsService,
    ) {}

    /** Returns every cached status without running Git. */
    getStatuses(): ProjectGitStatus[] {
        return [...this.cache.values()];
    }

    /**
     * Refreshes one registered project.
     *
     * @param projectPath - Exact registered project path.
     * @returns The new status, or null when the path is not registered.
     */
    async refreshProject(
        projectPath: string,
    ): Promise<ProjectGitStatus | null> {
        const projects = await this.projects.list();
        if (!projects.some((project) => project.path === projectPath)) {
            return null;
        }
        return this.refresh(projectPath, this.createCredentialSource());
    }

    /**
     * Refreshes every registered project and forgets removed ones.
     *
     * @returns Statuses for every registered project.
     */
    async refreshAll(): Promise<ProjectGitStatus[]> {
        const projectPaths = [
            ...new Set((await this.projects.list()).map(({ path }) => path)),
        ];
        const registered = new Set(projectPaths);
        for (const cachedPath of this.cache.keys()) {
            if (!registered.has(cachedPath)) {
                this.cache.delete(cachedPath);
            }
        }
        const credentialSource = this.createCredentialSource();
        return Promise.all(
            projectPaths.map((projectPath) =>
                this.refresh(projectPath, credentialSource),
            ),
        );
    }

    /**
     * Refreshes one path, joining an in-flight refresh for the same path.
     *
     * @param projectPath - Project path to refresh.
     * @param credentialSource - Batch-scoped GitHub credential reader.
     * @returns The cached and published status.
     */
    refresh(
        projectPath: string,
        credentialSource: GitHubCredentialSource,
    ): Promise<ProjectGitStatus> {
        const existing = this.inFlight.get(projectPath);
        if (existing) {
            return existing;
        }
        const run = this.withSlot(() =>
            this.computeStatus(projectPath, credentialSource),
        )
            .then((status) => {
                this.cache.set(projectPath, status);
                publish(status);
                return status;
            })
            .finally(() => {
                if (this.inFlight.get(projectPath) === run) {
                    this.inFlight.delete(projectPath);
                }
            });
        this.inFlight.set(projectPath, run);
        return run;
    }

    /**
     * Creates a batch-scoped reader that leases a GitHub credential at most once.
     *
     * The lease is held only while the token is read so long fetches never
     * block other GitHub integration operations.
     *
     * @returns Memoised credential reader.
     */
    createCredentialSource(): GitHubCredentialSource {
        let pending: Promise<GitHubFetchCredential | null> | undefined;
        return () => {
            pending ??= this.integrations
                .withCredentialLease('github', async (routes) => {
                    for (const route of routes) {
                        const parsed = GitHubStoredCredentialSchema.safeParse(
                            parseJson(route.credential),
                        );
                        if (parsed.success) {
                            return {
                                username: 'x-access-token',
                                password: parsed.data.accessToken,
                            };
                        }
                    }
                    return null;
                })
                .then((lease) => (lease.ok ? lease.value : null))
                .catch(() => null);
            return pending;
        };
    }

    /**
     * Runs one task once a concurrency slot is free.
     *
     * @param task - Work to run inside the slot.
     * @returns The task result.
     */
    private async withSlot<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= PROJECT_GIT_STATUS_CONCURRENCY) {
            const slot = Promise.withResolvers<void>();
            this.queue.push(slot.resolve);
            await slot.promise;
        } else {
            this.active += 1;
        }
        try {
            return await task();
        } finally {
            const next = this.queue.shift();
            if (next) {
                next();
            } else {
                this.active -= 1;
            }
        }
    }

    /**
     * Computes a status, converting unexpected failures to the `error` state.
     *
     * @param projectPath - Project path to inspect.
     * @param credentialSource - Batch-scoped GitHub credential reader.
     * @returns A complete status.
     */
    private async computeStatus(
        projectPath: string,
        credentialSource: GitHubCredentialSource,
    ): Promise<ProjectGitStatus> {
        const base: ProjectGitStatus = {
            projectPath,
            state: 'error',
            branch: null,
            upstream: null,
            ahead: null,
            behind: null,
            stale: false,
            message: null,
            checkedAt: 0,
        };
        let status: ProjectGitStatus;
        try {
            status = await this.inspect(projectPath, credentialSource, base);
        } catch (error) {
            logger.warn('Project Git status check failed unexpectedly', error);
            status = base;
        }
        return { ...status, checkedAt: Date.now() };
    }

    /**
     * Reads branch and upstream state, fetches, then counts commits.
     *
     * @param projectPath - Project path to inspect.
     * @param credentialSource - Batch-scoped GitHub credential reader.
     * @param base - Status defaults for this project.
     * @returns The computed status without a timestamp.
     */
    private async inspect(
        projectPath: string,
        credentialSource: GitHubCredentialSource,
        base: ProjectGitStatus,
    ): Promise<ProjectGitStatus> {
        const inspection = await this.git.inspectRepository(projectPath);
        if (inspection.status === 'not-a-repository') {
            return { ...base, state: 'not-a-repo' };
        }
        if (inspection.status !== 'inside-work-tree') {
            return {
                ...base,
                message:
                    inspection.status === 'git-unavailable'
                        ? 'Git is unavailable'
                        : 'Git could not inspect this project',
            };
        }

        const execute = await this.tools.createExecutionSession('git');
        const local = (args: readonly string[]) =>
            execute({
                args,
                cwd: projectPath,
                env: LOCAL_ENVIRONMENT,
                timeoutMs: GIT_LOCAL_TIMEOUT_MS,
            });

        const head = await local(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (!head.success) {
            return { ...base, message: sanitizeGitMessage(head.stderr) };
        }
        const branch = parseHeadBranch(head.stdout);
        if (branch === undefined) {
            return base;
        }
        if (branch === null) {
            return { ...base, state: 'detached' };
        }

        const upstream = await readUpstream(local, branch);
        if (!upstream) {
            return { ...base, state: 'no-upstream', branch };
        }
        const tracked: ProjectGitStatus = {
            ...base,
            branch,
            upstream: upstream.upstream,
        };

        const fetched =
            upstream.remote === '.'
                ? ({ ok: true } as const)
                : await this.fetchUpstream(
                      execute,
                      local,
                      projectPath,
                      upstream,
                      credentialSource,
                  );

        const counts = await local([
            'rev-list',
            '--left-right',
            '--count',
            'HEAD...@{u}',
        ]);
        const parsed = counts.success
            ? parseLeftRightCount(counts.stdout)
            : null;

        if (!fetched.ok) {
            return {
                ...tracked,
                state: fetched.kind,
                ahead: parsed?.ahead ?? null,
                behind: parsed?.behind ?? null,
                stale: parsed !== null,
                message: fetched.kind === 'error' ? fetched.message : null,
            };
        }
        if (!parsed) {
            return {
                ...tracked,
                message: counts.success
                    ? 'Unexpected rev-list output'
                    : sanitizeGitMessage(counts.stderr),
            };
        }
        return { ...tracked, state: 'ok', ...parsed };
    }

    /**
     * Fetches the upstream branch into its remote-tracking ref.
     *
     * GitHub HTTPS remotes use the connected GitHub integration through a
     * destination-bound loopback credential helper, so the token never reaches
     * argv, disk or the environment. Other remotes use the user's own Git
     * configuration with every interactive prompt disabled.
     *
     * @param execute - Validated Git execution session.
     * @param local - Local read-only Git runner for the project.
     * @param projectPath - Project working directory.
     * @param upstream - Resolved upstream details.
     * @param credentialSource - Batch-scoped GitHub credential reader.
     * @returns Success or a classified failure.
     */
    private async fetchUpstream(
        execute: ToolExecutionSession,
        local: (args: readonly string[]) => Promise<ToolExecutionResult>,
        projectPath: string,
        upstream: UpstreamDetails,
        credentialSource: GitHubCredentialSource,
    ): Promise<FetchOutcome> {
        const remoteUrl = await local(['remote', 'get-url', upstream.remote]);
        if (!remoteUrl.success) {
            return {
                ok: false,
                kind: 'error',
                message: sanitizeGitMessage(remoteUrl.stderr),
            };
        }
        const url = remoteUrl.stdout.trim();
        const normalized = normalizeGitRemoteUrl(url);
        const remoteKind = classifyRemoteUrl(url, normalized);

        const supportDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), 'eldritch-launcher-git-status-'),
        );
        const hooksDirectory = path.join(supportDirectory, 'hooks');
        let closeCredentialSession: (() => Promise<void>) | undefined;
        try {
            await fs.mkdir(hooksDirectory, { mode: 0o700 });
            const fetchArguments = [
                'fetch',
                '--no-tags',
                '--prune',
                '--no-recurse-submodules',
                '--no-write-fetch-head',
            ];
            const credential =
                remoteKind === 'github-https' && normalized
                    ? await credentialSource()
                    : null;

            let result: ToolExecutionResult;
            if (credential && normalized) {
                const canonicalUrl = `${normalized}.git`;
                const session = await this.credentials.openBound(
                    credential,
                    canonicalUrl,
                );
                closeCredentialSession = session.close;
                const configPaths =
                    await createIsolatedGitConfig(supportDirectory);
                result = await execute({
                    args: [
                        ...createGitHttpsSafetyArguments(true),
                        '-c',
                        `credential.helper=${session.helper}`,
                        '-c',
                        'core.askPass=',
                        '-c',
                        `core.hooksPath=${hooksDirectory}`,
                        ...FETCH_SIDE_EFFECT_ARGUMENTS,
                        ...fetchArguments,
                        canonicalUrl,
                        `+${upstream.mergeRef}:${upstream.trackingRef}`,
                    ],
                    cwd: projectPath,
                    env: createGitNetworkEnvironment(
                        configPaths,
                        session.environment,
                    ),
                    inheritEnv: false,
                    timeoutMs: GIT_FETCH_TIMEOUT_MS,
                });
            } else {
                const sshCommand =
                    remoteKind === 'ssh'
                        ? await resolveBatchSshCommand(local)
                        : undefined;
                result = await execute({
                    args: [
                        '-c',
                        'core.askPass=',
                        '-c',
                        'credential.interactive=false',
                        '-c',
                        `core.hooksPath=${hooksDirectory}`,
                        ...FETCH_SIDE_EFFECT_ARGUMENTS,
                        ...fetchArguments,
                        upstream.remote,
                        upstream.mergeRef,
                    ],
                    cwd: projectPath,
                    env: createNonInteractiveEnvironment(sshCommand),
                    inheritEnv: false,
                    timeoutMs: GIT_FETCH_TIMEOUT_MS,
                });
            }
            if (result.success) {
                return { ok: true };
            }
            return {
                ok: false,
                kind: classifyFetchFailure(
                    result.stderr,
                    result.reason === 'timed-out',
                ),
                message:
                    sanitizeGitMessage(result.stderr) ??
                    (result.reason === 'command-failed'
                        ? 'git fetch failed'
                        : `Git is ${result.reason}`),
            };
        } finally {
            await closeCredentialSession?.().catch(() => undefined);
            await fs
                .rm(supportDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    }
}

/**
 * Resolves the configured upstream of one branch.
 *
 * @param local - Local read-only Git runner for the project.
 * @param branch - Checked-out branch name.
 * @returns Upstream details, or null when no usable upstream is configured.
 */
async function readUpstream(
    local: (args: readonly string[]) => Promise<ToolExecutionResult>,
    branch: string,
): Promise<UpstreamDetails | null> {
    const [shortName, trackingRef, remote, merge] = await Promise.all([
        local(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
        local(['rev-parse', '--symbolic-full-name', '@{u}']),
        local(['config', '--get', `branch.${branch}.remote`]),
        local(['config', '--get', `branch.${branch}.merge`]),
    ]);
    if (
        !shortName.success ||
        !trackingRef.success ||
        !remote.success ||
        !merge.success
    ) {
        return null;
    }
    const mergeRef = parseMergeRef(merge.stdout);
    const remoteName = remote.stdout.trim();
    const tracking = trackingRef.stdout.trim();
    if (!mergeRef || !remoteName || !tracking.startsWith('refs/')) {
        return null;
    }
    return {
        branch,
        upstream: shortName.stdout.trim(),
        trackingRef: tracking,
        remote: remoteName,
        mergeRef,
    };
}

/**
 * Chooses a non-interactive SSH command unless the user configured their own.
 *
 * @param local - Local read-only Git runner for the project.
 * @returns `GIT_SSH_COMMAND` value, or undefined to keep the user's choice.
 */
async function resolveBatchSshCommand(
    local: (args: readonly string[]) => Promise<ToolExecutionResult>,
): Promise<string | undefined> {
    if (process.env.GIT_SSH_COMMAND || process.env.GIT_SSH) {
        return undefined;
    }
    const configured = await local(['config', '--get', 'core.sshCommand']);
    if (configured.success && configured.stdout.trim()) {
        return undefined;
    }
    return 'ssh -o BatchMode=yes';
}

/**
 * Builds the inherited environment with every Git prompt disabled.
 *
 * @param sshCommand - Optional non-interactive SSH command.
 * @returns Child process environment.
 */
function createNonInteractiveEnvironment(
    sshCommand: string | undefined,
): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!PROMPTING_ENVIRONMENT_KEYS[key.toUpperCase()]) {
            environment[key] = value;
        }
    }
    return {
        ...environment,
        ...LOCAL_ENVIRONMENT,
        GCM_INTERACTIVE: 'never',
        ...(sshCommand ? { GIT_SSH_COMMAND: sshCommand } : {}),
    };
}

/**
 * Parses JSON without throwing.
 *
 * @param value - Serialized credential bundle.
 * @returns The parsed value, or undefined when invalid.
 */
function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

/**
 * Sends one status to the main window when it is available.
 *
 * @param status - Freshly computed status.
 */
function publish(status: ProjectGitStatus): void {
    const webContents = getMainWindow()?.webContents;
    if (webContents && !webContents.isDestroyed?.()) {
        ipcWebContentsSend('project-git-status-updated', webContents, status);
    }
}
