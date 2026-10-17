import type { ProjectGitStatus } from '@shared/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GitStatusBadgeView } from './git-status-badge.component';

vi.mock('../../../hooks/release.hook', () => ({
    useRelease: () => ({ reloadReleases: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { n?: number }) =>
            options?.n === undefined ? key : `${key}:${options.n}`,
    }),
}));

const okStatus: ProjectGitStatus = {
    projectPath: '/projects/game',
    state: 'ok',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    stale: false,
    message: null,
    checkedAt: 1_700_000_000_000,
};

/** Renders the badge view as static HTML. */
function render(
    status: ProjectGitStatus | undefined,
    { refreshing = false, compact = false } = {},
): string {
    return renderToStaticMarkup(
        <GitStatusBadgeView
            status={status}
            refreshing={refreshing}
            compact={compact}
            onRefresh={() => undefined}
        />,
    );
}

describe('GitStatusBadgeView', () => {
    it('shows behind before ahead', () => {
        const html = render({ ...okStatus, behind: 2, ahead: 1 });

        expect(html).toContain('↓2');
        expect(html).toContain('↑1');
        expect(html.indexOf('↓2')).toBeLessThan(html.indexOf('↑1'));
        expect(html).toContain('git.behind:2');
        expect(html).toContain('<button');
    });

    it('hides a zero side', () => {
        const html = render({ ...okStatus, behind: 3, ahead: 0 });

        expect(html).toContain('↓3');
        expect(html).not.toContain('↑');
    });

    it('shows a check when up to date', () => {
        const html = render(okStatus);

        expect(html).toContain('lucide-check');
        expect(html).toContain('git.upToDate');
        expect(html).not.toContain('↓');
    });

    it.each([
        ['no-upstream', 'git.noUpstream'],
        ['detached', 'git.detached'],
        ['offline', 'git.offline'],
        ['error', 'git.error'],
    ] as const)('labels the %s state', (state, label) => {
        expect(
            render({ ...okStatus, state, ahead: null, behind: null }),
        ).toContain(label);
    });

    it('signs in to GitHub in place for auth-required', () => {
        const html = render({
            ...okStatus,
            state: 'auth-required',
            ahead: null,
            behind: null,
        });

        expect(html).toMatch(/<button[^>]*aria-label="git.signIn"/);
        expect(html).toContain('git.authRequired');
        expect(html).not.toContain('href=');
    });

    it('dims stale last-known counts', () => {
        const html = render({
            ...okStatus,
            state: 'offline',
            behind: 4,
            ahead: 0,
            stale: true,
        });

        expect(html).toContain('↓4');
        expect(html).toContain('opacity-60');
        expect(html).toContain('lucide-wifi-off');
    });

    it('renders nothing outside a repository or before the first check', () => {
        expect(render({ ...okStatus, state: 'not-a-repo' })).toBe('');
        expect(render(undefined)).toBe('');
        expect(render(undefined, { refreshing: true })).toContain(
            'loading-spinner',
        );
    });
});
