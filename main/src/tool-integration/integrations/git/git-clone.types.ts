import type { RemoteProjectGitLfsOutcome } from '@shared/contracts';

export type GitCloneRequest = {
    canonicalUrl: string;
    destinationPath: string;
    supportDirectory: string;
    signal: AbortSignal;
    onProgress: (percent: number) => void;
    /** Reports Git LFS download progress; called without a percent on entry. */
    onGitLfsProgress: (percent?: number) => void;
} & (
    | {
          source: 'public';
          approvedAddresses: string[];
      }
    | {
          source: 'connected';
          credential: {
              username: string;
              password: string;
          };
      }
);

export type GitCloneResult =
    | { ok: true; gitLfs: RemoteProjectGitLfsOutcome }
    | {
          ok: false;
          reason:
              | 'git-unavailable'
              | 'public-clone-incompatible'
              | 'clone-failed'
              | 'cancelled';
      };

export type GitCloneLfsRequest = {
    /** Exact checked-out working tree of a fresh clone. */
    repositoryPath: string;
    /** Token-free HTTPS URL the working tree was cloned from. */
    canonicalUrl: string;
    /** Isolated network environment carrying the clone's askpass session. */
    environment: NodeJS.ProcessEnv;
    /** Whether the askpass session may answer credential prompts. */
    interactive: boolean;
    signal: AbortSignal;
    /** Called once LFS-tracked files are found, before any download starts. */
    onStart: () => void;
    onProgress: (percent: number) => void;
};

export type GitCloneLfsResult =
    | RemoteProjectGitLfsOutcome
    | { status: 'cancelled' };
