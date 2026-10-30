import type { AppIntegrationSummary } from '../app-integrations/index.js';
import type { CodeEditorIntegrationSettings } from '../codeEditorIntegration/index.js';
import type {
    ProjectGitStatus,
    ProjectGitUpdateProgress,
} from '../project-git-status/index.js';
import type { ProjectTagsSnapshot } from '../project-tags/index.js';
import type {
    LaunchProjectResult,
    ProjectDetails,
    RemoteProjectImportProgress,
} from '../projects/index.js';
import type {
    InstalledRelease,
    ReleaseInstallProgress,
} from '../releases/index.js';

export type AppEventMap = {
    'projects-updated': ProjectDetails[];
    'project-tags-updated': ProjectTagsSnapshot;
    'project-git-status-updated': ProjectGitStatus;
    'project-git-update-progress': ProjectGitUpdateProgress;
    'remote-project-import-progress': RemoteProjectImportProgress;
    'code-editor-integrations-updated': CodeEditorIntegrationSettings[];
    'project-launch-code-editor-warning': {
        project: ProjectDetails;
        result: Extract<
            LaunchProjectResult,
            { reason: 'code_editor_unavailable' }
        >;
    };
    'releases-updated': InstalledRelease[];
    'release-install-progress': ReleaseInstallProgress;
    'app-integration-updated': AppIntegrationSummary;
};
