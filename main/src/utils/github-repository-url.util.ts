/**
 * Pure GitHub repository reference parsing shared by the main process and
 * the renderer. Keep this module free of imports so both builds can use it.
 */

/** Valid GitHub owner or repository name. */
export const GITHUB_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/** A GitHub repository identified by owner and name. */
export type GithubRepositoryRef = {
    owner: string;
    repo: string;
};

const GITHUB_HOSTS: Record<string, true> = {
    'github.com': true,
    'www.github.com': true,
};

/**
 * Parses a GitHub repository reference typed or pasted by the user.
 *
 * Accepts `https://github.com/owner/repo` (also `http://`, `www.`, no
 * scheme, a trailing `/` or `.git`, and extra path such as `/releases` or
 * `/tree/branch`), `git@github.com:owner/repo.git`,
 * `ssh://git@github.com/owner/repo.git`, and bare `owner/repo`.
 *
 * @param input - User-provided repository reference.
 * @returns The owner and repository, or null when the input is not a GitHub
 * repository reference.
 */
export function parseGithubRepositoryUrl(
    input: string,
): GithubRepositoryRef | null {
    const value = input.trim();
    if (!value || /\s/.test(value)) {
        return null;
    }

    let path: string;
    const scp = /^git@([^:/]+):(.*)$/i.exec(value);
    if (scp) {
        if (GITHUB_HOSTS[scp[1].toLowerCase()] !== true) {
            return null;
        }
        path = scp[2];
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return null;
        }
        const protocol = url.protocol.toLowerCase();
        if (
            !['http:', 'https:', 'ssh:'].includes(protocol) ||
            GITHUB_HOSTS[url.hostname.toLowerCase()] !== true ||
            url.port !== '' ||
            url.password !== '' ||
            (protocol === 'ssh:' ? url.username !== 'git' : url.username !== '')
        ) {
            return null;
        }
        path = url.pathname;
    } else {
        const slash = value.indexOf('/');
        const head = slash === -1 ? value : value.slice(0, slash);
        if (GITHUB_HOSTS[head.toLowerCase()] === true) {
            path = value.slice(slash + 1);
        } else if (head.includes('.') || head.includes(':')) {
            // Looks like another host, e.g. gitlab.com/owner/repo.
            return null;
        } else {
            // Bare owner/repo: exactly two segments.
            path = value;
            if (value.replace(/\/+$/, '').split('/').length !== 2) {
                return null;
            }
        }
    }

    const segments = path
        .replace(/[?#].*$/, '')
        .split('/')
        .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
        return null;
    }
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, '');
    if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) {
        return null;
    }
    return { owner, repo };
}
