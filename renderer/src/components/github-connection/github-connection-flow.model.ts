import type {
    AppIntegrationActionResult,
    AppIntegrationConfigurationIssue,
    AppIntegrationSummary,
} from '@shared/contracts';

export type GitHubConnectionFlowState =
    | 'intro'
    | 'authorising'
    | 'saving'
    | 'choosing'
    | 'installing'
    | 'error';

/**
 * Keeps asynchronous connection responses scoped to the active flow session.
 */
export class GitHubConnectionFlowSessionGuard {
    private version = 0;

    /**
     * Starts a new request and invalidates older responses.
     *
     * @returns The new request version.
     */
    begin(): number {
        this.version += 1;
        return this.version;
    }

    /**
     * Invalidates every outstanding response.
     */
    invalidate(): void {
        this.version += 1;
    }

    /**
     * Checks whether a request still belongs to this flow.
     *
     * @param version - Version returned by {@link begin}.
     * @returns Whether the response is still current.
     */
    isCurrent(version: number): boolean {
        return version === this.version;
    }
}

/**
 * Checks that a completed connection includes an account with accessible use.
 *
 * @param integration - Renderer-safe GitHub integration result.
 * @returns Whether the result is ready for a caller to use.
 */
export function hasUsableGitHubConnection(
    integration: AppIntegrationSummary,
): boolean {
    return (
        integration.state === 'connected' &&
        integration.connections.some(
            (connection) =>
                connection.state === 'connected' &&
                connection.accessTargets.some(
                    (target) => target.availability === 'available',
                ),
        )
    );
}

/**
 * Selects the next visible flow state from one bridge action result.
 *
 * @param result - Renderer-safe result returned by the app integrations bridge.
 * @returns The next visible state, or `completed` for a usable final connection.
 */
export function getGitHubConnectionFlowState(
    result: AppIntegrationActionResult,
): GitHubConnectionFlowState | 'completed' {
    if (!result.ok) {
        if (result.reason === 'already-connecting') return 'error';
        if (
            result.integration.state === 'selection-required' ||
            result.integration.connectionStage === 'choosing'
        ) {
            return 'choosing';
        }
        return 'error';
    }
    if (
        result.integration.state === 'selection-required' ||
        result.integration.connectionStage === 'choosing'
    ) {
        return 'choosing';
    }
    if (result.integration.connectionStage === 'installing')
        return 'installing';
    if (hasUsableGitHubConnection(result.integration)) return 'completed';
    return 'error';
}

/**
 * Selects the message explaining why GitHub cannot be connected in this build.
 *
 * @param issue - Missing GitHub App configuration.
 * @returns The `githubAuth` translation key.
 */
export function gitHubConfigurationIssueKey(
    issue: AppIntegrationConfigurationIssue,
): string {
    return issue === 'client-id-missing'
        ? 'githubAuth:configuration.clientIdMissing'
        : 'githubAuth:configuration.appSlugMissing';
}

/**
 * Formats the time left on a device code as `m:ss`.
 *
 * @param remainingMs - Milliseconds until the code expires.
 * @returns The countdown text, never negative.
 */
export function formatDeviceCodeRemaining(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
    const seconds = totalSeconds % 60;
    return `${Math.floor(totalSeconds / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}
