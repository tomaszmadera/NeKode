import { type ChildProcess, spawn } from 'node:child_process'
import { AppError } from '../../../shared/ipc-error'

// Adapter host (spec kanban-adapter-interface Behaviour 3, 5): one process
// per request. The request is a single JSON object written to stdin (stdin
// then closed); the response is a single JSON object read from stdout to
// EOF. Start failures, contract violations, wrong exit codes, and timeouts
// map to typed errors. stderr is captured for diagnostics only — never
// parsed; its tail rides on failure messages for the main-process log.

export const ADAPTER_TIMEOUT_MS = 30_000
/** Hard cap on adapter stdout (spec: more than 10 MB is a protocol violation). */
export const MAX_STDOUT_BYTES = 10 * 1024 * 1024
/** How much stderr tail a failure message carries. */
const STDERR_TAIL_CHARS = 2000

export type AdapterFailureCode = 'auth' | 'network' | 'notFound' | 'config' | 'internal'

const FAILURE_CODES: readonly AdapterFailureCode[] = [
  'auth',
  'network',
  'notFound',
  'config',
  'internal',
]

export interface AdapterRequest {
  protocolVersion: number
  action: string
  config: Record<string, string>
  params: Record<string, unknown>
}

export interface AdapterInvocation {
  /** Manifest adapter id; surfaces in typed error messages (spec Behaviour 5). */
  id: string
  dir: string
  invocation: { command: string; args: string[] }
}

/** Main-process typed error for adapter protocol/timeout failures. */
export class AdapterHostError extends Error {
  readonly kind: 'timeout' | 'protocol'

  constructor(kind: 'timeout' | 'protocol', message: string) {
    super(message)
    this.name = 'AdapterHostError'
    this.kind = kind
  }
}

/** Adapter-reported failure (ok:false) with its backend-facing code. */
export class AdapterError extends Error {
  readonly code: AdapterFailureCode

  constructor(code: AdapterFailureCode, message: string) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
  }
}

/** Maps host/adapter errors onto the typed transport; rethrows anything else. */
export function toAppError(error: unknown, channel: string): AppError {
  if (error instanceof AdapterHostError) {
    return new AppError(error.kind, error.message, channel)
  }
  if (error instanceof AdapterError) {
    // Surface the adapter's own code (auth|network|notFound|config|internal)
    // verbatim, per spec Errors/Edge cases — main adds no interpretation.
    return new AppError(error.code, error.message, channel)
  }
  throw error
}

/**
 * Kills the whole process tree. On Windows child.kill() hits only the direct
 * child (adapters may shell out), so taskkill /T /F takes the tree. Elsewhere
 * SIGKILL on the direct child; adapters are plain scripts without groups.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  child.kill('SIGKILL')
}

function stderrTail(stderr: string): string {
  const cleaned = stderr.trim()
  if (cleaned.length === 0) {
    return ''
  }
  return ` Adapter stderr tail: ${cleaned.slice(-STDERR_TAIL_CHARS)}`
}

function parseSingleJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new AdapterHostError('protocol', 'Adapter produced no output.')
  }
  try {
    // JSON.parse accepts exactly one JSON value (trailing garbage throws),
    // which enforces the "no second object" rule with the whitespace slack.
    return JSON.parse(trimmed)
  } catch {
    throw new AdapterHostError('protocol', 'Adapter output is not valid JSON.')
  }
}

export interface AdapterHostDeps {
  /** Process spawner; injectable so tests run real fixture scripts. */
  spawnProcess?: typeof spawn
  timeoutMs?: number
}

export class AdapterHost {
  readonly #spawn: typeof spawn
  readonly #timeoutMs: number

  constructor(deps: AdapterHostDeps = {}) {
    this.#spawn = deps.spawnProcess ?? spawn
    this.#timeoutMs = deps.timeoutMs ?? ADAPTER_TIMEOUT_MS
  }

