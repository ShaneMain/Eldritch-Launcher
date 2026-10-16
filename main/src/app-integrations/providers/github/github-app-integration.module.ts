import { Module } from '@mariodebono/di';
import { AppIntegrationsModule } from '../../app-integrations.module.js';
import { GitHubApiClient } from './github-api.client.js';
import { GitHubAppIntegrationProvider } from './github-app-integration.provider.js';
import { GitHubDeviceFlowClient } from './github-device-flow.client.js';
import { GitHubRepositoryBrowsingCapability } from './github-repository-browsing.capability.js';
import { GitHubRepositoryCreationCapability } from './github-repository-creation.capability.js';

/** Registers the GitHub app integration provider. */
@Module({
    imports: [AppIntegrationsModule],
    providers: [
        GitHubApiClient,
        GitHubDeviceFlowClient,
        GitHubAppIntegrationProvider,
        GitHubRepositoryBrowsingCapability,
        GitHubRepositoryCreationCapability,
    ],
})
export class GitHubAppIntegrationModule {}
