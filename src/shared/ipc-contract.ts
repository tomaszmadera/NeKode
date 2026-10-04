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

// One regular file in a project's configured handoff directory (spec
// handoff-resume-flow Data/API), newest first. `path` is the resolved
// absolute path; the Resume command composes the project-relative form from
// it (shared `relativeToProject`, absolute when outside the root).
export interface HandoffEntry {
  name: string
  path: string
  modifiedAt: string
}

// Shell selection (spec project-shell-selection): the stored per-project
// setting value is one opaque choice id — `default`, a detected shell
// (`powershell`, `pwsh`, `cmd`, `gitbash`, `wsl:<distro>`) or a user-added
// executable path (`custom:<absolute path>`). The renderer only ever sends
// ids; main resolves every id to an executable at spawn/label time and falls
// back to the platform default when the id no longer resolves.
export type ShellChoice =
  | 'default'
  | 'powershell'
  | 'pwsh'
  | 'cmd'
  | 'gitbash'
  | `wsl:${string}`
  | `custom:${string}`

/** One selectable shell as shown in the Shell settings tab. */
export interface ShellInfo {
  id: ShellChoice
  /** Display label (e.g. "PowerShell", "WSL: Ubuntu-24.04", "bash"). */
  label: string
}

// ---------------------------------------------------------------------------
// Kanban adapter integration (spec kanban-adapter-interface). Adapter plugins
// are external user-installed processes; the shapes below are the app-side
// normalized contract only — no backend knowledge lives in the renderer.
// ---------------------------------------------------------------------------

/** Plane-compatible state groups; every adapter maps its backend onto these. */
export type KanbanStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export const KANBAN_STATE_GROUPS: readonly KanbanStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
]

export interface KanbanState {
  id: string
  name: string
  group: KanbanStateGroup
  /** Adapter-provided sort key; the board orders columns by it. */
  order: number
}

export type KanbanPriority = 'urgent' | 'high' | 'medium' | 'low'

export const KANBAN_PRIORITIES: readonly KanbanPriority[] = ['urgent', 'high', 'medium', 'low']

export interface WorkItem {
  /** Stable human-readable reference, e.g. `NEKODE-16`. */
  ref: string
  /** Backend-native id, opaque to the UI. */
  id: string
  title: string
  description: string | null
  stateId: string
  stateName: string
  stateGroup: KanbanStateGroup
  priority: KanbanPriority | null
  assignee: string | null
  url: string | null
  updatedAt: string | null
}

export interface KanbanBoard {
  states: KanbanState[]
  items: WorkItem[]
}

export type KanbanConfigFieldType = 'string' | 'secret' | 'select' | 'boolean'

export interface KanbanConfigField {
  key: string
  label: string
  type: KanbanConfigFieldType
  required: boolean
  /** `select` fields only: the allowed values (at least one). */
  options?: string[]
  default?: string | boolean
}

export interface KanbanAdapterInfo {
  id: string
  name: string
  configSchema: KanbanConfigField[]
}

/** kanban:getConfig result: secret values never leave main (spec Business rules). */
export interface KanbanProjectConfig {
  adapterId: string | null
  /** Stored non-secret values; secret fields read as null. */
  values: Record<string, string | null>
  /** Secret keys that hold a stored value (the UI shows "stored", never the value). */
  secretKeys: string[]
}

export interface KanbanCreateInput {
  title: string
  description?: string
  /** State name or group alias; resolved by the adapter, never by main. */
  stateRef?: string
  priority?: KanbanPriority
}

export interface KanbanUpdatePatch {
  title?: string
  description?: string
  stateRef?: string
  priority?: KanbanPriority
}

function toPosixSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Project-root-relative '/'-separated form of an absolute path, or null when
 * the path lies outside the root (the absolute form stays the fallback).
 * Segment-boundary prefix match: a sibling directory sharing only the root's
 * string prefix never resolves. The root itself resolves to ''. The match is
 * case-sensitive: on a case-insensitive volume a casing mismatch degrades to
 * the absolute form (correct, just not the shorter display).
 */
export function relativeToProject(projectRoot: string, absolutePath: string): string | null {
  const root = toPosixSlashes(projectRoot).replace(/\/+$/, '')
  const target = toPosixSlashes(absolutePath)
  if (target === root) {
    return ''
  }
  const prefix = `${root}/`
  if (!target.startsWith(prefix)) {
    return null
  }
  return target.slice(prefix.length)
}

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
  terminalsShellList: 'terminals:shellList',
  terminalsShellDetect: 'terminals:shellDetect',
  terminalsShellAddCustom: 'terminals:shellAddCustom',
  terminalsData: 'terminals:data',
  terminalsExit: 'terminals:exit',
  gitStatus: 'git:status',
  filesList: 'files:list',
  filesRead: 'files:read',
  filesOpenExternal: 'files:openExternal',
  filesOpenRoot: 'files:openRoot',
  actionsList: 'actions:list',
  actionsCreate: 'actions:create',
  actionsUpdate: 'actions:update',
  actionsDelete: 'actions:delete',
  actionsExecute: 'actions:execute',
  actionsStatus: 'actions:status',
  handoffsList: 'handoffs:list',
  dialogsPickDirectory: 'dialogs:pickDirectory',
  kanbanAdaptersList: 'kanban:adaptersList',
  kanbanGetConfig: 'kanban:getConfig',
  kanbanSetConfig: 'kanban:setConfig',
  kanbanTest: 'kanban:test',
  kanbanListBoard: 'kanban:listBoard',
  kanbanCreateItem: 'kanban:createItem',
  kanbanUpdateItem: 'kanban:updateItem',
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
  /** Last confirmed Add Project dialog directory: the next dialog's defaultPath. */
  projectsLastDirectory: 'projects.lastDirectory',
  /** '1' sends Handoff/Resume commands straight to the PTY; missing means paste-only. */
  autoSendHandoffResume: 'handoffResume.autoSend',
  /** '0' disables the Ctrl+Tab chat switch; missing or '1' means enabled. */
  chatSwitchEnabled: 'chatSwitch.enabled',
  /** '0' keeps original project names in the tree; missing or '1' means uppercase. */
  projectNamesUppercase: 'projects.namesUppercase',
  /** '0' hides attention badges on unselected chat rows; missing or '1' means shown. */
  attentionBadgeEnabled: 'attention.badgeEnabled',
  /** '0' silences the attention chime for unselected chats; missing or '1' means on. */
  attentionChimeEnabled: 'attention.chimeEnabled',
  /** '0' silences the attention chime for the selected chat; missing or '1' means on. */
  attentionActiveChimeEnabled: 'attention.activeChimeEnabled',
  /** '0' hides the attention indicator on the selected chat's row; missing or '1' means shown. */
  attentionActiveIndicatorEnabled: 'attention.activeIndicatorEnabled',
  /** Absolute adapters directory override; missing means `<userData>/kanban-adapters`. */
  kanbanAdaptersDir: 'kanban.adaptersDir',
  /**
   * JSON array of absolute executable paths the user added as custom shells
   * (spec project-shell-selection). App-level, shared across projects;
   * re-validated (dead paths pruned) on every shell detection run.
   */
  customShells: 'shells.custom',
} as const

