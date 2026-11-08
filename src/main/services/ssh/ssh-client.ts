import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { AppError } from '@shared/ipc-error'
import { type SshTarget, sshDestination } from '@shared/ssh-target'
import type { ShellSpec } from '../terminal/terminal-service'

// The system OpenSSH client as the only SSH transport (spec ssh-projects
// Business rules): deterministic executable resolution, the exact argument
// word arrays for a terminal, an agent launch and a non-interactive script,
// and typed classification of a failed connection. No credential, host key or
// ssh_config handling lives here; the client owns all of it.
//
// Three quoting layers meet in this file: the local argv (node-pty or
// execFile), the local process command line, and the remote login shell. ssh
// joins the words after the destination with single spaces and hands that
// string to the remote login shell, so every remote word is POSIX
// single-quote escaped here and the remote script reads its data from
// positional parameters only. No validated value is ever interpolated into
// script text.

/** Timeout of a non-interactive invocation (ConnectTimeout is 10s). */
export const SSH_SCRIPT_TIMEOUT_MS = 20_000

/**
 * Local buffer cap for one captured invocation. The spec caps a remote read at
 * 2 MB plus one byte (spec ssh-projects Business rules), and a full payload
 * also carries the per-call marker and NUL field separators, so the cap sits
 * above 2 MB. It matches the local Git buffer (GIT_MAX_BUFFER_BYTES): a remote
 * status or decoration read of a large repository captures as much as the same
 * repository does locally (spec Behaviour 12). File reads stay capped by the
 * remote script, so the larger capture does not change read behavior.
 */
export const SSH_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/**
 * Exit status of a failed remote `cd` (spec ssh-projects Behaviour 8): the
 * remote directory is gone, so the terminal pane keeps the typed message
 * instead of closing the chat. Distinct from a normal exit status.
 */
export const SSH_CD_FAILED_EXIT = 111

/** The remote login shell form: change directory, then exec the login shell. */
const LOGIN_SHELL_SCRIPT = `cd "$1" || exit ${SSH_CD_FAILED_EXIT}; if test -n "$SHELL"; then exec "$SHELL" -l; fi; exec /bin/sh -l`

/** The agent launch form: positional argv, never interpolated into the script. */
const AGENT_SCRIPT = `cd "$1" || exit ${SSH_CD_FAILED_EXIT}; shift; exec "$@"`

/** The script and its positional arguments for one terminal launch. */
function terminalRemoteCommand(
  target: SshTarget,
  command?: ShellSpec,
): { script: string; positional: string[] } {
  if (command === undefined) return { script: LOGIN_SHELL_SCRIPT, positional: [target.path] }
  return { script: AGENT_SCRIPT, positional: [target.path, command.file, ...command.args] }
}

export interface SshRunResult {
  stdout: string
  stderr: string
  exitCode: number
  /**
   * Raw stdout bytes when the runner captured them. The real runner always
   * fills it; an injected string-only runner leaves it out, and the
   * binary-safe call falls back to the decoded text.
   */
  stdoutBytes?: Uint8Array
}

/** Injectable command runner so tests never spawn a real ssh client. */
export type SshRunner = (file: string, args: string[]) => Promise<SshRunResult>

export interface SshScriptResult {
  exitCode: number
  /** Fields after the per-call nonce marker (NUL-delimited on the wire). */
  fields: string[]
}

/** Binary-safe payload of one script run (spec ssh-projects Business rules). */
export interface SshScriptBytesResult {
  exitCode: number
  /** Fields after the per-call nonce marker, split on NUL bytes. */
  fields: Uint8Array[]
}

/**
 * The SshClient surface a remote service needs. Declared separately so tests
 * inject a fake script client without constructing a transport.
 */
export interface SshScriptClient {
  runScript(target: SshTarget, script: string, args?: readonly string[]): Promise<SshScriptResult>
  runScriptBytes(
    target: SshTarget,
    script: string,
    args?: readonly string[],
  ): Promise<SshScriptBytesResult>
}

export interface SshClientOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Executable existence probe; injectable for tests. */
  exists?: (path: string) => boolean
  /** Command runner; defaults to execFile with the script timeout. */
  run?: SshRunner
  /** Nonce generator; injectable for deterministic tests. */
  marker?: () => string
}

/** POSIX single-quote escaping: the value survives the remote login shell. */
export function quotePosix(value: string): string {
  return `'${value.split("'").join("'\\''")}'`
}

/**
 * Remote command words of the fixed form `sh -c '<script>' nekode <args>`.
 * Each word is quoted here because ssh joins the words with spaces.
 */
export function remoteWords(script: string, args: readonly string[] = []): string[] {
  return ['sh', '-c', quotePosix(script), 'nekode', ...args.map(quotePosix)]
}

/** The joined remote command line ssh sends (test and log-safe inspection). */
export function remoteCommandLine(script: string, args: readonly string[] = []): string {
  return remoteWords(script, args).join(' ')
}

