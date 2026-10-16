import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectDetails } from '@shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppIntegrationsService } from '../app-integrations/app-integrations.service.js';
import type { ProjectsStore } from '../projects/projects.store.js';
import { GitService } from '../tool-integration/integrations/git/git.service.js';
import type { GitCredentialSessionService } from '../tool-integration/integrations/git/git-credential-session.service.js';
import type { ToolIntegrationService } from '../tool-integration/tool-integration.service.js';
import type { ToolInstallation } from '../tool-integration/tool-integration.types.js';
import { ToolProcessExecutor } from '../tool-integration/tool-process.executor.js';
import {
    PROJECT_GIT_STATUS_CONCURRENCY,
    ProjectGitStatusService,
} from './project-git-status.service.js';

vi.mock('../mainWindow.js', () => ({ getMainWindow: () => null }));

const GIT_INSTALLATION: ToolInstallation = {
    executablePath: 'git',
    executableArgs: [],
    version: null,
    source: 'detected',
};
const TEST_GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
};

let root: string;

/** Runs one setup Git command synchronously. */
function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, {
        cwd,
        env: TEST_GIT_ENV,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/** Adds one commit that touches a unique file. */
function commit(cwd: string, name: string): void {
    writeFileSync(path.join(cwd, name), name);
    git(cwd, 'add', name);
    git(cwd, 'commit', '-q', '-m', name);
}

/** Creates a bare remote, a seed clone with one pushed commit, and a work clone. */
function createRepositories(): { remote: string; seed: string; work: string } {
    const remote = path.join(root, 'remote.git');
    const seed = path.join(root, 'seed');
    const work = path.join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, seed);
    commit(seed, 'initial');
    git(seed, 'push', '-q', 'origin', 'main');
    git(root, 'clone', '-q', remote, work);
    return { remote, seed, work };
}

