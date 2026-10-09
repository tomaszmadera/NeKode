import type {
  ActionControl,
  ActionExecution,
  ActionInput,
  AgentProfilePut,
  AgentProfilesDocument,
  ChatInfo,
  FileEntry,
  FilePreview,
  GitStatus,
  HandoffCandidatesResult,
  HandoffEntry,
  KanbanAdapterInfo,
  KanbanBoard,
  KanbanCreateInput,
  KanbanHandoffAvailabilityInput,
  KanbanHandoffAvailabilityResult,
  KanbanHandoffCandidatesInput,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  KanbanProjectConfig,
  KanbanUpdatePatch,
  ProjectInfo,
  ShellInfo,
  Unsubscribe,
  WorkItem,
} from '../../shared/ipc-contract'

// Real service registry (Stage 2: persistence; Stage 3: terminals + git;
// Stage 4: the chat entity). Terminal data/exit events are pushed to the
// renderer by the IPC layer; the registry only owns the service surface the
// handlers invoke.

export interface AppServices {
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
  }
  projects: {
    list(): ProjectInfo[]
    add(path: string): ProjectInfo
    wslDistributions(): string[]
    addWsl(distribution: string, linuxPath: string): ProjectInfo
    remove(projectId: string): void
  }
  chats: {
    list(projectId: string): ChatInfo[]
    /** Name is derived from the platform shell (spec Behaviour 3); duplicates allowed. */
    create(projectId: string): ChatInfo
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
    onData(listener: (chatId: string, data: string) => void): Unsubscribe
    onExit(listener: (chatId: string, exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
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
  }
  handoffs: {
    /** Regular files of the project's configured handoff directory, newest first. */
    list(projectId: string): Promise<HandoffEntry[]>
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
    createItem(projectId: string, input: KanbanCreateInput): Promise<WorkItem>
    updateItem(projectId: string, ref: string, patch: KanbanUpdatePatch): Promise<WorkItem>
    /** Adapter `getItem` `{ ref }`. Not the cached board. */
    getItem(projectId: string, ref: string): Promise<WorkItem>
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
  agentProfiles: {
    /** This project's document. Missing key reads as an empty document. */
    get(projectId: string): AgentProfilesDocument
    /** Creates or updates one profile. Invalid fields do not write. */
    put(projectId: string, input: AgentProfilePut): AgentProfilesDocument
    /** Deletes one profile. Deleting the default clears defaultId. */
    delete(projectId: string, profileId: string): AgentProfilesDocument
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
}
