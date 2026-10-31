import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import {
  parseUsageDocument,
  parseUsageRefreshResult,
  parseUsageSettings,
  USAGE_ENABLED_KEY,
  USAGE_MAX_BYTES,
  USAGE_REMOVED_ADAPTER_IDS,
  USAGE_REMOVED_ADAPTER_MESSAGE,
  USAGE_STATE_KEY,
  type UsageAdapter,
  type UsageAdapterAction,
  type UsageConnection,
  type UsageConnectionSnapshot,
  type UsageDocument,
  type UsageFailure,
  type UsageMetric,
  type UsagePin,
  type UsageRefreshRequest,
  type UsageRefreshResult,
  type UsageRefreshSkip,
  type UsageRefreshSourceResult,
  type UsageRefreshWindowResult,
  type UsageSettings,
  type UsageSnapshot,
  type UsageSubscription,
  usageObject,
} from '@shared/contracts/usage-contract'
import { AppError } from '@shared/ipc-error'
import { assertLiveRefresh, discoverUsageAdapters, UsageAdapterHost } from './adapter-host'

interface Storage {
  get(key: string): string | null
  set(key: string, value: string): void
  transaction<T>(fn: () => T): T
}
interface Encryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
interface Runtime {
  subscription: UsageSubscription | null
  /** Last failure of an automatic read; it controls backoff and suspension. */
  error: UsageFailure | null
  /**
   * Last failure of a manual refresh. It never changes automatic polling; the next successful
   * manual refresh or a source change clears it.
   */
  refreshError: UsageFailure | null
  refreshing: boolean
  /** Last manual refresh outcome; survives automatic polls and restarts. */
  refreshResult: UsageRefreshResult | null
  /** Next scheduled read (rules 12-13). */
  due: number
  /**
   * Start of the last manual refresh; the next manual refresh waits 60 s after it (spec L5).
   * Scheduled reads never set it, so they never block a manual refresh.
   */
  manualStartedAt: number
  /**
   * Start of the last manual refresh per agent (spec A9). An agent waits 60 s after the later of
   * its own start and `manualStartedAt`.
   */
  agentManualStartedAt: Map<string, number>
  /** Provider retry deadline of a `rate_limited` failure; a manual refresh honours it (L5). */
  retryUntil: number
  failures: number
  suspended: boolean
  controller?: AbortController
  flight?: Promise<UsageRefreshResult | undefined>
  /** Action of the read in flight; a manual refresh joins only a `refresh`. */
  flightAction?: UsageAdapterAction
  /** Agents of the manual refresh in flight; null when it covers the whole account (A10). */
  flightProviders?: string[] | null
}
/** What one manual refresh reads (spec A9), or why it cannot start yet. */
type ManualPlan =
  | { skip: { until: number; reason: UsageRefreshSkip['reason'] } }
  | { providers: string[] | null; sources: string[] | undefined }
export interface UsageServiceDeps {
  state: Storage
  userDataPath: string
  /** Shipped adapter directories, one per adapter (spec rule 17); see `bundledUsageAdapterDirectories`. */
  bundledAdapterDirectories?: readonly string[]
  safeStorage?: Encryption
  now?: () => number
  host?: UsageAdapterHost
  /** `app.isPackaged`: a packaged app never passes the adapter test seam to adapters. */
  packaged?: boolean
  startTimer?: boolean
  /** Opens a folder in the system file manager; resolves '' on success (shell.openPath). */
  openPath?: (path: string) => Promise<string>
}
/** Spec L5: a manual refresh starts at most once per 60 seconds per account. */
const MANUAL_REFRESH_MS = 60_000
/** Spec L7: an account of a removed passive source is listed and never collected. */
const removedSource = (c: Pick<UsageConnection, 'adapterId'>) =>
  USAGE_REMOVED_ADAPTER_IDS.includes(c.adapterId)
const REMOVED_SOURCE: UsageFailure = { code: 'config', message: USAGE_REMOVED_ADAPTER_MESSAGE }
/** The agent of a metric (spec A2): its own provider id, else the account's. */
const agentOf = (metric: UsageMetric, c: Pick<UsageConnection, 'providerId'>) =>
  metric.providerId ?? c.providerId
const empty = (): UsageSettings => ({
  connections: [],
  pin: null,
  export: { enabled: false, path: null },
})
const CONNECTION_REVISIONS_KEY = 'usage.connection-revisions'
function connectionRevisions(value: unknown): Record<string, string> {
  const revisions = usageObject(value)
  if (
    Object.keys(revisions).length > 100 ||
    Object.entries(revisions).some(
      ([id, revision]) =>
        id.length > 256 ||
        typeof revision !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(revision),
    )
  )
    throw new AppError('validation_error', 'Invalid usage source revisions.')
  return revisions as Record<string, string>
}
/** Equal adapter configurations regardless of key order. */
function sameConfig(a: UsageConnection['config'], b: UsageConnection['config']): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}
const safeFailure = (error: unknown): UsageFailure =>
  error instanceof AppError
    ? {
        code: error.code as UsageFailure['code'],
        message: error.message,
        retryAfterSeconds: (error as AppError & { retryAfterSeconds?: number }).retryAfterSeconds,
      }
    : { code: 'io', message: 'Cannot read usage source. Check its file or adapter configuration.' }

const REFRESH_RESULTS_FILE = 'refresh-results.json'
/** Overall status recomputed after retaining sources that were not attempted this time. */
function refreshStatusOf(sources: UsageRefreshSourceResult[]): UsageRefreshResult['status'] {
  if (
    sources.length > 0 &&
    sources.every(
      (source) =>
        source.status === 'succeeded' &&
        source.windows.every((window) => window.status === 'succeeded'),
    )
  )
    return 'success'
  const succeeded = sources.some(
    (source) =>
      source.status === 'succeeded' ||
      source.windows.some((window) => window.status === 'succeeded'),
  )
  return succeeded ? 'partial' : 'failed'
}
/**
 * Merge a new operation result with the previous one. A source skipped because its retry deadline
 * is still pending keeps its last typed failure and deadline, while a refreshed source replaces
 * both its source and window results. The overall status is recomputed from the merged set.
 */
