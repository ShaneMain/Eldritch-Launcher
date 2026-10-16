import type { OnModuleDestroy } from '@mariodebono/di';
import { Injectable } from '@mariodebono/di';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ConfigService } from '@mariodebono/di-config';
import {
    AppReady,
    AppReadyOrder,
    OnMainWindowFocus,
} from '@mariodebono/di-electron';
import type { ProjectGitStatus } from '@shared/contracts';
import {
    getUserPreferences,
    setUserPreferences,
} from '../commands/userPreferences.js';
import type { AppConfig } from '../config/index.js';
import { normaliseProjectGitStatusRefreshMinutes } from '../utils/prefs.utils.js';
import { GitStatusRefreshScheduler } from './project-git-status.scheduler.js';
// biome-ignore lint/style/useImportType: Required for DI constructor metadata
import { ProjectGitStatusService } from './project-git-status.service.js';

/** Runs project Git status refreshes on startup, focus and an interval. */
@Injectable()
export class ProjectGitStatusAutoRefreshService implements OnModuleDestroy {
    private readonly scheduler: GitStatusRefreshScheduler;
    private started = false;

    /**
     * Creates the automatic refresh coordinator.
     *
     * @param statuses - Project Git status service.
     * @param configService - Runtime application configuration.
     */
    constructor(
        private readonly statuses: ProjectGitStatusService,
        private readonly configService: ConfigService<AppConfig>,
    ) {
        this.scheduler = new GitStatusRefreshScheduler({
            refresh: () => this.statuses.refreshAll(),
        });
    }

    /** Starts automatic refreshes once the main window exists. */
    @AppReady({ order: AppReadyOrder.AfterWindow })
    async start(): Promise<void> {
        if (this.configService.getAll().e2eFixtures) {
            return;
        }
        const prefs = await getUserPreferences();
        this.started = true;
        this.scheduler.start(
            normaliseProjectGitStatusRefreshMinutes(
                prefs.project_git_status_refresh_minutes,
            ),
        );
    }

    /** Schedules a debounced refresh when the main window gains focus. */
    @OnMainWindowFocus()
    handleFocus(): void {
        if (this.started) {
            this.scheduler.handleFocus();
        }
    }

    /**
     * Refreshes every project now, joining a refresh already in progress.
     *
     * @returns Every cached status after the refresh.
     */
    async refreshAll(): Promise<ProjectGitStatus[]> {
        await this.scheduler.runNow();
        return this.statuses.getStatuses();
    }

    /**
     * Saves and applies the automatic refresh interval.
     *
     * @param minutes - Requested minutes; 0 disables automatic refreshes.
     * @returns The normalised saved interval.
     */
    async setRefreshInterval(minutes: number): Promise<number> {
        const normalized = normaliseProjectGitStatusRefreshMinutes(minutes);
        const prefs = await getUserPreferences();
        await setUserPreferences({
            ...prefs,
            project_git_status_refresh_minutes: normalized,
        });
        if (this.started) {
            this.scheduler.setIntervalMinutes(normalized);
        }
        return normalized;
    }

    /** Stops every automatic refresh timer. */
    onModuleDestroy(): void {
        this.scheduler.dispose();
    }
}
