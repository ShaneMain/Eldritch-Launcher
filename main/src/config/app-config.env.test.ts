import { describe, expect, it } from 'vitest';
import { parseProcessEnv } from './app-config.env.js';

describe('parseProcessEnv', () => {
    it('parses boolean env values', () => {
        expect(
            parseProcessEnv({
                GODOT_LAUNCHER_DISABLE_SANDBOX: '1',
                GODOT_LAUNCHER_NO_DEV_MENU: 'true',
                GODOT_LAUNCHER_E2E_FIXTURES: '0',
            }).GODOT_LAUNCHER_DISABLE_SANDBOX,
        ).toBe(true);
        expect(
            parseProcessEnv({ GODOT_LAUNCHER_E2E_FIXTURES: '1' })
                .GODOT_LAUNCHER_E2E_FIXTURES,
        ).toBe(true);
        expect(
            parseProcessEnv({
                GODOT_LAUNCHER_DISABLE_SANDBOX: 'false',
            }).GODOT_LAUNCHER_DISABLE_SANDBOX,
        ).toBe(false);
    });

    it('parses GitHub App overrides and drops blank or malformed values', () => {
        expect(
            parseProcessEnv({
                ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID: 'Iv1.0123456789abcdef',
                ELDRITCH_LAUNCHER_GITHUB_APP_SLUG: 'eldritch-launcher',
            }),
        ).toMatchObject({
            ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID: 'Iv1.0123456789abcdef',
            ELDRITCH_LAUNCHER_GITHUB_APP_SLUG: 'eldritch-launcher',
        });
        const ignored = parseProcessEnv({
            ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID: '   ',
            ELDRITCH_LAUNCHER_GITHUB_APP_SLUG: '-bad-',
        });
        expect(ignored.ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID).toBeUndefined();
        expect(ignored.ELDRITCH_LAUNCHER_GITHUB_APP_SLUG).toBeUndefined();
    });

    it('ignores invalid boolean env values', () => {
        expect(
            parseProcessEnv({
                GODOT_LAUNCHER_DISABLE_SANDBOX: 'maybe',
            }).GODOT_LAUNCHER_DISABLE_SANDBOX,
        ).toBeUndefined();
    });
});