function mergeRefreshResult(
  previous: UsageRefreshResult | null,
  next: UsageRefreshResult,
  keepMissing: boolean,
): UsageRefreshResult {
  const sources = new Map<string, UsageRefreshSourceResult>()
  if (keepMissing)
    for (const source of previous?.sources ?? []) sources.set(source.sourceId, source)
  for (const source of next.sources) sources.set(source.sourceId, source)
  const merged = [...sources.values()]
  const measurementId = next.measurementId ?? (keepMissing ? previous?.measurementId : undefined)
  const reportId = next.reportId ?? (keepMissing ? previous?.reportId : undefined)
  return {
    status: refreshStatusOf(merged),
    sources: merged,
    requestId: next.requestId,
    ...(measurementId === undefined ? {} : { measurementId }),
    ...(reportId === undefined ? {} : { reportId }),
  }
}
/** The previous-good metric if the new one is older; otherwise the new metric with receipt time. */
function acceptMetric(metric: UsageMetric, previous: UsageMetric | undefined, receivedAt: string) {
  const samePeriod =
    previous?.periodStart === metric.periodStart && previous?.resetsAt === metric.resetsAt
  if (
    previous?.observedAt &&
    ((!metric.observedAt && samePeriod) ||
      (metric.observedAt && Date.parse(metric.observedAt) < Date.parse(previous.observedAt)))
  )
    return previous
  return { ...metric, receivedAt }
}
/**
 * `<agent>-<window>` from a hub adapter to a readable row label; any other id stays unchanged.
 * The metric id itself is never changed, since pins and cache entries use it.
 */
function windowLabel(metricId: string): string {
  const match = /^(.+)-(5h|weekly|monthly)$/.exec(metricId)
  if (!match) return metricId
  const agent = match[1]
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
  return `${agent} ${match[2]}`
}
/**
 * Spec partial merge: succeeded windows replace values (after the L3 and newer-observation
 * checks); a failed window or source keeps the previous value with every date untouched. A failed
 * window without history becomes explicit unavailable with no number.
 */
function mergePartialMetrics(
  previous: UsageSubscription | null,
  next: UsageSubscription,
  windows: UsageRefreshWindowResult[],
  receivedAt: string,
  keepMissing: (metric: UsageMetric) => boolean,
): UsageMetric[] {
  const incoming = new Map(next.metrics.map((metric) => [metric.id, metric]))
  const previousById = new Map((previous?.metrics ?? []).map((metric) => [metric.id, metric]))
  const failed = new Map<string, UsageRefreshWindowResult>()
  for (const window of windows)
    if (window.status !== 'succeeded') failed.set(window.metricId, window)
  const metrics: UsageMetric[] = []
  for (const old of previous?.metrics ?? []) {
    const updated = incoming.get(old.id)
    if (updated) {
      metrics.push(acceptMetric(updated, old, receivedAt))
      incoming.delete(old.id)
    } else {
      // A failed window keeps every previous date. A source not attempted this time (subset
      // refresh) or an agent not selected (A11) also keeps its values; a full refresh drops
      // metrics the operation did not report.
      if (keepMissing(old) || failed.has(old.id)) metrics.push(old)
    }
  }
  for (const [metricId, window] of failed) {
    if (previousById.has(metricId) || incoming.has(metricId)) continue
    metrics.push({
      id: metricId,
      label: windowLabel(metricId),
      kind: 'window',
      observedAt: null,
      state: 'unavailable',
      reason: window.errorCode ?? window.status,
    })
  }
  for (const metric of incoming.values()) {
    metrics.push(acceptMetric(metric, previousById.get(metric.id), receivedAt))
  }
  return metrics
}

