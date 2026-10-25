import type { DesktopDictationSettings, DesktopDictationSetup } from './desktop-dictation-contract'
import type {
  CreateDictionaryEntryInput,
  DictationDictionary,
  DictationDictionaryEntry,
  DictationPostProcessingSettings,
  DictationResult,
  DictationSettings,
  DictationStart,
  DictationStatusSnapshot,
  SttProviderSummary,
  UpdateDictionaryEntryInput,
} from './dictation-contract'

export type {
  ConfigFieldSchema,
  ConfigFieldType,
  CreateDictionaryEntryInput,
  DictationConnectionState,
  DictationDictionary,
  DictationDictionaryEntry,
  DictationModelSelection,
  DictationPostProcessingLevel,
  DictationPostProcessingMode,
  DictationPostProcessingSettings,
  DictationResult,
  DictationSettings,
  DictationStart,
  DictationStatusSnapshot,
  LocalTranscribeModel,
  SetPostProcessingSettingsInput,
  SttProviderCapabilities,
  SttProviderManifest,
  SttProviderSummary,
  UpdateDictionaryEntryInput,
} from './dictation-contract'

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

export type SessionStatus = 'running' | 'waiting' | 'idle'

export interface SessionTaskProgress {
  taskId: string
  step: number
  totalSteps: number
  taskTitle?: string
  stepName?: string
  fix?: number
  review?: number
  stepNames?: readonly string[]
  ariaLabel?: string
  label?: string
  stale?: boolean
  staleReason?: string
}

/** Launch-time display identity, independent of mutable agent profile definitions. */
export interface ChatLaunchIdentity {
  taskRef?: string
  agentName?: string
}

