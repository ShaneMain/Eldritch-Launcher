import { z } from 'zod';

const BooleanFromEnvSchema = z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'true' || normalizedValue === '1') {
        return true;
    }
    if (normalizedValue === 'false' || normalizedValue === '0') {
        return false;
    }

    return value;
}, z.boolean().optional().catch(undefined));

/** Ignores blank or malformed values so the build-time default applies. */
const GitHubAppValueFromEnvSchema = (pattern: RegExp) =>
    z.preprocess(
        (value) => (typeof value === 'string' ? value.trim() : value),
        z.string().regex(pattern).optional().catch(undefined),
    );

export const AppEnvConfigSchema = z.object({
    GODOT_LAUNCHER_DISABLE_SANDBOX: BooleanFromEnvSchema,
    GODOT_LAUNCHER_NO_DEV_MENU: BooleanFromEnvSchema,
    GODOT_LAUNCHER_E2E_FIXTURES: BooleanFromEnvSchema,
    GODOT_LAUNCHER_E2E_HOME_DIR: z.string().optional(),
    ELDRITCH_LAUNCHER_GITHUB_CLIENT_ID: GitHubAppValueFromEnvSchema(
        /^[A-Za-z0-9._-]{1,128}$/u,
    ),
    ELDRITCH_LAUNCHER_GITHUB_APP_SLUG: GitHubAppValueFromEnvSchema(
        /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u,
    ),
});

export type AppEnvConfig = z.infer<typeof AppEnvConfigSchema>;

export function parseProcessEnv(
    env: NodeJS.ProcessEnv = process.env,
): AppEnvConfig {
    return AppEnvConfigSchema.parse(env);
}
