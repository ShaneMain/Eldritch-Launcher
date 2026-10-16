import type { ConfigService } from '@mariodebono/di-config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../config/index.js';
import type { GitHubApiClient } from './github-api.client.js';
import { GitHubAppIntegrationProvider } from './github-app-integration.provider.js';
import {
    type GitHubDeviceFlowClient,
    GitHubOAuthError,
} from './github-device-flow.client.js';

const mocks = vi.hoisted(() => ({
    loggerDebug: vi.fn(),
    loggerWarn: vi.fn(),
    openExternal: vi.fn(),
    revealMainWindow: vi.fn(),
}));

vi.mock('electron-log/main.js', () => ({
    default: { debug: mocks.loggerDebug, warn: mocks.loggerWarn },
}));
vi.mock('electron', () => ({ shell: { openExternal: mocks.openExternal } }));
vi.mock('../../../mainWindow.js', () => ({
    revealMainWindow: mocks.revealMainWindow,
}));

const deviceAuthorization = {
    deviceCode: 'device-code',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://github.com/login/device',
    expiresInSeconds: 900,
    intervalSeconds: 5,
};
const issuedToken = {
    accessToken: 'ghu_issued',
    expiresIn: 28_800,
    refreshToken: 'ghr_issued',
    refreshTokenExpiresIn: 15_897_600,
    scope: '',
    tokenType: 'bearer',
};
const accessTarget = {
    providerTargetId: '123456',
    login: 'Eldritch-Game-Studio',
    type: 'organization' as const,
    manageUrl:
        'https://github.com/organizations/Eldritch-Game-Studio/settings/installations/123456',
    capabilities: ['repository-browsing' as const],
};

/** Creates a config double for the GitHub App identity. */
function config(
    githubClientId = 'Iv1.client',
    githubAppSlug = 'eldritch-launcher',
): ConfigService<AppConfig> {
    const values: Record<string, string> = { githubClientId, githubAppSlug };
    return {
        getOrThrow: vi.fn((key: string) => values[key]),
    } as unknown as ConfigService<AppConfig>;
}

/** Creates a GitHub API double for one verified user. */
function githubApi(targets = [accessTarget]) {
    return {
        getUser: vi.fn(async () => ({
            id: 1,
            login: 'octocat',
            name: 'The Octocat',
        })),
        getInstallations: vi.fn(async () => targets),
    };
}

/** Creates a device-flow double that approves immediately. */
function deviceFlow() {
    return {
        requestDeviceCode: vi.fn(async () => deviceAuthorization),
        waitForAccessToken: vi.fn(async () => issuedToken),
        refreshAccessToken: vi.fn(),
    };
}

/** Builds a stored credential issued `ageMs` ago. */
function storedCredential(
    ageMs: number,
    overrides: Record<string, unknown> = {},
): string {
    return JSON.stringify({
        version: 1,
        createdAt: new Date(Date.now() - ageMs).toISOString(),
        accessToken: 'old-access-token',
        expiresIn: 28_800,
        refreshToken: 'old-refresh-token',
        refreshTokenExpiresIn: 15_897_600,
        scope: '',
        tokenType: 'bearer',
        ...overrides,
    });
}

const refreshContext = {
    operationId: 'refresh-operation',
    trigger: 'connections' as const,
};

