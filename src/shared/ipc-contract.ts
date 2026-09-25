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

export interface GitStatus {
  branch: string | null
  dirty: boolean
}

export type Unsubscribe = () => void

// Channel names mirror the spec Data/API bridge. terminals:terminate is
// intentionally absent: app-quit PTY teardown runs in the main process
// (TerminalService.terminateAll on app quit), never through the renderer.
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
  terminalsData: 'terminals:data',
  terminalsExit: 'terminals:exit',
  gitStatus: 'git:status',
} as const

// Keys of the flat app_state key–value store (spec Data/API). Shared so the
// renderer persists with the same keys the main process cleans up.
export const APP_STATE_KEY = {
  selectedProjectId: 'selection.projectId',
  selectedChatId: 'selection.chatId',
  leftRegionWidth: 'region.left.width',
  bottomRegionHeight: 'region.bottom.height',
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
    onData(chatId: string, callback: (data: string) => void): Unsubscribe
    onExit(chatId: string, callback: (exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
  }
}
