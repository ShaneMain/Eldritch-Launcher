import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GitHubDeviceFlowClient,
    GitHubOAuthError,
} from './github-device-flow.client.js';

// Response bodies follow GitHub's documented device-flow examples.
const DEVICE_CODE_FIXTURE = {
    device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5',
    user_code: 'WDJB-MJHT',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
};
const TOKEN_FIXTURE = {
    access_token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a',
    expires_in: 28_800,
    refresh_token: 'ghr_1B4a2e77838347a7E420ce178F2E7c6912E1',
    refresh_token_expires_in: 15_897_600,
    scope: '',
    token_type: 'bearer',
};

type FetchCall = { url: string; init: RequestInit };

/**
 * Stubs fetch with queued JSON responses and records every request.
 *
 * @param bodies - Response bodies, optionally with a non-200 status.
 * @returns The recorded calls.
 */
function stubFetch(
    ...bodies: Array<unknown | { status: number; body: unknown }>
): FetchCall[] {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            const next = bodies.shift();
            const { status, body } =
                typeof next === 'object' &&
                next !== null &&
                'status' in next &&
                'body' in next
                    ? (next as { status: number; body: unknown })
                    : { status: 200, body: next };
            return new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            });
        }),
    );
    return calls;
}

/** Decodes a recorded form body. */
function formFields(call: FetchCall): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(String(call.init.body)));
}

const authorization = {
    deviceCode: DEVICE_CODE_FIXTURE.device_code,
    userCode: DEVICE_CODE_FIXTURE.user_code,
    verificationUri: DEVICE_CODE_FIXTURE.verification_uri,
    expiresInSeconds: 900,
    intervalSeconds: 5,
};

