/**
 * Build-time GitHub App identity. Neither value is secret: device flow and
 * token refresh for GitHub App user tokens need only the public client ID.
 * Override at runtime with `ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID` and
 * `ELDRITCH_LAUNCHER_GITHUB_APP_SLUG`.
 */
export const GITHUB_APP_CLIENT_ID = 'Iv23li2rfGaBRYlD5lT1';
export const GITHUB_APP_SLUG = 'eldritch-launcher';

export const GITHUB_USER_AGENT = 'Eldritch-Launcher';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_ACCESS_TOKEN_URL =
    'https://github.com/login/oauth/access_token';
export const GITHUB_DEVICE_GRANT_TYPE =
    'urn:ietf:params:oauth:grant-type:device_code';
export const GITHUB_REFRESH_GRANT_TYPE = 'refresh_token';
/** RFC 8628 default polling interval when GitHub omits `interval`. */
export const GITHUB_DEVICE_DEFAULT_INTERVAL_SECONDS = 5;
/** Extra delay GitHub requires after each `slow_down` response. */
export const GITHUB_DEVICE_SLOW_DOWN_SECONDS = 5;
export const GITHUB_OAUTH_REQUEST_TIMEOUT_MS = 10_000;
export const GITHUB_OAUTH_RESPONSE_MAX_BYTES = 64 * 1024;
export const GITHUB_AUTHORISATIONS_SETTINGS_URL =
    'https://github.com/settings/apps/authorizations';
export const GITHUB_INSTALLATION_POLL_INTERVAL_MS = 5_000;

export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_INSTALLATIONS_URL =
    'https://api.github.com/user/installations';
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
export const GITHUB_INSTALLATIONS_PER_PAGE = 100;
export const MAX_INSTALLATION_PAGES = 10;
export const GITHUB_USER_RESPONSE_MAX_BYTES = 64 * 1024;
export const GITHUB_INSTALLATION_PAGE_MAX_BYTES = 1024 * 1024;
export const GITHUB_REPOSITORIES_PER_PAGE = 50;
export const GITHUB_REPOSITORY_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const GITHUB_REPOSITORY_RESPONSE_MAX_BYTES = 256 * 1024;
export const GITHUB_REPOSITORY_CREATION_RESPONSE_MAX_BYTES = 256 * 1024;
export const GITHUB_MAX_RENAME_REDIRECTS = 3;

/** Builds the public GitHub App installation entry for one app slug. */
export function githubAppInstallationUrl(slug: string): string {
    return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}
