import { describe, expect, it, vi } from 'vitest';
import { onNextFocus } from './github-app-access-button.component';

vi.mock('../../renderer.bridge.ts', () => ({ appBridge: {} }));

describe('onNextFocus', () => {
    it('re-checks once when the window regains focus', () => {
        const target = new EventTarget();
        const callback = vi.fn();

        onNextFocus(target, callback);
        target.dispatchEvent(new Event('focus'));
        target.dispatchEvent(new Event('focus'));

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not re-check after it is disarmed', () => {
        const target = new EventTarget();
        const callback = vi.fn();

        onNextFocus(target, callback)();
        target.dispatchEvent(new Event('focus'));

        expect(callback).not.toHaveBeenCalled();
    });
});
