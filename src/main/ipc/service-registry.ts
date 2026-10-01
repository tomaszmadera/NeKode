import type {
  ActionControl,
  ActionExecution,
  ActionInput,
  ChatInfo,
  FileEntry,
  FilePreview,
  GitStatus,
  HandoffEntry,
  ProjectInfo,
  Unsubscribe,
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
    /** Lazily spawns one PTY per chat (idempotent while the session lives). */
    create(chatId: string, cwd: string): string
    write(chatId: string, data: string): void
    resize(chatId: string, cols: number, rows: number): void
    /** Display label of the shell new sessions spawn. */
    shellName(): string
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
  dialogs: {
    /**
     * Native directory picker behind the typed channel; the OS dialog is
     * injected at the composition root (shell/dialog stay out of
     * create-services). Absolute path or null on cancel.
     */
    pickDirectory(defaultPath: string | null): Promise<string | null>
  }
}
