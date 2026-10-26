import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  parseUsageDocument,
  parseUsageRefreshResult,
  USAGE_MAX_BYTES,
  USAGE_REMOVED_ADAPTER_IDS,
  type UsageAdapter,
  type UsageAdapterAction,
  type UsageDocument,
  type UsageErrorCode,
  type UsageRefreshResult,
  usageObject,
} from '@shared/contracts/usage-contract'
import { AppError, isAppErrorCode } from '@shared/ipc-error'

/** Adapter protocol version (spec L1): version 2 requires the live `refresh` action. */
export const USAGE_PROTOCOL_VERSION = 2
/** Manual-refresh capability exchanged in `params.capabilities` (PDH-13 partial contract). */
export const USAGE_PARTIAL_CAPABILITY = 'partial-refresh-v1'
const UNSUPPORTED_PROTOCOL =
  'This adapter uses an unsupported protocol version. Update it to protocol version 2, which requires live refresh.'
const INVALID_MANIFEST =
  'Invalid usage-adapter.json. Check protocol version 2 and required manifest fields.'
export type UsageAdapterResult = UsageDocument & {
  /** Non-enumerable so the parsed document keeps its strict schema shape. */
  readonly refresh: UsageRefreshResult | null
}

/**
 * Spec L3: every available metric of a `refresh` response must be observed no earlier than the
 * start of the request, compared at whole-second precision. `unavailable` metrics are exempt.
 */
export function assertLiveRefresh(document: UsageDocument, startedAt: number): void {
  const start = Math.floor(startedAt / 1000)
  for (const subscription of document.subscriptions)
    for (const metric of subscription.metrics) {
      if (metric.state !== 'available') continue
      if (!metric.observedAt || Math.floor(Date.parse(metric.observedAt) / 1000) < start)
        throw new AppError('protocol', 'Usage adapter did not return a live refresh.')
    }
}

