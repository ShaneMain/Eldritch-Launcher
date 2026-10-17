import { describe, expect, it } from 'vitest';
import enProjects from '../../../../locales/en/projects.json';
import {
    getRemoteProjectGitLfsWarning,
    getRemoteProjectProgressKey,
    getRemoteProjectSubmoduleActivityMessage,
} from './remote-project-import.messages';

/** Resolves English project strings with i18next-style interpolation. */
function translate(key: string, values: Record<string, unknown> = {}): string {
    const template = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)?.[part],
            enProjects,
        );
    if (typeof template !== 'string') {
        throw new Error(`Missing translation ${key}`);
    }
    return template.replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
        String(values[name]),
    );
}

describe('remote project Git LFS messages', () => {
    it('labels the Git LFS download stage', () => {
        const key = getRemoteProjectProgressKey({
            jobId: 'job',
            stage: 'fetching-lfs',
            canCancel: true,
        });

        expect(translate(`addProject.remote.progress.${key}`)).toBe(
            'Downloading Git LFS files...',
        );
    });

    it('describes submodule Git LFS downloads with their path', () => {
        expect(
            getRemoteProjectSubmoduleActivityMessage(
                { type: 'fetching-lfs', path: 'addons/art' },
                translate,
            ),
        ).toBe('Downloading Git LFS files for addons/art');
    });

    it.each([null, { status: 'not-used' }, { status: 'pulled' }] as const)(
        'shows no warning for %j',
        (outcome) => {
            expect(
                getRemoteProjectGitLfsWarning(outcome, translate),
            ).toBeNull();
        },
    );

    it('explains how to fix pointer files when Git LFS is missing', () => {
        const warning = getRemoteProjectGitLfsWarning(
            { status: 'unavailable' },
            translate,
        );

        expect(warning).toContain('Install Git LFS');
        expect(warning).toContain('git lfs pull');
    });

    it.each([
        'authentication-failed',
        'quota-exceeded',
        'objects-missing',
        'network-failed',
        'timed-out',
        'unknown',
    ] as const)('names the %s failure and keeps the retry hint', (reason) => {
        const warning = getRemoteProjectGitLfsWarning(
            { status: 'failed', reason },
            translate,
        );

        expect(warning).toContain(
            translate(`addProject.remote.gitLfs.reasons.${reason}`),
        );
        expect(warning).toContain('git lfs pull');
        expect(warning).toContain('The clone was kept');
    });
});
