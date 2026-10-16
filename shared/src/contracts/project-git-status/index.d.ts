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
};