const ERROR_CODES: UsageErrorCode[] = [
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
const bounded = (value: unknown, max: number) =>
  value === undefined ||
  (typeof value === 'string' && value.trim() !== '' && value.length <= max && !value.includes('\0'))

/** Optional manifest `errorActions`: a fixed next action per known failure code. */
function errorActions(value: unknown): UsageAdapter['errorActions'] {
  if (value === undefined) return undefined
  const actions = usageObject(value)
  if (
    Object.entries(actions).some(
      ([code, text]) =>
        !ERROR_CODES.includes(code as UsageErrorCode) || text === undefined || !bounded(text, 256),
    )
  )
    throw new Error('manifest error actions')
  return actions as UsageAdapter['errorActions']
}

/** Usage adapters shipped with NeKode (spec rule 17); `adapters/<name>` in the repository. */
export const BUNDLED_USAGE_ADAPTERS = ['usage-claude', 'usage-codex']

/**
 * Shipped adapter directories: `<resources>/usage-adapters/<name>` in a packaged app (copied by
 * electron-builder.yml extraResources), `<appPath>/adapters/<name>` when unpackaged.
 */
export function bundledUsageAdapterDirectories(
  packaged: boolean,
  appPath: string,
  resourcesPath: string,
): string[] {
  const root = packaged ? join(resourcesPath, 'usage-adapters') : join(appPath, 'adapters')
  return BUNDLED_USAGE_ADAPTERS.map((name) => join(root, name))
}

/**
 * Bundled adapters (one directory each), then user adapters one level under `userDirectory`
 * (spec rule 17, L9). A valid user adapter replaces a bundled one with the same id.
 */
export function discoverUsageAdapters(
  userDirectory: string,
  bundledDirectories: readonly string[] = [],
): UsageAdapter[] {
  const bundled = bundledDirectories
    .filter((dir) => existsSync(join(dir, 'usage-adapter.json')))
    .map((dir) => {
      const a = readManifest(dir, basename(dir))
      if (a.error || a.invocation.command !== 'node') return { ...a, bundled: true }
      // Run with NeKode's own Node runtime (ELECTRON_RUN_AS_NODE, set by the host); this needs
      // the RunAsNode Electron fuse, which electron-builder.yml leaves enabled.
      return { ...a, bundled: true, invocation: { ...a.invocation, command: process.execPath } }
    })
  const user = existsSync(userDirectory)
    ? readdirSync(userDirectory, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .slice(0, 100)
        .map((e) => readManifest(join(userDirectory, e.name), e.name))
    : []
  const overridden = new Set(user.filter((a) => !a.error).map((a) => a.id))
  const result = [...bundled.filter((a) => !overridden.has(a.id)), ...user]
  const counts = new Map<string, number>()
  for (const a of result) counts.set(a.id, (counts.get(a.id) ?? 0) + 1)
  return result.map((a) =>
    (counts.get(a.id) ?? 0) > 1
      ? { ...a, error: 'Duplicate usage adapter id. Give each adapter a unique id.' }
      : USAGE_REMOVED_ADAPTER_IDS.includes(a.id)
        ? // Spec L7: accounts of these ids are never collected, so no adapter may claim one.
          {
            ...a,
            error: 'This adapter id belongs to a removed NeKode service. Give it another id.',
          }
        : a,
  )
}

function readManifest(dir: string, name: string): UsageAdapter {
  let error = INVALID_MANIFEST
  try {
    const file = readFileSync(join(dir, 'usage-adapter.json'))
    if (file.length > 64 * 1024) throw new Error('manifest size')
    const m = usageObject(JSON.parse(file.toString('utf8')))
    if (m.protocolVersion !== USAGE_PROTOCOL_VERSION) {
      // A declared other version gets the L1 message; a missing or malformed one stays invalid.
      if (typeof m.protocolVersion === 'number') error = UNSUPPORTED_PROTOCOL
      throw new Error('manifest protocol version')
    }
    const i = usageObject(m.invocation)
    if (
      typeof m.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id) ||
      typeof m.name !== 'string' ||
      m.name.length > 256 ||
      typeof i.command !== 'string' ||
      !i.command ||
      i.command.length > 4096 ||
      !Array.isArray(i.args) ||
      i.args.length > 50 ||
      i.args.some((a) => typeof a !== 'string' || a.length > 4096 || a.includes('\0')) ||
      !['api', 'cli'].includes(m.sourceKind as string) ||
      !Array.isArray(m.capabilities) ||
      m.capabilities.length > 3 ||
      m.capabilities.some((c) => !['window', 'credits', 'balance'].includes(c as string)) ||
      typeof m.minimumRefreshSeconds !== 'number' ||
      !Number.isFinite(m.minimumRefreshSeconds) ||
      m.minimumRefreshSeconds < 1 ||
      m.minimumRefreshSeconds > 86400 ||
      !Array.isArray(m.configSchema) ||
      m.configSchema.length > 50 ||
      !bounded(m.description, 1024) ||
      (m.providerId !== undefined &&
        (typeof m.providerId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.providerId))) ||
      !bounded(m.summary, 160) ||
      (m.experimental !== undefined && typeof m.experimental !== 'boolean')
    )
      throw new Error('manifest contract')
    const actions = errorActions(m.errorActions)
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
        !bounded(f.description, 512) ||
        (f.type === 'choice' &&
          (!Array.isArray(f.choices) ||
            f.choices.length > 100 ||
            f.choices.some((c) => typeof c !== 'string' || c.length > 256)))
      )
        throw new Error('manifest field')
      keys.add(f.key)
    }
    return {
      id: m.id,
      name: m.name,
      protocolVersion: 2,
      invocation: { command: i.command, args: i.args as string[] },
      sourceKind: m.sourceKind as UsageAdapter['sourceKind'],
      capabilities: m.capabilities as string[],
      minimumRefreshSeconds: m.minimumRefreshSeconds,
      configSchema: m.configSchema as UsageAdapter['configSchema'],
      ...(m.description === undefined ? {} : { description: m.description as string }),
      ...(actions ? { errorActions: actions } : {}),
      ...(m.providerId === undefined ? {} : { providerId: m.providerId as string }),
      ...(m.summary === undefined ? {} : { summary: m.summary as string }),
      ...(m.experimental === undefined ? {} : { experimental: m.experimental }),
      directory: dir,
    }
  } catch {
    return {
      id: `invalid:${name}`,
      name,
      protocolVersion: 2,
      invocation: { command: '', args: [] },
      sourceKind: 'api',
      capabilities: [],
      minimumRefreshSeconds: 60,
      configSchema: [],
      directory: dir,
      error,
    }
  }
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

/** Fixture seam read by the provider adapters; only an unpackaged (development or smoke) app passes it. */
export const USAGE_TEST_BASE_URL_ENV = 'NEKODE_USAGE_TEST_BASE_URL'