/** Creates the service with real Git and a fixed project list. */
function createService(
    projectPaths: string[],
    integrations: Partial<AppIntegrationsService> = {},
) {
    const executor = new ToolProcessExecutor();
    const createExecutionSession = vi.fn(
        async () => (request: Parameters<ToolProcessExecutor['execute']>[1]) =>
            executor.execute(GIT_INSTALLATION, request),
    );
    const tools = {
        createExecutionSession,
    } as unknown as ToolIntegrationService;
    const projects = {
        list: async () =>
            projectPaths.map((projectPath) => ({ path: projectPath })),
    } as unknown as ProjectsStore;
    const service = new ProjectGitStatusService(
        projects,
        new GitService(tools),
        tools,
        {} as GitCredentialSessionService,
        integrations as AppIntegrationsService,
    );
    return { service, createExecutionSession };
}

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'project-git-status-test-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('ProjectGitStatusService', () => {
    it('fetches the upstream and reports ahead and behind counts', async () => {
        const { seed, work } = createRepositories();
        commit(seed, 'remote-1');
        commit(seed, 'remote-2');
        git(seed, 'push', '-q', 'origin', 'main');
        commit(work, 'local-1');
        const { service } = createService([work]);

        const status = await service.refreshProject(work);

        expect(status).toMatchObject({
            projectPath: work,
            state: 'ok',
            branch: 'main',
            upstream: 'origin/main',
            ahead: 1,
            behind: 2,
            stale: false,
            message: null,
        });
        expect(status?.checkedAt).toBeGreaterThan(0);
        expect(service.getStatuses()).toEqual([status]);
        expect(git(work, 'rev-parse', 'origin/main')).toBe(
            git(seed, 'rev-parse', 'HEAD'),
        );
        expect(git(work, 'status', '--porcelain')).toBe('');
    });

    it('reports up to date when both sides match', async () => {
        const { work } = createRepositories();
        const { service } = createService([work]);

        await expect(service.refreshProject(work)).resolves.toMatchObject({
            state: 'ok',
            ahead: 0,
            behind: 0,
        });
    });

    it('reports a branch without an upstream', async () => {
        const { work } = createRepositories();
        git(work, 'checkout', '-q', '-b', 'feature');
        const { service } = createService([work]);

        await expect(service.refreshProject(work)).resolves.toMatchObject({
            state: 'no-upstream',
            branch: 'feature',
            upstream: null,
            ahead: null,
            behind: null,
        });
    });

    it('reports a detached HEAD', async () => {
        const { work } = createRepositories();
        git(work, 'checkout', '-q', '--detach');
        const { service } = createService([work]);

        await expect(service.refreshProject(work)).resolves.toMatchObject({
            state: 'detached',
            branch: null,
        });
    });

    it('reports a folder outside any repository', async () => {
        const plain = path.join(root, 'plain');
        mkdirSync(plain);
        const { service } = createService([plain]);

        await expect(service.refreshProject(plain)).resolves.toMatchObject({
            state: 'not-a-repo',
        });
    });

    it('keeps last-known counts as stale when fetching fails', async () => {
        const { seed, work } = createRepositories();
        commit(seed, 'remote-1');
        git(seed, 'push', '-q', 'origin', 'main');
        commit(work, 'local-1');
        const { service } = createService([work]);
        await expect(service.refreshProject(work)).resolves.toMatchObject({
            state: 'ok',
            ahead: 1,
            behind: 1,
        });

        commit(seed, 'remote-unseen');
        git(seed, 'push', '-q', 'origin', 'main');
        git(work, 'remote', 'set-url', 'origin', path.join(root, 'missing'));

        const status = await service.refreshProject(work);

        expect(status).toMatchObject({
            state: 'error',
            ahead: 1,
            behind: 1,
            stale: true,
        });
        expect(status?.message).toMatch(/missing|repository/u);
    });

    it('ignores unregistered paths', async () => {
        const { work } = createRepositories();
        const { service, createExecutionSession } = createService([]);

        await expect(service.refreshProject(work)).resolves.toBeNull();
        expect(createExecutionSession).not.toHaveBeenCalled();
    });

    it('joins an in-flight refresh for the same project', async () => {
        const { work } = createRepositories();
        const { service, createExecutionSession } = createService([work]);
        const source = vi.fn(async () => null);

        const first = service.refresh(work, source);
        const second = service.refresh(work, source);

        expect(second).toBe(first);
        await first;
        // One refresh: one session for inspection and one for status commands.
        expect(createExecutionSession).toHaveBeenCalledTimes(2);
        expect(source).not.toHaveBeenCalled();
    });

    it('refreshes all projects with bounded concurrency', async () => {
        const projectPaths = Array.from({ length: 10 }, (_, index) =>
            path.join(root, `project-${index}`),
        );
        let active = 0;
        let maxActive = 0;
        const gates: Array<() => void> = [];
        const tools = {
            createExecutionSession: vi.fn(),
        } as unknown as ToolIntegrationService;
        const git = {
            inspectRepository: vi.fn(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                const gate = Promise.withResolvers<void>();
                gates.push(gate.resolve);
                await gate.promise;
                active -= 1;
                return { status: 'not-a-repository' as const };
            }),
        } as unknown as GitService;
        const service = new ProjectGitStatusService(
            {
                list: async () =>
                    projectPaths.map(
                        (projectPath) =>
                            ({ path: projectPath }) as ProjectDetails,
                    ),
            } as unknown as ProjectsStore,
            git,
            tools,
            {} as GitCredentialSessionService,
            {} as AppIntegrationsService,
        );

        const pending = service.refreshAll();
        for (let released = 0; released < projectPaths.length; released++) {
            await vi.waitFor(() =>
                expect(gates.length).toBeGreaterThan(released),
            );
            expect(active).toBeLessThanOrEqual(PROJECT_GIT_STATUS_CONCURRENCY);
            gates[released]();
        }
        const statuses = await pending;

        expect(statuses.map((status) => status.state)).toEqual(
            projectPaths.map(() => 'not-a-repo'),
        );
        expect(maxActive).toBe(PROJECT_GIT_STATUS_CONCURRENCY);
    });

    it('leases one GitHub credential per batch', async () => {
        const withCredentialLease = vi.fn(
            async (
                _provider: string,
                operation: (
                    routes: readonly { credential: string }[],
                ) => Promise<unknown>,
            ) => ({
                ok: true as const,
                value: await operation([
                    { credential: 'not json' },
                    {
                        credential: JSON.stringify({
                            version: 1,
                            createdAt: '2026-01-01T00:00:00.000Z',
                            accessToken: 'ghu_token',
                            expiresIn: 28_800,
                            refreshToken: 'ghr_token',
                            refreshTokenExpiresIn: 15_897_600,
                            scope: '',
                            tokenType: 'bearer',
                        }),
                    },
                ]),
            }),
        );
        const { service } = createService([], {
            withCredentialLease,
        } as unknown as Partial<AppIntegrationsService>);

        const source = service.createCredentialSource();

        await expect(source()).resolves.toEqual({
            username: 'x-access-token',
            password: 'ghu_token',
        });
        await source();
        expect(withCredentialLease).toHaveBeenCalledTimes(1);
        expect(withCredentialLease).toHaveBeenCalledWith(
            'github',
            expect.any(Function),
        );
    });

    it('treats an unavailable GitHub connection as no credential', async () => {
        const { service } = createService([], {
            withCredentialLease: vi.fn(async () => ({
                ok: false as const,
                reason: 'no-usable-connection' as const,
            })),
        } as unknown as Partial<AppIntegrationsService>);

        await expect(service.createCredentialSource()()).resolves.toBeNull();
    });
});
