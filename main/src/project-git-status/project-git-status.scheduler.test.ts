import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FOCUS_REFRESH_DEBOUNCE_MS,
    GitStatusRefreshScheduler,
    MIN_AUTOMATIC_REFRESH_GAP_MS,
} from './project-git-status.scheduler.js';

const MINUTE_MS = 60_000;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** Creates a scheduler whose refresh resolves immediately. */
function createScheduler() {
    const refresh = vi.fn(async () => undefined);
    const scheduler = new GitStatusRefreshScheduler({
        refresh,
        now: () => Date.now(),
    });
    return { scheduler, refresh };
}

describe('GitStatusRefreshScheduler', () => {
    it('runs once on start and then on every interval', async () => {
        const { scheduler, refresh } = createScheduler();

        scheduler.start(10);
        expect(refresh).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10 * MINUTE_MS - 1);
        expect(refresh).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(refresh).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
        expect(refresh).toHaveBeenCalledTimes(3);
        scheduler.dispose();
    });

    it('disables the interval at zero and reschedules on change', async () => {
        const { scheduler, refresh } = createScheduler();

        scheduler.start(0);
        await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
        expect(refresh).toHaveBeenCalledTimes(1);

        scheduler.setIntervalMinutes(5);
        await vi.advanceTimersByTimeAsync(5 * MINUTE_MS);
        expect(refresh).toHaveBeenCalledTimes(2);

        scheduler.setIntervalMinutes(0);
        await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
        expect(refresh).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });

    it('debounces focus bursts into one refresh', async () => {
        const { scheduler, refresh } = createScheduler();

        for (let index = 0; index < 5; index++) {
            scheduler.handleFocus();
            await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DEBOUNCE_MS / 2);
        }
        expect(refresh).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DEBOUNCE_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
        scheduler.dispose();
    });

    it('skips focus refreshes within the minimum gap', async () => {
        const { scheduler, refresh } = createScheduler();
        scheduler.start(0);

        scheduler.handleFocus();
        await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DEBOUNCE_MS);
        expect(refresh).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(
            MIN_AUTOMATIC_REFRESH_GAP_MS - FOCUS_REFRESH_DEBOUNCE_MS,
        );
        scheduler.handleFocus();
        await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DEBOUNCE_MS);
        expect(refresh).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });

    it('joins a refresh already in progress', async () => {
        const gate = Promise.withResolvers<void>();
        const refresh = vi.fn(() => gate.promise);
        const scheduler = new GitStatusRefreshScheduler({ refresh });

        const first = scheduler.runNow();
        const second = scheduler.runNow();
        expect(second).toBe(first);
        expect(refresh).toHaveBeenCalledTimes(1);

        gate.resolve();
        await first;
        await scheduler.runNow();
        expect(refresh).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });

    it('stops every timer when disposed', async () => {
        const { scheduler, refresh } = createScheduler();
        scheduler.start(1);
        scheduler.handleFocus();
        scheduler.dispose();

        await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
