import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '../../../shared/bottom-tab-id'
import type { Unsubscribe } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Chat terminal sessions (spec Data/API, SDD §17): one PTY process per chat,
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
  chatId: string
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

/**
 * Display label for a shell (spec Behaviour 3: a chat is named after its
 * shell, e.g. "PowerShell" on Windows). Derived from the same ShellSpec the
 * PTY spawns with, so the chat name and the terminal can never disagree.
 */
export function shellDisplayName(shell: ShellSpec = defaultShell()): string {
  const base = basename(shell.file).replace(/\.(exe|com|cmd|bat)$/i, '')
  // PowerShell keeps its product casing; other shells use their binary name.
  return /^powershell$/i.test(base) ? 'PowerShell' : base
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
  readonly #dataListeners = new Set<(chatId: string, data: string) => void>()
  readonly #exitListeners = new Set<(chatId: string, exitCode: number) => void>()
  // Bottom-tab ids closed before their create IPC arrived. create() refuses
  // them once so a late spawn cannot outlive the tab. Chat ids are not recorded.
  readonly #closedBottomTabs = new Set<string>()
  #quitting = false

  constructor(options: TerminalServiceOptions) {
    this.#createPty = options.createPty
    this.#isDirectory = options.isDirectory ?? defaultIsDirectory
    this.#shell = options.shell ?? defaultShell()
    this.#cols = options.cols ?? 80
    this.#rows = options.rows ?? 24
  }

  /**
   * Lazily spawns the chat's PTY on first attach. Idempotent per chatId while
   * the session is alive (one PTY per chat, spec Business rules); an exited
   * session is replaced by a fresh process (spec Edge cases). The optional
   * shell override (spec project-shell-selection) is resolved by the caller —
   * main resolves the project's stored choice; absent means the service
   * default (platform default, unchanged).
   */
  create(chatId: string, cwd: string, shell?: ShellSpec): string {
    if (this.#quitting) {
      throw new AppError('conflict', 'The application is closing.')
    }
    if (this.#closedBottomTabs.has(chatId)) {
      this.#closedBottomTabs.delete(chatId)
      throw new AppError('conflict', 'The terminal was closed before it started.')
    }
    const existing = this.#sessions.get(chatId)
    if (existing !== undefined && existing.status === 'running') {
      return existing.chatId
    }
    if (existing !== undefined) {
      this.#disposeSession(existing)
      this.#sessions.delete(chatId)
    }
    if (!this.#isDirectory(cwd)) {
      throw new AppError(
        'not_found',
        'The project directory does not exist. Terminal sessions need an existing project directory.',
      )
    }

    const shellSpec = shell ?? this.#shell
    let pty: PtyProcessLike
    try {
      pty = this.#createPty({
        file: shellSpec.file,
        args: [...shellSpec.args],
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
      chatId,
      pty,
      status: 'running',
      exitCode: null,
      subscriptions: [],
    }
    session.subscriptions.push(
      pty.onData((data) => {
        for (const listener of this.#dataListeners) {
          listener(chatId, data)
        }
      }),
    )
    session.subscriptions.push(
      pty.onExit((event) => {
        // Quit teardown must never look like a chat exit: while quitting (and
        // after any teardown disposed this subscription) exit events are
        // dropped, so the renderer's chat-close flow (spec Behaviour 11) is
        // never triggered by application quit (spec Behaviour 8).
        if (session.status === 'exited' || this.#quitting) {
          return
        }
        session.status = 'exited'
        session.exitCode = event.exitCode
        for (const listener of this.#exitListeners) {
          listener(chatId, event.exitCode)
        }
      }),
    )
    this.#sessions.set(chatId, session)
    return session.chatId
  }

  /** Delivers renderer input to the chat's PTY, hidden or not (spec Edge cases). */
  write(chatId: string, data: string): void {
    const session = this.#requireRunning(chatId)
    session.pty.write(data)
  }

  resize(chatId: string, cols: number, rows: number): void {
    const session = this.#requireRunning(chatId)
    session.pty.resize(cols, rows)
  }

  /** Terminates one session; safe to call repeatedly. */
  terminate(chatId: string): void {
    if (isBottomTabId(chatId)) {
      this.#closedBottomTabs.add(chatId)
    }
    const session = this.#sessions.get(chatId)
    if (session === undefined) {
      return
    }
    this.#disposeSession(session)
    this.#sessions.delete(chatId)
  }

  /** Project removal: kill bottom-tab PTYs of that project and no others. */
  terminateProjectBottom(projectId: string): void {
    for (const sessionId of [...this.#sessions.keys()]) {
      if (bottomTabProjectId(sessionId) === projectId) {
        this.terminate(sessionId)
      }
    }
  }

  /** Display label of the shell this service spawns. */
  shellName(): string {
    return shellDisplayName(this.#shell)
  }

  /**
   * App-quit teardown (spec Behaviour 8): no orphaned shell processes and no
   * chat deletions. Exit events raised by this destruction are suppressed
   * (#quitting, plus subscriptions disposed before kill) so the renderer
   * never starts the chat-close flow while the application quits.
   */
  terminateAll(): void {
    this.#quitting = true
    for (const session of [...this.#sessions.values()]) {
      this.#disposeSession(session)
    }
    this.#sessions.clear()
  }

  onData(listener: (chatId: string, data: string) => void): Unsubscribe {
    this.#dataListeners.add(listener)
    return () => {
      this.#dataListeners.delete(listener)
    }
  }

  onExit(listener: (chatId: string, exitCode: number) => void): Unsubscribe {
    this.#exitListeners.add(listener)
    return () => {
      this.#exitListeners.delete(listener)
    }
  }

  /** Test/debug helper: whether a live (running) session exists for a chat. */
  hasRunningSession(chatId: string): boolean {
    return this.#sessions.get(chatId)?.status === 'running'
  }

  #requireRunning(chatId: string): TerminalSession {
    const session = this.#sessions.get(chatId)
    if (session === undefined) {
      throw new AppError('not_found', 'No terminal session exists for this chat.')
    }
    if (session.status === 'exited') {
      // Writes racing a session exit are expected during fast chat switches;
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
