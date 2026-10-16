/** Raised when a GitHub source needs a signed-in, authorised account. */
export class EngineSourceAuthError extends Error {
    /**
     * Creates an authorisation failure for one source.
     *
     * @param source - GitHub `owner/repo` that refused access.
     */
    constructor(readonly source: string) {
        super(`GitHub authorisation required for ${source}`);
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
