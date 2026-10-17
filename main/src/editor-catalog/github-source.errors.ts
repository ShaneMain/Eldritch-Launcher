/**
 * Raised when a GitHub source needs a signed-in, authorised account.
 * `signedIn` tells apart a missing or rejected login from a signed-in
 * account that cannot see the repository, which happens when the GitHub App
 * is not installed on the repository owner or not granted the repository.
 */
export class EngineSourceAuthError extends Error {
    /**
     * Creates an authorisation failure for one source.
     *
     * @param source - GitHub `owner/repo` that refused access.
     * @param signedIn - Whether a valid GitHub login was used.
     */
    constructor(
        readonly source: string,
        readonly signedIn = false,
    ) {
        super(
            signedIn
                ? `The signed-in GitHub account cannot access ${source}`
                : `GitHub authorisation required for ${source}`,
        );
        this.name = 'EngineSourceAuthError';
    }
}

/** Raised when a GitHub request fails for a reason other than authorisation. */
export class GithubRequestError extends Error {
    /**
     * Creates a failed request error.
     *
     * @param status - HTTP status, or 0 for network failures.
     * @param message - Readable failure description.
     * @param options - Optional underlying failure.
     */
    constructor(
        readonly status: number,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'GithubRequestError';
    }
}
