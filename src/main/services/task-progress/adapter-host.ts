import { type ChildProcess, spawn } from 'node:child_process'
import type { TaskProgressEnvironment, TaskProgressErrorCode } from '@shared/ipc-contract'
import { killTree } from '../kanban/adapter-host'

// Task progress adapter host (spec task-progress-adapters Behaviour 3-6). One
// process per request, argv from the manifest without a shell, cwd = adapter
// directory. One JSON object goes to stdin (then closed); stdout is read to EOF
// and must hold exactly one JSON object. Exit 0 pairs with ok:true, exit 1 with
// ok:false; anything else is a protocol error. The kanban host stays separate:
// its timeout, error codes, and stderr handling differ, and only its process
// tree kill is shared.

export const TASK_PROGRESS_TIMEOUT_MS = 15_000
export const TASK_PROGRESS_MAX_STDOUT_BYTES = 10 * 1024 * 1024
const STDERR_TAIL_CHARS = 2000
const TERMINATION_GRACE_MS = 1000

/** Codes an adapter may report in `error.code` (spec Behaviour 6). */
const ADAPTER_CODES: readonly TaskProgressErrorCode[] = [
  'config',
  'runtime',
  'unsupported_source',
  'transient',
  'internal',
]

export type TaskProgressAction = 'test' | 'snapshot'

export interface TaskProgressProjectContext {
  /** Host path of the project (a UNC path for WSL projects). */
  root: string
  environment: TaskProgressEnvironment
  distribution?: string
  linuxRoot?: string
}

export interface TaskProgressRequest {
  protocolVersion: 1
  action: TaskProgressAction
  config: Record<string, string>
  project: TaskProgressProjectContext
}

export interface TaskProgressInvocation {
  id: string
  dir: string
  invocation: { command: string; args: string[] }
}

/** Typed failure of one invocation; the message names the adapter and action. */
export class TaskProgressAdapterError extends Error {
  readonly code: TaskProgressErrorCode

  constructor(code: TaskProgressErrorCode, message: string) {
    super(message)
    this.name = 'TaskProgressAdapterError'
    this.code = code
  }
}

/**
 * The caller aborted the invocation (binding change, unobserve, project
 * removal, app quit). The process tree was killed; the result is discarded,
 * so this never becomes a visible state.
 */
export class TaskProgressCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskProgressCancelledError'
  }
}

export interface TaskProgressHostDeps {
  spawnProcess?: typeof spawn
  timeoutMs?: number
  /** Main-process diagnostic log; the only place the stderr tail goes (spec Errors). */
  log?: (message: string) => void
}

export class TaskProgressHost {
  readonly #spawn: typeof spawn
  readonly #timeoutMs: number
  readonly #log: (message: string) => void

  constructor(deps: TaskProgressHostDeps = {}) {
    this.#spawn = deps.spawnProcess ?? spawn
    this.#timeoutMs = deps.timeoutMs ?? TASK_PROGRESS_TIMEOUT_MS
    this.#log = deps.log ?? ((message) => console.warn(message))
  }

