import type { GitStatus, ProjectInfo, TaskInfo, Unsubscribe } from '../../shared/ipc-contract'

// Real service registry (Stage 2: persistence; Stage 3: terminals + git).
// Terminal data/exit events are pushed to the renderer by the IPC layer;
// the registry only owns the service surface the handlers invoke.

export interface AppServices {
  projects: {
    list(): ProjectInfo[]
    add(path: string): ProjectInfo
    remove(projectId: string): void
  }
  tasks: {
    list(projectId: string): TaskInfo[]
    create(projectId: string, name: string): TaskInfo
  }
  state: {
    get(key: string): string | null
    set(key: string, value: string): void
  }
  terminals: {
    /** Lazily spawns one PTY per task (idempotent while the session lives). */
    create(taskId: string, cwd: string): string
    write(taskId: string, data: string): void
    resize(taskId: string, cols: number, rows: number): void
    /**
     * Per-task teardown for the project-removal cascade (orphaned PTYs are
     * terminated in main); not part of the renderer bridge.
     */
    terminate(taskId: string): void
    /** App-quit teardown (spec Behaviour 8); not part of the renderer bridge. */
    terminateAll(): void
    onData(listener: (taskId: string, data: string) => void): Unsubscribe
    onExit(listener: (taskId: string, exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
  }
}
