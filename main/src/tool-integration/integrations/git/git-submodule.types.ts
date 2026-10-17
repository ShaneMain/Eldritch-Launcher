import type { RemoteProjectGitLfsOutcome } from '@shared/contracts';

export type GitSubmoduleActivity =
    | { type: 'found'; count: number }
    | { type: 'validating'; path: string }
    | { type: 'initialising'; path: string }
    | { type: 'initialised'; path: string }
    | { type: 'fetching-lfs'; path: string };

export type GitSubmoduleInitialiseRequest = {
    repositoryPath: string;
    supportDirectory: string;
    signal: AbortSignal;
    onActivity: (activity: GitSubmoduleActivity) => void;
};

export type GitSubmoduleInitialiseResult =
    | { ok: true; initialisedCount: number; gitLfs: RemoteProjectGitLfsOutcome }
    | {
          ok: false;
          reason:
              | 'git-unavailable'
              | 'unsupported-submodule'
              | 'submodule-unavailable'
              | 'submodule-limit-exceeded'
              | 'cancelled';
          path?: string;
      };
