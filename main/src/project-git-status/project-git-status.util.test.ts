import { describe, expect, it } from 'vitest';
import {
    classifyFetchFailure,
    classifyRemoteUrl,
    parseHeadBranch,
    parseLeftRightCount,
    parseMergeRef,
    sanitizeGitMessage,
} from './project-git-status.util.js';

describe('parseLeftRightCount', () => {
    it.each([
        ['3\t5\n', { ahead: 3, behind: 5 }],
        ['0\t0', { ahead: 0, behind: 0 }],
        ['  12 7  \r\n', { ahead: 12, behind: 7 }],
    ])('parses %j', (output, expected) => {
        expect(parseLeftRightCount(output)).toEqual(expected);
    });

    it.each(['', '3\n', '3\t5\t1', 'a\tb', '-1\t2'])('rejects %j', (output) => {
        expect(parseLeftRightCount(output)).toBeNull();
    });
});

describe('parseHeadBranch', () => {
    it('returns the branch, null for detached HEAD, undefined when empty', () => {
        expect(parseHeadBranch('feature/x\n')).toBe('feature/x');
        expect(parseHeadBranch('HEAD\n')).toBeNull();
        expect(parseHeadBranch('\n')).toBeUndefined();
    });
});

describe('parseMergeRef', () => {
    it('keeps full refs and expands short branch names', () => {
        expect(parseMergeRef('refs/heads/main\n')).toBe('refs/heads/main');
        expect(parseMergeRef('main')).toBe('refs/heads/main');
    });

    it.each(['', '-main', 'refs/heads/a b'])('rejects %j', (value) => {
        expect(parseMergeRef(value)).toBeNull();
    });
});

describe('classifyRemoteUrl', () => {
    it.each([
        [
            'https://github.com/Owner/Repo.git',
            'https://github.com/Owner/Repo',
            'github-https',
        ],
        ['https://gitlab.com/o/r.git', 'https://gitlab.com/o/r', 'other'],
        ['git@github.com:Owner/Repo.git', null, 'ssh'],
        ['ssh://git@example.com/o/r.git', null, 'ssh'],
        ['example.com:o/r.git', null, 'ssh'],
        ['file:///srv/repo.git', null, 'local'],
        ['/srv/repo.git', null, 'local'],
        ['C:\\repos\\game.git', null, 'local'],
        ['https://user:pass@github.com/o/r.git', null, 'other'],
    ] as const)('classifies %s', (url, normalized, expected) => {
        expect(classifyRemoteUrl(url, normalized)).toBe(expected);
    });
});

describe('classifyFetchFailure', () => {
    it.each([
        [
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            'auth-required',
        ],
        ['git@github.com: Permission denied (publickey).', 'auth-required'],
        ['fatal: unable to get password from user', 'auth-required'],
        ['remote: Repository not found.', 'auth-required'],
        [
            'fatal: unable to access: The requested URL returned error: 403',
            'auth-required',
        ],
        [
            "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
            'offline',
        ],
        [
            'ssh: connect to host github.com port 22: Network is unreachable',
            'offline',
        ],
        [
            "fatal: '/tmp/missing' does not appear to be a git repository",
            'error',
        ],
    ] as const)('classifies %s', (stderr, expected) => {
        expect(classifyFetchFailure(stderr, false)).toBe(expected);
    });

    it('treats a timeout as offline', () => {
        expect(classifyFetchFailure('', true)).toBe('offline');
    });
});

describe('sanitizeGitMessage', () => {
    it('prefers the fatal line and strips URL credentials', () => {
        expect(
            sanitizeGitMessage(
                "hint: something\nfatal: unable to access 'https://user:ghu_secret@github.com/o/r.git/'\nmore\n",
            ),
        ).toBe("fatal: unable to access 'https://github.com/o/r.git/'");
    });

    it('bounds long messages and returns null for silence', () => {
        expect(sanitizeGitMessage(`error: ${'x'.repeat(500)}`)).toHaveLength(
            240,
        );
        expect(sanitizeGitMessage('\n  \n')).toBeNull();
    });
});
