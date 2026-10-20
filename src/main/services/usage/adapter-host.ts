import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppError, isAppErrorCode } from '../../../shared/ipc-error'
import { USAGE_MAX_BYTES, type UsageAdapter, usageObject } from '../../../shared/usage-contract'

export const FILE_ADAPTER: UsageAdapter = {
  id: 'usage-file',
  name: 'Normalized JSON file',
  protocolVersion: 1,
  invocation: { command: 'Built-in JSON reader', args: [] },
  sourceKind: 'file',
  capabilities: ['window', 'credits', 'balance'],
  minimumRefreshSeconds: 5,
  configSchema: [{ key: 'path', label: 'JSON input file', type: 'file', required: true }],
}

export function discoverUsageAdapters(directory: string): UsageAdapter[] {
  const result: UsageAdapter[] = [{ ...FILE_ADAPTER }]
  if (!existsSync(directory)) return result
  for (const entry of readdirSync(directory, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .slice(0, 100)) {
    const dir = join(directory, entry.name)
    try {
      const file = readFileSync(join(dir, 'usage-adapter.json'))
      if (file.length > 64 * 1024) throw new Error('manifest size')
      const m = usageObject(JSON.parse(file.toString('utf8')))
      const i = usageObject(m.invocation)
      if (
        typeof m.id !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id) ||
        typeof m.name !== 'string' ||
        m.name.length > 256 ||
        m.protocolVersion !== 1 ||
        typeof i.command !== 'string' ||
        !i.command ||
        i.command.length > 4096 ||
        !Array.isArray(i.args) ||
        i.args.length > 50 ||
        i.args.some((a) => typeof a !== 'string' || a.length > 4096 || a.includes('\0')) ||
        !['file', 'api', 'cli'].includes(m.sourceKind as string) ||
        !Array.isArray(m.capabilities) ||
        m.capabilities.length > 3 ||
        m.capabilities.some((c) => !['window', 'credits', 'balance'].includes(c as string)) ||
        typeof m.minimumRefreshSeconds !== 'number' ||
        !Number.isFinite(m.minimumRefreshSeconds) ||
        m.minimumRefreshSeconds < 1 ||
        m.minimumRefreshSeconds > 86400 ||
        !Array.isArray(m.configSchema) ||
        m.configSchema.length > 50
      )
        throw new Error('manifest contract')
      const keys = new Set<string>()
      for (const raw of m.configSchema) {
        const f = usageObject(raw)
        if (
          typeof f.key !== 'string' ||
          !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.key) ||
          keys.has(f.key) ||
          typeof f.label !== 'string' ||
          f.label.length > 256 ||
          !['text', 'secret', 'boolean', 'choice', 'file'].includes(f.type as string) ||
          (f.required !== undefined && typeof f.required !== 'boolean') ||
          (f.type === 'choice' &&
            (!Array.isArray(f.choices) ||
              f.choices.length > 100 ||
              f.choices.some((c) => typeof c !== 'string' || c.length > 256)))
        )
          throw new Error('manifest field')
        keys.add(f.key)
      }
      result.push({
        id: m.id,
        name: m.name,
        protocolVersion: 1,
        invocation: { command: i.command, args: i.args as string[] },
        sourceKind: m.sourceKind as UsageAdapter['sourceKind'],
        capabilities: m.capabilities as string[],
        minimumRefreshSeconds: m.minimumRefreshSeconds,
        configSchema: m.configSchema as UsageAdapter['configSchema'],
        directory: dir,
      })
    } catch {
      result.push({
        ...FILE_ADAPTER,
        id: `invalid:${entry.name}`,
        name: entry.name,
        directory: dir,
        error: 'Invalid usage-adapter.json. Check protocol version 1 and required manifest fields.',
      })
    }
  }
  const counts = new Map<string, number>()
  for (const a of result) counts.set(a.id, (counts.get(a.id) ?? 0) + 1)
  return result.map((a) =>
    (counts.get(a.id) ?? 0) > 1
      ? { ...a, error: 'Duplicate usage adapter id. Give each adapter a unique id.' }
      : a,
  )
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => child.kill())
    killer.unref()
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/** One bounded process per read. Never transport adapter diagnostics or arbitrary messages. */
export class UsageAdapterHost {
  private readonly children = new Set<ChildProcess>()
  constructor(private readonly timeoutMs = 30_000) {}
  shutdown(): void {
    for (const child of this.children) terminate(child)
  }
  async read(
    adapter: UsageAdapter,
    config: Record<string, string | boolean>,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new AppError('config', 'Usage request was cancelled.')
    const child = spawn(adapter.invocation.command, adapter.invocation.args, {
      cwd: adapter.directory,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.children.add(child)
    let output = Buffer.alloc(0),
      stderrBytes = 0,
      failure: AppError | null = null
    const stop = (error: AppError) => {
      failure ??= error
      terminate(child)
    }
    const cancel = () => stop(new AppError('config', 'Usage request was cancelled.'))
    signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(
      () => stop(new AppError('timeout', 'Usage adapter timed out. Retry the connection.')),
      this.timeoutMs,
    )
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > USAGE_MAX_BYTES)
        stop(new AppError('protocol', 'Usage adapter response exceeds 1 MiB.'))
      else output = Buffer.concat([output, chunk])
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 8192)
        stop(new AppError('protocol', 'Usage adapter diagnostics exceed 8 KiB.'))
    })
    child.stdin.on('error', () =>
      stop(new AppError('protocol', 'Usage adapter could not read its request.')),
    )
    const exit = new Promise<number>((resolve) => {
      child.once('close', (code) => resolve(code ?? -1))
      child.once('error', () => {
        failure = new AppError('config', 'Cannot start usage adapter. Check its executable.')
        resolve(-1)
      })
    })
    child.stdin.end(
      JSON.stringify({ protocolVersion: 1, action: 'read', config, params: { connectionId } }),
    )
    try {
      const code = await exit
      if (failure) throw failure
      let response: Record<string, unknown>
      try {
        response = usageObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)))
      } catch {
        throw new AppError('protocol', 'Usage adapter must return one valid JSON response.')
      }
      if (response.protocolVersion !== 1)
        throw new AppError('protocol', 'Unsupported usage adapter version.')
      if (response.ok === true && code === 0) return response.data
      if (response.ok === false && code === 1) {
        const error = usageObject(response.error)
        const known = [
          'validation_error',
          'auth',
          'network',
          'timeout',
          'rate_limited',
          'unsupported',
          'config',
          'io',
          'not_found',
          'protocol',
        ]
        if (
          !known.includes(error.code as string) ||
          !isAppErrorCode(error.code) ||
          (error.retryAfterSeconds !== undefined &&
            (typeof error.retryAfterSeconds !== 'number' ||
              !Number.isFinite(error.retryAfterSeconds) ||
              error.retryAfterSeconds < 0 ||
              error.retryAfterSeconds > 86400))
        )
          throw new AppError('protocol', 'Invalid usage adapter failure response.')
        // Fixed per-code next actions; adapter-supplied text is never transported.
        const action =
          error.code === 'auth'
            ? 'Sign in with the CLI or account this adapter uses, then retry.'
            : error.code === 'unsupported'
              ? 'Update the CLI or adapter to a supported version, then retry.'
              : 'Check the connection and retry.'
        const typed = new AppError(error.code, `Usage source ${error.code}. ${action}`)
        Object.assign(typed, { retryAfterSeconds: error.retryAfterSeconds })
        throw typed
      }
      throw new AppError('protocol', 'Usage adapter response and exit code do not match.')
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      this.children.delete(child)
    }
  }
}
