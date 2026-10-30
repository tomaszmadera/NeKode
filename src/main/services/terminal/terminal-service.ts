import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '@shared/bottom-tab-id'
import type { Unsubscribe } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { prepareWslTerminal, validateWslExecutable, validateWslExecutableAsync } from './wsl'

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
  /** Executable base name, lower case, without a Windows suffix. */
  commandName: string
  status: SessionStatus
  exitCode: number | null
  /** Recent PTY bytes, kept so a quit banner split across reads still matches. */
  rawTail: string
  grokExitTimer: ReturnType<typeof setTimeout> | null
  subscriptions: Array<{ dispose(): void }>
}

/**
 * Grok's TUI prints this and leaves the alternate screen, then under ConPTY
 * the process stays alive, so the PTY never emits exit and the chat stays
 * open on a dead terminal. Measured with grok 1.0.70 on this host.
 */
export const GROK_EXIT_GRACE_MS = 250
const GROK_EXIT_TAIL = 1024
const GROK_SESSION_ENDED = /Resume this session with:\r?\n[ \t]+grok(?: --minimal)? --resume \S+/

export function commandBaseName(file: string): string {
  return basename(file)
    .replace(/\.(exe|com|cmd|bat)$/i, '')
    .toLowerCase()
}

/** True when `text` contains Grok's interactive quit banner. */
export function grokSessionEnded(text: string): boolean {
  return GROK_SESSION_ENDED.test(stripTerminalControls(text))
}

/** Drops CSI and OSC sequences so a quit banner can match around terminal modes. */
function stripTerminalControls(text: string): string {
  let result = ''
  let index = 0
  while (index < text.length) {
    if (text.charCodeAt(index) !== 0x1b) {
      result += text[index]
      index += 1
      continue
    }
    const kind = text[index + 1]
    if (kind === '[') {
      index += 2
      while (index < text.length && text.charCodeAt(index) < 0x40) {
        index += 1
      }
      if (index < text.length) {
        index += 1
      }
      continue
    }
    if (kind === ']') {
      index += 2
      while (index < text.length) {
        const code = text.charCodeAt(index)
        index += 1
        if (code === 0x07) {
          break
        }
        if (code === 0x1b && text[index] === '\\') {
          index += 1
          break
        }
      }
      continue
    }
    index += 1
  }
  return result
}