// A chat is a terminal session listed under a project (spec Data/API).
export interface ChatInfo extends ChatLaunchIdentity {
  id: string
  projectId: string
  name: string
  status?: SessionStatus
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

// Per-path Git status behind the file-tree decoration (spec
// project-files-view Behaviour 16-19). `modified` also covers a deletion, a
// rename and a type change; an untracked or ignored directory is keyed
// without its trailing slash and covers its whole subtree.
export type GitFileStatusKind = 'modified' | 'added' | 'untracked' | 'conflict' | 'ignored'

/** Project-root-relative path to decoration kind; empty when git is absent. */
export type GitFileStatuses = Readonly<Record<string, GitFileStatusKind>>

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

export interface KanbanComment {
  /** Backend-native comment id. */
  id: string
  /** Author display name or identifier, or null when unknown. */
  author: string | null
  /** Plain text content of the comment. */
  text: string
  /** ISO 8601 UTC timestamp or null. */
  createdAt: string | null
}

export interface KanbanBoard {
  states: KanbanState[]
  items: WorkItem[]
  /**
   * Document revision of the built-in `local-file` source (project-home spec
   * Data / API). The next create or update must echo it. Process adapters
   * omit it.
   */
  revision?: number
}

/**
 * Result of `kanban:createItem` and `kanban:updateItem`: the written item plus,
 * for `local-file` only, the new document revision.
 */
export type KanbanItemWriteResult = WorkItem & { revision?: number }

/**
 * Built-in task source (project-home spec Behaviour 7-10): a JSON document at
 * a fixed path under the project root, read and written by main. It is not
 * a discovered process adapter and has no config fields.
 */
export const LOCAL_FILE_ADAPTER_ID = 'local-file'
export const LOCAL_FILE_ADAPTER_NAME = 'Local file'
/** Project-relative path of the `local-file` task document. */
export const LOCAL_TASK_FILE_PATH = '.nekode/tasks.json'
/**
 * `detail` of the `not_found` error for a missing task file while bound
 * (project-home spec Edge cases). Only this case offers `Use a local task
 * list`; an unknown project or a missing project folder does not.
 */
export const LOCAL_TASK_FILE_MISSING = 'local_task_file_missing'

/**
 * Project-relative path of the one skill file `Teach agents` writes
 * (project-home spec Behaviour 11-12). No per-agent destinations.
 */
export const AGENT_SKILL_FILE_PATH = '.agents/skills/nekode-tasks/SKILL.md'

/** Result of `kanban:skillStatus`: whether the skill file already exists. */
export interface KanbanSkillStatus {
  exists: boolean
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

// ---------------------------------------------------------------------------
// Task progress adapters (spec task-progress-adapters). Adapters are external
// user-installed processes discovered in one fixed directory; the renderer
// never supplies a command, path, or adapters directory.
// ---------------------------------------------------------------------------

/** v1 field types. There are no secret or directory fields (spec Behaviour 2, Non-goals). */
export type TaskProgressConfigFieldType = 'string' | 'select' | 'boolean'

export interface TaskProgressConfigField {
  key: string
  label: string
  type: TaskProgressConfigFieldType
  required: boolean
  /** `select` fields only: the allowed values (at least one). */
  options?: string[]
  default?: string | boolean
}

export type TaskProgressEnvironment = 'local' | 'wsl'

export interface TaskProgressAdapterInfo {
  id: string
  name: string
  /** Project environments the adapter supports; the manifest default is `["local"]`. */
  environments: TaskProgressEnvironment[]
  configSchema: TaskProgressConfigField[]
}

/** `taskProgress:adaptersList` result: a fresh scan plus skipped-manifest warnings. */
export interface TaskProgressAdapterList {
  adapters: TaskProgressAdapterInfo[]
  warnings: string[]
}

/**
 * Stored project binding. Field values travel as strings (`boolean` fields as
 * `"true"`/`"false"`), like the kanban adapter config.
 */
export interface TaskProgressBinding {
  adapterId: string | null
  config: Record<string, string>
}

/** Typed error codes (spec Errors): host codes first, then adapter-reported codes. */
export type TaskProgressErrorCode =
  | 'adapter_missing'
  | 'environment_unsupported'
  | 'timeout'
  | 'protocol'
  | 'spawn'
  | 'config'
  | 'runtime'
  | 'unsupported_source'
  | 'transient'
  | 'internal'

export interface TaskProgressError {
  code: TaskProgressErrorCode
  /** Names the adapter id and the action; never carries adapter stderr. */
  message: string
}

/** `taskProgress:test` result: the adapter summary or a typed error, never a toast. */
export type TaskProgressTestResult =
  | { ok: true; summary: string }
  | { ok: false; error: TaskProgressError }

export type TaskProgressTaskState = 'active' | 'blocked' | 'completed'
export type TaskProgressLocation = 'live' | 'archived'
export type TaskProgressRecordState = 'valid' | 'invalid' | 'unsupported'
export type TaskProgressActivity = 'working' | 'waiting' | 'idle'

export interface TaskProgressStep {
  id: string
  label: string
  done: boolean
}

export interface TaskProgressPhase {
  name: string
  steps: TaskProgressStep[]
}

/**
 * One task of a validated `snapshot` response (spec Data / API). Optional
 * adapter fields are normalized: absent text and timestamps read as null,
 * absent lists as empty, absent counters as 0.
 */
export interface TaskProgressItem {
  id: string
  ref: string | null
  title: string | null
  state: TaskProgressTaskState
  location: TaskProgressLocation
  recordState: TaskProgressRecordState
  errors: string[]
  activity: TaskProgressActivity | null
  phases: TaskProgressPhase[]
  currentStepId: string | null
  currentLabel: string | null
  corrections: number
  reviews: number
  nextAction: string | null
  blockers: string | null
  createdAt: string | null
  updatedAt: string | null
  completedAt: string | null
  checkpoints: { stepId: string; completedAt: string }[]
  /** Relative, informational only. */
  path: string | null
}

/**
 * In-memory progress of one bound, observed project (spec Data / API).
 * `stale` keeps the last valid tasks and carries the current error.
 * `receivedAt` is the time of the last valid snapshot, null before the first.
 */
export interface TaskProgressSnapshot {
  projectId: string
  adapterId: string
  status: 'ok' | 'stale'
  tasks: TaskProgressItem[]
  receivedAt: string | null
  error?: TaskProgressError
}

/** `taskProgress:changed` payload: a new snapshot, or the project's snapshot was dropped. */
export type TaskProgressChangedEvent = TaskProgressSnapshot | { projectId: string; cleared: true }

/** Structural guard for the preload event listener. */
export function isTaskProgressChangedEvent(value: unknown): value is TaskProgressChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  if (typeof event.projectId !== 'string') return false
  if (event.cleared === true) return true
  return (
    typeof event.adapterId === 'string' &&
    (event.status === 'ok' || event.status === 'stale') &&
    Array.isArray(event.tasks)
  )
}

/** kanban:getConfig result: secret values never leave main (spec Business rules). */
export interface KanbanProjectConfig {
  adapterId: string | null
  /** Stored non-secret values; secret fields read as null. */
  values: Record<string, string | null>
  /** Secret keys that hold a stored value (the UI shows "stored", never the value). */
  secretKeys: string[]
  /**
   * True when the OS keyring (Electron safeStorage) is unavailable, e.g. Linux
   * without libsecret/gnome-keyring: secrets are then kept in memory for this
   * session only and are never written to disk in plain text.
   */
  sessionOnlySecrets?: boolean
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
  /**
   * Named priority, or null to clear it. Omit the field to leave priority
   * unchanged. Create still uses `KanbanPriority` only and does not clear.
   */
  priority?: KanbanPriority | null
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
  appUpdateLatest: 'appUpdate:latest',
  appUpdateDownload: 'appUpdate:download',
  appUpdateLaunch: 'appUpdate:launch',
  usageListAdapters: 'usage:listAdapters',
  usageGetSettings: 'usage:getSettings',
  usageSaveSettings: 'usage:saveSettings',
  usageRead: 'usage:read',
  usageRefresh: 'usage:refresh',
  usageTest: 'usage:test',
  usagePickFile: 'usage:pickFile',
  usageGetEnabled: 'usage:getEnabled',
  usageSetEnabled: 'usage:setEnabled',
  usageOpenAdaptersFolder: 'usage:openAdaptersFolder',
  dictationStatus: 'dictation:status',
  dictationDesktopSetup: 'dictation:desktopSetup',
  dictationDesktopConfigure: 'dictation:desktopConfigure',
  dictationDesktopActivate: 'dictation:desktopActivate',
  dictationTestConnection: 'dictation:testConnection',
  dictationRefreshModels: 'dictation:refreshModels',
  dictationDictionaryList: 'dictation:dictionaryList',
  dictationDictionaryAdd: 'dictation:dictionaryAdd',
  dictationDictionaryUpdate: 'dictation:dictionaryUpdate',
  dictationDictionaryDelete: 'dictation:dictionaryDelete',
  dictationDictionaryToggle: 'dictation:dictionaryToggle',
  dictationProvidersList: 'dictation:providersList',
  dictationProvidersTestConnection: 'dictation:providersTestConnection',
  dictationProvidersDiscoverModels: 'dictation:providersDiscoverModels',
  dictationProvidersGetConfig: 'dictation:providersGetConfig',
  dictationProvidersSetConfig: 'dictation:providersSetConfig',
  dictationGetActiveProvider: 'dictation:getActiveProvider',
  dictationSetActiveProvider: 'dictation:setActiveProvider',
  dictationPostProcessingGetSettings: 'dictation:postProcessingGetSettings',
  dictationPostProcessingSetSettings: 'dictation:postProcessingSetSettings',
  dictationGetSettings: 'dictation:getSettings',
  dictationSetSettings: 'dictation:setSettings',
  dictationStart: 'dictation:start',
  dictationAudio: 'dictation:audio',
  dictationCancel: 'dictation:cancel',
  dictationResult: 'dictation:result',
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsWslDistributions: 'projects:wslDistributions',
  projectsWslDirectories: 'projects:wslDirectories',
  projectsAddWsl: 'projects:addWsl',
  projectsRemove: 'projects:remove',
  chatsList: 'chats:list',
  chatsCreate: 'chats:create',
  /** Creates a chat with one agent profile running in its terminal. */
  chatsCreateWithAgent: 'chats:createWithAgent',
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
  gitFileStatuses: 'git:fileStatuses',
  gitSync: 'git:sync',
  filesList: 'files:list',
  filesRead: 'files:read',
  filesOpenExternal: 'files:openExternal',
  filesOpenRoot: 'files:openRoot',
  filesShowInFolder: 'files:showInFolder',
  filesTrash: 'files:trash',
  actionsList: 'actions:list',
  actionsCreate: 'actions:create',
  actionsUpdate: 'actions:update',
  actionsDelete: 'actions:delete',
  actionsExecute: 'actions:execute',
  actionsStatus: 'actions:status',
  handoffsList: 'handoffs:list',
  handoffsResumePrompt: 'handoffs:resumePrompt',
  dialogsPickDirectory: 'dialogs:pickDirectory',
  kanbanAdaptersList: 'kanban:adaptersList',
  kanbanGetConfig: 'kanban:getConfig',
  kanbanSetConfig: 'kanban:setConfig',
  kanbanTest: 'kanban:test',
  kanbanListBoard: 'kanban:listBoard',
  kanbanCreateItem: 'kanban:createItem',
  kanbanUpdateItem: 'kanban:updateItem',
  kanbanGetItem: 'kanban:getItem',
  kanbanGetComments: 'kanban:getComments',
  kanbanBindLocalFile: 'kanban:bindLocalFile',
  kanbanSkillStatus: 'kanban:skillStatus',
  kanbanWriteSkill: 'kanban:writeSkill',
  kanbanLaunchTask: 'kanban:launchTask',
  kanbanHandoffCandidates: 'kanban:handoffCandidates',
  kanbanHandoffAvailability: 'kanban:handoffAvailability',
  taskProgressAdaptersList: 'taskProgress:adaptersList',
  taskProgressGetBinding: 'taskProgress:getBinding',
  taskProgressSaveBinding: 'taskProgress:saveBinding',
  taskProgressTest: 'taskProgress:test',
  taskProgressObserve: 'taskProgress:observe',
  taskProgressGet: 'taskProgress:get',
  taskProgressChanged: 'taskProgress:changed',
  agentProfilesGet: 'agentProfiles:get',
  agentProfilesPut: 'agentProfiles:put',
  agentProfilesDelete: 'agentProfiles:delete',
  agentProfilesLibraryGet: 'agentProfiles:libraryGet',
  agentProfilesSelectionGet: 'agentProfiles:selectionGet',
  agentProfilesSelectionSet: 'agentProfiles:selectionSet',
  agentProfilesTemplatesGet: 'agentProfiles:templatesGet',
} as const

// Keys of the flat app_state key–value store (spec Data/API). Shared so the
// renderer persists with the same keys the main process cleans up.
export const APP_STATE_KEY = {
  dictationEnabled: 'dictation.enabled',
  dictationDesktop: 'dictation.desktop',
  dictationLanguage: 'dictation.language',
  dictationModel: 'dictation.model',
  dictationTimeoutSeconds: 'dictation.timeoutSeconds',
  dictationActiveProvider: 'dictation.activeProvider',
  dictationPostProcessingMode: 'dictation.postProcessing.mode',
  dictationPostProcessingLevel: 'dictation.postProcessing.level',
  dictationPostProcessingModel: 'dictation.postProcessing.model',
  dictationPostProcessingApiKey: 'dictation.postProcessing.apiKey',
  /** JSON containing state and checkedAt only. Historical, not startup readiness. */
  dictationStatus: 'dictation.status',
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
  /** '0' hides project avatar icons in the tree; missing or '1' means shown. */
  showProjectIcons: 'projects.showIcons',
  /** '0' hides attention badges on unselected chat rows; missing or '1' means shown. */
  attentionBadgeEnabled: 'attention.badgeEnabled',
  /** '0' silences the attention chime for unselected chats; missing or '1' means on. */
  attentionChimeEnabled: 'attention.chimeEnabled',
  /** '0' silences the attention chime for the selected chat; missing or '1' means on. */
  attentionActiveChimeEnabled: 'attention.activeChimeEnabled',
  /** '0' hides the attention indicator on the selected chat's row; missing or '1' means shown. */
  attentionActiveIndicatorEnabled: 'attention.activeIndicatorEnabled',
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

/** Per-project task progress adapter id (spec task-progress-adapters Data/API). */
export function projectTaskProgressAdapterKey(projectId: string): string {
  return `project.taskProgressAdapter:${projectId}`
}

/** Per-project task progress adapter field values (JSON object of strings). */
export function projectTaskProgressConfigKey(projectId: string): string {
  return `project.taskProgressConfig:${projectId}`
}

/**
 * Task progress binding keys are written only through the validated
 * taskProgress:* channels (spec Authorization), never via generic state IPC.
 */
export function isTaskProgressStateKey(key: string): boolean {
  return (
    key.startsWith('project.taskProgressAdapter:') || key.startsWith('project.taskProgressConfig:')
  )
}

/** Keys that carry secret values and must never be accessed via generic state IPC. */
export function isSecretStateKey(key: string): boolean {
  return (
    key.startsWith('usage.') ||
    key === 'project.kanbanConfig' ||
    key.startsWith('project.kanbanConfig:') ||
    key.startsWith('dictation.providerConfig:') ||
    key === APP_STATE_KEY.dictationPostProcessingApiKey
  )
}

/**
 * Per-project shell choice key (spec project-shell-selection). The stored
 * value is a `ShellChoice` id; empty or missing means `default` (the
 * platform default shell, unchanged behavior).
 */
export function projectShellKey(projectId: string): string {
  return `project.shell:${projectId}`
}

export function dictationProviderConfigKey(providerId: string): string {
  return `dictation.providerConfig:${providerId}`
}

/**
 * Per-project color key (hex string from PROJECT_COLOR_PALETTE or custom).
 * Missing or empty value means automatic (deterministic hash).
 */
export function projectColorKey(projectId: string): string {
  return `project.color:${projectId}`
}

/**
 * The one argv element a profile reserves for the launch prompt. The saved
 * prompt replaces this whole element later; it is never concatenated into
 * another argument. Stage 2 only stores the literal.
 */
export const AGENT_PROMPT_PLACEHOLDER = '{prompt}'

/** One global agent launch definition. `id` is minted in main. */
export interface AgentProfile {
  id: string
  name: string
  executable: string
  args: string[]
  /** Complete argv for New Chat; absent keeps legacy prompt removal, [] means no arguments. */
  interactiveArgs?: string[]
  originProjectName?: string
}

export interface AgentProfilesLibrary {
  version: 1
  profiles: AgentProfile[]
}

export interface AgentProfileTemplate {
  id: string
  name: string
  command: string
}

export interface AgentProjectSelectionInput {
  selectedIds: string[]
  defaultId: string | null
}

export interface AgentProjectSelection extends AgentProjectSelectionInput {
  version: 1
}

/** Effective project profiles returned for launching, never stored as definitions. */
export interface AgentProfilesDocument {
  defaultId: string | null
  profiles: AgentProfile[]
}

/**
 * `agentProfiles:put` body. `id: null` creates a global profile. A string
 * edits the same definition for future launches in every selected project.
 */
export interface AgentProfilePut {
  id: string | null
  name: string
  command: string
  interactiveArgs?: string[]
}

export const AGENT_PROFILES_LIBRARY_KEY = 'agents.library'

export function projectAgentSelectionKey(projectId: string): string {
  return `project.agentSelection:${projectId}`
}

/** Per-project agent profiles document (kanban task launch amendment). */
export function projectAgentProfilesKey(projectId: string): string {
  return `project.agentProfiles:${projectId}`
}

/**
 * Shared fields of `kanban:launchTask`. Main refetches the item with `getItem`
 * `{ ref }` and checks `itemId`. The renderer does not send a chat name,
 * description, or prompt.
 */
export interface KanbanLaunchTaskBase {
  projectId: string
  itemId: string
  ref: string
  profileId: string
  attemptId: string
}

/** `kanban:launchTask` body for `mode: 'start'` (the Start prompt). */
export interface KanbanStartLaunchInput extends KanbanLaunchTaskBase {
  mode: 'start'
}

/**
 * `kanban:launchTask` body for `mode: 'resume'`. `fileName` and `stamp` come
 * from a scan result main just produced. Main rechecks the file and the stamp
 * immediately before creating the chat; a missing, unreadable, replaced, or
 * changed file refreshes the choice and creates no chat.
 */
export interface KanbanResumeLaunchInput extends KanbanLaunchTaskBase {
  mode: 'resume'
  /** File name from the scan result main just produced. */
  fileName: string
  /** `modifiedAt` ISO stamp from that scan; main rechecks it before the chat. */
  stamp: string
}

/**
 * `kanban:launchTask` body for `mode: 'draft'` (Start without sending,
 * NEKODE-99). Main starts the profile with its interactive argv and returns the
 * Start prompt as `draftPrompt` instead of passing it to the process.
 */
export interface KanbanDraftLaunchInput extends KanbanLaunchTaskBase {
  mode: 'draft'
}

export type KanbanLaunchTaskInput =
  | KanbanStartLaunchInput
  | KanbanResumeLaunchInput
  | KanbanDraftLaunchInput

/** Chat created for one confirmation. `delivered` is false when spawn failed. */
export interface KanbanLaunchResult {
  chat: ChatInfo
  delivered: boolean
  /** The Start prompt for the prompt input; only for `mode: 'draft'` when delivered. */
  draftPrompt?: string
}

// ---------------------------------------------------------------------------
// Handoff match (kanban task launch amendment, stage 4; NEKODE-30 stage 2). The
// matcher reads the project's configured handoff directory and returns file
// metadata, not file bodies. The only link between a work item and a handoff is
// the full ref carried in the file name.
// ---------------------------------------------------------------------------

/**
 * How a scanned file matched the work item. `filename` is a ref-named or
 * ref-prefixed file; `none` is a readable file whose name does not carry the
 * ref (never a candidate).
 */
export type HandoffMatchKind = 'filename' | 'none'

/** One regular, readable `.md` file of the configured handoff directory. */
export interface HandoffFileInfo {
  name: string
  /** Display path: project-relative inside the root, absolute otherwise. */
  path: string
  /** ISO modification time; also the stamp a later confirm rechecks. */
  modifiedAt: string
  matchKind: HandoffMatchKind
}

/** A readable file the scan could not use as a candidate; shown as a warning. */
export interface HandoffRejection {
  name: string
  path: string
  /** Visible, user-facing reason (size cap, encoding, read failure). */
  reason: string
}

/**
 * One handoff scan for a work item. `not-configured` is an unconfigured
 * directory; `error` is a directory read failure and is never shown as an
 * empty set. Both are distinct from a `ready` scan that has no candidates.
 */
export type HandoffCandidatesResult =
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | {
      state: 'ready'
      /** Readable files, modification time descending (case-insensitive name tie-break). */
      files: HandoffFileInfo[]
      /** Files with a visible rejection reason; never hide the good candidates. */
      rejections: HandoffRejection[]
    }

/** `kanban:handoffCandidates` body. Item identity comes from the board. */
export interface KanbanHandoffCandidatesInput {
  projectId: string
  itemId: string
  ref: string
}

/**
 * `kanban:handoffAvailability` body. The renderer sends the loaded items'
 * identities only, never a disk path; main resolves the configured directory
 * from its own state.
 */
export interface KanbanHandoffAvailabilityInput {
  projectId: string
  items: Array<{ itemId: string; ref: string }>
}

/** One loaded item's availability in a batch handoff scan. */
export interface KanbanHandoffAvailabilityItem {
  itemId: string
  ref: string
  /** True when at least one readable file name carries the item's full ref. */
  available: boolean
}

/**
 * One batch handoff check for the loaded items. `not-configured` is an
 * unconfigured directory; `error` is a directory read failure and is never
 * shown as an empty set. Both are distinct from a `ready` scan whose items are
 * all unavailable. The result carries no file bodies and no adapter config.
 */
export type KanbanHandoffAvailabilityResult =
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | {
      state: 'ready'
      items: KanbanHandoffAvailabilityItem[]
      /** File-level scan warnings (size, encoding, read); never hides an item. */
      rejections: HandoffRejection[]
    }

/** Optional complete interactive argv; null means the value may be saved. */
export function agentInteractiveArgsError(value: unknown): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || [...value].some((arg) => typeof arg !== 'string')) {
    return 'Interactive arguments must be a list of strings.'
  }
  if (value.some((arg: string) => arg.includes('\u0000'))) {
    return 'Interactive arguments must not contain NUL characters.'
  }
  if (value.some((arg: string) => arg.includes(AGENT_PROMPT_PLACEHOLDER))) {
    return 'Interactive arguments must not include {prompt}.'
  }
  return null
}

