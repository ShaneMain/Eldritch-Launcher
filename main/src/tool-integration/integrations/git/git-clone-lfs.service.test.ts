import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolStreamingExecutionRequest } from '../../tool-integration.types.js';
import { ToolStreamingProcessExecutor } from '../../tool-streaming-process.executor.js';
import type { GitCloneLfsRequest } from './git-clone.types.js';
import { GitCloneLfsService } from './git-clone-lfs.service.js';
import {
    createGitNetworkEnvironment,
    createIsolatedGitConfig,
} from './git-network-process.util.js';

const ATTRIBUTES = 'filter=lfs diff=lfs merge=lfs -text';
const UNREACHABLE_URL = 'https://127.0.0.1:9/team/game.git';
const gitLfsInstalled =
    spawnSync('git-lfs', ['version'], { stdio: 'ignore' }).status === 0;

/** Reads the command-scoped Git config carried by one process environment. */
function readCommandConfig(
    environment: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
    const count = Number(environment.GIT_CONFIG_COUNT ?? 0);
    return Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
            environment[`GIT_CONFIG_KEY_${index}`],
            environment[`GIT_CONFIG_VALUE_${index}`],
        ]),
    );
}

describe('GitCloneLfsService with a mocked executor', () => {
    const executeStreaming = vi.fn();
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const service = new GitCloneLfsService(
        { executeStreaming } as never,
        logger as never,
    );

    /** Builds one pull request over a fixed fake clone. */
    function createRequest(
        overrides: Partial<GitCloneLfsRequest> = {},
    ): GitCloneLfsRequest {
        return {
            repositoryPath: '/projects/.game.clone',
            canonicalUrl: 'https://github.com/owner/game.git',
            environment: {
                GIT_ASKPASS: '/attempt/connected-askpass',
                GODOT_LAUNCHER_GIT_CREDENTIAL_SESSION: 'opaque-ref',
            },
            interactive: true,
            signal: new AbortController().signal,
            onStart: vi.fn(),
            onProgress: vi.fn(),
            ...overrides,
        };
    }

    /** Answers detection with LFS paths, then runs the given LFS handlers. */
    function withTrackedFiles(
        ...handlers: Array<
            (request: ToolStreamingExecutionRequest) => Promise<unknown>
        >
    ): void {
        executeStreaming.mockImplementationOnce(
            async (_toolId, request: ToolStreamingExecutionRequest) => {
                request.onStdout?.('art/hero.png\0audio/');
                request.onStdout?.('theme.ogg\0');
                return { success: true, exitCode: 0 };
            },
        );
        for (const handler of handlers) {
            executeStreaming.mockImplementationOnce(async (_toolId, request) =>
                handler(request),
            );
        }
    }

    const succeed = async () => ({ success: true, exitCode: 0 });

    beforeEach(() => {
        vi.clearAllMocks();
        executeStreaming.mockReset();
    });

    it('skips Git LFS entirely when no tracked path uses the LFS filter', async () => {
        executeStreaming.mockResolvedValueOnce({ success: true, exitCode: 0 });
        const request = createRequest();

        await expect(service.pull(request)).resolves.toEqual({
            status: 'not-used',
        });
        expect(executeStreaming).toHaveBeenCalledOnce();
        expect(executeStreaming).toHaveBeenCalledWith('git', {
            args: ['ls-files', '-z', '--', ':(attr:filter=lfs)'],
            cwd: '/projects/.game.clone',
            env: request.environment,
            signal: request.signal,
            timeoutMs: expect.any(Number),
            onStdout: expect.any(Function),
        });
        expect(request.onStart).not.toHaveBeenCalled();
    });

    it('installs repository hooks and pulls through a pinned endpoint', async () => {
        withTrackedFiles(succeed, async (request) => {
            request.onStderr?.(
                'Downloading LFS objects:  20% (1/5), 156 KB | 0 B/s     \r',
            );
            request.onStderr?.('Downloading LFS objects:  10% (1/5)\r');
            request.onStderr?.(
                'Downloading LFS objects: 100% (5/5), 241 KB | 0 B/s\r',
            );
            return { success: true, exitCode: 0 };
        });
        const request = createRequest();

        await expect(service.pull(request)).resolves.toEqual({
            status: 'pulled',
        });

        const [installTool, install] = executeStreaming.mock.calls[1];
        const [pullTool, pull] = executeStreaming.mock.calls[2];
        expect([installTool, install.args]).toEqual([
            'git-lfs',
            ['install', '--local'],
        ]);
        expect([pullTool, pull.args]).toEqual(['git-lfs', ['pull']]);
        for (const lfsRequest of [install, pull]) {
            expect(lfsRequest.cwd).toBe('/projects/.game.clone');
            expect(lfsRequest.signal).toBe(request.signal);
            expect(lfsRequest.env).toMatchObject(request.environment);
            expect(readCommandConfig(lfsRequest.env)).toEqual({
                'credential.helper': '',
                'credential.interactive': 'true',
                'credential.useHttpPath': 'true',
                'http.sslVerify': 'true',
                'lfs.url': 'https://github.com/owner/game.git/info/lfs',
                'lfs.standalonetransferagent': '',
                'lfs.basictransfersonly': 'true',
            });
        }
        expect(pull.env.GIT_LFS_FORCE_PROGRESS).toBe('1');
        expect(pull.timeoutMs).toBeGreaterThanOrEqual(60 * 60 * 1_000);
        expect(request.onStart).toHaveBeenCalledOnce();
        expect(vi.mocked(request.onProgress).mock.calls).toEqual([[20], [100]]);
    });

    it('derives the default endpoint for URLs without a .git suffix', async () => {
        withTrackedFiles(succeed, succeed);

        await service.pull(
            createRequest({
                canonicalUrl: 'https://example.com/team/game',
                interactive: false,
            }),
        );

        expect(
            readCommandConfig(executeStreaming.mock.calls[2]?.[1].env),
        ).toMatchObject({
            'credential.interactive': 'false',
            'lfs.url': 'https://example.com/team/game.git/info/lfs',
        });
    });

    it.each(['unavailable', 'invalid', 'disabled'])(
        'reports a %s Git LFS tool so pointer files are explained',
        async (reason) => {
            withTrackedFiles(async () => ({
                success: false,
                reason,
                exitCode: null,
            }));

            await expect(service.pull(createRequest())).resolves.toEqual({
                status: 'unavailable',
            });
            expect(executeStreaming).toHaveBeenCalledTimes(2);
        },
    );

    it.each([
        [
            'This repository is over its data quota. Account responsible for LFS bandwidth should purchase more data packs to restore access.',
            'quota-exceeded',
        ],
        [
            'batch response: Git credentials for https://github.com/owner/game.git/info/lfs not found:',
            'authentication-failed',
        ],
        [
            '[da250ba] Object does not exist on the server: [404] Object does not exist on the server',
            'objects-missing',
        ],
        [
            'batch response: Post "https://github.com/owner/game.git/info/lfs/objects/batch": dial tcp: lookup github.com: no such host',
            'network-failed',
        ],
        ['Smudge error: something unexpected', 'unknown'],
    ])('classifies pull failure %j', async (stderr, reason) => {
        withTrackedFiles(succeed, async (request) => {
            request.onStderr?.(stderr);
            return { success: false, reason: 'command-failed', exitCode: 2 };
        });

        await expect(service.pull(createRequest())).resolves.toEqual({
            status: 'failed',
            reason,
        });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
            'github.com',
        );
    });

    it('reports a timed-out pull', async () => {
        withTrackedFiles(succeed, async () => ({
            success: false,
            reason: 'timed-out',
            exitCode: null,
        }));

        await expect(service.pull(createRequest())).resolves.toEqual({
            status: 'failed',
            reason: 'timed-out',
        });
    });

    it('reports a failed detection without starting Git LFS', async () => {
        executeStreaming.mockResolvedValueOnce({
            success: false,
            reason: 'command-failed',
            exitCode: 128,
        });

        await expect(service.pull(createRequest())).resolves.toEqual({
            status: 'failed',
            reason: 'unknown',
        });
        expect(executeStreaming).toHaveBeenCalledOnce();
    });

    it.each([
        ['detection', 0],
        ['setup', 1],
        ['pull', 2],
    ])('returns cancellation during %s', async (_stage, failingCall) => {
        const cancelled = async () => ({
            success: false,
            reason: 'cancelled',
            exitCode: null,
        });
        if (failingCall === 0) {
            executeStreaming.mockImplementationOnce(cancelled);
        } else {
            withTrackedFiles(...[succeed, cancelled].slice(2 - failingCall));
        }

        await expect(service.pull(createRequest())).resolves.toEqual({
            status: 'cancelled',
        });
        expect(executeStreaming).toHaveBeenCalledTimes(failingCall + 1);
    });
});