/** A per-call marker so login-script chatter on stdout is never data. */
function defaultMarker(): string {
  return `nekode-${randomUUID()}`
}

const MISSING_CLIENT = 'The OpenSSH client is not available on this machine.'

/**
 * Maps exit code 255 plus captured stderr to the spec's typed errors. The raw
 * stderr never reaches the message, the renderer or a log.
 */
export function sshFailure(exitCode: number, stderr: string): AppError | null {
  if (exitCode !== 255) return null
  const text = stderr.toLowerCase()
  if (
    text.includes('host key verification failed') ||
    text.includes('remote host identification has changed') ||
    /no .* host key is known/u.test(text) ||
    text.includes('could not verify host key')
  ) {
    return new AppError(
      'auth',
      'The SSH host key is not trusted. Verify the host key in known_hosts.',
    )
  }
  if (text.includes('permission denied')) {
    return new AppError(
      'auth',
      'The SSH host requires interactive authentication. Open a terminal for this project or configure a key or agent.',
    )
  }
  if (
    text.includes('could not resolve hostname') ||
    text.includes('name or service not known') ||
    text.includes('temporary failure in name resolution')
  ) {
    return new AppError('network', 'The SSH host could not be resolved.')
  }
  if (
    text.includes('connection refused') ||
    text.includes('connection timed out') ||
    text.includes('operation timed out') ||
    text.includes('no route to host') ||
    text.includes('network is unreachable') ||
    text.includes('connection closed by')
  ) {
    return new AppError('network', 'The SSH host is unreachable.')
  }
  return new AppError('unknown', 'The SSH connection failed.')
}

/** Captured-stderr fixture for a non-POSIX remote shell or a missing marker. */
export function remoteShellFailure(): AppError {
  return new AppError('unknown', 'The remote host did not run the command with a POSIX shell.')
}

function realRunner(file: string, args: string[]): Promise<SshRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: SSH_SCRIPT_TIMEOUT_MS,
        maxBuffer: SSH_MAX_BUFFER_BYTES,
        windowsHide: true,
        // Bytes, not text: a remote file read must survive NUL bytes and
        // invalid UTF-8 (spec ssh-projects Business rules).
        encoding: 'buffer',
      },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code === 'string') {
          // ENOENT and friends: the process never started.
          reject(error)
          return
        }
        if (
          error !== null &&
          (error.killed === true || (error.signal !== undefined && error.signal !== null))
        ) {
          // execFile kills a child that exceeds the timeout (or a signal did),
          // so the status is not a remote exit code. Reject so the invoke path
          // reports a timeout instead of resolving a slow host as exit 1.
          reject(error)
          return
        }
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
        resolve({
          stdout: bytes.toString('utf8'),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr),
          exitCode,
          stdoutBytes: new Uint8Array(bytes),
        })
      },
    )
  })
}

/** True when the runner failure is a timeout or a signal kill, not an exit. */
function isKilledOrTimedOut(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const failure = error as { killed?: unknown; signal?: unknown }
  return failure.killed === true || (failure.signal !== undefined && failure.signal !== null)
}

const textEncoder = new TextEncoder()

/** First byte index of `needle` in `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).indexOf(needle)
}

/** Splits a payload on NUL bytes; a trailing NUL yields a final empty field. */
function splitBytes(value: Uint8Array): Uint8Array[] {
  const fields: Uint8Array[] = []
  let start = 0
  for (let index = 0; index < value.byteLength; index += 1) {
    if (value[index] === 0) {
      fields.push(value.subarray(start, index))
      start = index + 1
    }
  }
  fields.push(value.subarray(start))
  return fields
}

export class SshClient {
  readonly #platform: NodeJS.Platform
  readonly #env: NodeJS.ProcessEnv
  readonly #exists: (path: string) => boolean
  readonly #run: SshRunner
  readonly #marker: () => string

  constructor(options: SshClientOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#env = options.env ?? process.env
    this.#exists = options.exists ?? existsSync
    this.#run = options.run ?? realRunner
    this.#marker = options.marker ?? defaultMarker
  }

