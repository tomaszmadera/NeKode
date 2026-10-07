// Stable test ids shared by the shell, navigation and chat workspace.
// Kept out of App.tsx so components never import from App (no import cycle).

export const TEST_ID = {
  appShell: 'app-shell',
  /** Window title bar strip (drag surface); absent in the floating theme. */
  titleBar: 'title-bar',
  leftNav: 'region-left',
  tabStrip: 'tab-strip',
  tabTerminal: 'tab-terminal',
  /** Non-closable Kanban project-view tab (spec kanban-adapter-interface). */
  kanbanTab: 'tab-kanban',
  tabNewChat: 'tab-new-chat',
  /** Context menu of a file tab (right click / ContextMenu key / Shift+F10). */
  tabContextMenu: 'tab-context-menu',
  tabContextCopyRelative: 'tab-context-copy-relative',
  tabContextCopyAbsolute: 'tab-context-copy-absolute',
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
  bottomNewTerminal: 'bottom-new-terminal',
  bottomEmpty: 'bottom-empty',
  bottomTerminalError: 'bottom-terminal-error',
  bottomTerminalRetry: 'bottom-terminal-retry',
  leftResizeHandle: 'resize-handle-left',
  bottomResizeHandle: 'resize-handle-bottom',
  projectList: 'project-list',
  projectsHeader: 'projects-header',
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
  /** Welcome illustration surface: contextual add-project primary action. */
  welcomeAddProjectButton: 'welcome-add-project-button',
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
  /** Action-row switch for a markdown file tab (user decision 2026-10-06). */
  fileMarkdownCode: 'file-markdown-code',
  fileMarkdownPreview: 'file-markdown-preview',
  /** Rendered Markdown surface inside a file tab. */
  fileMarkdownRender: 'file-markdown-render',
  /** Right-click menu of the read-only file preview (Copy / Select All). */
  editorContextMenu: 'editor-context-menu',
  editorContextCopy: 'editor-context-copy',
  editorContextSelectAll: 'editor-context-select-all',
  /** Chat row attention badge (chat attention badge spec Behaviour 5). */
  chatAttentionBadge: 'chat-attention-badge',
  /** Modal confirmation dialog for destructive actions (e.g. close chat). */
  confirmDialog: 'confirm-dialog',
  confirmDialogCancel: 'confirm-dialog-cancel',
  confirmDialogConfirm: 'confirm-dialog-confirm',
  terminalPromptInput: 'terminal-prompt-input',
  terminalPromptSend: 'terminal-prompt-send',
  terminalPromptDictation: 'terminal-prompt-dictation',
  handoffPicker: 'handoff-picker',
  handoffPickerLoading: 'handoff-picker-loading',
  handoffPickerUnconfigured: 'handoff-picker-unconfigured',
  handoffPickerConfigure: 'handoff-picker-configure',
  handoffPickerPlainPaste: 'handoff-picker-plain-paste',
  handoffPickerError: 'handoff-picker-error',
  handoffPickerEmpty: 'handoff-picker-empty',
  handoffPickerList: 'handoff-picker-list',
  handoffPickerEntry: 'handoff-picker-entry',
  /** Left-panel footer: the App Settings opener (bottom of the panel). */
  appSettingsButton: 'app-settings-button',
  settingsConfigSection: 'settings-config-section',
  settingsAutoSend: 'settings-auto-send',
  /** App Settings: Ctrl+Tab chat switching on/off (NEKODE-2). */
  settingsChatSwitch: 'settings-chat-switch',
  /** App Settings: attention alert toggles (attention-alert-settings spec). */
  settingsAttentionBadge: 'settings-attention-badge',
  settingsAttentionActiveIndicator: 'settings-attention-active-indicator',
  settingsAttentionChime: 'settings-attention-chime',
  settingsAttentionActiveChime: 'settings-attention-active-chime',
  /** App Settings: General tab button. */
  settingsGeneralTab: 'settings-general-tab',
  /** App Settings: Shortcuts tab button. */
  settingsShortcutsTab: 'settings-shortcuts-tab',
  /** App Settings: shortcut table on the Shortcuts tab. */
  settingsShortcutsTable: 'settings-shortcuts-table',
  settingsHandoffDir: 'settings-handoff-dir',
  settingsHandoffDirBrowse: 'settings-handoff-dir-browse',
  settingsHandoffDirSave: 'settings-handoff-dir-save',
  settingsHandoffDirSaved: 'settings-handoff-dir-saved',
  /** Project Settings: Shell tab (spec project-shell-selection). */
  settingsShellTab: 'settings-shell-tab',
  /** Project Settings: Actions & Configuration tab. */
  settingsActionsTab: 'settings-actions-tab',
  /** Project Settings: Kanban tab button + panel (spec kanban-adapter-interface). */
  settingsKanbanTab: 'settings-kanban-tab',
  settingsKanbanPanel: 'settings-kanban-panel',
  settingsKanbanLoading: 'settings-kanban-loading',
  settingsKanbanEmpty: 'settings-kanban-empty',
  settingsKanbanAdapterSelect: 'settings-kanban-adapter-select',
  settingsKanbanAdapterMissing: 'settings-kanban-adapter-missing',
  settingsKanbanSave: 'settings-kanban-save',
  settingsKanbanSaved: 'settings-kanban-saved',
  settingsKanbanTest: 'settings-kanban-test',
  /** Inline container carrying the test-in-progress/success/failure text. */
  settingsKanbanTestResult: 'settings-kanban-test-result',
  /**
   * Inline hint shown while Test connection is disabled because the displayed
   * adapter is not yet the persisted binding (spec Behaviour 8).
   */
  settingsKanbanTestHint: 'settings-kanban-test-hint',
  /** Active adapters directory display + Browse override. */
  settingsKanbanDir: 'settings-kanban-dir',
  settingsKanbanDirBrowse: 'settings-kanban-dir-browse',
  /** Read-only Kanban board surface (spec kanban-adapter-interface Behaviour 14). */
  kanbanBoard: 'kanban-board',
  kanbanBoardLoading: 'kanban-board-loading',
  kanbanBoardError: 'kanban-board-error',
  kanbanBoardEmpty: 'kanban-board-empty',
  kanbanBoardUnconfigured: 'kanban-board-unconfigured',
  kanbanBoardConfigure: 'kanban-board-configure',
  kanbanBoardRefresh: 'kanban-board-refresh',
  /** List | Board switch on the Kanban tab (list is the default). */
  kanbanViewBoard: 'kanban-view-board',
  kanbanViewList: 'kanban-view-list',
  /** Grouped list of the same items the board shows as columns. */
  kanbanList: 'kanban-list',
  /** Sort select and direction toggle for Kanban list. */
  kanbanSortBy: 'kanban-sort-by',
  kanbanSortDirection: 'kanban-sort-direction',
  /** Read-only review of one work item, opened from the board or the list. */
  kanbanReview: 'kanban-review',
  kanbanReviewBack: 'kanban-review-back',
  kanbanReviewTitle: 'kanban-review-title',
  kanbanReviewDescription: 'kanban-review-description',
  /** Shell tab: detecting indicator, per-project select, custom path add. */
  settingsShellDetecting: 'settings-shell-detecting',
  settingsShellSelect: 'settings-shell-select',
  settingsShellSave: 'settings-shell-save',
  settingsShellSaved: 'settings-shell-saved',
  settingsShellCustomInput: 'settings-shell-custom-input',
  settingsShellCustomAdd: 'settings-shell-custom-add',
  /** Action form icon picker: preset select and the custom-emoji input. */
  settingsActionIconSelect: 'settings-action-icon-select',
  settingsActionIconEmoji: 'settings-action-icon-emoji',
  /** App Settings: terminal font size select. */
  settingsTerminalFontSize: 'settings-terminal-font-size',
  terminalContextMenu: 'terminal-context-menu',
  terminalContextCopy: 'terminal-context-copy',
  terminalContextPaste: 'terminal-context-paste',
  terminalContextPasteThroughProgram: 'terminal-context-paste-through-program',
  terminalContextSelectAll: 'terminal-context-select-all',
} as const