/**
 * Shared profile field rules. Null means the fields may be saved. Empty name,
 * empty executable, or any `{prompt}` count other than one is a validation
 * error. The placeholder must be its own argv element, not a substring.
 */
export function agentProfileFieldError(input: {
  name: string
  executable: string
  args: readonly string[]
  interactiveArgs?: readonly string[]
}): string | null {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    return 'Name is required.'
  }
  if (typeof input.executable !== 'string' || input.executable.trim().length === 0) {
    return 'Executable is required.'
  }
  if (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== 'string')) {
    return 'Arguments must be a list of strings.'
  }
  if ([input.name, input.executable, ...input.args].some((value) => value.includes('\u0000'))) {
    return 'Profile fields must not contain NUL characters.'
  }
  const placeholders = input.args.filter((arg) => arg === AGENT_PROMPT_PLACEHOLDER).length
  const hasSubstring = input.args.some(
    (arg) => arg !== AGENT_PROMPT_PLACEHOLDER && arg.includes(AGENT_PROMPT_PLACEHOLDER),
  )
  if (placeholders !== 1 || hasSubstring) {
    return 'Arguments must include {prompt} exactly once.'
  }
  return agentInteractiveArgsError(input.interactiveArgs)
}

export interface AppUpdateLatest {
  /** True only for a packaged Windows build. */
  canInstall: boolean
  /** Latest published numeric version, or null when it is unknown. */
  version: string | null
  /** Short sentence when the release check failed. Null when the check did not fail. */
  error: string | null
}

