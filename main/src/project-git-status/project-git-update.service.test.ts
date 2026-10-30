import { execFileSync, spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RemoteProjectGitLfsOutcome } from '@shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppIntegrationsService } from '../app-integrations/app-integrations.service.js';
import type { ProjectsStore } from '../projects/projects.store.js';
import { GitService } from '../tool-integration/integrations/git/git.service.js';
import type { GitCloneLfsRequest } from '../tool-integration/integrations/git/git-clone.types.js';
import { GitCloneLfsService } from '../tool-integration/integrations/git/git-clone-lfs.service.js';
import type { GitCredentialSessionService } from '../tool-integration/integrations/git/git-credential-session.service.js';
import type { ToolIntegrationService } from '../tool-integration/tool-integration.service.js';
import type {
    ToolInstallation,
    ToolStreamingExecutionRequest,
} from '../tool-integration/tool-integration.types.js';
import { ToolProcessExecutor } from '../tool-integration/tool-process.executor.js';
import { ToolStreamingProcessExecutor } from '../tool-integration/tool-streaming-process.executor.js';
import { ProjectGitStatusService } from './project-git-status.service.js';
import { ProjectGitUpdateService } from './project-git-update.service.js';

vi.mock('../mainWindow.js', () => ({ getMainWindow: () => null }));

const gitLfsInstalled =
    spawnSync('git-lfs', ['version'], { stdio: 'ignore' }).status === 0;

let root: string;
let fixtureEnvironment: NodeJS.ProcessEnv;

/** Runs one setup command synchronously with isolated configuration. */
function run(command: string, cwd: string, ...args: string[]): string {
    return execFileSync(command, args, {
        cwd,
        env: fixtureEnvironment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/** Runs one setup Git command. */
function git(cwd: string, ...args: string[]): string {
    return run('git', cwd, ...args);
}

/** Adds one commit writing `content` to `name`. */
function commit(cwd: string, name: string, content = name): void {
    writeFileSync(path.join(cwd, name), content);
    git(cwd, 'add', name);
    git(cwd, 'commit', '-q', '-m', name);
}

/** Creates a bare remote, a seed clone with two pushed files, and a work clone. */
function createRepositories(): { seed: string; work: string } {
    const remote = path.join(root, 'remote.git');
    const seed = path.join(root, 'seed');
    const work = path.join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, seed);
    commit(seed, 'project.godot', 'base\n');
    commit(seed, 'notes.txt', 'base\n');
    git(seed, 'push', '-q', 'origin', 'main');
    git(root, 'clone', '-q', remote, work);
    return { seed, work };
}

/** Pushes `count` new upstream commits touching project.godot. */
function pushUpstream(seed: string, count = 1): void {
    for (let index = 0; index < count; index += 1) {
        commit(seed, 'project.godot', `upstream ${index}\n`);
    }
    git(seed, 'push', '-q', 'origin', 'main');
}

/** Creates the services with real Git and a fixed project list. */
function createService(
    projectPaths: string[],
    lfsPull?: (request: GitCloneLfsRequest) => Promise<unknown>,
) {
    const installation = (toolId: string): ToolInstallation => ({
        executablePath: toolId,
        executableArgs: [],
        version: null,
        source: 'detected',
    });
    const executor = new ToolProcessExecutor();
    const streaming = new ToolStreamingProcessExecutor();
    const tools = {
        createExecutionSession:
            async () =>
            (request: Parameters<ToolProcessExecutor['execute']>[1]) =>
                executor.execute(installation('git'), request),
        executeStreaming: (
            toolId: string,
            request: ToolStreamingExecutionRequest,
        ) => streaming.execute(installation(toolId), request),
    } as unknown as ToolIntegrationService;
    const projects = {
        list: async () =>
            projectPaths.map((projectPath) => ({ path: projectPath })),
    } as unknown as ProjectsStore;
    const git = new GitService(tools);
    const statuses = new ProjectGitStatusService(
        projects,
        git,
        tools,
        {} as GitCredentialSessionService,
        {} as AppIntegrationsService,
    );
    const pull = vi.fn(
        lfsPull ??
            (async (): Promise<RemoteProjectGitLfsOutcome> => ({
                status: 'not-used',
            })),
    );
    const lfs = lfsPull
        ? ({ pull } as unknown as GitCloneLfsService)
        : new GitCloneLfsService(tools, {
              warn: vi.fn(),
              debug: vi.fn(),
          } as never);
    const service = new ProjectGitUpdateService(
        projects,
        git,
        tools,
        statuses,
        lfs,
    );
    return { service, statuses, pull };
}

beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'git-update-')));
    const globalConfig = path.join(root, 'fixture-global.config');
    writeFileSync(globalConfig, '');
    // The launcher's Git processes inherit this; no user identity is set so
    // the stash identity fallback is exercised.
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    fixtureEnvironment = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
    };
});

afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
});

describe('ProjectGitUpdateService', () => {
    it('fast-forwards a branch that is behind and refreshes its status', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed, 2);
        const { service, statuses } = createService([work]);

        const result = await service.updateProject(work);

        expect(result).toEqual({
            status: 'updated',
            commits: 2,
            lfs: { status: 'not-used' },
            stash: null,
        });
        expect(git(work, 'rev-parse', 'HEAD')).toBe(
            git(seed, 'rev-parse', 'HEAD'),
        );
        expect(git(work, 'rev-list', '--merges', '--count', 'HEAD')).toBe(
            '0\n',
        );
        expect(statuses.getStatuses()).toEqual([
            expect.objectContaining({ state: 'ok', ahead: 0, behind: 0 }),
        ]);
    });

    it('reports up-to-date when nothing is new', async () => {
        const { work } = createRepositories();
        const { service } = createService([work]);

        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'up-to-date',
        });
    });

    it('refuses a branch with local commits', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        commit(work, 'local.txt');
        const head = git(work, 'rev-parse', 'HEAD');
        const { service } = createService([work]);

        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'refused',
            reason: 'diverged',
        });
        expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    });

    it('refuses a detached HEAD and a branch without upstream', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        const { service } = createService([work]);

        git(work, 'checkout', '-q', '--detach');
        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'refused',
            reason: 'detached',
        });

        git(work, 'checkout', '-q', '-b', 'topic');
        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'refused',
            reason: 'no-upstream',
        });
    });

    it('refuses unregistered paths', async () => {
        const { work } = createRepositories();
        const { service } = createService([]);

        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'refused',
            reason: 'not-registered',
        });
    });

    it('keeps a local change the incoming commits do not touch', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        writeFileSync(path.join(work, 'notes.txt'), 'local edit\n');
        const { service } = createService([work]);

        const result = await service.updateProject(work);

        expect(result).toMatchObject({ status: 'updated', commits: 1 });
        expect(readFileSync(path.join(work, 'notes.txt'), 'utf8')).toBe(
            'local edit\n',
        );
        expect(readFileSync(path.join(work, 'project.godot'), 'utf8')).toBe(
            'upstream 0\n',
        );
    });

    it('reports conflicting local changes without touching them', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        writeFileSync(path.join(work, 'project.godot'), 'editor regen\n');
        const head = git(work, 'rev-parse', 'HEAD');
        const { service } = createService([work]);

        await expect(service.updateProject(work)).resolves.toEqual({
            status: 'local-changes',
            paths: ['project.godot'],
            totalPaths: 1,
        });
        expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
        expect(readFileSync(path.join(work, 'project.godot'), 'utf8')).toBe(
            'editor regen\n',
        );
        expect(git(work, 'stash', 'list')).toBe('');
    });

    it('stashes only the conflicting paths when asked, then updates', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        commit(seed, 'icon.png.import', 'upstream import\n');
        git(seed, 'push', '-q', 'origin', 'main');
        writeFileSync(path.join(work, 'project.godot'), 'editor regen\n');
        writeFileSync(path.join(work, 'icon.png.import'), 'local import\n');
        writeFileSync(path.join(work, 'notes.txt'), 'keep me\n');
        const { service } = createService([work]);

        const result = await service.updateProject(work, {
            discardGeneratedChanges: true,
        });

        expect(result).toMatchObject({
            status: 'updated',
            commits: 2,
            stash: {
                ref: 'stash@{0}',
                message: expect.stringMatching(
                    /^Eldritch Launcher: changes before update \d{4}-/u,
                ),
                paths: ['project.godot', 'icon.png.import'],
            },
        });
        if (result.status !== 'updated' || !result.stash) throw new Error();
        expect(git(work, 'rev-parse', 'refs/stash').trim()).toBe(
            result.stash.commit,
        );
        expect(git(work, 'show', 'stash@{0}:project.godot')).toBe(
            'editor regen\n',
        );
        expect(git(work, 'show', 'stash@{0}^3:icon.png.import')).toBe(
            'local import\n',
        );
        expect(readFileSync(path.join(work, 'notes.txt'), 'utf8')).toBe(
            'keep me\n',
        );
        expect(git(work, 'rev-parse', 'HEAD')).toBe(
            git(seed, 'rev-parse', 'HEAD'),
        );
    });

    it('pulls Git LFS with the fetch environment and keeps the update when LFS fails', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        const lfsPull = vi.fn(async (request: GitCloneLfsRequest) => {
            request.onStart();
            request.onProgress(50);
            return {
                status: 'failed',
                reason: 'network-failed',
            } satisfies RemoteProjectGitLfsOutcome;
        });
        const { service, pull } = createService([work], lfsPull);

        const result = await service.updateProject(work);

        expect(result).toEqual({
            status: 'updated',
            commits: 1,
            lfs: { status: 'failed', reason: 'network-failed' },
            stash: null,
        });
        expect(pull).toHaveBeenCalledOnce();
        expect(pull.mock.calls[0]?.[0]).toMatchObject({
            repositoryPath: work,
            canonicalUrl: null,
            interactive: false,
            skipHooks: true,
            environment: expect.objectContaining({
                GIT_TERMINAL_PROMPT: '0',
                GCM_INTERACTIVE: 'never',
            }),
        });
        expect(git(work, 'rev-parse', 'HEAD')).toBe(
            git(seed, 'rev-parse', 'HEAD'),
        );
    });

    it('does not run Git LFS when the update is refused', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        commit(work, 'local.txt');
        const { service, pull } = createService([work], vi.fn());

        await service.updateProject(work);

        expect(pull).not.toHaveBeenCalled();
    });

    it('holds status refreshes until the update finishes and joins duplicate updates', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        const lfs = Promise.withResolvers<RemoteProjectGitLfsOutcome>();
        const { service, statuses } = createService([work], () => lfs.promise);

        const first = service.updateProject(work);
        const second = service.updateProject(work);
        await vi.waitFor(() =>
            expect(git(work, 'rev-parse', 'HEAD')).toBe(
                git(seed, 'rev-parse', 'HEAD'),
            ),
        );
        const computeStatus = vi.spyOn(
            statuses as unknown as { computeStatus: () => unknown },
            'computeStatus',
        );
        const refresh = statuses.refreshProject(work);
        // Drains every queued microtask; an ungated refresh starts computing
        // within them.
        const drained = Promise.withResolvers<void>();
        setImmediate(drained.resolve);
        await drained.promise;
        expect(computeStatus).not.toHaveBeenCalled();

        lfs.resolve({ status: 'pulled' });
        const [a, b] = await Promise.all([first, second]);
        expect(a).toBe(b);
        expect(a).toMatchObject({
            status: 'updated',
            lfs: { status: 'pulled' },
        });
        await expect(refresh).resolves.toMatchObject({ behind: 0 });
    });

    it('cancels a running update', async () => {
        const { seed, work } = createRepositories();
        pushUpstream(seed);
        const { service } = createService([work]);

        const result = service.updateProject(work);
        expect(service.cancelUpdate(work)).toBe(true);

        await expect(result).resolves.toEqual({ status: 'cancelled' });
        expect(service.cancelUpdate(work)).toBe(false);
    });

    it.skipIf(!gitLfsInstalled)(
        'downloads Git LFS content of the new commits from a real remote',
        async () => {
            const { seed, work } = createRepositories();
            run('git-lfs', seed, 'install', '--local');
            writeFileSync(
                path.join(seed, '.gitattributes'),
                '*.bin filter=lfs diff=lfs merge=lfs -text\n',
            );
            writeFileSync(path.join(seed, 'asset.bin'), 'binary payload\n');
            git(seed, 'add', '.');
            git(seed, 'commit', '-q', '-m', 'asset');
            git(seed, 'push', '-q', 'origin', 'main');
            const { service } = createService([work]);

            const result = await service.updateProject(work);

            expect(result).toMatchObject({
                status: 'updated',
                lfs: { status: 'pulled' },
            });
            expect(readFileSync(path.join(work, 'asset.bin'), 'utf8')).toBe(
                'binary payload\n',
            );
        },
    );
});
