export type AppIntegrationState =
    | 'not-connected'
    | 'connecting'
    | 'selection-required'
    | 'connected'
    | 'reauthorisation-required'
    | 'secure-storage-unavailable';

export type AppIntegrationConnectionStage =
    | 'authorising'
    | 'choosing'
    | 'installing'
    | null;

export type AppIntegrationActionFailureReason =
    | 'account-mismatch'
    | 'already-connecting'
    | 'cancelled'
    | 'denied'
    | 'device-flow-disabled'
    | 'installation-required'
    | 'invalid-response'
    | 'network-error'
    | 'not-configured'
    | 'provider-unavailable'
    | 'secure-storage-unavailable'
    | 'timed-out'
    | 'unknown';

/** Build or runtime configuration that prevents starting a connection. */
export type AppIntegrationConfigurationIssue =
    | 'client-id-missing'
    | 'app-slug-missing';

/** The one-time code a user confirms on the provider's device page. */
export type AppIntegrationDeviceAuthorization = {
    userCode: string;
    verificationUri: string;
    /** ISO timestamp after which the code can no longer be confirmed. */
    expiresAt: string;
};

export type AppIntegrationConnectionSummary = {
    id: string;
    accountLogin: string;
    accountDisplayName: string | null;
    state:
        | 'connected'
        | 'reauthorisation-required'
        | 'secure-storage-unavailable';
    accessTargets: AppIntegrationAccessTargetSummary[];
};

export type AppIntegrationAccessTargetSummary = {
    id: string;
    login: string;
    type: 'organization' | 'user';
    availability: 'available' | 'unavailable';
    capabilities: Array<'repository-browsing' | 'repository-creation'>;
};

export type AppIntegrationConnectionOption = {
    id: string;
    login: string;
    type: 'organization' | 'user';
};

/**
 * Describes one app integration without exposing provider internals.
 */
export type AppIntegrationSummary = {
    id: string;
    displayName: string;
    state: AppIntegrationState;
    connectionStage: AppIntegrationConnectionStage;
    connections: AppIntegrationConnectionSummary[];
    connectionOptions: AppIntegrationConnectionOption[];
    configurationIssue: AppIntegrationConfigurationIssue | null;
    /** Present while the provider waits for the user to confirm a code. */
    deviceAuthorization: AppIntegrationDeviceAuthorization | null;
};

export type AppIntegrationActionResult =
    | {
          ok: true;
          integration: AppIntegrationSummary;
      }
    | {
          ok: false;
          reason: AppIntegrationActionFailureReason;
          integration: AppIntegrationSummary;
      };

export type AppIntegrationDisconnectOptions = {
    /**
     * Also opens the provider page where the user revokes the authorisation,
     * because device-flow apps cannot revoke grants without a client secret.
     */
    revokeAuthorisation: boolean;
};