/** Test ids that depend on record ids (projects/chats/sessions/paths). */
export const testIdFor = {
  projectRow: (projectId: string): string => `project-row-${projectId}`,
  projectSelect: (projectId: string): string => `project-select-${projectId}`,
  projectToggle: (projectId: string): string => `project-toggle-${projectId}`,
  projectChats: (projectId: string): string => `project-chats-${projectId}`,
  /** Left-navigation Kanban tile of a bound project (first expanded element). */
  projectKanban: (projectId: string): string => `project-kanban-${projectId}`,
  projectFiles: (projectId: string): string => `project-files-${projectId}`,
  removeProject: (projectId: string): string => `remove-project-${projectId}`,
  chatRow: (chatId: string): string => `chat-row-${chatId}`,
  /** Hover close control on a chat row (opens the close-chat confirmation). */
  chatClose: (chatId: string): string => `chat-close-${chatId}`,
  /** Attention badge dot on a chat row (chat attention badge spec). */
  chatAttentionBadge: (chatId: string): string => `chat-attention-badge-${chatId}`,
  terminalView: (chatId: string): string => `terminal-view-${chatId}`,
  bottomTab: (tabId: string): string => `bottom-tab-${tabId}`,
  bottomTabClose: (tabId: string): string => `bottom-tab-close-${tabId}`,
  bottomTerminal: (tabId: string): string => `bottom-terminal-${tabId}`,
  /** File tree entry row (entry ids carry their '/'-separated relative path). */
  fileEntry: (relativePath: string): string => `file-entry-${relativePath}`,
  /** File tab of the tab strip (ids carry the '/'-separated relative path). */
  tabFile: (relativePath: string): string => `tab-file-${relativePath}`,
  /** Close control of a file tab. */
  tabFileClose: (relativePath: string): string => `tab-close-${relativePath}`,
  /** Main-surface pane of one open file tab (hidden view when inactive). */
  filePreviewPane: (relativePath: string): string => `file-preview-pane-${relativePath}`,
  /** Kanban settings config field widget, keyed by the manifest field key. */
  kanbanField: (key: string): string => `settings-kanban-field-${key}`,
  /** "stored" indicator beside a secret field that holds a value in main. */
  kanbanSecretStored: (key: string): string => `settings-kanban-secret-stored-${key}`,
  /** One Kanban board column, keyed by the adapter state id. */
  kanbanColumn: (stateId: string): string => `kanban-column-${stateId}`,
  /** One work item on the board or the list, keyed by its ref (Plane slug). */
  kanbanItem: (ref: string): string => `kanban-item-${ref}`,
  /** One state group in the list view, keyed by the adapter state id. */
  kanbanListGroup: (stateId: string): string => `kanban-list-group-${stateId}`,
  /** Toggle button for collapsing or expanding a state group in the list view. */
  kanbanGroupToggle: (stateId: string): string => `kanban-group-toggle-${stateId}`,
}
