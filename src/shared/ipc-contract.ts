import type { ActionControl, ActionExecution, ActionInput } from './contracts/actions-contract'
import type {
  AgentProfilePut,
  AgentProfilesDocument,
  AgentProfilesLibrary,
  AgentProfileTemplate,
  AgentProjectSelection,
  AgentProjectSelectionInput,
} from './contracts/agent-profiles-contract'
import type { AppUpdateLatest } from './contracts/app-update-contract'
import type { ChatInfo } from './contracts/chats-contract'
import type {
  DesktopDictationSettings,
  DesktopDictationSetup,
} from './contracts/desktop-dictation-contract'
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
} from './contracts/dictation-contract'
import type { FileEntry, FilePreview } from './contracts/files-contract'
import type { GitFileStatuses, GitStatus } from './contracts/git-contract'
import type { HandoffCandidatesResult, HandoffEntry } from './contracts/handoffs-contract'
import type {
  KanbanAdapterInfo,
  KanbanBoard,
  KanbanComment,
  KanbanCreateInput,
  KanbanHandoffAvailabilityInput,
  KanbanHandoffAvailabilityResult,
  KanbanHandoffCandidatesInput,
  KanbanItemWriteResult,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  KanbanProjectConfig,
  KanbanSkillStatus,
  KanbanUpdatePatch,
  WorkItem,
} from './contracts/kanban-contract'
import type { ProjectInfo } from './contracts/projects-contract'
import type { ShellInfo } from './contracts/shell-contract'
import type {
  TaskProgressAdapterList,
  TaskProgressBinding,
  TaskProgressChangedEvent,
  TaskProgressSnapshot,
  TaskProgressTestResult,
} from './contracts/task-progress-contract'

export * from './contracts/actions-contract'
export * from './contracts/agent-profiles-contract'
export * from './contracts/app-state-contract'
export * from './contracts/app-update-contract'
export * from './contracts/chats-contract'
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
} from './contracts/dictation-contract'
export * from './contracts/files-contract'
export * from './contracts/git-contract'
export * from './contracts/handoffs-contract'
export * from './contracts/kanban-contract'
export * from './contracts/projects-contract'
export * from './contracts/shell-contract'
export * from './contracts/task-progress-contract'

// Typed IPC contract shared by main, preload and renderer (SDD §6, §44).
// Every channel is served by a real service in main: projects/chats/state by
// the SQLite persistence services, terminals by real PTY sessions
// (TerminalService) and git:status by the git service.

export type Unsubscribe = () => void

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
    /** Download and checksum the latest published Windows installer when it is newer. */
    download(): Promise<void>
    /** Start the checked installer with no arguments, then quit NeKode. */
    launch(): Promise<void>
  }
  usage: import('./contracts/usage-contract').UsageApi
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