/**
 * Remove a variable from a copied environment. Windows names are case-insensitive, so a variant
 * such as `nekode_usage_test_base_url` reaches the child under the exact name and is removed too.
 */
function deleteEnv(env: NodeJS.ProcessEnv, name: string): void {
  for (const key of Object.keys(env))
    if (key === name || (process.platform === 'win32' && key.toUpperCase() === name))
      delete env[key]
}

/** One bounded process per read. Never transport adapter diagnostics or arbitrary messages. */
export class UsageAdapterHost {
  private readonly children = new Set<ChildProcess>()
  constructor(
    private readonly timeoutMs = 30_000,
    private readonly options: { packaged?: boolean } = {},
  ) {}
  private childEnv(adapter: UsageAdapter): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (this.options.packaged) deleteEnv(env, USAGE_TEST_BASE_URL_ENV)
    // Bundled adapters run on NeKode's executable in Node mode (spec rule 19).
    deleteEnv(env, 'ELECTRON_RUN_AS_NODE')
    if (adapter.bundled) env.ELECTRON_RUN_AS_NODE = '1'
    return env
  }
  shutdown(): void {
    for (const child of this.children) terminate(child)
  }
  async read(
    adapter: UsageAdapter,
    config: Record<string, string | boolean>,
    connectionId: string,
    signal: AbortSignal,
    action: UsageAdapterAction = 'read',
    options: { refreshSources?: string[] } = {},
  ): Promise<UsageAdapterResult> {
    if (signal.aborted) throw new AppError('config', 'Usage request was cancelled.')
    if (
      options.refreshSources !== undefined &&
      (!Array.isArray(options.refreshSources) ||
        options.refreshSources.length === 0 ||
        options.refreshSources.length > 20 ||
        options.refreshSources.some(
          (id) => typeof id !== 'string' || !id.trim() || id.length > 256 || id.includes('\0'),
        ))
    )
      throw new AppError('validation_error', 'Invalid usage refresh source selection.')
    const child = spawn(adapter.invocation.command, adapter.invocation.args, {
      cwd: adapter.directory,
      env: this.childEnv(adapter),
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
      () => stop(new AppError('timeout', 'Usage adapter timed out. Retry the account.')),
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
      JSON.stringify({
        protocolVersion: USAGE_PROTOCOL_VERSION,
        action,
        config,
        params: {
          connectionId,
          // The PDH adapter requires the capability before creating a quota operation.
          ...(action === 'refresh' ? { capabilities: [USAGE_PARTIAL_CAPABILITY] } : {}),
          ...(action === 'refresh' && options.refreshSources
            ? { refreshSources: options.refreshSources }
            : {}),
        },
      }),
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
      if (response.protocolVersion !== USAGE_PROTOCOL_VERSION)
        throw new AppError('protocol', 'Unsupported usage adapter version.')
      if (response.ok === true && code === 0) {
        const document = parseUsageDocument(response.data, Date.now())
        // A missing field is valid: adapters without `partial-refresh-v1` keep the old transport.
        const refresh =
          response.refresh === undefined
            ? null
            : parseUsageRefreshResult(response.refresh, document, Date.now())
        // Non-enumerable: `parseUsageDocument` still accepts the object and JSON export of the
        // document never carries attempt metadata.
        Object.defineProperty(document, 'refresh', {
          value: refresh,
          enumerable: false,
          configurable: true,
        })
        return document as UsageAdapterResult
      }
      if (response.ok === false && code === 1) {
        const error = usageObject(response.error)
        if (
          !ERROR_CODES.includes(error.code as UsageErrorCode) ||
          !isAppErrorCode(error.code) ||
          (error.retryAfterSeconds !== undefined &&
            (typeof error.retryAfterSeconds !== 'number' ||
              !Number.isFinite(error.retryAfterSeconds) ||
              error.retryAfterSeconds < 0 ||
              error.retryAfterSeconds > 86400))
        )
          throw new AppError('protocol', 'Invalid usage adapter failure response.')
        // Fixed per-code next actions (from the trusted manifest or built in); text the adapter
        // process writes is never transported.
        const action =
          adapter.errorActions?.[error.code as UsageErrorCode] ??
          (error.code === 'auth'
            ? 'Sign in with the CLI or account this adapter uses, then retry.'
            : error.code === 'unsupported'
              ? 'Update the CLI or adapter to a supported version, then retry.'
              : 'Check the account and retry.')
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