export interface AppApi {
  /**
   * Host platform (process.platform), set by the preload. Absent (older test
   * doubles) means Windows behaviour, the app's primary platform.
   */
  platform?: string
  /**
   * The user's home directory (USERPROFILE on Windows, HOME elsewhere), set by
   * the preload. Display only: paths under it show as `~`. Absent means no
   * shortening.
   */
  homeDir?: string
  appUpdate: {
    latest(): Promise<AppUpdateLatest>
    /** Download and checksum the latest published Windows installer. */
    download(): Promise<void>
    /** Start the checked installer with no arguments, then quit NeKode. */
    launch(): Promise<void>
  }
  usage: import('./usage-contract').UsageApi
  dictation: {
    desktopSetup(): Promise<DesktopDictationSetup>
    desktopConfigure(settings: DesktopDictationSettings): Promise<DesktopDictationSetup>
    desktopActivate(): Promise<void>
    status(): Promise<DictationStatusSnapshot>
    testConnection(): Promise<DictationStatusSnapshot>
    refreshModels(): Promise<DictationStatusSnapshot>
    dictionaryList(projectId?: string): Promise<DictationDictionaryEntry[] | DictationDictionary>
    getSettings(): Promise<DictationSettings>
    setSettings(settings: DictationSettings): Promise<DictationSettings>
    start(chatId: string, retrySessionId: string | null): Promise<DictationStart>
    audio(sessionId: string, wav: ArrayBuffer): Promise<void>
    cancel(sessionId: string): Promise<void>
    onResult(callback: (result: DictationResult) => void): Unsubscribe

    providersList(): Promise<SttProviderSummary[]>
    providersTestConnection(
      providerId: string,
      config?: Record<string, unknown>,
    ): Promise<{ ok: boolean; message: string }>
    providersDiscoverModels(
      providerId: string,
      config?: Record<string, unknown>,
    ): Promise<Array<{ id: string; name: string }>>
    providersGetConfig(providerId: string): Promise<Record<string, unknown>>
    providersSetConfig(providerId: string, config: Record<string, unknown>): Promise<void>
    getActiveProvider(): Promise<string>
    setActiveProvider(providerId: string): Promise<void>
    dictionaryAdd(entry: CreateDictionaryEntryInput): Promise<DictationDictionaryEntry>
    dictionaryUpdate(
      id: string,
      updates: UpdateDictionaryEntryInput,
    ): Promise<DictationDictionaryEntry>
    dictionaryDelete(id: string): Promise<void>
    dictionaryToggle(id: string, enabled: boolean): Promise<DictationDictionaryEntry>
    postProcessingGetSettings(): Promise<DictationPostProcessingSettings>
    postProcessingSetSettings(settings: {
      mode: string
      level: string
      model?: string
      apiKey?: string
    }): Promise<void>
  }
  projects: {
    list(): Promise<ProjectInfo[]>
    /** Opens the native directory dialog in main. Resolves null when the user cancels. */
    add(): Promise<ProjectInfo | null>
    wslDistributions(): Promise<string[]>
    /** Advisory directory completions in the selected distribution; never registers a project. */
    wslDirectories(distribution: string, linuxPath: string): Promise<string[]>
    addWsl(distribution: string, linuxPath: string): Promise<ProjectInfo>
    remove(projectId: string): Promise<void>
  }
  chats: {
    list(projectId: string): Promise<ChatInfo[]>
    /**
     * Creates a chat with no naming form (spec Behaviour 3): the name is
     * the project's compact shell code in brackets (e.g. "[PS7]") and may
     * repeat within a project. Returns the created chat (selected by the
     * renderer).
     */
    create(projectId: string): Promise<ChatInfo>
    /**
     * Creates one chat named `[shell] <profile name>` and starts the profile's
     * agent process in that chat's terminal at the project root (the Kanban
     * launch path: argv, never a shell; the `{prompt}` element is removed so
     * the agent starts interactively). A spawn failure removes the chat again
     * and rejects with a typed error; there is no fallback to a shell chat.
     */
    createWithAgent(projectId: string, profileId: string): Promise<ChatInfo>
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
    shellList(projectId?: string | null): Promise<ShellInfo[]>
    /**
     * Runs one detection (the Shell settings tab calls this on entry):
     * fixed-path probing plus one WSL enumeration in main, cache replaced,
     * custom paths re-validated (dead pruned). Returns the full list.
     */
    shellDetect(projectId?: string | null): Promise<ShellInfo[]>
    /**
     * Validates an absolute executable path in main and adds it as a
     * `custom:<path>` entry (persisted app-level). Rejects invalid input.
     */
    shellAddCustom(path: string, projectId?: string | null): Promise<ShellInfo>
    /**
     * Terminates one bottom-tab PTY. Rejects any other id. Chat sessions and
     * application quit do not use this method.
     */
    terminate(bottomTabId: string): Promise<void>
    onData(chatId: string, callback: (data: string) => void): Unsubscribe
    onExit(chatId: string, callback: (exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectId: string): Promise<GitStatus>
    /**
     * One read of the project's per-path working-tree status for the file
     * tree decoration. Any failure (not a repository, git missing, timeout)
     * degrades to the empty map; the caller never sees an error state.
     */
    fileStatuses(projectId: string): Promise<GitFileStatuses>
    sync(projectId: string): Promise<void>
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
    /**
     * Reveals the entry in the OS file manager (main: shell.showItemInFolder
     * on the contained lexical path). Unknown project or a rejected path:
     * not_found.
     */
    showInFolder(projectId: string, relativePath: string): Promise<void>
    /**
     * Moves the entry to the Windows Recycle Bin (main: shell.trashItem).
     * A failure leaves the file in place. There is no direct-remove fallback.
     */
    trash(projectId: string, relativePath: string): Promise<void>
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
    /** Compose a file-based Resume using current local settings; no handoff read. */
    resumePrompt(projectId: string, handoffPath: string): Promise<string>
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
    /**
     * Normalized states + items of the bound source. For `local-file` the
     * board also carries the document `revision`.
     */
    listBoard(projectId: string): Promise<KanbanBoard>
    /**
     * `revision` is the `local-file` document revision last read; process
     * adapters ignore it and the renderer omits it for them. A stale revision
     * rejects with `conflict` and changes nothing.
     */
    createItem(
      projectId: string,
      input: KanbanCreateInput,
      revision?: number,
    ): Promise<KanbanItemWriteResult>
    updateItem(
      projectId: string,
      ref: string,
      patch: KanbanUpdatePatch,
      revision?: number,
    ): Promise<KanbanItemWriteResult>
    /** Live item via the adapter `getItem` action (`{ ref }`). */
    getItem(projectId: string, ref: string): Promise<WorkItem>
    /** Comments for one work item via the adapter `listComments` action (`{ ref }`). */
    getComments(projectId: string, ref: string): Promise<KanbanComment[]>
    /**
     * `Use a local task list` (project-home spec Behaviour 7): creates
     * `.nekode/tasks.json` only when it is absent, then binds `local-file`.
     * An existing file is left unchanged.
     */
    bindLocalFile(projectId: string): Promise<void>
    /**
     * `Teach agents` (project-home spec Behaviour 11): whether
     * `.agents/skills/nekode-tasks/SKILL.md` exists under the project root.
     * Read-only, with the same containment checks as the write.
     */
    skillStatus(projectId: string): Promise<KanbanSkillStatus>
    /**
     * Writes `.agents/skills/nekode-tasks/SKILL.md` after the confirm gesture.
     * Main builds the text from the bound source; the renderer sends no
     * content. Rejects while no source is bound.
     */
    writeSkill(projectId: string): Promise<void>
    /**
     * Starts one task chat. Main owns the profile, the prompt, and the
     * process. The same `attemptId` returns the same chat.
     */
    launchTask(input: KanbanLaunchTaskInput): Promise<KanbanLaunchResult>
    /**
     * One scan of the project's configured handoff directory for a work item.
     * Read-only: main returns names, match kind, display path, stamp and
     * rejection reasons, never file bodies. Failures are distinct states,
     * never an empty set.
     */
    handoffCandidates(input: KanbanHandoffCandidatesInput): Promise<HandoffCandidatesResult>
    /**
     * One batch handoff scan for the loaded items: the directory and each
     * qualifying file are read at most once, then matched against every item.
     * Read-only; failures are distinct states, never an empty set.
     */
    handoffAvailability(
      input: KanbanHandoffAvailabilityInput,
    ): Promise<KanbanHandoffAvailabilityResult>
  }
  taskProgress: {
    /** Fresh one-level scan of the fixed `<userData>/task-progress-adapters` directory. */
    adaptersList(): Promise<TaskProgressAdapterList>
    /** Stored binding; `adapterId` null keeps the saved field values. */
    getBinding(projectId: string): Promise<TaskProgressBinding>
    /**
     * Saves the adapter id and field values (validated against the manifest).
     * `null` removes the binding and keeps the stored values.
     */
    saveBinding(
      projectId: string,
      adapterId: string | null,
      config: Record<string, string>,
    ): Promise<void>
    /** Runs the adapter `test` action with the given, possibly unsaved, values; saves nothing. */
    test(
      projectId: string,
      adapterId: string,
      config: Record<string, string>,
    ): Promise<TaskProgressTestResult>
    /**
     * The full set of visible projects (selected or expanded in the left
     * navigation). Bound projects in the set are observed; the rest stop.
     */
    observe(projectIds: string[]): Promise<void>
    /** Current in-memory snapshot of the project, or null. */
    get(projectId: string): Promise<TaskProgressSnapshot | null>
    /** `taskProgress:changed` events; returns the unsubscribe function. */
    onChanged(callback: (event: TaskProgressChangedEvent) => void): Unsubscribe
  }
  agentProfiles: {
    /** Current global definitions selected by this project, in library order. */
    get(projectId: string): Promise<AgentProfilesDocument>
    libraryGet(): Promise<AgentProfilesLibrary>
    templatesGet(): Promise<AgentProfileTemplate[]>
    /** Creates or edits a global definition; never selects it for a project. */
    put(input: AgentProfilePut): Promise<AgentProfilesLibrary>
    /** Refuses a definition still selected in any project. */
    delete(profileId: string): Promise<AgentProfilesLibrary>
    selectionGet(projectId: string): Promise<AgentProjectSelection>
    selectionSet(
      projectId: string,
      input: AgentProjectSelectionInput,
    ): Promise<AgentProjectSelection>
  }
  dialogs: {
    /**
     * Opens the native directory picker (main process). Resolves the chosen
     * absolute path, or null when the user cancels. Persists nothing.
     */
    pickDirectory(defaultPath: string | null): Promise<string | null>
  }
}

/** Custom Linux shells belong to one project and its persisted distribution. */
export function projectWslShellsKey(projectId: string): string {
  return `project.wslShells:${projectId}`
}
