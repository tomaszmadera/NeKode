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
import { AppError } from '../../../shared/ipc-error'
import {
  parseUsageDocument,
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
  type UsagePin,
  type UsageRefreshSkip,
  type UsageSettings,
  type UsageSnapshot,
  type UsageSubscription,
  usageObject,
} from '../../../shared/usage-contract'
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
  error: UsageFailure | null
  refreshing: boolean
  /** Next scheduled read (rules 12-13). */
  due: number
  /** Start of the last read of either action; a manual refresh waits 60 s after it (spec L5). */
  startedAt: number
  /** Provider retry deadline of a `rate_limited` failure; a manual refresh honours it (L5). */
  retryUntil: number
  failures: number
  suspended: boolean
  controller?: AbortController
  flight?: Promise<void>
}
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
    throw new AppError('validation_error', 'Invalid usage connection revisions.')
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

export class UsageService {
  private settings: UsageSettings = empty()
  private connectionRevisions: Record<string, string> = {}
  private readonly runtime = new Map<string, Runtime>()
  private readonly now: () => number
  private readonly host: UsageAdapterHost
  private readonly cacheDirectory: string
  private readonly cachePath: string
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
        this.cacheError = 'Cannot load usage cache identity. Refresh usage to restore it.'
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
        this.cacheError = 'Cannot load usage cache. Refresh usage to restore it.'
      }
    }
    if (deps.startTimer !== false) {
      this.timer = setInterval(() => this.tick(), 1000)
      this.timer.unref?.()
    }
  }
  private newRuntime(): Runtime {
    return {
      subscription: null,
      error: null,
      refreshing: false,
      due: 0,
      startedAt: 0,
      retryUntil: 0,
      failures: 0,
      suspended: false,
    }
  }
  private runtimeFor(id: string): Runtime {
    const runtime = this.runtime.get(id)
    if (!runtime) throw new Error('Usage connection runtime is missing.')
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
    const previous = this.settings.connections.find(
      (p) => p.id === c.id && p.adapterId === c.adapterId,
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
              'Secret encryption is unavailable. Cannot save this account.',
            )
          value = `encrypted:${this.deps.safeStorage.encryptString(value).toString('base64')}`
        }
        if (value !== undefined) config[f.key] = value
      }
      if (f.required && (value === undefined || value === ''))
        throw new AppError('config', `Set ${f.label} before saving this account.`)
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
      return 'Cannot pin this metric: its account is removed or disabled.'
    if (invalidated.has(pin.connectionId))
      return 'Cannot pin this metric: its account settings changed. Pin it after the next refresh.'
    if (
      !this.runtime
        .get(pin.connectionId)
        ?.subscription?.metrics.some((m) => m.id === pin.metricId && m.state !== 'unavailable')
    )
      return 'Cannot pin this metric: its account reports no value for it.'
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
      if (changed && !invalidated.has(c.id)) r.subscription = kept?.subscription ?? null
      // Spec L5: a save without a source change keeps every deadline, so neither a scheduled
      // nor a manual read starts before the interval or a provider retry deadline. A read this
      // save aborts never completed, so only its provider retry deadline remains.
      if (changed && kept && !invalidated.has(c.id)) {
        r.retryUntil = kept.retryUntil
        r.startedAt = kept.flight ? 0 : kept.startedAt
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
    const connections: UsageConnectionSnapshot[] = this.settings.connections
      .filter((c) => c.enabled)
      .map((c) => {
        const { config: _config, ...connection } = c
        const r = this.runtimeFor(c.id)
        const until = removedSource(c) ? 0 : this.manualDeadline(r).until
        return {
          connection,
          subscription: r.subscription,
          error: this.failure(c, r),
          refreshing: r.refreshing,
          nextRefreshAt: this.now() < until ? new Date(until).toISOString() : null,
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
  async refresh(): Promise<UsageSnapshot> {
    const refresh: NonNullable<UsageSnapshot['refresh']> = { read: [], skipped: [] }
    if (this.enabled) {
      const connections = this.settings.connections.filter((c) => c.enabled)
      const runtimes = connections.map((c) => this.runtimeFor(c.id))
      const results = await Promise.all(connections.map((c) => this.collect(c, true)))
      results.forEach((result, index) => {
        // A removed/reconfigured source cannot contribute an obsolete manual outcome.
        if (!this.enabled || this.runtime.get(connections[index].id) !== runtimes[index]) return
        if (result === 'read') refresh.read.push(connections[index].id)
        else if (result) refresh.skipped.push(result)
      })
    }
    return { ...this.read(), refresh }
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
          throw new AppError('config', 'Secret encryption is unavailable. Reconfigure the account.')
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
    return removedSource(c) ? { ...REMOVED_SOURCE } : r.error
  }
  /** Spec L5: earliest manual refresh start, and whether a provider retry deadline sets it. */
  private manualDeadline(r: Runtime): { until: number; reason: UsageRefreshSkip['reason'] } {
    const interval = r.startedAt + MANUAL_REFRESH_MS
    return r.retryUntil >= interval
      ? { until: r.retryUntil, reason: 'backoff' }
      : { until: interval, reason: 'interval' }
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
  ): Promise<UsageSubscription> {
    if (removedSource(c)) throw new AppError('config', USAGE_REMOVED_ADAPTER_MESSAGE)
    const a = this.adapter(c),
      config = this.secrets(c, a)
    const document = parseUsageDocument(
      await this.host.read(a, config, c.id, signal, action),
      this.now(),
    )
    if (action === 'refresh') assertLiveRefresh(document, startedAt)
    // Spec rule 23: the provider id must match only when the service declares one.
    if (
      document.subscriptions.length !== 1 ||
      document.subscriptions[0].id !== c.id ||
      (a.providerId !== undefined && document.subscriptions[0].providerId !== c.providerId)
    )
      throw new AppError(
        'validation_error',
        'Usage source must return one subscription for this account and its provider.',
      )
    return {
      ...document.subscriptions[0],
      providerId: c.providerId,
      label: c.label,
      sourceKind: a.sourceKind,
    }
  }
  async test(raw: UsageConnection): Promise<void> {
    // Rule 12: while off, even an explicit test reads no file and starts no process.
    if (!this.enabled) throw new AppError('config', 'Turn on Show usage quota to test connections.')
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
  ): Promise<'read' | UsageRefreshSkip | null> {
    const r = this.runtimeFor(c.id)
    if (r.flight) {
      await r.flight
      return 'read'
    }
    // Spec L7: an account of a removed source is never collected.
    if (this.stopped || removedSource(c)) return null
    if (explicit) {
      // Spec L5: a manual refresh honours only the 60-second limit and a provider retry deadline;
      // it ignores the adapter minimum interval, growing backoff and suspension.
      const deadline = this.manualDeadline(r)
      if (this.now() < deadline.until)
        return {
          connectionId: c.id,
          until: new Date(deadline.until).toISOString(),
          reason: deadline.reason,
        }
    } else if (r.suspended || this.now() < r.due) return null
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
    r.startedAt = startedAt
    r.due = startedAt + minimum
    r.flight = (async () => {
      try {
        const sub = await this.load(c, controller.signal, explicit ? 'refresh' : 'read', startedAt)
        if (
          controller.signal.aborted ||
          revision !== this.revision ||
          this.runtime.get(c.id) !== r ||
          this.stopped
        )
          return
        // A rename during the read keeps it (spec rule 2); show the current label.
        sub.label = this.settings.connections.find((p) => p.id === c.id)?.label ?? sub.label
        const now = this.now()
        const receivedAt = new Date(now).toISOString()
        sub.metrics = sub.metrics.map((metric) => {
          const previous = r.subscription?.metrics.find((m) => m.id === metric.id)
          const samePeriod =
            previous?.periodStart === metric.periodStart && previous?.resetsAt === metric.resetsAt
          if (
            previous?.observedAt &&
            ((!metric.observedAt && samePeriod) ||
              (metric.observedAt &&
                Date.parse(metric.observedAt) < Date.parse(previous.observedAt)))
          )
            return previous
          return { ...metric, receivedAt }
        })
        r.subscription = sub
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
        r.error = null
        r.failures = 0
        r.suspended = false
        r.retryUntil = 0
        this.persistCache()
        this.exportDocument()
      } catch (error) {
        if (
          controller.signal.aborted ||
          revision !== this.revision ||
          this.runtime.get(c.id) !== r ||
          this.stopped
        )
          return
        r.error = safeFailure(error)
        r.failures++
        r.suspended = ['auth', 'unsupported', 'config'].includes(r.error.code)
        r.retryUntil =
          r.error.code === 'rate_limited' && r.error.retryAfterSeconds
            ? this.now() + r.error.retryAfterSeconds * 1000
            : 0
        if (!r.suspended) {
          r.due =
            this.now() +
            Math.max(
              minimum,
              Math.min(300, 60 * 2 ** Math.min(r.failures - 1, 3)) * 1000,
              (r.error.retryAfterSeconds ?? 0) * 1000,
            )
        }
        this.exportDocument()
      } finally {
        if (revision === this.revision && this.runtime.get(c.id) === r) {
          r.refreshing = false
          r.flight = undefined
          r.controller = undefined
        }
      }
    })()
    await r.flight
    return 'read'
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
