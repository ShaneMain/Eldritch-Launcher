import { Module } from '@mariodebono/di';
import { AppIntegrationsModule } from '../app-integrations/app-integrations.module.js';
import { ProjectsStoreModule } from '../projects/projects-store.module.js';
import { GitModule } from '../tool-integration/integrations/git/git.module.js';
import { ToolIntegrationModule } from '../tool-integration/tool-integration.module.js';
import { ProjectGitStatusController } from './project-git-status.controller.js';
import { ProjectGitStatusService } from './project-git-status.service.js';
import { ProjectGitStatusAutoRefreshService } from './project-git-status-auto-refresh.service.js';

/** Provides read-only ahead/behind status for registered projects. */
@Module({
    imports: [
        ProjectsStoreModule,
        AppIntegrationsModule,
        GitModule,
        ToolIntegrationModule,
    ],
    providers: [
        ProjectGitStatusService,
        ProjectGitStatusAutoRefreshService,
        ProjectGitStatusController,
    ],
})
export class ProjectGitStatusModule {}