  /**
   * Deterministic client resolution (spec Business rules): the Windows
   * system client when present, otherwise `ssh` from PATH.
   */
  executable(): string {
    if (this.#platform === 'win32') {
      const system = `${this.#env.SystemRoot ?? 'C:\\Windows'}\\System32\\OpenSSH\\ssh.exe`
      if (this.#exists(system)) return system
    }
    return 'ssh'
  }

  /** ssh words of an interactive terminal session (forced remote TTY). */
  terminalArgs(target: SshTarget): string[] {
    const args = ['-tt', '-o', 'RemoteCommand=none']
    if (target.port !== 22) args.push('-p', String(target.port))
    args.push('--', sshDestination(target))
    return args
  }

  /** ssh words of a non-interactive invocation (BatchMode, no remote TTY). */
  scriptArgs(target: SshTarget): string[] {
    const args = [
      '-o',
      'BatchMode=yes',
      '-o',
      'RemoteCommand=none',
      '-o',
      'ConnectTimeout=10',
      '-T',
    ]
    if (target.port !== 22) args.push('-p', String(target.port))
    args.push('--', sshDestination(target))
    return args
  }

  /**
   * Full spawn spec for a terminal PTY: the login shell, or the agent command
   * as positional arguments. The local working directory stays the caller's
   * (the local user home), never the SSH URL.
   */
  terminalCommand(target: SshTarget, command?: ShellSpec): { file: string; args: string[] } {
    const { script, positional } = terminalRemoteCommand(target, command)
    return {
      file: this.executable(),
      args: [...this.terminalArgs(target), ...remoteWords(script, positional)],
    }
  }

  /** The remote command line of a terminal spawn (diagnostics and tests). */
  terminalCommandLine(target: SshTarget, command?: ShellSpec): string {
    const { script, positional } = terminalRemoteCommand(target, command)
    return remoteCommandLine(script, positional)
  }

  /**
   * Runs one non-interactive remote script. Emits a per-call marker before
   * the payload, so a login script that prints to stdout cannot be mistaken
   * for data. Throws the typed connection error for exit code 255 and the
   * POSIX-shell error when the marker is missing.
   */
  async runScript(
    target: SshTarget,
    script: string,
    args: readonly string[] = [],
  ): Promise<SshScriptResult> {
    const marker = this.#marker()
    const result = await this.#invoke(this.#argvFor(target, script, args, marker))
    // The marker ends a field, so chatter before it (with or without its own
    // newline) is dropped instead of being read as data. A marker without its
    // NUL terminator means the remote shell did not run the printf, so the
    // payload cannot be trusted as data.
    const needle = `${marker}\u0000`
    const index = result.stdout.indexOf(needle)
    if (index === -1) {
      throw remoteShellFailure()
    }
    const payload = result.stdout.slice(index + needle.length)
    return { exitCode: result.exitCode, fields: payload.split('\u0000') }
  }

  /**
   * Binary-safe form of `runScript` for a remote file read (spec ssh-projects
   * Business rules: remote reads are capped on the remote side and returned as
   * a buffer). The marker search and the field split run on bytes, so content
   * with NUL bytes or invalid UTF-8 survives the transport.
   */
  async runScriptBytes(
    target: SshTarget,
    script: string,
    args: readonly string[] = [],
  ): Promise<SshScriptBytesResult> {
    const marker = this.#marker()
    const result = await this.#invoke(this.#argvFor(target, script, args, marker))
    const bytes = result.stdoutBytes ?? textEncoder.encode(result.stdout)
    const needle = textEncoder.encode(`${marker}\u0000`)
    const index = indexOfBytes(bytes, needle)
    if (index === -1) {
      // Same contract as runScript: a marker without its NUL terminator is a
      // remote shell that did not run the printf, never an empty payload.
      throw remoteShellFailure()
    }
    return { exitCode: result.exitCode, fields: splitBytes(bytes.subarray(index + needle.length)) }
  }

  /** ssh words of one marked script invocation. */
  #argvFor(target: SshTarget, script: string, args: readonly string[], marker: string): string[] {
    const marked = `printf '%s\\0' ${quotePosix(marker)}; ${script}`
    return [...this.scriptArgs(target), ...remoteWords(marked, args)]
  }

  /** Runs the argv and maps spawn, timeout and connection failures to typed errors. */
  async #invoke(argv: string[]): Promise<SshRunResult> {
    let result: SshRunResult
    try {
      result = await this.#run(this.executable(), argv)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new AppError('unknown', MISSING_CLIENT)
      if (isKilledOrTimedOut(error)) {
        // The timeout killed the child (or a signal did), so no remote exit
        // status exists. Reporting an ordinary failure would surface a slow
        // host as a missing file (spec Errors: never a not-found).
        throw new AppError('timeout', 'The SSH command did not finish in time or was interrupted.')
      }
      throw new AppError('unknown', 'The SSH connection failed.')
    }
    const failure = sshFailure(result.exitCode, result.stderr)
    if (failure !== null) throw failure
    return result
  }

  /**
   * Registration check (spec Behaviour 4): the directory must exist and be a
   * directory, and its canonical identity is the `pwd -P` result.
   */
  async requireDirectory(target: SshTarget): Promise<string> {
    const channel = 'projects:addSsh'
    const result = await this.runScript(target, 'cd "$1" || exit 1; pwd -P', [target.path])
    const canonical = (result.fields[0] ?? '').replace(/[\r\n]+$/u, '')
    if (result.exitCode !== 0 || !canonical.startsWith('/')) {
      throw new AppError(
        'not_found',
        'The remote directory does not exist or is not accessible.',
        channel,
      )
    }
    return canonical
  }
}