/**
 * Per-project handoff directory setting key (spec handoff-resume-flow
 * Business rules). Empty or missing value means unconfigured; relative
 * values resolve against the project root at listing time.
 */
export function projectHandoffDirKey(projectId: string): string {
  return `project.handoffDir:${projectId}`
}

/** Per-project Kanban adapter binding key (spec kanban-adapter-interface Business rules). */
export function projectKanbanAdapterKey(projectId: string): string {
  return `project.kanbanAdapter:${projectId}`
}

/** Per-project Kanban adapter config JSON key (field values, secrets included). */
export function projectKanbanConfigKey(projectId: string): string {
  return `project.kanbanConfig:${projectId}`
}

/**
 * Per-project shell choice key (spec project-shell-selection). The stored
 * value is a `ShellChoice` id; empty or missing means `default` (the
 * platform default shell, unchanged behavior).
 */
export function projectShellKey(projectId: string): string {
  return `project.shell:${projectId}`
}

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
     * Display label of the project's resolved shell (spec
     * project-shell-selection): the stored per-project choice, or the
     * platform default (e.g. "PowerShell") when unset/unresolvable. Bottom
     * tabs take their label from this. It does not create a chat.
     */
    shellName(projectId: string): Promise<string>
    /**
     * Cached shell list (spec project-shell-selection): `default` plus the
     * last detection of this app run plus persisted custom entries. Never
     * probes the machine — detection runs only via `shellDetect`.
     */
    shellList(): Promise<ShellInfo[]>
    /**
     * Runs one detection (the Shell settings tab calls this on entry):
     * fixed-path probing plus one WSL enumeration in main, cache replaced,
     * custom paths re-validated (dead pruned). Returns the full list.
     */
    shellDetect(): Promise<ShellInfo[]>
    /**
     * Validates an absolute executable path in main and adds it as a
     * `custom:<path>` entry (persisted app-level). Rejects invalid input.
     */
    shellAddCustom(path: string): Promise<ShellInfo>
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
    /**
     * Opens the project root directory in the OS file manager (main:
     * shell.openPath on the registered root). Unknown project: not_found.
     */
    openRoot(projectId: string): Promise<void>
  }
  actions: {
    list(): Promise<ActionControl[]>
    create(input: ActionInput): Promise<ActionControl>
    update(id: string, input: ActionInput): Promise<ActionControl>
    delete(id: string): Promise<void>
    execute(id: string, projectId: string | null, confirmed: boolean): Promise<ActionExecution>
    status(id: string): Promise<ActionExecution>
  }
  handoffs: {
    /**
     * One lazy listing of the project's configured handoff directory
     * (regular files, newest first). Unconfigured project: typed
     * validation error; missing directory: not_found naming the path.
     */
    list(projectId: string): Promise<HandoffEntry[]>
  }
  kanban: {
    /** Adapters discovered in the configured adapters directory (fresh scan). */
    adaptersList(): Promise<KanbanAdapterInfo[]>
    /** Binding + stored values; secret values read as null (never leave main). */
    getConfig(projectId: string): Promise<KanbanProjectConfig>
    /**
     * Persists binding and field values. A missing (vs empty) secret entry
     * keeps the stored secret; an empty string clears any stored value.
     */
    setConfig(
      projectId: string,
      config: { adapterId: string | null; values: Record<string, string> },
    ): Promise<void>
    /** Invokes the adapter's `test` action; `values` falls back to stored config. */
    test(projectId: string, values?: Record<string, string>): Promise<void>
    /** Normalized states + items of the bound adapter's backend. */
    listBoard(projectId: string): Promise<KanbanBoard>
    createItem(projectId: string, input: KanbanCreateInput): Promise<WorkItem>
    updateItem(projectId: string, ref: string, patch: KanbanUpdatePatch): Promise<WorkItem>
  }
  dialogs: {
    /**
     * Opens the native directory picker (main process). Resolves the chosen
     * absolute path, or null when the user cancels. Persists nothing.
     */
    pickDirectory(defaultPath: string | null): Promise<string | null>
  }
}
