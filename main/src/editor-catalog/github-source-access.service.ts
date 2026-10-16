import { Injectable } from '@mariodebono/di';
import type { AppIntegrationCredentialRoute } from '../app-integrations/app-integration-capability.types.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { AppIntegrationsService } from '../app-integrations/app-integrations.service.js';
import { GitHubStoredCredentialSchema } from '../app-integrations/providers/github/github-app-integration.schema.js';
import {
    EngineSourceAuthError,
    GithubRequestError,
} from './github-source.errors.js';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** Identifies one GitHub repository used as an engine source. */
export type GithubRepositoryRef = {
    owner: string;
    repo: string;
    requiresAuth: boolean;
};

/** Runs GitHub REST requests for engine sources with an optional user token. */
@Injectable()
export class GithubSourceAccessService {
    /**
     * Creates the source access service.
     *
     * @param integrations - App integrations that lease the GitHub credential.
     */
    constructor(private readonly integrations: AppIntegrationsService) {}

    /**
     * Runs an operation with the signed-in GitHub token, or with null when no
     * usable GitHub connection exists. The token is only valid inside the
     * callback and must not be retained.
     *
     * @param operation - Callback receiving the bearer token or null.
     * @returns The callback result.
     */
    async withToken<T>(
        operation: (token: string | null) => Promise<T>,
    ): Promise<T> {
        let started = false;
        try {
            const lease = await this.integrations.withCredentialLease(
                'github',
                (routes) => {
                    started = true;
                    return operation(readAccessToken(routes));
                },
            );
            if (lease.ok) {
                return lease.value;
            }
        } catch (error) {
            if (started) {
                throw error;
            }
        }
        return operation(null);
    }

    /**
     * Sends one GitHub REST API request.
     *
     * @param path - API path beginning with `/`, or an absolute API URL.
     * @param token - Optional bearer token.
     * @param repository - Repository the request belongs to, for error mapping.
     * @param init - Extra request options.
     * @returns The successful response.
     */
    async request(
        path: string,
        token: string | null,
        repository: GithubRepositoryRef,
        init: RequestInit = {},
    ): Promise<Response> {
        const url = new URL(path, GITHUB_API_ORIGIN);
        if (url.origin !== GITHUB_API_ORIGIN) {
            throw new GithubRequestError(0, 'Refusing non-GitHub API request');
        }
        let response: Response;
        try {
            response = await fetch(url, {
                ...init,
                headers: {
                    ...githubHeaders(token),
                    ...(init.headers as Record<string, string> | undefined),
                },
            });
        } catch (cause) {
            if (init.signal?.aborted) {
                throw init.signal.reason ?? cause;
            }
            throw new GithubRequestError(0, 'GitHub is unreachable', {
                cause,
            });
        }
        if (response.ok || REDIRECT_STATUSES.includes(response.status)) {
            return response;
        }
        await response.body?.cancel();
        throw mapFailure(response, repository);
    }

    /**
     * Resolves a private or public release asset API URL to the short-lived
     * signed download URL. The bearer token is sent only to api.github.com;
     * callers download the returned URL without credentials.
     *
     * @param apiUrl - `https://api.github.com/repos/{o}/{r}/releases/assets/{id}`.
     * @param token - Optional bearer token.
     * @param repository - Repository that owns the asset.
     * @param signal - Optional cancellation signal.
     * @returns The signed download URL.
     */
    async resolveAssetDownloadUrl(
        apiUrl: string,
        token: string | null,
        repository: GithubRepositoryRef,
        signal?: AbortSignal,
    ): Promise<string> {
        const response = await this.request(apiUrl, token, repository, {
            headers: { Accept: 'application/octet-stream' },
            redirect: 'manual',
            signal,
        });
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!REDIRECT_STATUSES.includes(response.status) || !location) {
            throw new GithubRequestError(
                response.status,
                'GitHub did not return a release asset download location',
            );
        }
        const resolved = new URL(location, apiUrl);
        if (resolved.protocol !== 'https:') {
            throw new GithubRequestError(
                response.status,
                'GitHub returned an insecure release asset location',
            );
        }
        return resolved.href;
    }
}

/**
 * Builds the headers sent to the GitHub REST API.
 *
 * @param token - Optional bearer token.
 * @returns GitHub REST API headers.
 */
function githubHeaders(token: string | null): Record<string, string> {
    return {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'Godot-Launcher',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

/**
 * Maps a failed GitHub response to an authorisation or request error.
 * Rejected credentials (401) always need sign-in; 403/404 only do for
 * sources that require authentication, since private repositories answer
 * 404 to unauthorised callers.
 *
 * @param response - The failed response.
 * @param repository - Repository the request belongs to.
 * @returns The error to throw.
 */
function mapFailure(
    response: Response,
    repository: GithubRepositoryRef,
): Error {
    const source = `${repository.owner}/${repository.repo}`;
    const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
            response.headers.get('x-ratelimit-remaining') === '0');
    if (rateLimited) {
        return new GithubRequestError(
            response.status,
            `GitHub rate limit reached for ${source}`,
        );
    }
    if (
        response.status === 401 ||
        ((response.status === 403 || response.status === 404) &&
            repository.requiresAuth)
    ) {
        return new EngineSourceAuthError(source);
    }
    return new GithubRequestError(
        response.status,
        `GitHub request for ${source} failed: ${response.status}`,
    );
}

/**
 * Reads the GitHub access token from leased credential routes.
 *
 * @param routes - Routes granted by the credential lease.
 * @returns The access token, or null when the credential is unusable.
 */
function readAccessToken(
    routes: readonly AppIntegrationCredentialRoute[],
): string | null {
    const credential = routes[0]?.credential;
    if (!credential) {
        return null;
    }
    try {
        return GitHubStoredCredentialSchema.parse(JSON.parse(credential))
            .accessToken;
    } catch {
        return null;
    }
}
