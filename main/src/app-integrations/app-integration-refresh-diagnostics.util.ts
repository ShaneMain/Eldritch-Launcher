import logger from 'electron-log/main.js';
import type { AppIntegrationRefreshContext } from './app-integration.types.js';

export type AppIntegrationRefreshDiagnosticPhase =
    | 'credential-read'
    | 'credential-decrypt'
    | 'credential-parse'
    | 'credential-classified'
    | 'token-rotation'
    | 'provider-validation'
    | 'credential-persist'
    | 'metadata-update';

export type AppIntegrationRefreshDiagnosticCode =
    | 'client-id-missing'
    | 'credential-invalid'
    | 'credential-missing'
    | 'github-forbidden'
    | 'github-unauthorised'
    | 'identity-mismatch'
    | 'network-error'
    | 'refresh-token-expired'
    | 'refresh-token-missing'
    | 'refresh-token-rejected'
    | 'secure-storage-error'
    | 'timed-out'
    | 'token-endpoint-invalid-response'
    | 'token-endpoint-unavailable'
    | 'unknown';

export type AppIntegrationRefreshDiagnostic = AppIntegrationRefreshContext & {
    providerId: string;
    phase: AppIntegrationRefreshDiagnosticPhase;
    outcome: 'started' | 'succeeded' | 'temporary-failure' | 'terminal-failure';
    accessTokenState?: 'current' | 'expired' | 'near-expiry' | 'non-expiring';
    refreshTokenState?: 'missing' | 'present' | 'recorded-expired' | 'unknown';
    code?: AppIntegrationRefreshDiagnosticCode;
    status?: number | null;
};

/** Writes one allowlisted credential-refresh diagnostic without secret values. */
export function logAppIntegrationRefreshDiagnostic(
    diagnostic: AppIntegrationRefreshDiagnostic,
): void {
    logger.debug('App integration credential refresh', {
        processId: process.pid,
        ...diagnostic,
    });
}
