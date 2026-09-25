import type { ChatInfo, GitStatus, ProjectInfo, Unsubscribe } from '../../shared/ipc-contract'

// Real service registry (Stage 2: persistence; Stage 3: terminals + git;
// Stage 4: the chat entity). Terminal data/exit events are pushed to the
// renderer by the IPC layer; the registry only owns the service surface the
// handlers invoke.

export interface AppServices {
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
  }
  terminals: {
    /** Lazily spawns one PTY per chat (idempotent while the session lives). */
    create(chatId: string, cwd: string): string
    write(chatId: string, data: string): void
    resize(chatId: string, cols: number, rows: number): void
    /**
     * Per-chat teardown for the project-removal cascade (orphaned PTYs are
     * terminated in main); not part of the renderer bridge.
     */
    terminate(chatId: string): void
    /** App-quit teardown (spec Behaviour 8); not part of the renderer bridge. */
    terminateAll(): void
    onData(listener: (chatId: string, data: string) => void): Unsubscribe
    onExit(listener: (chatId: string, exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
  }
}
