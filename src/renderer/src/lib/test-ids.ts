// Stable test ids shared by the shell, navigation and task workspace.
// Kept out of App.tsx so components never import from App (no import cycle).

export const TEST_ID = {
  appShell: 'app-shell',
  topBar: 'region-top',
  leftNav: 'region-left',
  centerHeader: 'region-center-header',
  centerSurface: 'region-center-surface',
  rightRegion: 'region-right',
  bottomRegion: 'region-bottom',
  leftResizeHandle: 'resize-handle-left',
  bottomResizeHandle: 'resize-handle-bottom',
  projectList: 'project-list',
  emptyProjectList: 'project-list-empty',
  addProjectButton: 'add-project-button',
  welcomeSurface: 'welcome-surface',
  actionNotice: 'action-notice',
  newTaskForm: 'new-task-form',
  newTaskInput: 'new-task-input',
  newTaskSubmit: 'new-task-submit',
  headerProjectName: 'header-project-name',
  headerProjectPath: 'header-project-path',
  headerRuntimeLabel: 'header-runtime-label',
  headerGitBranch: 'header-git-branch',
  headerGitStatus: 'header-git-status',
  headerGitNone: 'header-git-none',
  taskWorkspace: 'task-workspace',
  taskWorkspaceTitle: 'task-workspace-title',
  terminalHost: 'terminal-host',
  terminalView: 'terminal-view',
  terminalSessionEnded: 'terminal-session-ended',
  terminalSpawnError: 'terminal-spawn-error',
  terminalStartNewSession: 'terminal-start-new-session',
  terminalRetry: 'terminal-retry',
} as const

/** Test ids that depend on record ids (projects/tasks/sessions). */
export const testIdFor = {
  projectRow: (projectId: string): string => `project-row-${projectId}`,
  projectSelect: (projectId: string): string => `project-select-${projectId}`,
  projectToggle: (projectId: string): string => `project-toggle-${projectId}`,
  projectTasks: (projectId: string): string => `project-tasks-${projectId}`,
  removeProject: (projectId: string): string => `remove-project-${projectId}`,
  taskRow: (taskId: string): string => `task-row-${taskId}`,
  terminalView: (taskId: string): string => `terminal-view-${taskId}`,
}
