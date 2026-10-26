import type {
  DesktopDictationSettings,
  DesktopDictationSetup,
} from '@shared/contracts/desktop-dictation-contract'
import type {
  ActionControl,
  ActionExecution,
  ActionInput,
  AgentProfilePut,
  AgentProfilesDocument,
  AgentProfilesLibrary,
  AgentProfileTemplate,
  AgentProjectSelection,
  AgentProjectSelectionInput,
  AppUpdateLatest,
  ChatInfo,
  CreateDictionaryEntryInput,
  DictationDictionary,
  DictationDictionaryEntry,
  DictationPostProcessingSettings,
  DictationResult,
  DictationSettings,
  DictationStart,
  DictationStatusSnapshot,
  FileEntry,
  FilePreview,
  GitFileStatuses,
  GitStatus,
  HandoffCandidatesResult,
  HandoffEntry,
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
  ProjectInfo,
  ShellInfo,
  SttProviderSummary,
  TaskProgressAdapterList,
  TaskProgressBinding,
  TaskProgressChangedEvent,
  TaskProgressSnapshot,
  TaskProgressTestResult,
  Unsubscribe,
  UpdateDictionaryEntryInput,
  WorkItem,
} from '@shared/ipc-contract'

// Real service registry (Stage 2: persistence; Stage 3: terminals + git;
// Stage 4: the chat entity). Terminal data/exit events are pushed to the
// renderer by the IPC layer; the registry only owns the service surface the
// handlers invoke.

