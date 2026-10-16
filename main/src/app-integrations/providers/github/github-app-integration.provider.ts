import { Injectable } from '@mariodebono/di';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ConfigService } from '@mariodebono/di-config';
import type { AppIntegrationConfigurationIssue } from '@shared/contracts';
import { shell } from 'electron';
import { ZodError } from 'zod';
import type { AppConfig } from '../../../config/index.js';
import { revealMainWindow } from '../../../mainWindow.js';
import { APP_INTEGRATION_PROVIDER_TAG } from '../../app-integration.constants.js';
import {
    type AppIntegrationAccessTarget,
    type AppIntegrationConnectionRequest,
    type AppIntegrationProvider,
    type AppIntegrationProviderConnection,
    type AppIntegrationProviderConnectionResult,
    AppIntegrationProviderError,
    type AppIntegrationProviderInstallation,
    type AppIntegrationProviderRefreshResult,
    type AppIntegrationRefreshContext,
} from '../../app-integration.types.js';
import { logAppIntegrationRefreshDiagnostic } from '../../app-integration-refresh-diagnostics.util.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { GitHubApiClient, GitHubApiError } from './github-api.client.js';
import {
    GITHUB_AUTHORISATIONS_SETTINGS_URL,
    GITHUB_INSTALLATION_POLL_INTERVAL_MS,
    githubAppInstallationUrl,
} from './github-app-integration.constants.js';
import { GitHubStoredCredentialSchema } from './github-app-integration.schema.js';
import type {
    GitHubStoredCredential,
    GitHubTokenBundle,
    GitHubUserIdentity,
} from './github-app-integration.types.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import {
    GitHubDeviceFlowClient,
    GitHubOAuthError,
    waitFor,
} from './github-device-flow.client.js';

/** Describes GitHub as an app integration available to Launcher. */
@Injectable({ tags: [APP_INTEGRATION_PROVIDER_TAG] })
export class GitHubAppIntegrationProvider implements AppIntegrationProvider {
    readonly metadata = {
        id: 'github',
        displayName: 'GitHub',
        order: 10,
    } as const;

    /**
     * Creates the GitHub provider.
     *
     * @param configService - Runtime Launcher configuration with the GitHub App identity.
     * @param deviceFlow - GitHub OAuth device-flow and token-refresh client.
     * @param github - GitHub API identity client.
     */
    constructor(
        private readonly configService: ConfigService<AppConfig>,
        private readonly deviceFlow: GitHubDeviceFlowClient,
        private readonly github: GitHubApiClient,
    ) {}

    /** Reports a missing GitHub App client ID or slug before any request. */
    getConfigurationIssue(): AppIntegrationConfigurationIssue | null {
        if (!this.configService.getOrThrow('githubClientId')) {
            return 'client-id-missing';
        }
        if (!this.configService.getOrThrow('githubAppSlug')) {
            return 'app-slug-missing';
        }
        return null;
    }

    /**
     * Completes one GitHub device-flow connection or reauthorisation.
     *
     * @param signal - Connection-attempt cancellation signal.
     * @param request - Requested operation, expected account, and code sink.
     * @returns The verified user credential and, for new connections, the
     * installation step.
     */
    async connect(
        signal: AbortSignal,
        request: AppIntegrationConnectionRequest,
    ): Promise<AppIntegrationProviderConnectionResult> {
        try {
            if (this.getConfigurationIssue() !== null) {
                throw new AppIntegrationProviderError('not-configured');
            }
            const clientId = this.configService.getOrThrow('githubClientId');
            const authorization = await this.deviceFlow.requestDeviceCode(
                clientId,
                signal,
            );
            request.onDeviceAuthorization({
                userCode: authorization.userCode,
                verificationUri: authorization.verificationUri,
                expiresAt: new Date(
                    Date.now() + authorization.expiresInSeconds * 1_000,
                ).toISOString(),
            });
            const token = await this.deviceFlow.waitForAccessToken(
                clientId,
                authorization,
                signal,
            );
            const issuedAt = Date.now();
            const identity = await this.github.getUser(
                token.accessToken,
                signal,
            );
            if (
                request.expectedAccountId !== null &&
                request.expectedAccountId !== String(identity.id)
            ) {
                throw new AppIntegrationProviderError('account-mismatch');
            }
            const accessTargets = await this.github.getInstallations(
                token.accessToken,
                signal,
            );
            revealMainWindow();
            return {
                connection: this.createConnection(
                    identity,
                    token,
                    accessTargets,
                    null,
                    issuedAt,
                ),
                installation:
                    request.intent === 'connect'
                        ? this.createInstallation(
                              identity,
                              token,
                              accessTargets,
                              issuedAt,
                              signal,
                          )
                        : null,
            };
        } catch (error) {
            throw mapProviderError(error, signal);
        }
    }