/** Maximum time a terminated bottom tab ID is kept to guard against racing create IPCs. */
export const CLOSED_BOTTOM_TAB_TTL_MS = 30_000
/** Maximum capacity of the closed bottom tab cache. */
export const MAX_CLOSED_BOTTOM_TABS = 100

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
  /** Timestamp generator; injectable for tests. */
  now?: () => number
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
  readonly #pendingCreates = new Map<string, { cancelled: boolean; promise: Promise<string> }>()
  readonly #dataListeners = new Set<(chatId: string, data: string) => void>()
  readonly #exitListeners = new Set<(chatId: string, exitCode: number) => void>()
  readonly #now: () => number
  // Bottom-tab ids closed before their create IPC arrived. create() refuses
  // them once so a late spawn cannot outlive the tab. Chat ids are not recorded.
  // Entries are timestamped, pruned by TTL, and bounded to prevent unbounded growth.
  readonly #closedBottomTabs = new Map<string, number>()
  #quitting = false
  #shutdown: Promise<void> | undefined

  constructor(options: TerminalServiceOptions) {
    this.#createPty = options.createPty
    this.#isDirectory = options.isDirectory ?? defaultIsDirectory
    this.#shell = options.shell ?? defaultShell()
    this.#cols = options.cols ?? 80
    this.#rows = options.rows ?? 24
    this.#now = options.now ?? Date.now
  }

  /**
   * Lazily spawns the chat's PTY on first attach. Idempotent per chatId while
   * the session is alive (one PTY per chat, spec Business rules); an exited
   * session is replaced by a fresh process (spec Edge cases). The optional
   * shell override can be a resolver, evaluated only for a new process.
   * Main resolves the project's stored choice; absent means the service
   * default (platform default, unchanged).
   */
  create(chatId: string, cwd: string, shell?: ShellSpec | (() => ShellSpec)): string {
    return this.#create(chatId, cwd, shell, false)
  }

  createAsync(
    chatId: string,
    cwd: string,
    shell?: ShellSpec | (() => ShellSpec | Promise<ShellSpec>),
  ): Promise<string> {
    if (this.#quitting)
      return Promise.reject(new AppError('conflict', 'The application is closing.'))
    const existing = this.#sessions.get(chatId)
    if (existing?.status === 'running') return Promise.resolve(existing.chatId)
    const pending = this.#pendingCreates.get(chatId)
    if (pending) return pending.promise
    const closedAt = this.#closedBottomTabs.get(chatId)
    if (closedAt !== undefined) {
      this.#closedBottomTabs.delete(chatId)
      if (this.#now() - closedAt <= CLOSED_BOTTOM_TAB_TTL_MS) {
        return Promise.reject(
          new AppError('conflict', 'The terminal was closed before it started.'),
        )
      }
    }
    if (!this.#isDirectory(cwd)) {
      return Promise.reject(
        new AppError(
          'not_found',
          'The project directory does not exist. Terminal sessions need an existing project directory.',
        ),
      )
    }
    const entry = { cancelled: false, promise: undefined as unknown as Promise<string> }
    entry.promise = (async () => {
      const resolvedShell = typeof shell === 'function' ? await shell() : shell
      if (resolvedShell !== undefined) await validateWslExecutableAsync(cwd, resolvedShell)
      if (this.#quitting) throw new AppError('conflict', 'The application is closing.')
      if (entry.cancelled)
        throw new AppError('conflict', 'The terminal was closed before it started.')
      return this.#create(chatId, cwd, resolvedShell, true)
    })().finally(() => {
      if (this.#pendingCreates.get(chatId) === entry) this.#pendingCreates.delete(chatId)
    })
    this.#pendingCreates.set(chatId, entry)
    return entry.promise
  }

  #create(
    chatId: string,
    cwd: string,
    shell: ShellSpec | (() => ShellSpec) | undefined,
    validated: boolean,
  ): string {
    if (this.#quitting) {
      throw new AppError('conflict', 'The application is closing.')
    }
    const closedAt = this.#closedBottomTabs.get(chatId)
    if (closedAt !== undefined) {
      this.#closedBottomTabs.delete(chatId)
      if (this.#now() - closedAt <= CLOSED_BOTTOM_TAB_TTL_MS) {
        throw new AppError('conflict', 'The terminal was closed before it started.')
      }
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

    const resolvedShell = typeof shell === 'function' ? shell() : shell
    const wsl = prepareWslTerminal(cwd, resolvedShell)
    if (resolvedShell !== undefined && !validated) validateWslExecutable(cwd, resolvedShell)
    const shellSpec = wsl ?? resolvedShell ?? this.#shell
    let pty: PtyProcessLike
    try {
      pty = this.#createPty({
        file: shellSpec.file,
        args: [...shellSpec.args],
        cwd: wsl?.cwd ?? cwd,
        cols: this.#cols,
        rows: this.#rows,
        env: { ...process.env } as Record<string, string>,
      })
    } catch {
      // A node-pty error can carry the command line. Task launch puts the
      // prompt in argv, so the log stays a fixed string.
      console.error('[terminal] failed to spawn PTY')
      throw new AppError('unknown', 'Failed to start the terminal process.')
    }

    const session: TerminalSession = {
      chatId,
      pty,
      commandName: commandBaseName(shellSpec.file),
      status: 'running',
      exitCode: null,
      rawTail: '',
      grokExitTimer: null,
      subscriptions: [],
    }
    session.subscriptions.push(
      pty.onData((data) => {
        for (const listener of this.#dataListeners) {
          listener(chatId, data)
        }
        this.#watchGrokExit(session, data)
      }),
    )
    session.subscriptions.push(
      pty.onExit((event) => {
        // Quit teardown must never look like a chat exit: while quitting (and
        // after any teardown disposed this subscription) exit events are
        // dropped, so the renderer's chat-close flow (spec Behaviour 11) is
        // never triggered by application quit (spec Behaviour 8).
        this.#clearGrokExitTimer(session)
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
    const pending = this.#pendingCreates.get(chatId)
    if (pending) pending.cancelled = true
    if (isBottomTabId(chatId)) {
      const now = this.#now()
      this.#pruneClosedBottomTabs(now)
      this.#closedBottomTabs.set(chatId, now)
      if (this.#closedBottomTabs.size > MAX_CLOSED_BOTTOM_TABS) {
        const oldest = this.#closedBottomTabs.keys().next().value
        if (oldest !== undefined) {
          this.#closedBottomTabs.delete(oldest)
        }
      }
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
    for (const sessionId of this.#pendingCreates.keys()) {
      if (bottomTabProjectId(sessionId) === projectId) this.terminate(sessionId)
    }
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
    for (const pending of this.#pendingCreates.values()) pending.cancelled = true
    this.#closedBottomTabs.clear()
    for (const session of [...this.#sessions.values()]) {
      this.#disposeSession(session)
    }
    this.#sessions.clear()
  }

  #pruneClosedBottomTabs(now: number): void {
    for (const [id, timestamp] of this.#closedBottomTabs) {
      if (now - timestamp > CLOSED_BOTTOM_TAB_TTL_MS) {
        this.#closedBottomTabs.delete(id)
      } else {
        break
      }
    }
  }

  /**
   * Wait for native exit callbacks before Electron destroys the Node environment.
   * If a PTY has not exited by seven seconds, the timeout is reported and the
   * wait settles so the application can finish quitting.
   */
  shutdown(reportTimeout?: (error: unknown) => void): Promise<void> {
    if (this.#shutdown) return this.#shutdown
    this.#quitting = true
    let reported = false
    const exits = [...this.#sessions.values()]
      .filter((session) => session.status === 'running')
      .map(
        (session) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (!reported) {
                reported = true
                reportTimeout?.(new Error('Terminal shutdown timed out.'))
              }
              try {
                session.pty.kill()
              } catch {
                // The process may already be gone; kill stays idempotent.
              }
              subscription.dispose()
              resolve()
            }, 7000)
            const subscription = session.pty.onExit(() => {
              clearTimeout(timer)
              subscription.dispose()
              resolve()
            })
          }),
      )
    const pendingCreates = [...this.#pendingCreates.values()].map((entry) =>
      entry.promise.catch(() => undefined),
    )
    this.#shutdown = Promise.all([...exits, ...pendingCreates]).then(() => undefined)
    this.terminateAll()
    return this.#shutdown
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

  /** Test/debug helper: number of tracked closed bottom tabs. */
  closedBottomTabsCount(): number {
    return this.#closedBottomTabs.size
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

  /**
   * A Grok quit banner means the TUI has finished. Give the process a moment
   * to exit on its own, then kill it so the normal exit path can close the chat.
   */
  #watchGrokExit(session: TerminalSession, data: string): void {
    if (session.commandName !== 'grok' || session.grokExitTimer !== null || this.#quitting) {
      return
    }
    session.rawTail = (session.rawTail + data).slice(-GROK_EXIT_TAIL)
    if (!grokSessionEnded(session.rawTail)) {
      return
    }
    session.grokExitTimer = setTimeout(() => {
      session.grokExitTimer = null
      if (session.status !== 'running' || this.#quitting) {
        return
      }
      try {
        session.pty.kill()
      } catch {
        // The process may already be gone.
      }
    }, GROK_EXIT_GRACE_MS)
  }

  #clearGrokExitTimer(session: TerminalSession): void {
    if (session.grokExitTimer === null) {
      return
    }
    clearTimeout(session.grokExitTimer)
    session.grokExitTimer = null
  }

  #disposeSession(session: TerminalSession): void {
    this.#clearGrokExitTimer(session)
    for (const subscription of session.subscriptions) {
      try {
        subscription.dispose()
      } catch {
        // Cleanup must stay idempotent even if a subscription already died.
      }
    }
    session.subscriptions = []
    try {
      if (session.status === 'running') session.pty.kill()
    } catch {
      // The process may already be gone (exited session); kill stays idempotent.
    }
  }
}
