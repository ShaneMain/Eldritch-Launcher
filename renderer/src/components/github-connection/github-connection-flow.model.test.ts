import type {
    AppIntegrationActionResult,
    AppIntegrationSummary,
} from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import {
    formatDeviceCodeRemaining,
    GitHubConnectionFlowSessionGuard,
    getGitHubConnectionFlowState,
    gitHubConfigurationIssueKey,
    hasUsableGitHubConnection,
} from './github-connection-flow.model';

const disconnected: AppIntegrationSummary = {
    id: 'github',
    displayName: 'GitHub',
    state: 'not-connected',
    connectionStage: null,
    connections: [],
    connectionOptions: [],
    configurationIssue: null,
    deviceAuthorization: null,
};

const usable: AppIntegrationSummary = {
    ...disconnected,
    state: 'connected',
    connections: [
        {
            id: 'connection-id',
            accountLogin: 'octocat',
            accountDisplayName: null,
            state: 'connected',
            accessTargets: [
                {
                    id: 'target-id',
                    login: 'octocat',
                    type: 'user',
                    availability: 'available',
                    capabilities: ['repository-browsing'],
                },
            ],
        },
    ],
};

/**
 * Creates an accepted bridge result for a flow-state test.
 *
 * @param integration - Summary returned by the bridge action.
 * @returns A successful app integration action result.
 */
function successfulResult(
    integration: AppIntegrationSummary,
): AppIntegrationActionResult {
    return { ok: true, integration };
}

describe('GitHub connection flow state', () => {
    it('keeps an authorised installation choice in the chooser', () => {
        expect(
            getGitHubConnectionFlowState(
                successfulResult({
                    ...disconnected,
                    state: 'selection-required',
                    connectionStage: 'choosing',
                    connectionOptions: [
                        { id: 'option-id', login: 'octocat', type: 'user' },
                    ],
                }),
            ),
        ).toBe('choosing');
    });

    it('only completes after a usable connected account is returned', () => {
        expect(hasUsableGitHubConnection(usable)).toBe(true);
        expect(getGitHubConnectionFlowState(successfulResult(usable))).toBe(
            'completed',
        );

        expect(
            getGitHubConnectionFlowState(
                successfulResult({
                    ...usable,
                    connections: [
                        {
                            ...usable.connections[0],
                            state: 'reauthorisation-required',
                        },
                    ],
                }),
            ),
        ).toBe('error');
    });

    it('ignores a late browser result after cancellation invalidates its session', () => {
        const guard = new GitHubConnectionFlowSessionGuard();
        const browserRequest = guard.begin();

        guard.invalidate();

        expect(guard.isCurrent(browserRequest)).toBe(false);
        expect(guard.isCurrent(guard.begin())).toBe(true);
    });

    it('does not adopt a separate active connection session', () => {
        expect(
            getGitHubConnectionFlowState({
                ok: false,
                reason: 'already-connecting',
                integration: {
                    ...disconnected,
                    state: 'selection-required',
                    connectionStage: 'choosing',
                },
            }),
        ).toBe('error');
    });
});

describe('GitHub device-flow presentation', () => {
    it('formats the device-code countdown as minutes and padded seconds', () => {
        expect(formatDeviceCodeRemaining(15 * 60 * 1_000)).toBe('15:00');
        expect(formatDeviceCodeRemaining(65_000)).toBe('1:05');
        expect(formatDeviceCodeRemaining(400)).toBe('0:01');
        expect(formatDeviceCodeRemaining(-5_000)).toBe('0:00');
    });

    it('explains each missing GitHub App setting', () => {
        expect(gitHubConfigurationIssueKey('client-id-missing')).toBe(
            'githubAuth:configuration.clientIdMissing',
        );
        expect(gitHubConfigurationIssueKey('app-slug-missing')).toBe(
            'githubAuth:configuration.appSlugMissing',
        );
    });
});
