/** One GitHub device-flow authorisation awaiting user confirmation. */
export type GitHubDeviceAuthorization = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresInSeconds: number;
    intervalSeconds: number;
};

export type GitHubTokenBundle = {
    accessToken: string;
    expiresIn: number | null;
    refreshToken: string | null;
    refreshTokenExpiresIn: number | null;
    scope: string;
    tokenType: string;
};

export type GitHubStoredCredential = GitHubTokenBundle & {
    version: 1;
    createdAt: string;
};

export type GitHubUserIdentity = {
    id: number;
    login: string;
    name: string | null;
};

export type GitHubInstallation = {
    id: number;
    account: {
        login: string;
        type: 'Organization' | 'User';
    };
    html_url: string;
    permissions: {
        administration?: 'read' | 'write';
        contents?: 'read' | 'write';
    };
    suspended_at: string | null;
};

export type GitHubRepository = {
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
    visibility: 'public' | 'private' | 'internal';
    clone_url: string;
    disabled: boolean;
    archived: boolean;
    permissions: { pull: boolean };
};

export type GitHubRepositoryPage = {
    repositories: GitHubRepository[];
    nextCursor: string | null;
};

export type GitHubCreatedRepository = {
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
    private: true;
    clone_url: string;
    html_url: string;
};
