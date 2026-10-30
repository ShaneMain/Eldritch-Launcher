import {
    BridgeController,
    createIpcHandleTyped,
} from '@mariodebono/di-electron';
import type {
    ProjectGitStatus,
    ProjectGitStatusBridge,
    ProjectGitUpdateOptions,
    ProjectGitUpdateResult,
} from '@shared/contracts';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectGitStatusService } from './project-git-status.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectGitStatusAutoRefreshService } from './project-git-status-auto-refresh.service.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectGitUpdateService } from './project-git-update.service.js';

const ProjectGitStatusHandler = createIpcHandleTyped<ProjectGitStatusBridge>();

/** Handles project Git upstream status requests from the renderer. */
@BridgeController({ namespace: 'projectGitStatus' })
export class ProjectGitStatusController implements ProjectGitStatusBridge {
    /**
     * Creates the project Git status controller.
     *
     * @param statuses - Project Git status service.
     * @param autoRefresh - Automatic refresh coordinator.
     * @param updates - Fast-forward update service.
     */
    constructor(
        private readonly statuses: ProjectGitStatusService,
        private readonly autoRefresh: ProjectGitStatusAutoRefreshService,
        private readonly updates: ProjectGitUpdateService,
    ) {}

    /** Returns cached statuses without running Git. */
    @ProjectGitStatusHandler('getStatuses')
    async getStatuses(): Promise<ProjectGitStatus[]> {
        return this.statuses.getStatuses();
    }

    /**
     * Refreshes one registered project.
     *
     * @param projectPath - Exact registered project path.
     */
    @ProjectGitStatusHandler('refreshProject')
    refreshProject(projectPath: string): Promise<ProjectGitStatus | null> {
        return this.statuses.refreshProject(projectPath);
    }

    /** Refreshes every registered project. */
    @ProjectGitStatusHandler('refreshAll')
    refreshAll(): Promise<ProjectGitStatus[]> {
        return this.autoRefresh.refreshAll();
    }

    /**
     * Saves the automatic refresh interval.
     *
     * @param minutes - Minutes between refreshes; 0 disables them.
     */
    @ProjectGitStatusHandler('setRefreshInterval')
    setRefreshInterval(minutes: number): Promise<number> {
        return this.autoRefresh.setRefreshInterval(minutes);
    }

    /**
     * Fast-forwards one registered project to its upstream.
     *
     * @param projectPath - Exact registered project path.
     * @param options - Optional stash-and-retry for blocking local changes.
     */
    @ProjectGitStatusHandler('updateProject')
    updateProject(
        projectPath: string,
        options?: ProjectGitUpdateOptions,
    ): Promise<ProjectGitUpdateResult> {
        return this.updates.updateProject(projectPath, options);
    }

    /**
     * Cancels a running update.
     *
     * @param projectPath - Project path being updated.
     */
    @ProjectGitStatusHandler('cancelUpdate')
    async cancelUpdate(projectPath: string): Promise<boolean> {
        return this.updates.cancelUpdate(projectPath);
    }
}