export interface AppServices {
  usage: Pick<
    import('../services/usage/usage-service').UsageService,
    | 'listAdapters'
    | 'getSettings'
    | 'saveSettings'
    | 'read'
    | 'refresh'
    | 'test'
    | 'getEnabled'
    | 'setEnabled'
    | 'setVisible'
    | 'shutdown'
    | 'openAdaptersFolder'
  > & { pickFile(output: boolean): Promise<string | null> }
  appUpdate: {
    latest(): Promise<AppUpdateLatest>
    download(): Promise<void>
    launch(): Promise<void>
  }
  dictation: {
    desktopSetup(): DesktopDictationSetup
    desktopConfigure(settings: DesktopDictationSettings): DesktopDictationSetup
    desktopActivate(handle: string): Promise<void>
    status(): DictationStatusSnapshot
    testConnection(): Promise<DictationStatusSnapshot>
    refreshModels(): Promise<DictationStatusSnapshot>
    dictionaryList(
      projectId?: string,
    ):
      | Promise<DictationDictionaryEntry[] | DictationDictionary>
      | DictationDictionaryEntry[]
      | DictationDictionary
    getSettings(): DictationSettings
    setSettings(settings: DictationSettings): DictationSettings
    start(chatId: string, retrySessionId: string | null): DictationStart
    audio(sessionId: string, wav: ArrayBuffer): Promise<void>
    cancel(sessionId: string): void
    onResult(callback: (result: DictationResult) => void): Unsubscribe
    shutdown(): void

    providersList(): Promise<SttProviderSummary[]> | SttProviderSummary[]
    providersTestConnection(
      providerId: string,
      config?: Record<string, unknown>,
    ): Promise<{ ok: boolean; message: string }>
    providersDiscoverModels(
      providerId: string,
      config?: Record<string, unknown>,
    ): Promise<Array<{ id: string; name: string }>>
    providersGetConfig(
      providerId: string,
    ): Promise<Record<string, unknown>> | Record<string, unknown>
    providersSetConfig(providerId: string, config: Record<string, unknown>): Promise<void> | void
    getActiveProvider(): Promise<string> | string
    setActiveProvider(providerId: string): Promise<void> | void
    dictionaryAdd(
      entry: CreateDictionaryEntryInput,
    ): Promise<DictationDictionaryEntry> | DictationDictionaryEntry
    dictionaryUpdate(
      id: string,
      updates: UpdateDictionaryEntryInput,
    ): Promise<DictationDictionaryEntry> | DictationDictionaryEntry
    dictionaryDelete(id: string): Promise<void> | void
    dictionaryToggle(
      id: string,
      enabled: boolean,
    ): Promise<DictationDictionaryEntry> | DictationDictionaryEntry
    postProcessingGetSettings():
      | Promise<DictationPostProcessingSettings>
      | DictationPostProcessingSettings
    postProcessingSetSettings(settings: {
      mode: string
      level: string
      model?: string
      apiKey?: string
    }): Promise<void> | void
  }
  actions: {
    list(): ActionControl[]
    create(input: ActionInput): ActionControl
    update(id: string, input: ActionInput): ActionControl
    delete(id: string): void
    execute(id: string, projectId: string | null, confirmed: boolean): ActionExecution
    status(id: string): ActionExecution
    /**
     * Stops background children owned by a project after `projects:remove`.
     * Not part of the renderer bridge.
     */
    stopForProject(projectId: string): void
    /** Stops every active background child on application quit. */
    stopAll(): void
  }
  projects: {
    list(): ProjectInfo[]
    add(path: string): ProjectInfo
    wslDistributions(): string[]
    wslDirectories(distribution: string, linuxPath: string): string[]
    addWsl(distribution: string, linuxPath: string): ProjectInfo
    remove(projectId: string): void
  }
  chats: {
    list(projectId: string): ChatInfo[]
    /** Name is derived from the platform shell (spec Behaviour 3); duplicates allowed. */
    create(projectId: string): ChatInfo
    /**
     * Creates one `[shell] <profile name>` chat and starts the profile's agent
     * in its terminal (new-chat-agent-menu). Rolls the chat back and throws a
     * typed error when the agent cannot start.
     */
    createWithAgent(projectId: string, profileId: string): ChatInfo
    /** Removes one chat row (terminal-exit close flow, spec Behaviour 11). */
    remove(chatId: string): void
  }
  state: {
    get(key: string): string | null
    set(key: string, value: string): void
    /** Main-side cleanup of per-entity keys (removed project handoff dirs). */
    delete(key: string): void
  }
  terminals: {
    /**
     * Lazily spawns one PTY per chat (idempotent while the session lives).
     * Main resolves the id's project and spawns its stored shell (spec
     * project-shell-selection); the renderer payload is unchanged.
     */
    create(chatId: string, cwd: string): string
    write(chatId: string, data: string): void
    resize(chatId: string, cols: number, rows: number): void
    /** Display label of the project's resolved shell (fallback: platform default). */
    shellName(projectId: string): string
    /** Cached shell list; never probes (spec project-shell-selection). */
    shellList(projectId?: string | null): ShellInfo[]
    /** One explicit detection run; replaces the cache, prunes dead custom paths. */
    shellDetect(projectId?: string | null): ShellInfo[]
    /** Validates and adds an absolute executable path as a custom shell. */
    shellAddCustom(path: string, projectId?: string | null): ShellInfo
    /**
     * Per-session teardown. The renderer bridge exposes this only for bottom
     * tab ids. Project removal and chat close call it in main.
     */
    terminate(chatId: string): void
    /** Bottom-tab PTYs whose id belongs to the removed project. */
    terminateProjectBottom(projectId: string): void
    /** App-quit teardown (spec Behaviour 8); not part of the renderer bridge. */
    terminateAll(): void
    /** App-quit wait. A seven-second report does not settle this promise. */
    shutdown(reportTimeout?: (error: unknown) => void): Promise<void>
    onData(listener: (chatId: string, data: string) => void): Unsubscribe
    onExit(listener: (chatId: string, exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectId: string): Promise<GitStatus>
    /**
     * Per-path working-tree status for the file-tree decoration (NEKODE-31).
     * One read-only call; any failure degrades to the empty map.
     */
    fileStatuses(projectId: string): Promise<GitFileStatuses>
    sync(projectId: string): Promise<void>
  }
  files: {
    /** One directory level of the project tree (null = project root). */
    list(projectId: string, relativePath: string | null): Promise<FileEntry[]>
    /** Read-only preview classification of one project file. */
    read(projectId: string, relativePath: string): Promise<FilePreview>
    /** Opens the file with the OS default application (main-process only). */
    openExternal(projectId: string, relativePath: string): Promise<void>
    /**
     * Opens the registered project root in the OS file manager. Unknown
     * project or missing root directory: not_found.
     */
    openRoot(projectId: string): Promise<void>
    showInFolder(projectId: string, relativePath: string): Promise<void>
    trash(projectId: string, relativePath: string): Promise<void>
  }
  handoffs: {
    /** Regular files of the project's configured handoff directory, newest first. */
    list(projectId: string): Promise<HandoffEntry[]>
    resumePrompt(projectId: string, handoffPath: string): Promise<string>
  }
  kanban: {
    /** Adapters discovered in the configured adapters directory (fresh scan). */
    adaptersList(): KanbanAdapterInfo[]
    /** Binding + stored values; secret values never leave main. */
    getConfig(projectId: string): KanbanProjectConfig
    /** Persists binding and values (empty string clears; missing secret key keeps). */
    setConfig(
      projectId: string,
      config: { adapterId: string | null; values: Record<string, string> },
    ): void
    /** Adapter `test` invocation; optional unsaved-values override. */
    test(projectId: string, values?: Record<string, string>): Promise<void>
    /** Normalized states + items of the bound adapter's backend. */
    listBoard(projectId: string): Promise<KanbanBoard>
    /** `revision` is the `local-file` document revision; process adapters ignore it. */
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
    /** Creates `.nekode/tasks.json` when absent, then binds `local-file`. */
    bindLocalFile(projectId: string): Promise<void>
    /** Whether `.agents/skills/nekode-tasks/SKILL.md` exists under the project root. */
    skillStatus(projectId: string): Promise<KanbanSkillStatus>
    /** Writes the skill file for the bound source; main builds its text. */
    writeSkill(projectId: string): Promise<void>
    /** Adapter `getItem` `{ ref }`. Not the cached board. */
    getItem(projectId: string, ref: string): Promise<WorkItem>
    /** Comments for one work item via the adapter `listComments` action (`{ ref }`). */
    getComments(projectId: string, ref: string): Promise<KanbanComment[]>
    /** Start one task chat. Same attempt id returns the same chat. */
    launchTask(input: KanbanLaunchTaskInput): Promise<KanbanLaunchResult>
    /** One handoff scan for an item. Read-only; failures are distinct states. */
    handoffCandidates(input: KanbanHandoffCandidatesInput): Promise<HandoffCandidatesResult>
    /**
     * One batch handoff scan for the loaded items: one directory read and at
     * most one read per qualifying file, matched against every item.
     */
    handoffAvailability(
      input: KanbanHandoffAvailabilityInput,
    ): Promise<KanbanHandoffAvailabilityResult>
    /** Per-project key cleanup on projects:remove; not on the renderer bridge. */
    cleanupProject(projectId: string): void
    /** Drops in-flight Start launches for a removed project. Not on the renderer bridge. */
    dropLaunchProject(projectId: string): void
    /**
     * True while a launch chat is waiting for a profile spawn. Renderer
     * `terminals:create` must not start the project shell for that chat.
     */
    blocksProjectShell(chatId: string): boolean
  }
  taskProgress: {
    /** Fresh scan of the fixed task progress adapters directory. */
    adaptersList(): TaskProgressAdapterList
    getBinding(projectId: string): TaskProgressBinding
    saveBinding(projectId: string, adapterId: string | null, config: Record<string, string>): void
    /** Adapter `test` action with possibly unsaved values; persists nothing. */
    test(
      projectId: string,
      adapterId: string,
      config: Record<string, string>,
    ): Promise<TaskProgressTestResult>
    /** Full visible project set; bound ones are observed, the rest stop. */
    observe(projectIds: string[]): void
    get(projectId: string): TaskProgressSnapshot | null
    /** taskProgress:changed source; not on the renderer bridge. */
    onChanged(callback: (event: TaskProgressChangedEvent) => void): Unsubscribe
    /** Any window visible and not minimized (spec Behaviour 18); not on the bridge. */
    setVisible(visible: boolean): void
    /** App quit: stop observations, kill adapter processes; not on the bridge. */
    shutdown(): void
    /** Per-project key cleanup on projects:remove; not on the renderer bridge. */
    cleanupProject(projectId: string): void
  }
  agentProfiles: {
    /** Selected current global definitions, in library order. */
    get(projectId: string): AgentProfilesDocument
    libraryGet(): AgentProfilesLibrary
    templatesGet(): AgentProfileTemplate[]
    put(input: AgentProfilePut): AgentProfilesLibrary
    delete(profileId: string): AgentProfilesLibrary
    selectionGet(projectId: string): AgentProjectSelection
    selectionSet(projectId: string, input: AgentProjectSelectionInput): AgentProjectSelection
    /** Per-project key cleanup on projects:remove; not on the renderer bridge. */
    cleanupProject(projectId: string): void
  }
  dialogs: {
    /**
     * Native directory picker behind the typed channel; the OS dialog is
     * injected at the composition root (shell/dialog stay out of
     * create-services). Absolute path or null on cancel.
     */
    pickDirectory(defaultPath: string | null): Promise<string | null>
  }
  /** Closes the SQLite database connection on application quit. */
  closeDatabase?(): void
}