export class UsageService {
  private settings: UsageSettings = empty()
  private connectionRevisions: Record<string, string> = {}
  private readonly runtime = new Map<string, Runtime>()
  private readonly now: () => number
  private readonly host: UsageAdapterHost
  private readonly cacheDirectory: string
  private readonly cachePath: string
  private readonly refreshResultsPath: string
  private timer?: ReturnType<typeof setInterval>
  private visible = false
  private stopped = false
  /** Global `Show usage quota` switch (spec rule 1); off schedules nothing. */
  private enabled: boolean
  private revision = 0
  private cacheError: string | null = null
  private exportError: string | null = null
  constructor(private readonly deps: UsageServiceDeps) {
    this.now = deps.now ?? Date.now
    this.host = deps.host ?? new UsageAdapterHost(undefined, { packaged: deps.packaged })
    this.cacheDirectory = join(deps.userDataPath, 'usage')
    this.cachePath = join(this.cacheDirectory, 'observations.json')
    this.refreshResultsPath = join(this.cacheDirectory, REFRESH_RESULTS_FILE)
    this.enabled = deps.state.get(USAGE_ENABLED_KEY) === 'true'
    const saved = deps.state.get(USAGE_STATE_KEY)
    if (saved) {
      try {
        // Settings saved before spec rule 20 may carry the removed adapters directory override.
        const { adaptersDirectory: _legacy, ...stored } = JSON.parse(saved)
        this.settings = parseUsageSettings(stored)
      } catch {
        this.cacheError = 'Cannot load usage settings. Configure usage again.'
      }
    }
    for (const c of this.settings.connections) this.runtime.set(c.id, this.newRuntime())
    const savedRevisions = deps.state.get(CONNECTION_REVISIONS_KEY)
    if (savedRevisions) {
      try {
        this.connectionRevisions = connectionRevisions(JSON.parse(savedRevisions))
      } catch {
        this.cacheError = 'Cannot load usage cache identity. Refresh the account to restore it.'
      }
    }
    if (existsSync(this.cachePath)) {
      try {
        const { connectionRevisions: rawRevisions, ...rawDocument } = usageObject(
          this.readJson(this.cachePath),
        )
        const revisions = rawRevisions === undefined ? {} : connectionRevisions(rawRevisions)
        const document = parseUsageDocument(rawDocument, this.now())
        for (const c of this.settings.connections) {
          if (!revisions[c.id] || revisions[c.id] !== this.connectionRevisions[c.id]) continue
          const sub = document.subscriptions.find(
            (s) => s.id === c.id && s.providerId === c.providerId,
          )
          if (sub) this.runtimeFor(c.id).subscription = { ...sub, label: c.label }
        }
      } catch {
        this.cacheError = 'Cannot load usage cache. Refresh the account to restore it.'
      }
    }
    this.loadRefreshResults()
    if (deps.startTimer !== false) {
      this.timer = setInterval(() => this.tick(), 1000)
      this.timer.unref?.()
    }
  }
  private newRuntime(): Runtime {
    return {
      subscription: null,
      error: null,
      refreshError: null,
      refreshing: false,
      refreshResult: null,
      due: 0,
      manualStartedAt: 0,
      agentManualStartedAt: new Map(),
      retryUntil: 0,
      failures: 0,
      suspended: false,
    }
  }
  private runtimeFor(id: string): Runtime {
    const runtime = this.runtime.get(id)
    if (!runtime) throw new Error('Usage source runtime is missing.')
    return runtime
  }
  getEnabled(): boolean {
    return this.enabled
  }
  /** Turning the switch off cancels in-flight reads and keeps connections, pin and cache. */
  setEnabled(enabled: boolean): boolean {
    if (typeof enabled !== 'boolean')
      throw new AppError('validation_error', 'Invalid usage switch.')
    this.deps.state.transaction(() =>
      this.deps.state.set(USAGE_ENABLED_KEY, enabled ? 'true' : 'false'),
    )
    this.enabled = enabled
    if (!enabled) for (const r of this.runtime.values()) r.controller?.abort()
    else {
      this.exportDocument()
      this.tick()
    }
    return this.enabled
  }
  listAdapters(): UsageAdapter[] {
    try {
      return this.discover()
    } catch {
      throw new AppError('io', 'Cannot read usage adapters directory. Check its permissions.')
    }
  }
  private discover(): UsageAdapter[] {
    return discoverUsageAdapters(
      join(this.deps.userDataPath, 'usage-adapters'),
      this.deps.bundledAdapterDirectories,
    )
  }
  getSettings(): UsageSettings {
    const settings = structuredClone(this.settings)
    for (const c of settings.connections) {
      c.secretKeys = []
      for (const [key, value] of Object.entries(c.config))
        if (typeof value === 'string' && value.startsWith('encrypted:')) {
          c.secretKeys.push(key)
          delete c.config[key]
        }
    }
    return settings
  }
  private adapter(c: UsageConnection): UsageAdapter {
    const adapters = this.discover()
    const matches = adapters.filter((a) => a.id === c.adapterId)
    if (matches.length !== 1 || matches[0].error)
      throw new AppError('config', 'Usage adapter is unavailable. Select a valid adapter.')
    return matches[0]
  }
  private checkedPath(path: string, mustExist: boolean): string {
    if (!isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).includes('..'))
      throw new AppError('validation_error', 'Usage paths must be absolute without traversal.')
    const absolute = resolve(path)
    let current = absolute
    while (current !== parse(current).root) {
      // lstat, not exists: a dangling link at a not-yet-existing path is still an alias.
      let link = false
      try {
        link = lstatSync(current).isSymbolicLink()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new AppError('config', 'Cannot inspect usage path. Check its permissions.')
      }
      if (link) throw new AppError('config', 'Usage paths cannot use symbolic links or junctions.')
      current = dirname(current)
    }
    if (mustExist && !existsSync(absolute))
      throw new AppError('config', 'Usage path does not exist.')
    let parent: string
    try {
      parent = realpathSync(dirname(absolute))
    } catch {
      throw new AppError('config', 'Usage path folder does not exist. Choose an existing folder.')
    }
    return join(parent, absolute.slice(dirname(absolute).length + 1))
  }
  private pathKey(path: string): string {
    return resolve(path).toLowerCase()
  }
  private validatePaths(settings: UsageSettings): void {
    const inputs: string[] = []
    for (const c of settings.connections) {
      // Spec L7: a removed source reads nothing, so its stored paths are not inputs.
      if (removedSource(c)) continue
      const a = this.adapter(c)
      for (const f of a.configSchema) {
        if (f.type !== 'file' || typeof c.config[f.key] !== 'string' || !c.config[f.key]) continue
        inputs.push(this.checkedPath(c.config[f.key] as string, false))
      }
    }
    const cache = this.pathKey(this.cacheDirectory)
    if (
      inputs.some(
        (p) =>
          this.pathKey(p) === cache ||
          this.pathKey(p).startsWith(`${cache}\\`) ||
          this.pathKey(p).startsWith(`${cache}/`),
      )
    )
      throw new AppError('config', 'Usage input cannot be inside the usage cache.')
    if (!settings.export.enabled) return
    if (!settings.export.path)
      throw new AppError('config', 'Choose an output file for usage export.')
    const output = this.checkedPath(settings.export.path, false),
      key = this.pathKey(output)
    if (
      key === cache ||
      key.startsWith(`${cache}\\`) ||
      key.startsWith(`${cache}/`) ||
      inputs.some((p) => {
        if (this.pathKey(p) === key) return true
        if (!existsSync(output) || !existsSync(p)) return false
        const a = statSync(p),
          b = statSync(output)
        return a.dev === b.dev && a.ino === b.ino
      })
    )
      throw new AppError('config', 'Usage output must differ from every input and cache path.')
    if (
      existsSync(output) &&
      !(this.settings.export.enabled && this.pathKey(this.settings.export.path ?? '') === key) &&
      !settings.export.replaceExisting
    ) {
      throw new AppError(
        'conflict',
        'Output file already exists. Explicitly choose Replace existing file to overwrite it.',
      )
    }
  }
  private prepare(c: UsageConnection): UsageConnection {
    const previous = this.settings.connections.find((p) => p.id === c.id)
    if (previous && previous.adapterId !== c.adapterId)
      throw new AppError(
        'validation_error',
        'The adapter of a saved source cannot change. Remove the source and add another.',
      )
    if (removedSource(c)) {
      // Spec L7: a stored account of a removed source keeps its configuration and provider until
      // the user removes it; no new account of such a service can be added.
      if (!previous) throw new AppError('config', USAGE_REMOVED_ADAPTER_MESSAGE)
      return { ...c, providerId: previous.providerId, config: previous.config }
    }
    const a = this.adapter(c),
      config = { ...c.config }
    // Spec rule 20: a stored field the adapter no longer declares is dropped; a new one is rejected.
    const unknown = Object.keys(config).find(
      (k) => !a.configSchema.some((f) => f.key === k) && previous?.config[k] !== config[k],
    )
    if (unknown !== undefined)
      throw new AppError(
        'validation_error',
        `Unknown usage adapter configuration field "${unknown}".`,
      )
    for (const f of a.configSchema) {
      let value = config[f.key]
      if (f.type === 'secret') {
        if (value === undefined && previous) value = previous.config[f.key]
        else if (typeof value === 'string' && value !== '') {
          if (value.startsWith('encrypted:'))
            throw new AppError(
              'validation_error',
              'Secret values must be supplied through the write-only field.',
            )
          if (!this.deps.safeStorage?.isEncryptionAvailable())
            throw new AppError(
              'config',
              'Secret encryption is unavailable. Cannot save this source.',
            )
          value = `encrypted:${this.deps.safeStorage.encryptString(value).toString('base64')}`
        }
        if (value !== undefined) config[f.key] = value
      }
      if (f.required && (value === undefined || value === ''))
        throw new AppError('config', `Set ${f.label} before saving this source.`)
      if (
        value !== undefined &&
        (f.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string')
      )
        throw new AppError('validation_error', 'Invalid usage adapter field type.')
      if (f.type === 'choice' && value !== undefined && !f.choices?.includes(value as string))
        throw new AppError('validation_error', 'Invalid usage adapter choice.')
    }
    return { ...c, config: this.declared(config, a), providerId: this.providerFor(c, a, config) }
  }
  /** Spec rule 20: the configuration as the adapter declares it, in schema order, so field order
   * and fields the adapter no longer declares never change account identity. */
  private declared(config: UsageConnection['config'], a: UsageAdapter): UsageConnection['config'] {
    const declared: UsageConnection['config'] = {}
    for (const f of a.configSchema) if (config[f.key] !== undefined) declared[f.key] = config[f.key]
    return declared
  }
  /** Spec rule 23: the service's declared id, otherwise the adapter id. */
  private providerFor(
    c: UsageConnection,
    a: UsageAdapter,
    config: UsageConnection['config'],
  ): string {
    const stored = this.settings.connections.find((p) => p.id === c.id && p.adapterId === a.id)
    // Criterion 15: saving one account leaves every other stored account unchanged,
    // including a provider id stored before services declared theirs.
    if (
      stored?.providerId &&
      c.providerId === stored.providerId &&
      c.label === stored.label &&
      c.enabled === stored.enabled &&
      sameConfig(config, stored.config)
    )
      return stored.providerId
    return a.providerId ?? a.id
  }
  /** Spec rule 26: create the user adapters folder when missing and open it. */
  async openAdaptersFolder(): Promise<void> {
    const dir = join(this.deps.userDataPath, 'usage-adapters')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      throw new AppError('io', 'Cannot create the usage adapters folder. Check its permissions.')
    }
    if (!this.deps.openPath)
      throw new AppError('not_found', 'Cannot open folders in this NeKode build.')
    if (await this.deps.openPath(dir))
      throw new AppError('io', 'Cannot open the usage adapters folder.')
  }
  /** Why `pin` cannot target a metric under `next`, or null when it can. */
  private pinRefusal(pin: UsagePin, next: UsageSettings, invalidated: Set<string>): string | null {
    if (!next.connections.some((c) => c.id === pin.connectionId && c.enabled))
      return 'Cannot pin this metric: its source is removed or disabled.'
    if (invalidated.has(pin.connectionId))
      return 'Cannot pin this metric: its source settings changed. Pin it after the next refresh.'
    if (
      !this.runtime
        .get(pin.connectionId)
        ?.subscription?.metrics.some((m) => m.id === pin.metricId && m.state !== 'unavailable')
    )
      return 'Cannot pin this metric: its source reports no value for it.'
    return null
  }
  saveSettings(raw: UsageSettings): UsageSettings {
    const next = parseUsageSettings(raw)
    next.connections = next.connections.map((c) => this.prepare(c))
    this.validatePaths(next)
    // Spec rule 2 and L5: only a changed source (provider, adapter, or configuration) invalidates
    // an account's data, pin target, and deadlines; a label is display only.
    const invalidated = new Set<string>()
    for (const c of next.connections) {
      const previous = this.settings.connections.find((p) => p.id === c.id)
      if (
        !previous ||
        previous.providerId !== c.providerId ||
        previous.adapterId !== c.adapterId ||
        JSON.stringify(
          removedSource(c) ? previous.config : this.declared(previous.config, this.adapter(c)),
        ) !== JSON.stringify(c.config)
      )
        invalidated.add(c.id)
    }
    const refusal = next.pin && this.pinRefusal(next.pin, next, invalidated)
    if (next.pin && refusal) {
      const current = this.settings.pin
      // Spec rule 9: a new pin request reports why it failed; a kept pin whose target is gone clears.
      if (current?.connectionId !== next.pin.connectionId || current.metricId !== next.pin.metricId)
        throw new AppError('validation_error', refusal)
      next.pin = null
    }
    next.export.replaceExisting = undefined
    const revisions = Object.fromEntries(
      next.connections.map((c) => [
        c.id,
        invalidated.has(c.id) ? randomUUID() : (this.connectionRevisions[c.id] ?? randomUUID()),
      ]),
    )
    this.deps.state.transaction(() => {
      this.deps.state.set(USAGE_STATE_KEY, JSON.stringify(next))
      this.deps.state.set(CONNECTION_REVISIONS_KEY, JSON.stringify(revisions))
    })
    this.connectionRevisions = revisions
    const old = this.runtime
    const retained = new Map(old)
    for (const [id, r] of retained)
      if (invalidated.has(id) || !next.connections.some((c) => c.id === id && c.enabled))
        r.controller?.abort()
    old.clear()
    for (const c of next.connections) {
      const previous = this.settings.connections.find((p) => p.id === c.id)
      const changed = invalidated.has(c.id) || previous?.enabled !== c.enabled
      const r = changed ? this.newRuntime() : (retained.get(c.id) ?? this.newRuntime())
      const kept = retained.get(c.id)
      if (changed && !invalidated.has(c.id)) {
        r.subscription = kept?.subscription ?? null
        r.refreshResult = kept?.refreshResult ?? null
      }
      // Spec L5: a save without a source change keeps every deadline, so neither a scheduled
      // nor a manual read starts before the interval or a provider retry deadline. A read this
      // save aborts never completed, so only its provider retry deadline remains.
      if (changed && kept && !invalidated.has(c.id)) {
        r.retryUntil = kept.retryUntil
        const aborted = kept.flight !== undefined && kept.flightAction === 'refresh'
        r.manualStartedAt = aborted && kept.flightProviders === null ? 0 : kept.manualStartedAt
        r.agentManualStartedAt = new Map(kept.agentManualStartedAt)
        if (aborted)
          for (const agent of kept.flightProviders ?? []) r.agentManualStartedAt.delete(agent)
        r.due = kept.flight ? kept.retryUntil : Math.max(kept.due, kept.retryUntil)
      }
      if (r.subscription && r.subscription.label !== c.label)
        r.subscription = { ...r.subscription, label: c.label }
      old.set(c.id, r)
    }
    this.settings = next
    this.persistCache()
    this.exportDocument()
    this.tick()
    return this.getSettings()
  }
  read(): UsageSnapshot {
    let adapters: UsageAdapter[] = []
    try {
      adapters = this.discover()
    } catch {
      /* Collection reports an unreadable adapters directory on the account. */
    }
    const at = (plan: ManualPlan) =>
      'skip' in plan ? new Date(plan.skip.until).toISOString() : null
    const connections: UsageConnectionSnapshot[] = this.settings.connections
      .filter((c) => c.enabled)
      .map((c) => {
        const { config: _config, ...connection } = c
        const r = this.runtimeFor(c.id)
        const supported = this.agentSupport(c, adapters)
        return {
          connection,
          subscription: r.subscription,
          error: this.failure(c, r),
          refreshing: r.refreshing,
          nextRefreshAt: removedSource(c) ? null : at(this.manualPlan(c, r, supported)),
          agents: supported
            ? this.agentsOf(c, r).map((providerId) => ({
                providerId,
                nextRefreshAt: at(this.manualPlan(c, r, supported, providerId)),
              }))
            : null,
          refreshResult: r.refreshResult,
        }
      })
    return structuredClone({
      connections,
      pin: this.settings.pin,
      cacheError: this.cacheError,
      exportError: this.exportError,
    })
  }
  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) this.tick()
  }
  private tick(): void {
    if (this.visible && !this.stopped && this.enabled)
      for (const c of this.settings.connections) if (c.enabled) void this.collect(c, false)
  }
  /** Spec A6: a manual refresh of one account, or of one agent of an account with support. */
  async refresh(request: UsageRefreshRequest): Promise<UsageSnapshot> {
    const refresh: NonNullable<UsageSnapshot['refresh']> = { read: [], skipped: [] }
    const c = this.settings.connections.find((p) => p.id === request.connectionId && p.enabled)
    if (!c) throw new AppError('not_found', 'Usage source is not configured or is disabled.')
    const r = this.runtimeFor(c.id)
    const { providerId } = request
    if (providerId !== undefined) {
      if (!this.agentSupport(c))
        throw new AppError('validation_error', 'This usage source cannot refresh one agent.')
      if (!this.agentsOf(c, r).includes(providerId))
        throw new AppError('not_found', 'This usage source reports no such agent.')
    }
    if (this.enabled) {
      const result = await this.collect(c, true, providerId)
      // A removed/reconfigured source cannot contribute an obsolete manual outcome.
      if (this.enabled && this.runtime.get(c.id) === r) {
        if (result && 'read' in result) {
          refresh.read.push(c.id)
          if (result.result) refresh.result = result.result
        } else if (result) refresh.skipped.push(result)
      }
    }
    return { ...this.read(), refresh }
  }
  /** Spec A7: the adapter declares `refreshOptions: ["providers"]`. */
  private agentSupport(c: UsageConnection, adapters?: UsageAdapter[]): boolean {
    if (removedSource(c)) return false
    let a: UsageAdapter
    try {
      if (adapters) {
        const matches = adapters.filter((p) => p.id === c.adapterId)
        if (matches.length !== 1 || matches[0].error) return false
        a = matches[0]
      } else a = this.adapter(c)
    } catch {
      /* Collection reports an unavailable adapter on the account. */
      return false
    }
    return a.refreshOptions?.includes('providers') === true
  }
  /** Agents of the retained metrics, in the order they first appear (spec A2). */
  private agentsOf(c: UsageConnection, r: Runtime): string[] {
    const agents: string[] = []
    for (const metric of r.subscription?.metrics ?? []) {
      const agent = agentOf(metric, c)
      if (!agents.includes(agent)) agents.push(agent)
    }
    return agents
  }
  private agentDeadline(r: Runtime, agent: string): number {
    return Math.max(r.manualStartedAt, r.agentManualStartedAt.get(agent) ?? 0) + MANUAL_REFRESH_MS
  }
  private readJson(path: string): unknown {
    if (statSync(path).size > USAGE_MAX_BYTES)
      throw new AppError('validation_error', 'Usage file exceeds 1 MiB.')
    const bytes = readFileSync(path)
    if (bytes.length > USAGE_MAX_BYTES)
      throw new AppError('validation_error', 'Usage file exceeds 1 MiB.')
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        'protocol',
        'Cannot parse usage file. Write one complete version 1 JSON document.',
      )
    }
  }
  private secrets(c: UsageConnection, a: UsageAdapter): Record<string, string | boolean> {
    const config = { ...c.config }
    for (const f of a.configSchema.filter((f) => f.type === 'secret')) {
      const value = config[f.key]
      if (typeof value === 'string' && value.startsWith('encrypted:')) {
        if (!this.deps.safeStorage?.isEncryptionAvailable())
          throw new AppError('config', 'Secret encryption is unavailable. Reconfigure the source.')
        try {
          config[f.key] = this.deps.safeStorage.decryptString(
            Buffer.from(value.slice(10), 'base64'),
          )
        } catch {
          throw new AppError(
            'config',
            'Cannot decrypt usage secret. Enter it again in Usage settings.',
          )
        }
      }
    }
    return config
  }
  /** Spec L7: an account of a removed source always reports the fixed configuration error. */
  private failure(c: UsageConnection, r: Runtime): UsageFailure | null {
    return removedSource(c) ? { ...REMOVED_SOURCE } : (r.error ?? r.refreshError)
  }
  /**
   * Spec L5, A9 and the partial contract: what a manual refresh of the account, or of one agent,
   * reads now, or the deadline and reason that skip it.
   */
  private manualPlan(
    c: UsageConnection,
    r: Runtime,
    supported: boolean,
    providerId?: string,
  ): ManualPlan {
    const now = this.now()
    const agents = supported ? this.agentsOf(c, r) : []
    if (providerId === undefined && agents.length > 0) {
      // A9: compare each agent's combined interval and provider deadline. The first interval
      // alone may belong to an agent still in backoff, while another agent can read sooner.
      const plans = agents.map((agent) => this.manualPlan(c, r, supported, agent))
      if (plans.every((plan) => 'skip' in plan))
        return plans.reduce((earliest, plan) =>
          plan.skip.until < earliest.skip.until ? plan : earliest,
        )
    }
    let providers: string[] | null = null
    let interval: number
    if (providerId !== undefined) {
      providers = [providerId]
      interval = this.agentDeadline(r, providerId)
    } else if (agents.length > 0) {
      const ready = agents.filter((agent) => this.agentDeadline(r, agent) <= now)
      interval = ready.length ? 0 : Math.min(...agents.map((a) => this.agentDeadline(r, a)))
      if (ready.length > 0 && ready.length < agents.length) providers = ready
    } else interval = r.manualStartedAt + MANUAL_REFRESH_MS
    // Retry is per source; an agent selection counts only the sources holding its metrics.
    const selected = providers
    const agentByMetric = new Map((r.subscription?.metrics ?? []).map((m) => [m.id, agentOf(m, c)]))
    const sources = (r.refreshResult?.sources ?? []).filter(
      (source) =>
        !selected ||
        source.windows.some((w) => selected.includes(agentByMetric.get(w.metricId) ?? '')),
    )
    const blockedUntil = (source: UsageRefreshSourceResult) => {
      const until = source.nextAllowedAt ? Date.parse(source.nextAllowedAt) : Number.NaN
      return Number.isFinite(until) && until > now ? until : 0
    }
    const eligible = sources.filter((source) => blockedUntil(source) === 0)
    const sourceUntil =
      sources.length > 0 && eligible.length === 0 ? Math.min(...sources.map(blockedUntil)) : 0
    const provider = Math.max(r.retryUntil, sourceUntil)
    if (now < Math.max(interval, provider))
      return {
        skip:
          provider >= interval && provider > 0
            ? { until: provider, reason: 'backoff' }
            : { until: interval, reason: 'interval' },
      }
    return {
      providers,
      sources:
        eligible.length === sources.length ? undefined : eligible.map((source) => source.sourceId),
    }
  }
  /**
   * One adapter read. `refresh` (manual) responses must be live (spec L3): every available metric
   * observed no earlier than `startedAt`.
   */
  private async load(
    c: UsageConnection,
    signal: AbortSignal,
    action: UsageAdapterAction,
    startedAt: number,
    refreshSources?: string[],
    refreshProviders?: string[],
  ): Promise<{ subscription: UsageSubscription; refresh: UsageRefreshResult | null }> {
    if (removedSource(c)) throw new AppError('config', USAGE_REMOVED_ADAPTER_MESSAGE)
    const a = this.adapter(c),
      config = this.secrets(c, a)
    const result = await this.host.read(a, config, c.id, signal, action, {
      ...(refreshSources === undefined ? {} : { refreshSources }),
      ...(refreshProviders === undefined ? {} : { refreshProviders }),
    })
    const document = result
    if (action === 'refresh') assertLiveRefresh(document, startedAt)
    // Spec A8: an agent refresh may return only metrics of the selected agents.
    if (
      refreshProviders &&
      document.subscriptions.some((sub) =>
        sub.metrics.some((m) => !refreshProviders.includes(agentOf(m, c))),
      )
    )
      throw new AppError('protocol', 'Usage adapter returned metrics outside the selected agents.')
    // Spec rule 23: the provider id must match only when the service declares one.
    if (
      document.subscriptions.length !== 1 ||
      document.subscriptions[0].id !== c.id ||
      (a.providerId !== undefined && document.subscriptions[0].providerId !== c.providerId)
    )
      throw new AppError(
        'validation_error',
        'Usage source must return one subscription for this source and its provider.',
      )
    return {
      subscription: {
        ...document.subscriptions[0],
        providerId: c.providerId,
        label: c.label,
        sourceKind: a.sourceKind,
      },
      refresh: result.refresh,
    }
  }
  async test(raw: UsageConnection): Promise<void> {
    // Rule 12: while off, even an explicit test reads no file and starts no process.
    if (!this.enabled) throw new AppError('config', 'Turn on Show usage quota to test sources.')
    const settings = parseUsageSettings({
      ...this.getSettings(),
      connections: [raw],
      pin: null,
      export: { enabled: false, path: null },
    })
    const c = this.prepare(settings.connections[0])
    settings.connections = [c]
    this.validatePaths(settings)
    await this.load(c, new AbortController().signal, 'read', this.now())
  }
  private async collect(
    c: UsageConnection,
    explicit: boolean,
    providerId?: string,
  ): Promise<{ read: true; result: UsageRefreshResult | undefined } | UsageRefreshSkip | null> {
    const r = this.runtimeFor(c.id)
    // Spec L5 and A10: a manual refresh joins a refresh in flight that covers its selection. A
    // scheduled read, or a refresh of other agents, in flight makes it wait and then start its own.
    while (r.flight) {
      const covers =
        r.flightAction === 'refresh' &&
        (r.flightProviders === null ||
          (providerId !== undefined && r.flightProviders?.includes(providerId) === true))
      if (!explicit || covers) {
        return { read: true, result: await r.flight }
      }
      const running = r.flight
      await running
      // An obsolete runtime or a flight not cleared (shutdown) ends the wait without a read.
      if (this.stopped || this.runtime.get(c.id) !== r || r.flight === running) return null
    }
    // Spec L7: an account of a removed source is never collected.
    if (this.stopped || removedSource(c)) return null
    // Spec L5, A9 and the partial contract: a manual refresh honours only the 60-second limits and
    // provider retry deadlines; it ignores the adapter minimum interval, growing backoff and
    // suspension. Retry is per source, so blocked sources keep their typed result.
    let refreshSources: string[] | undefined
    let refreshProviders: string[] | null = null
    if (explicit) {
      const plan = this.manualPlan(c, r, this.agentSupport(c), providerId)
      if ('skip' in plan)
        return {
          connectionId: c.id,
          ...(providerId === undefined ? {} : { providerId }),
          until: new Date(plan.skip.until).toISOString(),
          reason: plan.skip.reason,
        }
      refreshSources = plan.sources
      refreshProviders = plan.providers
    } else if (r.suspended || this.now() < r.due) return null
    const selection = refreshProviders
    const revision = this.revision,
      controller = new AbortController(),
      startedAt = this.now()
    r.controller = controller
    r.refreshing = true
    r.suspended = false
    let minimum = 60_000
    try {
      minimum = Math.max(60_000, this.adapter(c).minimumRefreshSeconds * 1000)
    } catch {
      /* Collection reports the actionable configuration failure. */
    }
    if (explicit && selection === null) r.manualStartedAt = startedAt
    for (const agent of selection ?? []) r.agentManualStartedAt.set(agent, startedAt)
    r.due = startedAt + minimum
    r.flightAction = explicit ? 'refresh' : 'read'
    r.flightProviders = explicit ? selection : undefined
    r.flight = (async () => {
      try {
        const loaded = await this.load(
          c,
          controller.signal,
          explicit ? 'refresh' : 'read',
          startedAt,
          refreshSources,
          selection ?? undefined,
        )
        if (
          controller.signal.aborted ||
          revision !== this.revision ||
          this.runtime.get(c.id) !== r ||
          this.stopped
        )
          return
        const sub = loaded.subscription
        // A rename during the read keeps it (spec rule 2); show the current label.
        sub.label = this.settings.connections.find((p) => p.id === c.id)?.label ?? sub.label
        const now = this.now()
        const receivedAt = new Date(now).toISOString()
        const refresh = explicit ? loaded.refresh : null
        // Spec A11: metrics of agents outside the selection keep their values and dates.
        const keepMissing = (metric: UsageMetric) =>
          refreshSources !== undefined ||
          (selection !== null && !selection.includes(agentOf(metric, c)))
        if (refresh || selection) {
          sub.metrics = mergePartialMetrics(
            r.subscription,
            sub,
            refresh?.sources.flatMap((source) => source.windows) ?? [],
            receivedAt,
            keepMissing,
          )
          sub.status = sub.metrics.some((metric) => metric.state !== 'unavailable')
            ? 'available'
            : 'unavailable'
        } else {
          sub.metrics = sub.metrics.map((metric) =>
            acceptMetric(
              metric,
              r.subscription?.metrics.find((m) => m.id === metric.id),
              receivedAt,
            ),
          )
        }
        r.subscription = sub
        if (explicit)
          r.refreshResult = refresh
            ? mergeRefreshResult(
                r.refreshResult,
                refresh,
                refreshSources !== undefined || selection !== null,
              )
            : null
        if (
          this.settings.pin?.connectionId === c.id &&
          !sub.metrics.some((m) => m.id === this.settings.pin?.metricId)
        ) {
          const settings = { ...this.settings, pin: null }
          this.deps.state.transaction(() =>
            this.deps.state.set(USAGE_STATE_KEY, JSON.stringify(settings)),
          )
          this.settings = settings
        }
        // An automatic read keeps a provider retry deadline from a failed manual refresh (L5).
        if (explicit) {
          r.refreshError = null
          r.retryUntil = 0
        }
        r.error = null
        r.failures = 0
        r.suspended = false
        this.persistCache()
        this.exportDocument()
        return refresh ?? undefined
      } catch (error) {
        if (
          controller.signal.aborted ||
          revision !== this.revision ||
          this.runtime.get(c.id) !== r ||
          this.stopped
        )
          return
        const failure = safeFailure(error)
        const retryUntil =
          failure.code === 'rate_limited' && failure.retryAfterSeconds
            ? this.now() + failure.retryAfterSeconds * 1000
            : 0
        if (explicit || retryUntil > 0) r.retryUntil = retryUntil
        if (explicit) {
          // NEKODE-147: a failed manual refresh stays with this account and leaves automatic
          // reads on their adapter-minimum schedule; only read failures back off or suspend.
          r.refreshError = failure
        } else {
          r.error = failure
          r.failures++
          r.suspended = ['auth', 'unsupported', 'config'].includes(failure.code)
          if (!r.suspended) {
            r.due =
              this.now() +
              Math.max(
                minimum,
                Math.min(300, 60 * 2 ** Math.min(r.failures - 1, 3)) * 1000,
                (failure.retryAfterSeconds ?? 0) * 1000,
              )
          }
        }
        this.exportDocument()
        if (explicit) this.persistRefreshResults()
      } finally {
        if (revision === this.revision && this.runtime.get(c.id) === r) {
          r.refreshing = false
          r.flight = undefined
          r.flightAction = undefined
          r.flightProviders = undefined
          r.controller = undefined
        }
      }
    })()
    return { read: true, result: await r.flight }
  }
  private document(): UsageDocument {
    return {
      schemaVersion: 1,
      subscriptions: this.settings.connections
        .filter((c) => c.enabled)
        .map((c) => {
          const r = this.runtimeFor(c.id)
          return r.subscription
            ? { ...r.subscription, status: this.failure(c, r) ? 'error' : r.subscription.status }
            : {
                id: c.id,
                providerId: c.providerId,
                label: c.label,
                // Exported documents keep `file` for accounts of removed passive sources (L6).
                sourceKind: removedSource(c) ? 'file' : this.adapter(c).sourceKind,
                metrics: [],
                status: this.failure(c, r) ? 'error' : 'unavailable',
              }
        }),
    }
  }
  private atomicWrite(
    path: string,
    document: UsageDocument,
    revisions?: Record<string, string>,
  ): void {
    const text = JSON.stringify(
      {
        ...parseUsageDocument(document, this.now()),
        ...(revisions ? { connectionRevisions: revisions } : {}),
      },
      null,
      2,
    )
    if (Buffer.byteLength(text) > USAGE_MAX_BYTES)
      throw new AppError('io', 'Usage output exceeds 1 MiB.')
    const temporary = `${path}.${randomUUID()}.tmp`
    let created = false
    try {
      writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
      created = true
      renameSync(temporary, path)
    } finally {
      if (created && existsSync(temporary)) unlinkSync(temporary)
    }
  }
  /** Restore the typed manual-refresh outcome only for the matching connection revision. */
  private loadRefreshResults(): void {
    if (!existsSync(this.refreshResultsPath)) return
    try {
      const raw = usageObject(this.readJson(this.refreshResultsPath))
      const revisions =
        raw.connectionRevisions === undefined ? {} : connectionRevisions(raw.connectionRevisions)
      const results = raw.results === undefined ? {} : usageObject(raw.results)
      for (const c of this.settings.connections) {
        if (!revisions[c.id] || revisions[c.id] !== this.connectionRevisions[c.id]) continue
        const r = this.runtimeFor(c.id)
        const value = results[c.id]
        if (value === undefined) continue
        // Structural validation only: the stored result predates the merged subscription and its
        // failed windows intentionally have no metric in the current document.
        r.refreshResult = parseUsageRefreshResult(value, undefined, this.now())
      }
    } catch {
      this.cacheError = 'Cannot load usage refresh results. Refresh the account to restore them.'
    }
  }
  /**
   * Persist per-source retry deadlines and the typed outcome under the usage cache, keyed by the
   * connection revision. The export document never carries this attempt metadata.
   */
  private persistRefreshResults(): void {
    try {
      const results: Record<string, UsageRefreshResult> = {}
      for (const c of this.settings.connections) {
        const result = this.runtime.get(c.id)?.refreshResult
        if (result) results[c.id] = result
      }
      const text = JSON.stringify(
        { connectionRevisions: this.connectionRevisions, results },
        null,
        2,
      )
      if (Buffer.byteLength(text) > USAGE_MAX_BYTES)
        throw new AppError('io', 'Usage refresh results exceed 1 MiB.')
      mkdirSync(this.cacheDirectory, { recursive: true })
      const temporary = `${this.refreshResultsPath}.${randomUUID()}.tmp`
      let created = false
      try {
        writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
        created = true
        renameSync(temporary, this.refreshResultsPath)
      } finally {
        if (created && existsSync(temporary)) unlinkSync(temporary)
      }
    } catch {
      this.cacheError =
        'Cannot write usage refresh results. Current data remains available until restart.'
    }
  }
  private persistCache(): void {
    try {
      if (this.settings.connections.some((c) => !this.connectionRevisions[c.id])) {
        const revisions = Object.fromEntries(
          this.settings.connections.map((c) => [
            c.id,
            this.connectionRevisions[c.id] ?? randomUUID(),
          ]),
        )
        this.deps.state.transaction(() =>
          this.deps.state.set(CONNECTION_REVISIONS_KEY, JSON.stringify(revisions)),
        )
        this.connectionRevisions = revisions
      }
      mkdirSync(this.cacheDirectory, { recursive: true })
      this.checkedPath(this.cachePath, false)
      this.atomicWrite(this.cachePath, this.document(), this.connectionRevisions)
      this.cacheError = null
      this.persistRefreshResults()
    } catch {
      this.cacheError = 'Cannot write usage cache. Current data remains available until restart.'
    }
  }
  private exportDocument(): void {
    // While the switch is off nothing is written; the last export and its error are retained.
    if (!this.enabled) return
    if (!this.settings.export.enabled) {
      this.exportError = null
      return
    }
    try {
      this.validatePaths(this.settings)
      const path = this.settings.export.path
      if (!path) throw new AppError('config', 'Choose an output file for usage export.')
      this.atomicWrite(path, this.document())
      this.exportError = null
    } catch {
      this.exportError =
        'Usage export failed. Check the output path and permissions; the previous file is retained.'
    }
  }
  shutdown(): void {
    this.stopped = true
    this.revision++
    if (this.timer) clearInterval(this.timer)
    for (const r of this.runtime.values()) r.controller?.abort()
    this.host.shutdown()
  }
}