describe('GitHubDeviceFlowClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('requestDeviceCode', () => {
        it('posts only the public client ID and parses the device code', async () => {
            const calls = stubFetch(DEVICE_CODE_FIXTURE);

            const result = await new GitHubDeviceFlowClient().requestDeviceCode(
                'Iv1.client',
                new AbortController().signal,
            );

            expect(result).toEqual(authorization);
            expect(calls).toHaveLength(1);
            expect(calls[0].url).toBe('https://github.com/login/device/code');
            expect(calls[0].init).toMatchObject({
                method: 'POST',
                redirect: 'error',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Eldritch-Launcher',
                },
            });
            expect(formFields(calls[0])).toEqual({ client_id: 'Iv1.client' });
        });

        it('defaults the polling interval when GitHub omits it', async () => {
            const { interval: _interval, ...withoutInterval } =
                DEVICE_CODE_FIXTURE;
            stubFetch(withoutInterval);

            const result = await new GitHubDeviceFlowClient().requestDeviceCode(
                'Iv1.client',
                new AbortController().signal,
            );

            expect(result.intervalSeconds).toBe(5);
        });

        it('rejects a verification URI outside github.com', async () => {
            stubFetch({
                ...DEVICE_CODE_FIXTURE,
                verification_uri: 'https://github.com.evil.test/login/device',
            });

            await expect(
                new GitHubDeviceFlowClient().requestDeviceCode(
                    'Iv1.client',
                    new AbortController().signal,
                ),
            ).rejects.toEqual(new GitHubOAuthError('invalid_response', null));
        });

        it('reports a disabled device flow and unavailable GitHub', async () => {
            stubFetch(
                { error: 'device_flow_disabled' },
                { status: 503, body: {} },
            );
            const client = new GitHubDeviceFlowClient();
            const signal = new AbortController().signal;

            await expect(
                client.requestDeviceCode('Iv1.client', signal),
            ).rejects.toMatchObject({ code: 'device_flow_disabled' });
            await expect(
                client.requestDeviceCode('Iv1.client', signal),
            ).rejects.toMatchObject({ code: 'unavailable', status: 503 });
        });
    });

    describe('waitForAccessToken', () => {
        beforeEach(() => {
            vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00.000Z') });
        });

        it('keeps polling while pending, backs off on slow_down, then returns the token', async () => {
            const calls = stubFetch(
                { error: 'authorization_pending' },
                { error: 'slow_down', interval: 10 },
                TOKEN_FIXTURE,
            );
            const result = new GitHubDeviceFlowClient().waitForAccessToken(
                'Iv1.client',
                authorization,
                new AbortController().signal,
            );

            await vi.advanceTimersByTimeAsync(4_999);
            expect(calls).toHaveLength(0);
            await vi.advanceTimersByTimeAsync(1);
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(5_000);
            expect(calls).toHaveLength(2);
            // slow_down raises the interval from 5 s to 10 s.
            await vi.advanceTimersByTimeAsync(9_999);
            expect(calls).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(1);

            await expect(result).resolves.toEqual({
                accessToken: TOKEN_FIXTURE.access_token,
                expiresIn: 28_800,
                refreshToken: TOKEN_FIXTURE.refresh_token,
                refreshTokenExpiresIn: 15_897_600,
                scope: '',
                tokenType: 'bearer',
            });
            expect(calls.map((call) => call.url)).toEqual([
                'https://github.com/login/oauth/access_token',
                'https://github.com/login/oauth/access_token',
                'https://github.com/login/oauth/access_token',
            ]);
            expect(formFields(calls[0])).toEqual({
                client_id: 'Iv1.client',
                device_code: DEVICE_CODE_FIXTURE.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            });
        });

        it('adds five seconds on slow_down when GitHub sends no interval', async () => {
            const calls = stubFetch(
                { error: 'slow_down' },
                { error: 'authorization_pending' },
            );
            void new GitHubDeviceFlowClient()
                .waitForAccessToken(
                    'Iv1.client',
                    authorization,
                    new AbortController().signal,
                )
                .catch(() => undefined);

            await vi.advanceTimersByTimeAsync(5_000);
            await vi.advanceTimersByTimeAsync(9_999);
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(calls).toHaveLength(2);
        });

        it('fails when GitHub reports the code expired', async () => {
            stubFetch({ error: 'expired_token' });
            const result = new GitHubDeviceFlowClient().waitForAccessToken(
                'Iv1.client',
                authorization,
                new AbortController().signal,
            );
            const assertion = expect(result).rejects.toMatchObject({
                code: 'expired_token',
            });

            await vi.advanceTimersByTimeAsync(5_000);
            await assertion;
        });

        it('stops at the local expiry without another poll', async () => {
            const calls = stubFetch({ error: 'authorization_pending' });
            const result = new GitHubDeviceFlowClient().waitForAccessToken(
                'Iv1.client',
                { ...authorization, expiresInSeconds: 10 },
                new AbortController().signal,
            );
            const assertion = expect(result).rejects.toMatchObject({
                code: 'expired_token',
            });

            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
            expect(calls).toHaveLength(1);
        });

        it('fails when the user denies access', async () => {
            stubFetch({ error: 'access_denied' });
            const result = new GitHubDeviceFlowClient().waitForAccessToken(
                'Iv1.client',
                authorization,
                new AbortController().signal,
            );
            const assertion = expect(result).rejects.toMatchObject({
                code: 'access_denied',
            });

            await vi.advanceTimersByTimeAsync(5_000);
            await assertion;
        });

        it('stops waiting as soon as the caller cancels', async () => {
            const calls = stubFetch(TOKEN_FIXTURE);
            const controller = new AbortController();
            const result = new GitHubDeviceFlowClient().waitForAccessToken(
                'Iv1.client',
                authorization,
                controller.signal,
            );
            const assertion = expect(result).rejects.toBe('cancelled');

            await vi.advanceTimersByTimeAsync(2_000);
            controller.abort('cancelled');
            await assertion;
            await vi.advanceTimersByTimeAsync(10_000);
            expect(calls).toHaveLength(0);
        });
    });

    describe('refreshAccessToken', () => {
        it('refreshes with the client ID and refresh token but no client secret', async () => {
            const calls = stubFetch(TOKEN_FIXTURE);

            const token = await new GitHubDeviceFlowClient().refreshAccessToken(
                'Iv1.client',
                'ghr_old',
                new AbortController().signal,
            );

            expect(token.accessToken).toBe(TOKEN_FIXTURE.access_token);
            expect(token.refreshToken).toBe(TOKEN_FIXTURE.refresh_token);
            expect(calls[0].url).toBe(
                'https://github.com/login/oauth/access_token',
            );
            expect(formFields(calls[0])).toEqual({
                client_id: 'Iv1.client',
                grant_type: 'refresh_token',
                refresh_token: 'ghr_old',
            });
        });

        it('maps tokens without expiry to non-expiring credentials', async () => {
            stubFetch({
                access_token: 'ghu_noexpiry',
                scope: '',
                token_type: 'bearer',
            });

            await expect(
                new GitHubDeviceFlowClient().refreshAccessToken(
                    'Iv1.client',
                    'ghr_old',
                    new AbortController().signal,
                ),
            ).resolves.toMatchObject({
                expiresIn: null,
                refreshToken: null,
                refreshTokenExpiresIn: null,
            });
        });

        it('reports a rejected refresh token', async () => {
            stubFetch({ error: 'bad_refresh_token' });

            await expect(
                new GitHubDeviceFlowClient().refreshAccessToken(
                    'Iv1.client',
                    'ghr_old',
                    new AbortController().signal,
                ),
            ).rejects.toEqual(new GitHubOAuthError('bad_refresh_token', 200));
        });
    });
});