describe.skipIf(!gitLfsInstalled)(
    'GitCloneLfsService with real Git and Git LFS',
    () => {
        let root: string;
        let fixtureEnvironment: NodeJS.ProcessEnv;
        const executor = new ToolStreamingProcessExecutor();
        const logger = { warn: vi.fn(), debug: vi.fn() };
        let lfsToolAvailable = true;
        const tools = {
            executeStreaming: (
                toolId: string,
                request: ToolStreamingExecutionRequest,
            ) =>
                toolId === 'git-lfs' && !lfsToolAvailable
                    ? Promise.resolve({
                          success: false,
                          reason: 'unavailable',
                          exitCode: null,
                      })
                    : executor.execute(
                          {
                              executablePath: toolId,
                              executableArgs: [],
                              version: null,
                              source: 'detected',
                          },
                          request,
                      ),
        };
        const service = new GitCloneLfsService(tools as never, logger as never);

        /** Runs one fixture command with isolated user configuration. */
        function run(command: string, cwd: string, ...args: string[]): string {
            return execFileSync(command, args, {
                cwd,
                env: fixtureEnvironment,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }

        /**
         * Commits LFS content in a source repository, then clones it the way
         * the launcher does: without any LFS filter, leaving pointer files.
         */
        async function createPointerClone(): Promise<{
            source: string;
            clone: string;
            asset: Buffer;
            nested: Buffer;
        }> {
            const source = path.join(root, 'source');
            const clone = path.join(root, 'clone');
            await fs.mkdir(path.join(source, 'levels'), { recursive: true });
            run('git', source, 'init', '-q', '-b', 'main');
            run('git-lfs', source, 'install', '--local');
            const asset = randomBytes(64 * 1024);
            const nested = randomBytes(4 * 1024);
            await fs.writeFile(
                path.join(source, '.gitattributes'),
                `*.bin ${ATTRIBUTES}\n`,
            );
            await fs.writeFile(
                path.join(source, 'levels', '.gitattributes'),
                `*.scn ${ATTRIBUTES}\n`,
            );
            await fs.writeFile(path.join(source, 'asset.bin'), asset);
            await fs.writeFile(path.join(source, 'levels', 'one.scn'), nested);
            await fs.writeFile(path.join(source, 'readme.txt'), 'plain\n');
            run('git', source, 'add', '.');
            run('git', source, 'commit', '-q', '-m', 'assets');
            run('git', root, 'clone', '-q', source, clone);
            return { source, clone, asset, nested };
        }

        /** Builds the isolated environment the clone service hands over. */
        async function createCloneEnvironment(): Promise<NodeJS.ProcessEnv> {
            const support = path.join(root, 'support');
            await fs.mkdir(support);
            return createGitNetworkEnvironment(
                await createIsolatedGitConfig(support),
                {},
            );
        }

        /** Pulls one pointer clone through the service. */
        async function pull(clone: string) {
            return service.pull({
                repositoryPath: clone,
                canonicalUrl: UNREACHABLE_URL,
                environment: await createCloneEnvironment(),
                interactive: false,
                signal: new AbortController().signal,
                onStart: vi.fn(),
                onProgress: vi.fn(),
            });
        }

        beforeEach(async () => {
            lfsToolAvailable = true;
            root = await fs.realpath(
                await fs.mkdtemp(path.join(os.tmpdir(), 'git-clone-lfs-')),
            );
            const globalConfig = path.join(root, 'fixture-global.config');
            await fs.writeFile(globalConfig, '');
            fixtureEnvironment = {
                ...process.env,
                GIT_CONFIG_GLOBAL: globalConfig,
                GIT_CONFIG_NOSYSTEM: '1',
                GIT_AUTHOR_NAME: 'Test',
                GIT_AUTHOR_EMAIL: 'test@example.com',
                GIT_COMMITTER_NAME: 'Test',
                GIT_COMMITTER_EMAIL: 'test@example.com',
            };
        });

        afterEach(async () => {
            await fs.rm(root, { recursive: true, force: true });
        });

        it('replaces pointer files with real content and installs the filter', async () => {
            const { source, clone, asset, nested } = await createPointerClone();
            expect(
                await fs.readFile(path.join(clone, 'asset.bin'), 'utf8'),
            ).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1/u);
            // Objects already in the local store need no network; the
            // unreachable endpoint proves nothing else was contacted.
            await fs.cp(
                path.join(source, '.git', 'lfs', 'objects'),
                path.join(clone, '.git', 'lfs', 'objects'),
                { recursive: true },
            );

            await expect(pull(clone)).resolves.toEqual({ status: 'pulled' });

            expect(await fs.readFile(path.join(clone, 'asset.bin'))).toEqual(
                asset,
            );
            expect(
                await fs.readFile(path.join(clone, 'levels', 'one.scn')),
            ).toEqual(nested);
            const listed = run('git-lfs', clone, 'ls-files').trim().split('\n');
            expect(listed).toHaveLength(2);
            for (const line of listed) {
                expect(line).toMatch(/^[0-9a-f]+ \* /u);
            }
            expect(run('git', clone, 'status', '--porcelain')).toBe('');
            expect(
                run('git', clone, 'config', '--local', 'filter.lfs.process'),
            ).toContain('git-lfs filter-process');
        });

        it('keeps the clone with pointer files when the download fails', async () => {
            const { clone } = await createPointerClone();

            await expect(pull(clone)).resolves.toEqual({
                status: 'failed',
                reason: 'network-failed',
            });
            expect(
                await fs.readFile(path.join(clone, 'asset.bin'), 'utf8'),
            ).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1/u);
            expect(run('git', clone, 'status', '--porcelain')).toBe('');
        });

        it('reports a missing Git LFS tool without modifying the clone', async () => {
            const { clone } = await createPointerClone();
            lfsToolAvailable = false;

            await expect(pull(clone)).resolves.toEqual({
                status: 'unavailable',
            });
            expect(
                spawnSync('git', ['config', '--local', 'filter.lfs.process'], {
                    cwd: clone,
                    env: fixtureEnvironment,
                }).status,
            ).toBe(1);
        });

        it('does not touch repositories without LFS-tracked files', async () => {
            const repository = path.join(root, 'plain');
            await fs.mkdir(repository);
            run('git', repository, 'init', '-q', '-b', 'main');
            await fs.writeFile(
                path.join(repository, '.gitattributes'),
                `*.bin ${ATTRIBUTES}\n`,
            );
            await fs.writeFile(path.join(repository, 'readme.txt'), 'plain\n');
            run('git', repository, 'add', '.');
            run('git', repository, 'commit', '-q', '-m', 'plain');

            await expect(pull(repository)).resolves.toEqual({
                status: 'not-used',
            });
            expect(
                await fs.readdir(path.join(repository, '.git', 'hooks')),
            ).not.toContain('pre-push');
        });
    },
);