    /**
     * Creates the explicit GitHub App installation step for a new connection.
     * GitHub offers no callback without a server, so Launcher opens the
     * install page and polls the user's installations until a new one appears.
     *
     * @param identity - Verified GitHub user identity.
     * @param token - Device-flow token bundle.
     * @param knownTargets - Installations visible before installing.
     * @param issuedAt - Token issue time used for expiry calculation.
     * @param signal - Connection-session cancellation signal.
     * @returns The single-use installation step.
     */
    private createInstallation(
        identity: GitHubUserIdentity,
        token: GitHubTokenBundle,
        knownTargets: AppIntegrationProviderConnection['accessTargets'],
        issuedAt: number,
        signal: AbortSignal,
    ): AppIntegrationProviderInstallation {
        let started = false;
        return {
            // Nothing is held open; the session signal stops any polling.
            close: async () => undefined,
            install: async () => {
                if (started) {
                    throw new AppIntegrationProviderError('invalid-response');
                }
                started = true;
                try {
                    const knownIds = new Set(
                        knownTargets.map((target) => target.providerTargetId),
                    );
                    await shell.openExternal(
                        githubAppInstallationUrl(
                            this.configService.getOrThrow('githubAppSlug'),
                        ),
                    );
                    while (true) {
                        await waitFor(
                            GITHUB_INSTALLATION_POLL_INTERVAL_MS,
                            signal,
                        );
                        const targets = await this.github.getInstallations(
                            token.accessToken,
                            signal,
                        );
                        const added = targets.find(
                            (target) => !knownIds.has(target.providerTargetId),
                        );
                        if (added) {
                            revealMainWindow();
                            return this.createConnection(
                                identity,
                                token,
                                targets,
                                added.providerTargetId,
                                issuedAt,
                            );
                        }
                    }
                } catch (error) {
                    throw mapProviderError(error, signal);
                }
            },
        };
    }

    /**
     * Builds one verified connection result from a GitHub token and identity.
     *
     * @param identity - Verified GitHub user identity.
     * @param token - GitHub App user token bundle.
     * @param accessTargets - Installations visible to the user.
     * @param selectedAccessTargetId - Newly installed target, when present.
     * @param issuedAt - Token issue time used for expiry calculation.
     * @returns The provider connection result.
     */
    private createConnection(
        identity: GitHubUserIdentity,
        token: GitHubTokenBundle,
        accessTargets: AppIntegrationProviderConnection['accessTargets'],
        selectedAccessTargetId: string | null,
        issuedAt: number,
    ): AppIntegrationProviderConnection {
        return {
            accountId: String(identity.id),
            accountLogin: identity.login,
            accountDisplayName: identity.name,
            credential: JSON.stringify(
                GitHubStoredCredentialSchema.parse({
                    ...token,
                    version: 1,
                    createdAt: new Date(issuedAt).toISOString(),
                }),
            ),
            accessTokenExpiresAt: expiryFromSeconds(issuedAt, token.expiresIn),
            refreshTokenExpiresAt: expiryFromSeconds(
                issuedAt,
                token.refreshTokenExpiresIn,
            ),
            accessTargets,
            selectedAccessTargetId,
        };
    }

    /** Checks a decrypted GitHub token bundle before restoring it. */
    isCredentialValid(credential: string): boolean {
        try {
            return GitHubStoredCredentialSchema.safeParse(
                JSON.parse(credential),
            ).success;
        } catch {
            return false;
        }
    }