  /**
   * Resolves the `data` of an ok:true response; rejects with
   * TaskProgressAdapterError, or TaskProgressCancelledError after `signal`
   * aborts (the process tree is killed first).
   */
  async invoke(
    adapter: TaskProgressInvocation,
    request: TaskProgressRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const label = `Adapter "${adapter.id}" (${request.action})`
    if (signal?.aborted) {
      throw new TaskProgressCancelledError(`${label}: cancelled before start`)
    }
    let stderr = ''
    const failWith = (code: TaskProgressErrorCode, detail: string): never => {
      const tail = stderr.trim()
      if (tail.length > 0) {
        this.#log(`[task-progress] ${label} stderr tail: ${tail.slice(-STDERR_TAIL_CHARS)}`)
      }
      throw new TaskProgressAdapterError(code, `${label}: ${detail}`)
    }

    let child: ChildProcess
    try {
      child = this.#spawn(adapter.invocation.command, adapter.invocation.args, {
        cwd: adapter.dir,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        // POSIX only: own process group so killTree takes the whole tree.
        ...(process.platform === 'win32' ? {} : { detached: true }),
      })
    } catch (error) {
      return failWith(
        'spawn',
        `cannot start ${adapter.invocation.command}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    let startError: Error | null = null
    const onChildError = (error: Error) => {
      startError = error
    }
    child.on('error', onChildError)

    const decoder = new TextDecoder('utf-8', { fatal: true })
    let stdout = ''
    let stdoutBytes = 0
    let oversized = false
    let invalidEncoding = false
    const onStdout = (chunk: Buffer) => {
      if (oversized || invalidEncoding) return
      stdoutBytes += chunk.length
      if (stdoutBytes > TASK_PROGRESS_MAX_STDOUT_BYTES) {
        oversized = true
        killTree(child, this.#spawn)
        return
      }
      try {
        stdout += decoder.decode(chunk, { stream: true })
      } catch {
        invalidEncoding = true
        killTree(child, this.#spawn)
      }
    }
    const onStderr = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS)
    }
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)

    // A write to an adapter that already exited fails on the stream (EPIPE);
    // the listener turns it into a typed protocol error below.
    let stdinError: Error | null = null
    const onStdinError = (error: Error) => {
      stdinError = error
    }
    child.stdin?.on('error', onStdinError)
    child.stdin?.end(Buffer.from(JSON.stringify(request), 'utf8'))

    let timedOut = false
    let aborted = false
    const exitCode = await new Promise<number>((resolve) => {
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (code: number) => {
        clearTimeout(timer)
        clearTimeout(graceTimer)
        signal?.removeEventListener('abort', onAbort)
        child.removeListener('close', onClose)
        child.removeListener('error', onExitError)
        child.removeListener('error', onChildError)
        child.stdout?.removeListener('data', onStdout)
        child.stderr?.removeListener('data', onStderr)
        child.stdin?.removeListener('error', onStdinError)
        resolve(code)
      }
      const onClose = (code: number | null) => finish(code ?? -1)
      const onExitError = () => finish(-1)
      const terminate = () => {
        clearTimeout(timer)
        graceTimer = setTimeout(() => {
          // A child or stdin may still report an error after the grace expires.
          // Keep error listeners until their respective close events.
          const ignoreError = () => {}
          child.on('error', ignoreError)
          child.once('close', () => child.removeListener('error', ignoreError))
          if (child.stdin && !child.stdin.closed) {
            child.stdin.on('error', ignoreError)
            child.stdin.once('close', () => child.stdin?.removeListener('error', ignoreError))
          }
          finish(-1)
        }, TERMINATION_GRACE_MS)
        killTree(child, this.#spawn)
      }
      const timer = setTimeout(() => {
        timedOut = true
        terminate()
      }, this.#timeoutMs)
      const onAbort = () => {
        if (timedOut || aborted) return
        aborted = true
        terminate()
      }
      child.once('close', onClose)
      child.once('error', onExitError)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    if (aborted) {
      throw new TaskProgressCancelledError(`${label}: cancelled`)
    }

    if (!oversized && !invalidEncoding && !timedOut) {
      try {
        stdout += decoder.decode()
      } catch {
        invalidEncoding = true
      }
    }

    // The timeout wins over errors caused by our own kill.
    if (timedOut) {
      return failWith('timeout', `timed out after ${this.#timeoutMs} ms`)
    }
    const started = startError as Error | null
    if (started !== null) {
      return failWith('spawn', `cannot start ${adapter.invocation.command}: ${started.message}`)
    }
    if (oversized) {
      return failWith('protocol', `stdout exceeded ${TASK_PROGRESS_MAX_STDOUT_BYTES} bytes`)
    }
    if (invalidEncoding) {
      return failWith('protocol', 'stdout is not valid UTF-8')
    }
    const stdinFailure = stdinError as Error | null
    if (stdinFailure !== null) {
      return failWith('protocol', `stdin write failed: ${stdinFailure.message}`)
    }

    const text = stdout.trim()
    if (text.length === 0) {
      return failWith('protocol', 'produced no output')
    }
    let parsed: unknown
    try {
      // JSON.parse accepts exactly one value, so a second object is rejected.
      parsed = JSON.parse(text)
    } catch {
      return failWith('protocol', 'stdout is not exactly one JSON object')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return failWith('protocol', 'response must be a JSON object')
    }
    const response = parsed as { ok?: unknown; data?: unknown; error?: unknown }

    if (response.ok === true) {
      if (exitCode !== 0) {
        return failWith('protocol', `reported ok but exited with code ${exitCode}`)
      }
      return response.data
    }
    if (response.ok === false) {
      if (exitCode !== 1) {
        return failWith('protocol', `reported failure but exited with code ${exitCode}`)
      }
      const error = response.error as { code?: unknown; message?: unknown } | null | undefined
      if (
        typeof error !== 'object' ||
        error === null ||
        typeof error.message !== 'string' ||
        !ADAPTER_CODES.includes(error.code as TaskProgressErrorCode)
      ) {
        return failWith(
          'protocol',
          `failure response must carry error.code (${ADAPTER_CODES.join('|')}) and error.message`,
        )
      }
      return failWith(error.code as TaskProgressErrorCode, error.message)
    }
    return failWith('protocol', 'response must carry ok: true or ok: false')
  }
}
