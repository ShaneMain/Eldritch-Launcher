import { Injectable } from '@mariodebono/di';
import {
    GITHUB_ACCESS_TOKEN_URL,
    GITHUB_DEVICE_CODE_URL,
    GITHUB_DEVICE_DEFAULT_INTERVAL_SECONDS,
    GITHUB_DEVICE_GRANT_TYPE,
    GITHUB_DEVICE_SLOW_DOWN_SECONDS,
    GITHUB_OAUTH_REQUEST_TIMEOUT_MS,
    GITHUB_OAUTH_RESPONSE_MAX_BYTES,
    GITHUB_REFRESH_GRANT_TYPE,
    GITHUB_USER_AGENT,
} from './github-app-integration.constants.js';
import {
    GitHubAccessTokenResponseSchema,
    GitHubDeviceCodeResponseSchema,
    GitHubOAuthErrorResponseSchema,
} from './github-app-integration.schema.js';
import type {
    GitHubDeviceAuthorization,
    GitHubTokenBundle,
} from './github-app-integration.types.js';
import { readGitHubJsonResponse } from './github-json-response.util.js';

/** GitHub OAuth error codes Launcher distinguishes, plus local transport classes. */
export type GitHubOAuthErrorCode =
    | 'access_denied'
    | 'bad_refresh_token'
    | 'device_flow_disabled'
    | 'expired_token'
    | 'incorrect_client_credentials'
    | 'incorrect_device_code'
    | 'unsupported_grant_type'
    | 'invalid_response'
    | 'unavailable';

const KNOWN_OAUTH_ERROR_CODES: Record<string, true> = {
    access_denied: true,
    bad_refresh_token: true,
    device_flow_disabled: true,
    expired_token: true,
    incorrect_client_credentials: true,
    incorrect_device_code: true,
    unsupported_grant_type: true,
};

export class GitHubOAuthError extends Error {
    /**
     * Creates a checked GitHub OAuth failure without provider-controlled text.
     *
     * @param code - Allowlisted GitHub OAuth error or local transport class.
     * @param status - HTTP status, when a response was received.
     */
    constructor(
        readonly code: GitHubOAuthErrorCode,
        readonly status: number | null,
    ) {
        super(`GitHub OAuth request failed: ${code}`);
        this.name = 'GitHubOAuthError';
    }
}

/** One device-flow token poll outcome that does not end the flow. */
export type GitHubDeviceTokenPoll =
    | { status: 'pending' }
    | { status: 'slow-down'; intervalSeconds: number | null }
    | { status: 'authorised'; token: GitHubTokenBundle };

/**
 * Talks to GitHub's OAuth endpoints for GitHub App device flow and token
 * refresh. Every request uses only the public client ID; no secret ships.
 */
@Injectable()
export class GitHubDeviceFlowClient {
    /**
     * Requests a device and user code for one GitHub App.
     *
     * @param clientId - Public GitHub App client ID.
     * @param signal - Caller cancellation signal.
     * @returns The validated device authorisation.
     */
    async requestDeviceCode(
        clientId: string,
        signal: AbortSignal,
    ): Promise<GitHubDeviceAuthorization> {
        const body = await this.post(
            GITHUB_DEVICE_CODE_URL,
            { client_id: clientId },
            signal,
        );
        const failure = GitHubOAuthErrorResponseSchema.safeParse(body);
        if (failure.success) {
            throw toOAuthError(failure.data.error);
        }
        const parsed = GitHubDeviceCodeResponseSchema.safeParse(body);
        if (!parsed.success) {
            throw new GitHubOAuthError('invalid_response', null);
        }
        return {
            deviceCode: parsed.data.device_code,
            userCode: parsed.data.user_code,
            verificationUri: parsed.data.verification_uri,
            expiresInSeconds: parsed.data.expires_in,
            intervalSeconds:
                parsed.data.interval ?? GITHUB_DEVICE_DEFAULT_INTERVAL_SECONDS,
        };
    }

    /**
     * Sends one device-flow token request.
     *
     * @param clientId - Public GitHub App client ID.
     * @param deviceCode - Device code from {@link requestDeviceCode}.
     * @param signal - Caller cancellation signal.
     * @returns Whether to keep polling, slow down, or the issued token.
     */
    async pollAccessToken(
        clientId: string,
        deviceCode: string,
        signal: AbortSignal,
    ): Promise<GitHubDeviceTokenPoll> {
        const body = await this.post(
            GITHUB_ACCESS_TOKEN_URL,
            {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: GITHUB_DEVICE_GRANT_TYPE,
            },
            signal,
        );
        const failure = GitHubOAuthErrorResponseSchema.safeParse(body);
        if (failure.success) {
            if (failure.data.error === 'authorization_pending') {
                return { status: 'pending' };
            }
            if (failure.data.error === 'slow_down') {
                return {
                    status: 'slow-down',
                    intervalSeconds: failure.data.interval ?? null,
                };
            }
            throw toOAuthError(failure.data.error);
        }
        return { status: 'authorised', token: parseTokenBundle(body) };
    }

