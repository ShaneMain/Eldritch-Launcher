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
    /** Exact checked-out working tree of a fresh clone or updated checkout. */
    repositoryPath: string;
    /**
     * Token-free HTTPS URL the working tree was cloned or fetched from; the
     * LFS endpoint and credentials are pinned to it. Null keeps the
     * repository's own LFS endpoint and the user's credential configuration
     * (existing checkouts whose remote the launcher holds no credential for).
     */
    canonicalUrl: string | null;
    /** Isolated network environment carrying the clone's askpass session. */
    environment: NodeJS.ProcessEnv;
    /** Whether the askpass session may answer credential prompts. */
    interactive: boolean;
    /** Destination-bound credential helper to use instead of askpass. */
    credentialHelper?: string;
    /**
     * Configures the LFS filters without installing Git hooks, for existing
     * checkouts whose own hooks must stay untouched.
     */
    skipHooks?: boolean;
    signal: AbortSignal;
    /** Called once LFS-tracked files are found, before any download starts. */
    onStart: () => void;
    onProgress: (percent: number) => void;
};

export type GitCloneLfsResult =
    | RemoteProjectGitLfsOutcome
    | { status: 'cancelled' };
