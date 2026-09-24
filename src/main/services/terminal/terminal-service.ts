import { statSync } from 'node:fs'
import type { Unsubscribe } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Task terminal sessions (spec Data/API, SDD §17): one PTY process per task,
// spawned lazily on the first terminal attach. The renderer never touches
// node-pty; this service is the only owner of PTY processes. The PTY factory
// is injected so unit tests run against a fake PTY (no real processes).

export interface PtyProcessLike {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export type PtyFactory = (options: PtySpawnOptions) => PtyProcessLike

export interface ShellSpec {
  file: string
  args: string[]
}

type SessionStatus = 'running' | 'exited'

interface TerminalSession {
  taskId: string
  pty: PtyProcessLike
  status: SessionStatus
  exitCode: number | null
  subscriptions: Array<{ dispose(): void }>
}

export interface TerminalServiceOptions {
  /** Injected PTY spawner (node-pty in production, a fake in tests). */
  createPty: PtyFactory
  /** Directory existence check; injectable for tests. */
  isDirectory?: (path: string) => boolean
  /** Shell to spawn; defaults to PowerShell on Windows. */
  shell?: ShellSpec
  /** Initial PTY geometry; the renderer resizes on attach. */
  cols?: number
  rows?: number
}

/** The user's default shell: PowerShell on Windows, $SHELL elsewhere. */
export function defaultShell(): ShellSpec {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: process.env.SHELL ?? '/bin/bash', args: [] }
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export class TerminalService {
  readonly #createPty: PtyFactory
  readonly #isDirectory: (path: string) => boolean
  readonly #shell: ShellSpec
  readonly #cols: number
  readonly #rows: number
  readonly #sessions = new Map<string, TerminalSession>()
  readonly #dataListeners = new Set<(taskId: string, data: string) => void>()
  readonly #exitListeners = new Set<(taskId: string, exitCode: number) => void>()

  constructor(options: TerminalServiceOptions) {
    this.#createPty = options.createPty
    this.#isDirectory = options.isDirectory ?? defaultIsDirectory
    this.#shell = options.shell ?? defaultShell()
    this.#cols = options.cols ?? 80
    this.#rows = options.rows ?? 24
  }

  /**
   * Lazily spawns the task's PTY on first attach. Idempotent per taskId while
   * the session is alive (one PTY per task, spec Business rules); an exited
   * session is replaced by a fresh process (spec Edge cases).
   */
  create(taskId: string, cwd: string): string {
    const existing = this.#sessions.get(taskId)
    if (existing !== undefined && existing.status === 'running') {
      return existing.taskId
    }
    if (existing !== undefined) {
      this.#disposeSession(existing)
      this.#sessions.delete(taskId)
    }
    if (!this.#isDirectory(cwd)) {
      throw new AppError(
        'not_found',
        'The project directory does not exist. Terminal sessions need an existing project directory.',
      )
    }

    let pty: PtyProcessLike
    try {
      pty = this.#createPty({
        file: this.#shell.file,
        args: [...this.#shell.args],
        cwd,
        cols: this.#cols,
        rows: this.#rows,
        env: { ...process.env } as Record<string, string>,
      })
    } catch (error) {
      // Full details stay on the main side; the renderer gets the typed error.
      console.error('[terminal] failed to spawn PTY:', error)
      throw new AppError('unknown', 'Failed to start the terminal process.')
    }

    const session: TerminalSession = {
      taskId,
      pty,
      status: 'running',
      exitCode: null,
      subscriptions: [],
    }
    session.subscriptions.push(
      pty.onData((data) => {
        for (const listener of this.#dataListeners) {
          listener(taskId, data)
        }
      }),
    )
    session.subscriptions.push(
      pty.onExit((event) => {
        if (session.status === 'exited') {
          return
        }
        session.status = 'exited'
        session.exitCode = event.exitCode
        for (const listener of this.#exitListeners) {
          listener(taskId, event.exitCode)
        }
      }),
    )
    this.#sessions.set(taskId, session)
    return session.taskId
  }

  /** Delivers renderer input to the task's PTY, hidden or not (spec Edge cases). */
  write(taskId: string, data: string): void {
    const session = this.#requireRunning(taskId)
    session.pty.write(data)
  }

  resize(taskId: string, cols: number, rows: number): void {
    const session = this.#requireRunning(taskId)
    session.pty.resize(cols, rows)
  }

  /** Terminates one session; safe to call repeatedly. */
  terminate(taskId: string): void {
    const session = this.#sessions.get(taskId)
    if (session === undefined) {
      return
    }
    this.#disposeSession(session)
    this.#sessions.delete(taskId)
  }

  /** App-quit teardown (spec Behaviour 8): no orphaned shell processes. */
  terminateAll(): void {
    for (const session of [...this.#sessions.values()]) {
      this.#disposeSession(session)
    }
    this.#sessions.clear()
  }

  onData(listener: (taskId: string, data: string) => void): Unsubscribe {
    this.#dataListeners.add(listener)
    return () => {
      this.#dataListeners.delete(listener)
    }
  }

  onExit(listener: (taskId: string, exitCode: number) => void): Unsubscribe {
    this.#exitListeners.add(listener)
    return () => {
      this.#exitListeners.delete(listener)
    }
  }

  /** Test/debug helper: whether a live (running) session exists for a task. */
  hasRunningSession(taskId: string): boolean {
    return this.#sessions.get(taskId)?.status === 'running'
  }

  #requireRunning(taskId: string): TerminalSession {
    const session = this.#sessions.get(taskId)
    if (session === undefined) {
      throw new AppError('not_found', 'No terminal session exists for this task.')
    }
    if (session.status === 'exited') {
      // Writes racing a session exit are expected during fast task switches;
      // they reject as a typed conflict and the renderer drops the input.
      throw new AppError('conflict', 'The terminal session has ended.')
    }
    return session
  }

  #disposeSession(session: TerminalSession): void {
    for (const subscription of session.subscriptions) {
      try {
        subscription.dispose()
      } catch {
        // Cleanup must stay idempotent even if a subscription already died.
      }
    }
    session.subscriptions = []
    try {
      session.pty.kill()
    } catch {
      // The process may already be gone (exited session); kill stays idempotent.
    }
  }
}