describe('GitHubAppIntegrationProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports a missing client ID before a missing slug', () => {
        const create = (clientId: string, slug: string) =>
            new GitHubAppIntegrationProvider(
                config(clientId, slug),
                {} as never,
                {} as never,
            );

        expect(create('', '').getConfigurationIssue()).toBe(
            'client-id-missing',
        );
        expect(create('Iv1.client', '').getConfigurationIssue()).toBe(
            'app-slug-missing',
        );
        expect(
            create('Iv1.client', 'eldritch-launcher').getConfigurationIssue(),
        ).toBeNull();
    });

    it('refuses to connect without a client ID and never contacts GitHub', async () => {
        const flow = deviceFlow();
        const provider = new GitHubAppIntegrationProvider(
            config(''),
            flow as unknown as GitHubDeviceFlowClient,
            {} as never,
        );

        await expect(
            provider.connect(new AbortController().signal, {
                intent: 'connect',
                expectedAccountId: null,
                onDeviceAuthorization: vi.fn(),
            }),
        ).rejects.toMatchObject({ reason: 'not-configured' });
        expect(flow.requestDeviceCode).not.toHaveBeenCalled();
    });

    it('publishes the user code, then returns verified installations', async () => {
        vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00.000Z') });
        const flow = deviceFlow();
        const github = githubApi();
        const onDeviceAuthorization = vi.fn();
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            github as unknown as GitHubApiClient,
        );
        const signal = new AbortController().signal;

        const result = await provider.connect(signal, {
            intent: 'connect',
            expectedAccountId: null,
            onDeviceAuthorization,
        });

        expect(flow.requestDeviceCode).toHaveBeenCalledWith(
            'Iv1.client',
            signal,
        );
        expect(onDeviceAuthorization).toHaveBeenCalledWith({
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.com/login/device',
            expiresAt: '2026-10-16T12:15:00.000Z',
        });
        expect(flow.waitForAccessToken).toHaveBeenCalledWith(
            'Iv1.client',
            deviceAuthorization,
            signal,
        );
        expect(github.getUser).toHaveBeenCalledWith('ghu_issued', signal);
        expect(result.connection).toMatchObject({
            accountId: '1',
            accountLogin: 'octocat',
            accessTokenExpiresAt: '2026-10-16T20:00:00.000Z',
            accessTargets: [accessTarget],
            selectedAccessTargetId: null,
        });
        expect(provider.isCredentialValid(result.connection.credential)).toBe(
            true,
        );
        expect(result.installation).not.toBeNull();
        expect(mocks.openExternal).not.toHaveBeenCalled();
        expect(mocks.revealMainWindow).toHaveBeenCalledOnce();
    });

    it('opens the app install page and selects the newly visible installation', async () => {
        vi.useFakeTimers();
        const added = {
            ...accessTarget,
            providerTargetId: '777',
            login: 'octocat',
            type: 'organization' as const,
            manageUrl:
                'https://github.com/organizations/octocat/settings/installations/777',
        };
        const github = githubApi();
        const provider = new GitHubAppIntegrationProvider(
            config(),
            deviceFlow() as unknown as GitHubDeviceFlowClient,
            github as unknown as GitHubApiClient,
        );
        const result = await provider.connect(new AbortController().signal, {
            intent: 'connect',
            expectedAccountId: null,
            onDeviceAuthorization: vi.fn(),
        });
        github.getInstallations
            .mockResolvedValueOnce([accessTarget])
            .mockResolvedValueOnce([accessTarget, added]);

        const installed = result.installation?.install();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mocks.openExternal).toHaveBeenCalledWith(
            'https://github.com/apps/eldritch-launcher/installations/new',
        );
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(installed).resolves.toMatchObject({
            selectedAccessTargetId: '777',
            accessTargets: [accessTarget, added],
        });
    });

    it('returns no installation step when reconnecting', async () => {
        const provider = new GitHubAppIntegrationProvider(
            config(),
            deviceFlow() as unknown as GitHubDeviceFlowClient,
            githubApi() as unknown as GitHubApiClient,
        );

        const result = await provider.connect(new AbortController().signal, {
            intent: 'reconnect',
            expectedAccountId: '1',
            onDeviceAuthorization: vi.fn(),
        });

        expect(result.installation).toBeNull();
    });

    it('rejects a different identity during reconnect', async () => {
        const provider = new GitHubAppIntegrationProvider(
            config(),
            deviceFlow() as unknown as GitHubDeviceFlowClient,
            githubApi() as unknown as GitHubApiClient,
        );

        await expect(
            provider.connect(new AbortController().signal, {
                intent: 'reconnect',
                expectedAccountId: '2',
                onDeviceAuthorization: vi.fn(),
            }),
        ).rejects.toMatchObject({ reason: 'account-mismatch' });
        expect(mocks.revealMainWindow).not.toHaveBeenCalled();
    });

    it.each([
        ['access_denied', 'denied'],
        ['expired_token', 'timed-out'],
        ['device_flow_disabled', 'device-flow-disabled'],
        ['unavailable', 'provider-unavailable'],
        ['incorrect_device_code', 'invalid-response'],
    ] as const)(
        'maps the %s device-flow failure to %s',
        async (code, reason) => {
            const flow = deviceFlow();
            flow.waitForAccessToken.mockRejectedValueOnce(
                new GitHubOAuthError(code, 200),
            );
            const provider = new GitHubAppIntegrationProvider(
                config(),
                flow as unknown as GitHubDeviceFlowClient,
                githubApi() as unknown as GitHubApiClient,
            );

            await expect(
                provider.connect(new AbortController().signal, {
                    intent: 'connect',
                    expectedAccountId: null,
                    onDeviceAuthorization: vi.fn(),
                }),
            ).rejects.toMatchObject({ reason });
        },
    );

    it('reports cancellation and network failures', async () => {
        const flow = deviceFlow();
        const controller = new AbortController();
        flow.waitForAccessToken.mockImplementationOnce(async () => {
            controller.abort('cancelled');
            throw 'cancelled';
        });
        flow.requestDeviceCode
            .mockResolvedValueOnce(deviceAuthorization)
            .mockRejectedValueOnce(new TypeError('fetch failed'));
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            githubApi() as unknown as GitHubApiClient,
        );
        const request = {
            intent: 'connect' as const,
            expectedAccountId: null,
            onDeviceAuthorization: vi.fn(),
        };

        await expect(
            provider.connect(controller.signal, request),
        ).rejects.toMatchObject({ reason: 'cancelled' });
        await expect(
            provider.connect(new AbortController().signal, request),
        ).rejects.toMatchObject({ reason: 'network-error' });
    });

    it('rotates an expiring credential directly with GitHub and verifies the user', async () => {
        const flow = deviceFlow();
        flow.refreshAccessToken.mockResolvedValueOnce({
            ...issuedToken,
            accessToken: 'rotated-access-token',
            refreshToken: 'rotated-refresh-token',
        });
        const github = githubApi([]);
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            github as unknown as GitHubApiClient,
        );

        const result = await provider.refresh(
            new AbortController().signal,
            storedCredential(9 * 60 * 60 * 1_000),
            '1',
            refreshContext,
        );

        expect(result).toMatchObject({
            status: 'refreshed',
            connection: { accountId: '1', accountLogin: 'octocat' },
        });
        expect(flow.refreshAccessToken).toHaveBeenCalledWith(
            'Iv1.client',
            'old-refresh-token',
            expect.any(AbortSignal),
        );
        expect(github.getUser).toHaveBeenCalledWith(
            'rotated-access-token',
            expect.any(AbortSignal),
        );
        expect(JSON.stringify(result)).toContain('rotated-refresh-token');
        const diagnostics = JSON.stringify([
            ...mocks.loggerDebug.mock.calls,
            ...mocks.loggerWarn.mock.calls,
        ]);
        expect(diagnostics).toContain('token-rotation');
        expect(diagnostics).not.toContain('old-access-token');
        expect(diagnostics).not.toContain('old-refresh-token');
        expect(diagnostics).not.toContain('rotated-access-token');
        expect(diagnostics).not.toContain('rotated-refresh-token');
    });

    it('requires reconnecting when GitHub rejects the refresh token', async () => {
        const flow = deviceFlow();
        flow.refreshAccessToken.mockRejectedValueOnce(
            new GitHubOAuthError('bad_refresh_token', 200),
        );
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            {} as never,
        );
        const credential = storedCredential(9 * 60 * 60 * 1_000, {
            accessToken: 'diagnostic-access-token',
            refreshToken: 'diagnostic-refresh-token',
        });

        await expect(
            provider.refresh(
                new AbortController().signal,
                credential,
                '1',
                refreshContext,
            ),
        ).resolves.toEqual({ status: 'reauthorisation-required' });
        expect(mocks.loggerDebug).toHaveBeenCalledWith(
            'App integration credential refresh',
            expect.objectContaining({
                ...refreshContext,
                phase: 'token-rotation',
                outcome: 'terminal-failure',
                code: 'refresh-token-rejected',
                status: 200,
            }),
        );
        const diagnostics = JSON.stringify(mocks.loggerDebug.mock.calls);
        expect(diagnostics).not.toContain('diagnostic-access-token');
        expect(diagnostics).not.toContain('diagnostic-refresh-token');
    });

    it('keeps the connection when GitHub is temporarily unavailable', async () => {
        const flow = deviceFlow();
        flow.refreshAccessToken.mockRejectedValueOnce(
            new GitHubOAuthError('unavailable', 503),
        );
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            {} as never,
        );

        await expect(
            provider.refresh(
                new AbortController().signal,
                storedCredential(9 * 60 * 60 * 1_000),
                '1',
                refreshContext,
            ),
        ).resolves.toEqual({ status: 'temporarily-unavailable' });
    });

    it('never rotates a token from an app that opted out of expiry', async () => {
        const flow = deviceFlow();
        const github = githubApi([]);
        const provider = new GitHubAppIntegrationProvider(
            config(),
            flow as unknown as GitHubDeviceFlowClient,
            github as unknown as GitHubApiClient,
        );

        const result = await provider.refresh(
            new AbortController().signal,
            storedCredential(365 * 24 * 60 * 60 * 1_000, {
                expiresIn: null,
                refreshToken: null,
                refreshTokenExpiresIn: null,
            }),
            '1',
            refreshContext,
        );

        expect(result).toMatchObject({
            status: 'refreshed',
            connection: {
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
            },
        });
        expect(flow.refreshAccessToken).not.toHaveBeenCalled();
        expect(github.getUser).toHaveBeenCalledWith(
            'old-access-token',
            expect.any(AbortSignal),
        );
    });

    it('opens GitHub authorised apps settings for revocation', async () => {
        const provider = new GitHubAppIntegrationProvider(
            config(),
            {} as never,
            {} as never,
        );

        await provider.openAuthorisationSettings();

        expect(mocks.openExternal).toHaveBeenCalledWith(
            'https://github.com/settings/apps/authorizations',
        );
    });

    it('opens the exact verified organisation installation settings', async () => {
        const provider = new GitHubAppIntegrationProvider(
            config(),
            {} as never,
            {} as never,
        );

        await provider.openManageAccess({
            ...accessTarget,
            id: 'e26b8c8d-3f28-4d95-a814-a781223c62e9',
            availability: 'available',
        });

        expect(mocks.openExternal).toHaveBeenCalledWith(accessTarget.manageUrl);
    });
});