  /**
   * Runs one adapter invocation. Resolves the parsed `data` of an ok:true
   * response. Adapter-reported failures (ok:false) reject with AdapterError;
   * contract violations and timeouts reject with AdapterHostError.
   */
  async invoke<T>(adapter: AdapterInvocation, request: AdapterRequest): Promise<T> {
    let child: ChildProcess
    try {
      child = this.#spawn(adapter.invocation.command, adapter.invocation.args, {
        cwd: adapter.dir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      // Synchronous spawn failure; ENOENT normally arrives via 'error'.
      throw new AdapterHostError(
        'protocol',
        `Adapter "${adapter.id}" command not found: ${adapter.invocation.command}`,
      )
    }

    let startError: Error | null = null
    child.on('error', (error: Error) => {
      startError = error
    })

    // stdout is decoded with a fatal UTF-8 decoder so invalid bytes surface as
    // the typed protocol error Behaviour 3 mandates (chunk.toString would
    // silently replace them with U+FFFD). The cap is enforced in bytes and
    // stops accumulation, killing the tree once it trips (Behaviour 3).
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let stdout = ''
    let stdoutBytes = 0
    let oversized = false
    let invalidEncoding = false
    child.stdout?.on('data', (chunk: Buffer) => {
      if (oversized || invalidEncoding) {
        return
      }
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        oversized = true
        killTree(child)
        return
      }
      try {
        stdout += decoder.decode(chunk, { stream: true })
      } catch {
        invalidEncoding = true
        killTree(child)
      }
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    // Write the single request object, then close stdin (Behaviour 3). A write
    // to an already-exited adapter raises on the stdin stream (EPIPE), not on
    // the ChildProcess, so the stream carries its own error listener; the
    // failure becomes a typed protocol error instead of an uncaught exception
    // while the framing stays exactly one JSON object followed by EOF.
    const stdin = child.stdin
    if (stdin === null) {
      killTree(child)
      throw new AdapterHostError('protocol', `Adapter "${adapter.id}" stdin is unavailable.`)
    }
    let stdinError: Error | null = null
    stdin.on('error', (error: Error) => {
      stdinError = error
    })
    try {
      stdin.write(Buffer.from(JSON.stringify(request), 'utf8'))
      stdin.end()
    } catch (error) {
      stdinError = error instanceof Error ? error : new Error(String(error))
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, this.#timeoutMs)

    const exitCode = await new Promise<number>((resolve) => {
      child.once('exit', (code) => resolve(code ?? -1))
      child.once('error', () => resolve(-1))
    })
    clearTimeout(timer)

    // Flush any buffered partial multibyte sequence so a truncated trailing
    // character is also detected as invalid UTF-8.
    if (!oversized && !invalidEncoding && !timedOut) {
      try {
        stdout += decoder.decode()
      } catch {
        invalidEncoding = true
      }
    }

    if (startError !== null) {
      if ((startError as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AdapterHostError(
          'protocol',
          `Adapter "${adapter.id}" command not found: ${adapter.invocation.command}`,
        )
      }
      throw new AdapterHostError(
        'protocol',
        `Adapter "${adapter.id}" failed to start: ${String(startError)}`,
      )
    }
    // Ordering matters: a host-imposed timeout kills the tree, which closes
    // stdin, so any still-pending large write then fails (EPIPE) on our own
    // kill. Reporting that as a stdin write failure would mask the typed
    // `timeout` error spec Behaviour 5 requires (naming the adapter and
    // action), so the timeout is evaluated first. A genuine stdin write
    // failure — the adapter exited without reading, no timeout — still falls
    // through to the typed protocol error below instead of an uncaught throw.
    if (timedOut) {
      throw new AdapterHostError(
        'timeout',
        `Adapter "${adapter.id}" timed out after ${this.#timeoutMs} ms (${request.action}).${stderrTail(stderr)}`,
      )
    }
    if (oversized) {
      throw new AdapterHostError(
        'protocol',
        `Adapter "${adapter.id}" stdout exceeded ${MAX_STDOUT_BYTES} bytes.${stderrTail(stderr)}`,
      )
    }
    if (invalidEncoding) {
      throw new AdapterHostError(
        'protocol',
        `Adapter "${adapter.id}" output is not valid UTF-8.${stderrTail(stderr)}`,
      )
    }
    if (stdinError !== null) {
      throw new AdapterHostError(
        'protocol',
        `Adapter "${adapter.id}" stdin write failed: ${stdinError.message}.${stderrTail(stderr)}`,
      )
    }

    const parsed = parseSingleJson(stdout)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new AdapterHostError('protocol', 'Adapter response must be a JSON object.')
    }
    const response = parsed as { ok?: unknown; data?: unknown; error?: unknown }

    if (response.ok === true) {
      if (exitCode !== 0) {
        throw new AdapterHostError(
          'protocol',
          `Adapter reported ok but exited with code ${exitCode}.${stderrTail(stderr)}`,
        )
      }
      return response.data as T
    }

    if (response.ok === false) {
      if (exitCode !== 1) {
        throw new AdapterHostError(
          'protocol',
          `Adapter reported failure but exited with code ${exitCode}.${stderrTail(stderr)}`,
        )
      }
      const error = response.error
      if (
        typeof error !== 'object' ||
        error === null ||
        typeof (error as { message?: unknown }).message !== 'string'
      ) {
        throw new AdapterHostError('protocol', 'Adapter failure response must carry error.message.')
      }
      const code = (error as { code?: unknown }).code
      const failureCode = FAILURE_CODES.includes(code as AdapterFailureCode)
        ? (code as AdapterFailureCode)
        : 'internal'
      throw new AdapterError(failureCode, (error as { message: string }).message)
    }

    throw new AdapterHostError('protocol', 'Adapter response must carry ok: true or ok: false.')
  }
}
