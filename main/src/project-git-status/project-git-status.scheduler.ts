export const FOCUS_REFRESH_DEBOUNCE_MS = 1_000;
export const MIN_AUTOMATIC_REFRESH_GAP_MS = 2 * 60 * 1_000;

type GitStatusRefreshSchedulerOptions = {
    /** Refreshes every project; failures are the callee's responsibility. */
    refresh: () => Promise<unknown>;
    now?: () => number;
};

/**
 * Decides when automatic project Git status refreshes run.
 *
 * Focus events are debounced and skipped when any refresh started within the
 * minimum gap. The interval timer runs independently of focus. Overlapping
 * requests join the refresh already in progress.
 */
export class GitStatusRefreshScheduler {
    private readonly refresh: () => Promise<unknown>;
    private readonly now: () => number;
    private lastRunAt: number | null = null;
    private running: Promise<void> | null = null;
    private focusTimer: NodeJS.Timeout | undefined;
    private intervalTimer: NodeJS.Timeout | undefined;
    private disposed = false;

    /**
     * Creates an idle scheduler; call `start` to enable automatic runs.
     *
     * @param options - Refresh callback and optional clock.
     */
    constructor(options: GitStatusRefreshSchedulerOptions) {
        this.refresh = options.refresh;
        this.now = options.now ?? Date.now;
    }

    /**
     * Runs an initial refresh and starts the interval timer.
     *
     * @param intervalMinutes - Minutes between refreshes; 0 disables the timer.
     */
    start(intervalMinutes: number): void {
        this.setIntervalMinutes(intervalMinutes);
        void this.runNow();
    }

    /**
     * Replaces the interval timer.
     *
     * @param intervalMinutes - Minutes between refreshes; 0 disables the timer.
     */
    setIntervalMinutes(intervalMinutes: number): void {
        clearInterval(this.intervalTimer);
        this.intervalTimer = undefined;
        if (this.disposed || intervalMinutes <= 0) {
            return;
        }
        this.intervalTimer = setInterval(() => {
            void this.runNow();
        }, intervalMinutes * 60_000);
    }

    /** Schedules a debounced refresh after the main window gains focus. */
    handleFocus(): void {
        if (this.disposed) {
            return;
        }
        clearTimeout(this.focusTimer);
        this.focusTimer = setTimeout(() => {
            this.focusTimer = undefined;
            if (
                this.lastRunAt !== null &&
                this.now() - this.lastRunAt < MIN_AUTOMATIC_REFRESH_GAP_MS
            ) {
                return;
            }
            void this.runNow();
        }, FOCUS_REFRESH_DEBOUNCE_MS);
    }

    /**
     * Starts a refresh immediately, or joins the one in progress.
     *
     * @returns A promise that settles when the refresh finishes.
     */
    runNow(): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        if (this.running) {
            return this.running;
        }
        this.lastRunAt = this.now();
        const run = this.refresh()
            .then(() => undefined)
            .catch(() => undefined)
            .finally(() => {
                if (this.running === run) {
                    this.running = null;
                }
            });
        this.running = run;
        return run;
    }

    /** Stops every timer; later calls do nothing. */
    dispose(): void {
        this.disposed = true;
        clearTimeout(this.focusTimer);
        clearInterval(this.intervalTimer);
        this.focusTimer = undefined;
        this.intervalTimer = undefined;
    }
}
