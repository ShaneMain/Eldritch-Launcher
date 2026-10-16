import type { ProjectGitStatusState } from '@shared/contracts';

const MAX_MESSAGE_LENGTH = 240;

export type GitFetchFailureKind = Extract<
    ProjectGitStatusState,
    'auth-required' | 'offline' | 'error'
>;

export type GitRemoteKind = 'github-https' | 'ssh' | 'local' | 'other';

const AUTH_PATTERNS = [
    'authentication failed',
    'could not read username',
    'could not read password',
    'terminal prompts disabled',
    'invalid username or password',
    'permission denied (publickey',
    'permission to ',
    'repository not found',
    'access denied',
    'error: 401',
    'error: 403',
    'returned error: 401',
    'returned error: 403',
    'bad credentials',
] as const;

const OFFLINE_PATTERNS = [
    'could not resolve host',
    'could not resolve hostname',
    'temporary failure in name resolution',
    'name or service not known',
    'failed to connect',
    'connection timed out',
    'connection refused',
    'network is unreachable',
    'no route to host',
    'operation timed out',
    'timed out after',
    'connection reset',
    'could not connect',
    'unable to connect',
    'ssl_connect',
    'gnutls_handshake',
] as const;

/**
 * Parses `git rev-list --left-right --count HEAD...@{u}` output.
 *
 * @param output - Raw stdout from Git.
 * @returns Commits only on HEAD (`ahead`) and only on upstream (`behind`).
 */
export function parseLeftRightCount(
    output: string,
): { ahead: number; behind: number } | null {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(output);
    if (!match) {
        return null;
    }
    return {
        ahead: Number.parseInt(match[1], 10),
        behind: Number.parseInt(match[2], 10),
    };
}

/**
 * Parses `git rev-parse --abbrev-ref HEAD` output.
 *
 * @param output - Raw stdout from Git.
 * @returns The branch name, `null` for a detached HEAD, or undefined when empty.
 */
export function parseHeadBranch(output: string): string | null | undefined {
    const branch = output.trim();
    if (!branch) {
        return undefined;
    }
    return branch === 'HEAD' ? null : branch;
}

/**
 * Converts a configured `branch.<name>.merge` value to a full remote ref.
 *
 * @param value - Raw configured merge value.
 * @returns A full `refs/heads/...` style ref, or null when unusable.
 */
export function parseMergeRef(value: string): string | null {
    const ref = value.trim();
    if (!ref || /\s/u.test(ref) || ref.startsWith('-')) {
        return null;
    }
    return ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
}

/**
 * Classifies a configured remote URL for credential and prompt handling.
 *
 * @param url - Effective fetch URL from `git remote get-url`.
 * @param normalizedHttps - Token-free canonical HTTPS URL, when valid.
 * @returns The remote transport class.
 */
export function classifyRemoteUrl(
    url: string,
    normalizedHttps: string | null,
): GitRemoteKind {
    if (normalizedHttps && new URL(normalizedHttps).hostname === 'github.com') {
        return 'github-https';
    }
    const lower = url.toLowerCase();
    if (/^(?:ssh|git\+ssh|ssh\+git):\/\//u.test(lower)) {
        return 'ssh';
    }
    if (lower.startsWith('file://')) {
        return 'local';
    }
    if (lower.includes('://')) {
        return 'other';
    }
    // scp-like `[user@]host:path`; a single-letter host is a Windows drive.
    if (/^(?:[^@/\\:]+@)?[^@/\\:]{2,}:/u.test(url)) {
        return 'ssh';
    }
    return 'local';
}

/**
 * Classifies bounded Git fetch diagnostics.
 *
 * @param stderr - Git standard error, possibly truncated.
 * @param timedOut - Whether the process hit the launcher timeout.
 * @returns The user-facing failure class.
 */
export function classifyFetchFailure(
    stderr: string,
    timedOut: boolean,
): GitFetchFailureKind {
    const lower = stderr.toLowerCase();
    if (AUTH_PATTERNS.some((pattern) => lower.includes(pattern))) {
        return 'auth-required';
    }
    if (
        timedOut ||
        OFFLINE_PATTERNS.some((pattern) => lower.includes(pattern))
    ) {
        return 'offline';
    }
    return 'error';
}

/**
 * Extracts one safe diagnostic line from Git output.
 *
 * URL user information is removed so credentials embedded in remote URLs never
 * reach logs or the renderer.
 *
 * @param stderr - Git standard error.
 * @returns A bounded single-line message, or null when Git said nothing.
 */
export function sanitizeGitMessage(stderr: string): string | null {
    const lines = stderr
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    const line =
        lines.find((candidate) => /^(?:fatal|error):/iu.test(candidate)) ??
        lines.at(-1);
    if (!line) {
        return null;
    }
    const redacted = line
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/giu, '$1')
        .replace(/[\p{Cc}]/gu, '');
    return redacted.length > MAX_MESSAGE_LENGTH
        ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : redacted;
}
