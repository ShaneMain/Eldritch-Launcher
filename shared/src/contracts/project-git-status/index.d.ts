import type { RemoteProjectGitLfsOutcome } from '../projects/index.js';

/**
 * Read-only comparison state of a project's checked-out branch and upstream.
 *
 * - `ok`: the upstream was fetched and the counts are current.
 * - `not-a-repo`: the project is not inside a Git work tree.
 * - `no-upstream`: the current branch has no configured upstream.
 * - `detached`: HEAD is not on a branch.
 * - `auth-required`: the remote rejected or required credentials.
 * - `offline`: the remote could not be reached.
 * - `error`: any other failure; see `message`.
 */
export type ProjectGitStatusState =
    | 'ok'
    | 'not-a-repo'
    | 'no-upstream'
    | 'detached'
    | 'auth-required'
    | 'offline'
    | 'error';

export type ProjectGitStatus = {
    projectPath: string;
    state: ProjectGitStatusState;
    /** Checked-out branch, or null when detached or unknown. */
    branch: string | null;
    /** Short upstream name such as `origin/main`, when configured. */
    upstream: string | null;
    /** Local commits not on the upstream, when known. */
    ahead: number | null;
    /** Upstream commits not in the local branch, when known. */
    behind: number | null;
    /** Counts come from the last fetched remote-tracking ref, not a fresh fetch. */
    stale: boolean;
    /** Sanitised Git diagnostic for the `error` state. */
    message: string | null;
    /** Epoch milliseconds when this status was computed. */
    checkedAt: number;
};

/** Project Git upstream status operations available to the renderer. */
export type ProjectGitStatusBridge = {
    /** Returns the cached statuses without running Git. */
    getStatuses(): Promise<ProjectGitStatus[]>;
    /** Fetches and recomputes one registered project's status. */
    refreshProject(projectPath: string): Promise<ProjectGitStatus | null>;
    /** Fetches and recomputes every registered project's status. */
    refreshAll(): Promise<ProjectGitStatus[]>;
    /**
     * Saves the automatic refresh interval and reschedules it.
     *
     * @param minutes - Minutes between automatic refreshes; 0 disables them.
     * @returns The normalised saved interval.
     */
    setRefreshInterval(minutes: number): Promise<number>;
    /**
     * Fast-forwards a registered project's branch to its upstream and pulls
     * Git LFS content. Progress arrives as `project-git-update-progress`.
     *
     * @param projectPath - Exact registered project path.
     * @param options - Optional stash-and-retry for blocking local changes.
     */
    updateProject(
        projectPath: string,
        options?: ProjectGitUpdateOptions,
    ): Promise<ProjectGitUpdateResult>;
    /**
     * Cancels a running update of one project.
     *
     * @returns Whether an update was running.
     */
    cancelUpdate(projectPath: string): Promise<boolean>;
};

/** Step of a running fast-forward update. */
export type ProjectGitUpdateStage = 'fetching' | 'updating' | 'lfs';

/** Progress of one running update, pushed as `project-git-update-progress`. */
export type ProjectGitUpdateProgress = {
    projectPath: string;
    stage: ProjectGitUpdateStage;
    /** Git LFS download percentage; null when the stage has no percentage. */
    percent: number | null;
};

export type ProjectGitUpdateOptions = {
    /**
     * Stashes exactly the local changes that block the fast-forward, then
     * retries it. Nothing is discarded; the stash stays in `git stash list`.
     */
    discardGeneratedChanges?: boolean;
};

/** Local changes the launcher stashed before updating. */
export type ProjectGitUpdateStash = {
    /** Stash reference at creation time, such as `stash@{0}`. */
    ref: string;
    /** Stash commit hash, stable even after later stashes. */
    commit: string;
    message: string;
    paths: string[];
};

/**
 * Outcome of a fast-forward-only update of a project's checked-out branch.
 *
 * - `updated`: the branch fast-forwarded by `commits`; `lfs` reports Git LFS
 *   content, whose failure keeps the update.
 * - `up-to-date`: nothing to apply.
 * - `local-changes`: uncommitted changes would be overwritten; retry with
 *   `discardGeneratedChanges` to stash them first.
 * - `refused`: the branch cannot fast-forward safely.
 * - `fetch-failed`: the upstream could not be fetched.
 * - `failed`: Git rejected the update; any stash is reported so nothing is lost.
 */
export type ProjectGitUpdateResult =
    | {
          status: 'updated';
          commits: number;
          lfs: RemoteProjectGitLfsOutcome;
          stash: ProjectGitUpdateStash | null;
      }
    | { status: 'up-to-date' }
    | {
          status: 'local-changes';
          /** First conflicting paths, at most ten. */
          paths: string[];
          totalPaths: number;
      }
    | {
          status: 'refused';
          reason:
              | 'not-registered'
              | 'not-a-repo'
              | 'detached'
              | 'no-upstream'
              | 'diverged';
      }
    | {
          status: 'fetch-failed';
          kind: 'auth-required' | 'offline' | 'error';
          message: string | null;
      }
    | { status: 'cancelled' }
    | {
          status: 'failed';
          message: string | null;
          stash: ProjectGitUpdateStash | null;
      };