    /**
     * Polls until the user approves the device code, honouring GitHub's
     * interval and `slow_down` back-off.
     *
     * @param clientId - Public GitHub App client ID.
     * @param authorization - Active device authorisation.
     * @param signal - Caller cancellation signal.
     * @returns The issued GitHub App user token bundle.
     */
    async waitForAccessToken(
        clientId: string,
        authorization: GitHubDeviceAuthorization,
        signal: AbortSignal,
    ): Promise<GitHubTokenBundle> {
        const deadline = Date.now() + authorization.expiresInSeconds * 1_000;
        let intervalSeconds = authorization.intervalSeconds;
        while (true) {
            await waitFor(intervalSeconds * 1_000, signal);
            if (Date.now() >= deadline) {
                throw new GitHubOAuthError('expired_token', null);
            }
            const poll = await this.pollAccessToken(
                clientId,
                authorization.deviceCode,
                signal,
            );
            if (poll.status === 'authorised') {
                return poll.token;
            }
            if (poll.status === 'slow-down') {
                intervalSeconds = Math.max(
                    intervalSeconds + GITHUB_DEVICE_SLOW_DOWN_SECONDS,
                    poll.intervalSeconds ?? 0,
                );
            }
        }
    }

    /**
     * Rotates a GitHub App user token. Device-flow tokens refresh without a
     * client secret.
     *
     * @param clientId - Public GitHub App client ID.
     * @param refreshToken - Current refresh token.
     * @param signal - Caller cancellation signal.
     * @returns The rotated token bundle.
     */
    async refreshAccessToken(
        clientId: string,
        refreshToken: string,
        signal: AbortSignal,
    ): Promise<GitHubTokenBundle> {
        const body = await this.post(
            GITHUB_ACCESS_TOKEN_URL,
            {
                client_id: clientId,
                grant_type: GITHUB_REFRESH_GRANT_TYPE,
                refresh_token: refreshToken,
            },
            signal,
        );
        const failure = GitHubOAuthErrorResponseSchema.safeParse(body);
        if (failure.success) {
            throw toOAuthError(failure.data.error);
        }
        return parseTokenBundle(body);
    }

    /**
     * Sends one bounded, no-store form POST to a GitHub OAuth endpoint.
     *
     * @param url - Fixed GitHub OAuth endpoint.
     * @param fields - Form fields.
     * @param signal - Caller cancellation signal.
     * @returns The parsed JSON body.
     */
    private async post(
        url: string,
        fields: Record<string, string>,
        signal: AbortSignal,
    ): Promise<unknown> {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-store',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': GITHUB_USER_AGENT,
            },
            body: new URLSearchParams(fields).toString(),
            redirect: 'error',
            signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(GITHUB_OAUTH_REQUEST_TIMEOUT_MS),
            ]),
        });
        if (response.status === 429 || response.status >= 500) {
            await response.body?.cancel().catch(() => undefined);
            throw new GitHubOAuthError('unavailable', response.status);
        }
        let body: unknown;
        try {
            body = await readGitHubJsonResponse(
                response,
                GITHUB_OAUTH_RESPONSE_MAX_BYTES,
            );
        } catch {
            throw new GitHubOAuthError('invalid_response', response.status);
        }
        if (!response.ok) {
            const failure = GitHubOAuthErrorResponseSchema.safeParse(body);
            throw failure.success
                ? toOAuthError(failure.data.error, response.status)
                : new GitHubOAuthError('invalid_response', response.status);
        }
        return body;
    }
}

/**
 * Waits for a delay unless the caller cancels first.
 *
 * @param milliseconds - Delay length.
 * @param signal - Cancellation signal; rejects with its reason when aborted.
 */
export function waitFor(
    milliseconds: number,
    signal: AbortSignal,
): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    if (signal.aborted) {
        reject(signal.reason);
        return promise;
    }
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
    };
    const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
    return promise;
}

/** Maps GitHub's token response into the stored token bundle shape. */
function parseTokenBundle(body: unknown): GitHubTokenBundle {
    const parsed = GitHubAccessTokenResponseSchema.safeParse(body);
    if (!parsed.success) {
        throw new GitHubOAuthError('invalid_response', null);
    }
    return {
        accessToken: parsed.data.access_token,
        expiresIn: parsed.data.expires_in ?? null,
        refreshToken: parsed.data.refresh_token ?? null,
        refreshTokenExpiresIn: parsed.data.refresh_token_expires_in ?? null,
        scope: parsed.data.scope,
        tokenType: parsed.data.token_type,
    };
}

/** Converts a GitHub error code into an allowlisted OAuth failure. */
function toOAuthError(code: string, status: number | null = 200) {
    return new GitHubOAuthError(
        Object.hasOwn(KNOWN_OAUTH_ERROR_CODES, code)
            ? (code as GitHubOAuthErrorCode)
            : 'invalid_response',
        status,
    );
}
