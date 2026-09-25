// Stable test ids shared by the shell, navigation and chat workspace.
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
  newChatButton: 'new-chat-button',
  headerProjectName: 'header-project-name',
  headerProjectPath: 'header-project-path',
  headerRuntimeLabel: 'header-runtime-label',
  headerGitBranch: 'header-git-branch',
  headerGitStatus: 'header-git-status',
  headerGitNone: 'header-git-none',
  chatWorkspace: 'chat-workspace',
  chatWorkspaceTitle: 'chat-workspace-title',
  terminalHost: 'terminal-host',
  terminalView: 'terminal-view',
  terminalSpawnError: 'terminal-spawn-error',
  terminalRetry: 'terminal-retry',
  startNewChatState: 'start-new-chat-state',
  startNewChatButton: 'start-new-chat-button',
} as const

/** Test ids that depend on record ids (projects/chats/sessions). */
export const testIdFor = {
  projectRow: (projectId: string): string => `project-row-${projectId}`,
  projectSelect: (projectId: string): string => `project-select-${projectId}`,
  projectToggle: (projectId: string): string => `project-toggle-${projectId}`,
  projectChats: (projectId: string): string => `project-chats-${projectId}`,
  removeProject: (projectId: string): string => `remove-project-${projectId}`,
  chatRow: (chatId: string): string => `chat-row-${chatId}`,
  terminalView: (chatId: string): string => `terminal-view-${chatId}`,
}