    /**
     * Refreshes an authorised GitHub user and their visible installations,
     * rotating the token directly with GitHub when it is near expiry.
     *
     * @param signal - Refresh cancellation signal.
     * @param credential - Decrypted GitHub token bundle.
     * @param expectedAccountId - Immutable GitHub user ID.
     * @param context - Safe correlation metadata for this refresh operation.
     * @returns The refreshed provider state without opening a browser.
     */
    async refresh(
        signal: AbortSignal,
        credential: string,
        expectedAccountId: string,
        context: AppIntegrationRefreshContext,
    ): Promise<AppIntegrationProviderRefreshResult> {
        let stored: GitHubStoredCredential;
        try {
            stored = GitHubStoredCredentialSchema.parse(JSON.parse(credential));
        } catch {
            logAppIntegrationRefreshDiagnostic({
                ...context,
                providerId: this.metadata.id,
                phase: 'credential-parse',
                outcome: 'terminal-failure',
                refreshTokenState: 'unknown',
                code: 'credential-invalid',
            });
            return { status: 'reauthorisation-required' };
        }

        try {
            const createdAt = new Date(stored.createdAt).getTime();
            const now = Date.now();
            const accessTokenExpiry = stored.expiresIn
                ? createdAt + stored.expiresIn * 1_000
                : null;
            const accessTokenState =
                accessTokenExpiry === null
                    ? ('non-expiring' as const)
                    : accessTokenExpiry <= now
                      ? ('expired' as const)
                      : accessTokenExpiry <= now + 5 * 60 * 1_000
                        ? ('near-expiry' as const)
                        : ('current' as const);
            const refreshTokenExpired =
                stored.refreshTokenExpiresIn !== null &&
                createdAt + stored.refreshTokenExpiresIn * 1_000 <= now;
            const refreshTokenState = refreshTokenExpired
                ? ('recorded-expired' as const)
                : stored.refreshToken
                  ? ('present' as const)
                  : ('missing' as const);
            logAppIntegrationRefreshDiagnostic({
                ...context,
                providerId: this.metadata.id,
                phase: 'credential-classified',
                outcome: 'succeeded',
                accessTokenState,
                refreshTokenState,
            });
            if (refreshTokenExpired) {
                logAppIntegrationRefreshDiagnostic({
                    ...context,
                    providerId: this.metadata.id,
                    phase: 'credential-classified',
                    outcome: 'terminal-failure',
                    accessTokenState,
                    refreshTokenState,
                    code: 'refresh-token-expired',
                });
                return { status: 'reauthorisation-required' };
            }
            let token: GitHubTokenBundle = stored;
            // Tokens from apps that opted out of expiry never rotate.
            if (
                accessTokenExpiry !== null &&
                accessTokenExpiry <= now + 5 * 60 * 1_000
            ) {
                if (!stored.refreshToken) {
                    logAppIntegrationRefreshDiagnostic({
                        ...context,
                        providerId: this.metadata.id,
                        phase: 'token-rotation',
                        outcome: 'terminal-failure',
                        accessTokenState,
                        refreshTokenState,
                        code: 'refresh-token-missing',
                    });
                    return { status: 'reauthorisation-required' };
                }
                const clientId =
                    this.configService.getOrThrow('githubClientId');
                if (!clientId) {
                    logAppIntegrationRefreshDiagnostic({
                        ...context,
                        providerId: this.metadata.id,
                        phase: 'token-rotation',
                        outcome: 'temporary-failure',
                        accessTokenState,
                        refreshTokenState,
                        code: 'client-id-missing',
                    });
                    return { status: 'temporarily-unavailable' };
                }
                logAppIntegrationRefreshDiagnostic({
                    ...context,
                    providerId: this.metadata.id,
                    phase: 'token-rotation',
                    outcome: 'started',
                    accessTokenState,
                    refreshTokenState,
                });
                token = await this.deviceFlow.refreshAccessToken(
                    clientId,
                    stored.refreshToken,
                    signal,
                );
                logAppIntegrationRefreshDiagnostic({
                    ...context,
                    providerId: this.metadata.id,
                    phase: 'token-rotation',
                    outcome: 'succeeded',
                    accessTokenState,
                    refreshTokenState: token.refreshToken
                        ? 'present'
                        : 'missing',
                });
            }
            const [identity, accessTargets] = await Promise.all([
                this.github.getUser(token.accessToken, signal),
                this.github.getInstallations(token.accessToken, signal),
            ]);
            if (String(identity.id) !== expectedAccountId) {
                logAppIntegrationRefreshDiagnostic({
                    ...context,
                    providerId: this.metadata.id,
                    phase: 'provider-validation',
                    outcome: 'terminal-failure',
                    accessTokenState,
                    refreshTokenState,
                    code: 'identity-mismatch',
                });
                return { status: 'reauthorisation-required' };
            }
            const refreshedAt = token === stored ? createdAt : Date.now();
            logAppIntegrationRefreshDiagnostic({
                ...context,
                providerId: this.metadata.id,
                phase: 'provider-validation',
                outcome: 'succeeded',
                accessTokenState,
                refreshTokenState: token.refreshToken ? 'present' : 'missing',
            });
            return {
                status: 'refreshed',
                connection: {
                    accountId: expectedAccountId,
                    accountLogin: identity.login,
                    accountDisplayName: identity.name,
                    credential: JSON.stringify(
                        GitHubStoredCredentialSchema.parse({
                            ...token,
                            version: 1,
                            createdAt: new Date(refreshedAt).toISOString(),
                        }),
                    ),
                    accessTokenExpiresAt: expiryFromSeconds(
                        refreshedAt,
                        token.expiresIn,
                    ),
                    refreshTokenExpiresAt: expiryFromSeconds(
                        refreshedAt,
                        token.refreshTokenExpiresIn,
                    ),
                    accessTargets,
                    selectedAccessTargetId: null,
                },
            };
        } catch (error) {
            const terminal =
                (error instanceof GitHubOAuthError &&
                    error.code === 'bad_refresh_token') ||
                (error instanceof GitHubApiError &&
                    (error.status === 401 || error.status === 403));
            const code =
                error instanceof GitHubOAuthError
                    ? error.code === 'bad_refresh_token'
                        ? ('refresh-token-rejected' as const)
                        : error.code === 'unavailable'
                          ? ('token-endpoint-unavailable' as const)
                          : ('token-endpoint-invalid-response' as const)
                    : error instanceof GitHubApiError
                      ? error.status === 401
                          ? ('github-unauthorised' as const)
                          : error.status === 403
                            ? ('github-forbidden' as const)
                            : ('network-error' as const)
                      : signal.aborted
                        ? ('timed-out' as const)
                        : error instanceof TypeError
                          ? ('network-error' as const)
                          : ('unknown' as const);
            logAppIntegrationRefreshDiagnostic({
                ...context,
                providerId: this.metadata.id,
                phase:
                    error instanceof GitHubOAuthError
                        ? 'token-rotation'
                        : 'provider-validation',
                outcome: terminal ? 'terminal-failure' : 'temporary-failure',
                code,
                status:
                    error instanceof GitHubOAuthError ||
                    error instanceof GitHubApiError
                        ? error.status
                        : null,
            });
            if (terminal) {
                return { status: 'reauthorisation-required' };
            }
            return { status: 'temporarily-unavailable' };
        }
    }

