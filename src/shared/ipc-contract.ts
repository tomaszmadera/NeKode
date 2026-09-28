// Typed IPC contract shared by main, preload and renderer (SDD §6, §44).
// Every channel is served by a real service in main: projects/chats/state by
// the SQLite persistence services, terminals by real PTY sessions
// (TerminalService) and git:status by the git service.

export interface ProjectInfo {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}

// A chat is a terminal session listed under a project (spec Data/API). The
// work-item "task" entity is post-MVP and deliberately has no representation
// in this slice: no status column, no progress fields.
export interface ChatInfo {
  id: string
  projectId: string
  name: string
}

export interface ActionInput {
  scope: 'global' | 'project'
  projectId: string | null
  title: string
  icon: string | null
  command: string
  cwd: string | null
  runMode: 'background' | 'new-terminal' | 'bottom-terminal'
  confirm: boolean
  sortOrder: number
}

export interface ActionControl extends ActionInput {
  id: string
}

export interface ActionExecution {
  status: 'idle' | 'running' | 'success' | 'failed'
  exitCode: number | null
  completedAt: string | null
  error: string | null
  chat?: ChatInfo
  /**
   * New-terminal delivery waits until its terminal view is subscribed and ready.
   */
  terminalCommand?: string
  terminalCwd?: string
  /**
   * Bottom-terminal delivery addresses the new bottom tab (never a chat): the
   * renderer opens the panel, adds the tab, and writes terminalCommand plus CR
   * once that tab's terminal is subscribed. Success means delivery, so the
   * exit code is null and the shell command's later exit is not tracked.
   */
  bottomTabId?: string
}

// Worktree/change counts behind the UX-UI §16 status forms and hover details.
export interface GitWorktreeStatus {
  modified: number
  added: number
  deleted: number
  untracked: number
  conflicts: number
  ahead: number
  behind: number
}

export function emptyGitWorktree(): GitWorktreeStatus {
  return { modified: 0, added: 0, deleted: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 }
}

export interface GitStatus {
  branch: string | null
  dirty: boolean
  worktree: GitWorktreeStatus
}

export type Unsubscribe = () => void

// One entry of a project file-tree listing (spec Data/API): one directory
// level, already filtered in main (default directory exclusions).
export interface FileEntry {
  name: string
  /** Path relative to the project root, '/'-separated ('' is never used: the root itself has no entry). */
  relativePath: string
  kind: 'file' | 'directory'
}

// Read-only file preview classification (spec Data/API / Behaviour 10):
// text at or below the preview threshold, too-large above it, binary when
// the content is not decodable as UTF-8 (or sniffs binary).
export type FilePreview =
  | { kind: 'text'; content: string; language: string | null }
  | { kind: 'too-large'; size: number }
  | { kind: 'binary' }

// Channel names mirror the spec Data/API bridge. terminals:terminate accepts
// only a bottom tab id (tab close). Chat teardown and application quit stay
// in the main process: chats:remove, projects:remove, and
// TerminalService.terminateAll on app quit. Quit never goes through the renderer.
export const IPC_CHANNEL = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  chatsList: 'chats:list',
  chatsCreate: 'chats:create',
  chatsRemove: 'chats:remove',
  stateGet: 'state:get',
  stateSet: 'state:set',
  terminalsCreate: 'terminals:create',
  terminalsWrite: 'terminals:write',
  terminalsResize: 'terminals:resize',
  terminalsTerminate: 'terminals:terminate',
  terminalsShellName: 'terminals:shellName',
  terminalsData: 'terminals:data',
  terminalsExit: 'terminals:exit',
  gitStatus: 'git:status',
  filesList: 'files:list',
  filesRead: 'files:read',
  filesOpenExternal: 'files:openExternal',
  actionsList: 'actions:list',
  actionsCreate: 'actions:create',
  actionsUpdate: 'actions:update',
  actionsDelete: 'actions:delete',
  actionsExecute: 'actions:execute',
  actionsStatus: 'actions:status',
} as const

// Keys of the flat app_state key–value store (spec Data/API). Shared so the
// renderer persists with the same keys the main process cleans up.
export const APP_STATE_KEY = {
  selectedProjectId: 'selection.projectId',
  selectedChatId: 'selection.chatId',
  leftRegionWidth: 'region.left.width',
  bottomRegionHeight: 'region.bottom.height',
  /** '1' open, '0' hidden. Missing or any other value means hidden. */
  bottomRegionOpen: 'region.bottom.open',
} as const

export interface AppApi {
  projects: {
    list(): Promise<ProjectInfo[]>
    /** Opens the native directory dialog in main. Resolves null when the user cancels. */
    add(): Promise<ProjectInfo | null>
    remove(projectId: string): Promise<void>
  }
  chats: {
    list(projectId: string): Promise<ChatInfo[]>
    /**
     * Creates a chat with no naming form (spec Behaviour 3): the name is
     * derived from the platform shell (e.g. "PowerShell" on win32) and may
     * repeat within a project. Returns the created chat (selected by the
     * renderer).
     */
    create(projectId: string): Promise<ChatInfo>
    /**
     * Removes a chat from the tree and the database (the terminal-exit close
     * flow, spec Behaviour 11). Main also drops the chat's terminal session.
     * Application quit never goes through this path.
     */
    remove(chatId: string): Promise<void>
  }
  state: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  terminals: {
    create(chatId: string, cwd: string): Promise<string>
    write(chatId: string, data: string): Promise<void>
    resize(chatId: string, cols: number, rows: number): Promise<void>
    /**
     * Platform shell display label (for example "PowerShell"). Bottom tabs
     * take their label from this. It does not create a chat.
     */
    shellName(): Promise<string>
    /**
     * Terminates one bottom-tab PTY. Rejects any other id. Chat sessions and
     * application quit do not use this method.
     */
    terminate(bottomTabId: string): Promise<void>
    onData(chatId: string, callback: (data: string) => void): Unsubscribe
    onExit(chatId: string, callback: (exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
  }
  files: {
    /**
     * One directory level of the project tree (null = project root). The
     * listing is filtered in main (default directory exclusions) and never
     * resolves outside the registered project root.
     */
    list(projectId: string, relativePath: string | null): Promise<FileEntry[]>
    /** Read-only preview classification of one project file. */
    read(projectId: string, relativePath: string): Promise<FilePreview>
    /** Opens the file with the OS default application (main: shell.openPath). */
    openExternal(projectId: string, relativePath: string): Promise<void>
  }
  actions: {
    list(): Promise<ActionControl[]>
    create(input: ActionInput): Promise<ActionControl>
    update(id: string, input: ActionInput): Promise<ActionControl>
    delete(id: string): Promise<void>
    execute(id: string, projectId: string | null, confirmed: boolean): Promise<ActionExecution>
    status(id: string): Promise<ActionExecution>
  }
}
