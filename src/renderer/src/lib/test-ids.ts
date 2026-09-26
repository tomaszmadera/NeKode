// Stable test ids shared by the shell, navigation and chat workspace.
// Kept out of App.tsx so components never import from App (no import cycle).

export const TEST_ID = {
  appShell: 'app-shell',
  leftNav: 'region-left',
  tabStrip: 'tab-strip',
  tabTerminal: 'tab-terminal',
  tabNewChat: 'tab-new-chat',
  actionRowSlot: 'action-row-slot',
  statusBar: 'status-bar',
  statusProjectName: 'status-project-name',
  statusProjectPath: 'status-project-path',
  statusRuntimes: 'status-runtimes',
  statusRuntimeMore: 'status-runtime-more',
  statusGitBranch: 'status-git-branch',
  statusGitStatus: 'status-git-status',
  statusGitNone: 'status-git-none',
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
  chatWorkspace: 'chat-workspace',
  chatSurfaceHost: 'chat-surface-host',
  terminalHost: 'terminal-host',
  terminalView: 'terminal-view',
  terminalSpawnError: 'terminal-spawn-error',
  terminalRetry: 'terminal-retry',
  startNewChatState: 'start-new-chat-state',
  startNewChatButton: 'start-new-chat-button',
  projectContextMenu: 'project-context-menu',
  projectFilesPanel: 'project-files-panel',
  filesBackButton: 'files-back-button',
  filesProjectName: 'files-project-name',
  fileTree: 'file-tree',
  fileTreeError: 'file-tree-error',
  filePreviewError: 'file-preview-error',
  filePreviewTooLarge: 'file-preview-too-large',
  filePreviewBinary: 'file-preview-binary',
  filePreviewOpenExternal: 'file-preview-open-external',
  filePreviewMonaco: 'file-preview-monaco',
} as const

/** Test ids that depend on record ids (projects/chats/sessions/paths). */
export const testIdFor = {
  projectRow: (projectId: string): string => `project-row-${projectId}`,
  projectSelect: (projectId: string): string => `project-select-${projectId}`,
  projectToggle: (projectId: string): string => `project-toggle-${projectId}`,
  projectChats: (projectId: string): string => `project-chats-${projectId}`,
  projectFiles: (projectId: string): string => `project-files-${projectId}`,
  removeProject: (projectId: string): string => `remove-project-${projectId}`,
  chatRow: (chatId: string): string => `chat-row-${chatId}`,
  terminalView: (chatId: string): string => `terminal-view-${chatId}`,
  /** File tree entry row (entry ids carry their '/'-separated relative path). */
  fileEntry: (relativePath: string): string => `file-entry-${relativePath}`,
  /** File tab of the tab strip (ids carry the '/'-separated relative path). */
  tabFile: (relativePath: string): string => `tab-file-${relativePath}`,
  /** Close control of a file tab. */
  tabFileClose: (relativePath: string): string => `tab-close-${relativePath}`,
  /** Main-surface pane of one open file tab (hidden view when inactive). */
  filePreviewPane: (relativePath: string): string => `file-preview-pane-${relativePath}`,
}