    /**
     * Opens GitHub's authorised GitHub Apps settings. GitHub only revokes
     * GitHub App user grants with the client secret, which Launcher never has.
     */
    async openAuthorisationSettings(): Promise<void> {
        await shell.openExternal(GITHUB_AUTHORISATIONS_SETTINGS_URL);
    }

    /**
     * Opens GitHub's exact installed-app access settings when known.
     *
     * @param accessTarget - Persisted verified GitHub installation target.
     */
    async openManageAccess(
        accessTarget: AppIntegrationAccessTarget,
    ): Promise<void> {
        await shell.openExternal(validatedManageAccessUrl(accessTarget));
    }
}

/**
 * Revalidates persisted GitHub settings metadata before browser navigation.
 *
 * @param accessTarget - Persisted non-secret installation metadata.
 * @returns The exact safe GitHub settings URL.
 */
function validatedManageAccessUrl(
    accessTarget: AppIntegrationAccessTarget,
): string {
    const expectedPath =
        accessTarget.type === 'organization'
            ? `/organizations/${accessTarget.login}/settings/installations/${accessTarget.providerTargetId}`
            : `/settings/installations/${accessTarget.providerTargetId}`;
    const url = new URL(accessTarget.manageUrl);
    if (
        url.origin !== 'https://github.com' ||
        url.pathname !== expectedPath ||
        url.search !== '' ||
        url.hash !== ''
    ) {
        throw new Error('The GitHub installation settings URL is invalid');
    }
    return url.toString();
}

/** Converts a relative provider lifetime into an ISO expiry. */
function expiryFromSeconds(
    createdAt: number,
    lifetimeSeconds: number | null,
): string | null {
    return lifetimeSeconds === null
        ? null
        : new Date(createdAt + lifetimeSeconds * 1_000).toISOString();
}

/** Maps implementation errors into renderer-safe provider classifications. */
function mapProviderError(
    error: unknown,
    signal: AbortSignal,
): AppIntegrationProviderError {
    if (signal.aborted) {
        return new AppIntegrationProviderError(
            signal.reason === 'timed-out' ? 'timed-out' : 'cancelled',
        );
    }
    if (error instanceof AppIntegrationProviderError) {
        return error;
    }
    if (error instanceof GitHubOAuthError) {
        switch (error.code) {
            case 'access_denied':
                return new AppIntegrationProviderError('denied');
            case 'expired_token':
                return new AppIntegrationProviderError('timed-out');
            case 'device_flow_disabled':
                return new AppIntegrationProviderError('device-flow-disabled');
            case 'unavailable':
                return new AppIntegrationProviderError('provider-unavailable');
            default:
                return new AppIntegrationProviderError('invalid-response');
        }
    }
    if (error instanceof ZodError) {
        return new AppIntegrationProviderError('invalid-response');
    }
    return new AppIntegrationProviderError(
        error instanceof TypeError ||
            (error instanceof Error && error.name === 'TimeoutError')
            ? 'network-error'
            : 'invalid-response',
    );
}
