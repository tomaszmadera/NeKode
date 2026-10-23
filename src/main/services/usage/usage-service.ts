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
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { AppError } from '../../../shared/ipc-error'
import {
  parseUsageDocument,
  parseUsageSettings,
  USAGE_ENABLED_KEY,
  USAGE_MAX_BYTES,
  USAGE_STATE_KEY,
  type UsageAdapter,
  type UsageClaudeSetup,
  type UsageConnection,
  type UsageConnectionSnapshot,
  type UsageDocument,
  type UsageFailure,
  type UsageFileSubscription,
  type UsagePin,
  type UsageSettings,
  type UsageSnapshot,
  type UsageSubscription,
  usageObject,
} from '../../../shared/usage-contract'
import { discoverUsageAdapters, FILE_ADAPTER, UsageAdapterHost } from './adapter-host'
import { CLAUDE_SNAPSHOT_ADAPTER, newerWindow, readClaudeSnapshots } from './claude-snapshots'

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
  due: number
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
  /** Claude snapshot writer setup script (`claudeSetupScriptPath`, spec rule 24). */
  claudeSetupScript?: string
  /** Home directory holding `.claude/settings.json`; defaults to the OS home. */
  homeDirectory?: string
  /** Opens a folder in the system file manager; resolves '' on success (shell.openPath). */
  openPath?: (path: string) => Promise<string>
}
/** Connection ids that can name a proposed Claude directory (spec rule 24). */
const DIRECTORY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
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
/** Rule 16 comparison key of an available age-unknown window metric. */
/** Equal adapter configurations regardless of key order. */
function sameConfig(a: UsageConnection['config'], b: UsageConnection['config']): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}
function windowKey(metric: UsageSubscription['metrics'][number]) {
  if (metric.state !== 'available' || typeof metric.usedPercent !== 'number') return null
  return {
    usedPercent: metric.usedPercent,
    resetsAt: metric.resetsAt ? Date.parse(metric.resetsAt) / 1000 : null,
  }
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
    const inputs: string[] = [],
      directories: string[] = []
    for (const c of settings.connections) {
      const a = this.adapter(c)
      for (const f of a.configSchema) {
        if ((f.type !== 'file' && f.type !== 'directory') || typeof c.config[f.key] !== 'string')
          continue
        if (!c.config[f.key]) continue
        const path = this.checkedPath(c.config[f.key] as string, false)
        if (f.type === 'directory') {
          if (existsSync(path) && !lstatSync(path).isDirectory())
            throw new AppError('config', 'Claude snapshot directory must be a folder.')
          directories.push(path)
        }
        inputs.push(path)
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
      directories.some((d) => {
        const dir = this.pathKey(d)
        return key.startsWith(`${dir}\\`) || key.startsWith(`${dir}/`)
      }) ||
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
    const a = this.adapter(c),
      config = { ...c.config }
    const previous = this.settings.connections.find(
      (p) => p.id === c.id && p.adapterId === c.adapterId,
    )
    if (config.subscriptionId === '') delete config.subscriptionId
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
  /** Spec rule 23: the service's declared id, a JSON file subscription's id, or the adapter id. */
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
    if (a.providerId) return a.providerId
    if (a.id !== FILE_ADAPTER.id) return a.id
    // The editor chose a subscription from the file (spec rule 25); saving reads no file
    // (rule 12) and every read checks this provider id.
    if (c.providerId) return c.providerId
    if (
      stored?.providerId &&
      stored.config.path === config.path &&
      stored.config.subscriptionId === config.subscriptionId
    )
      return stored.providerId
    throw new AppError('config', 'Choose the JSON file again to select its subscription.')
  }
  /** Spec rule 25: the subscriptions of a JSON input file, without metrics. */
  inspectFile(path: string): UsageFileSubscription[] {
    // Rule 12: while off, even an explicit read touches no file.
    if (!this.enabled)
      throw new AppError('config', 'Turn on Show usage quota to read the JSON file.')
    const checked = this.checkedPath(path, false)
    if (!existsSync(checked))
      throw new AppError('not_found', 'Usage file does not exist. Choose an existing JSON file.')
    return this.readDocument(checked).subscriptions.map((x) => ({
      id: x.id,
      providerId: x.providerId,
      label: x.label,
    }))
  }
  private proposedClaudeDirectory(connectionId: string): string {
    if (typeof connectionId !== 'string' || !DIRECTORY_ID.test(connectionId))
      throw new AppError('validation_error', 'This account id cannot name a Claude directory.')
    return join(this.deps.userDataPath, 'claude-code-usage', connectionId)
  }
  /** Spec rule 24: the proposed directory, or the chosen one, and the setup preview command. */
  claudeSetup(connectionId: string, directory: string | null): UsageClaudeSetup {
    const proposed = DIRECTORY_ID.test(connectionId)
      ? this.proposedClaudeDirectory(connectionId)
      : null
    // The proposed directory may not exist before the account is saved.
    const dir =
      directory === null
        ? this.proposedClaudeDirectory(connectionId)
        : proposed && this.pathKey(directory) === this.pathKey(proposed)
          ? proposed
          : this.checkedPath(directory, false)
    const script = this.deps.claudeSetupScript
    if (!script)
      throw new AppError(
        'not_found',
        'The Claude snapshot writer is missing. Repair your NeKode installation.',
      )
    const settings = join(this.deps.homeDirectory ?? homedir(), '.claude', 'settings.json')
    const quote = (value: string) => {
      // PowerShell expands $ and backticks inside double quotes and also ends a
      // double-quoted string at the typographic double quotes U+201C-U+201E.
      if (/["\u201C-\u201E`$\r\n]/.test(value))
        throw new AppError(
          'validation_error',
          'Paths for the setup command cannot contain quotes, backticks, $ or line breaks.',
        )
      return `"${value}"`
    }
    return {
      directory: dir,
      command: `node ${quote(script)} --settings ${quote(settings)} --dir ${quote(dir)}`,
    }
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
  /** Spec rule 24: saving or testing a Claude account creates its proposed directory. */
  private createProposedDirectories(settings: UsageSettings): void {
    for (const c of settings.connections) {
      if (
        c.adapterId !== CLAUDE_SNAPSHOT_ADAPTER.id ||
        typeof c.config.directory !== 'string' ||
        !DIRECTORY_ID.test(c.id)
      )
        continue
      const proposed = this.proposedClaudeDirectory(c.id)
      if (this.pathKey(c.config.directory) !== this.pathKey(proposed) || existsSync(proposed))
        continue
      try {
        mkdirSync(proposed, { recursive: true })
      } catch {
        throw new AppError(
          'io',
          'Cannot create the Claude snapshot directory. Check its permissions.',
        )
      }
    }
  }
  /** Spec rule 2: two accounts cannot bind the same JSON file subscription. */
  private rejectDuplicateFileBindings(settings: UsageSettings): void {
    const bound = new Map<string, string>()
    for (const c of settings.connections) {
      if (c.adapterId !== FILE_ADAPTER.id || typeof c.config.path !== 'string') continue
      const key = `${this.pathKey(c.config.path)}\n${(c.config.subscriptionId as string | undefined) || c.id}`
      const other = bound.get(key)
      if (other !== undefined)
        throw new AppError(
          'validation_error',
          `This file subscription is already tracked by the account "${other}".`,
        )
      bound.set(key, c.label)
    }
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
    this.rejectDuplicateFileBindings(next)
    // The proposed directory must exist before path validation resolves its parent.
    this.createProposedDirectories(next)
    this.validatePaths(next)
    const invalidated = new Set<string>()
    for (const c of next.connections) {
      const previous = this.settings.connections.find((p) => p.id === c.id)
      if (
        !previous ||
        previous.label !== c.label ||
        previous.providerId !== c.providerId ||
        previous.adapterId !== c.adapterId ||
        JSON.stringify(this.declared(previous.config, this.adapter(c))) !== JSON.stringify(c.config)
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
      if (changed && !invalidated.has(c.id))
        r.subscription = retained.get(c.id)?.subscription ?? null
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
        return {
          connection,
          subscription: r.subscription,
          error: r.error,
          refreshing: r.refreshing,
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
    if (!this.enabled) return this.read()
    await Promise.all(
      this.settings.connections.filter((c) => c.enabled).map((c) => this.collect(c, true)),
    )
    return this.read()
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
  /** A missing local input is transient (spec rule 13); only rejected paths are configuration errors. */
  private fileInput(path: string): string {
    const checked = this.checkedPath(path, false)
    if (!existsSync(checked))
      throw new AppError(
        'io',
        'Cannot read usage file. It does not exist yet; collection retries automatically.',
      )
    return checked
  }
  /** A missing snapshot directory in an existing folder is transient (spec rule 16). */
  private snapshotDirectory(path: string): string {
    const checked = this.checkedPath(path, false)
    if (!existsSync(checked))
      throw new AppError(
        'io',
        'Cannot read Claude snapshot directory. It does not exist yet; collection retries automatically.',
      )
    return checked
  }
  private readDocument(path: string): UsageDocument {
    return parseUsageDocument(this.readJson(path), this.now())
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
  private async load(c: UsageConnection, signal: AbortSignal): Promise<UsageSubscription> {
    const a = this.adapter(c),
      config = this.secrets(c, a)
    if (a.id === FILE_ADAPTER.id) {
      // Spec rule 25: read the bound subscription, ignore the others, never rebind.
      const id = (config.subscriptionId as string | undefined) || c.id
      const sub = this.readDocument(this.fileInput(config.path as string)).subscriptions.find(
        (x) => x.id === id,
      )
      if (!sub)
        throw new AppError(
          'io',
          `Usage file has no subscription "${id}". Collection retries automatically.`,
        )
      if (sub.providerId !== c.providerId)
        throw new AppError(
          'validation_error',
          'The usage file subscription changed its provider. Choose the file again for this account.',
        )
      return { ...sub, id: c.id, label: c.label, sourceKind: a.sourceKind }
    }
    const document =
      a.id === CLAUDE_SNAPSHOT_ADAPTER.id
        ? parseUsageDocument(
            readClaudeSnapshots(this.snapshotDirectory(config.directory as string), c, this.now()),
            this.now(),
          )
        : parseUsageDocument(await this.host.read(a, config, c.id, signal), this.now())
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
    // The proposed directory must exist before path validation resolves its parent.
    this.createProposedDirectories(settings)
    this.validatePaths(settings)
    await this.load(c, new AbortController().signal)
  }
  private collect(c: UsageConnection, explicit: boolean): Promise<void> {
    const r = this.runtimeFor(c.id)
    if (r.flight) return r.flight
    if (this.stopped || (!explicit && r.suspended) || this.now() < r.due) return Promise.resolve()
    const revision = this.revision,
      controller = new AbortController()
    r.controller = controller
    r.refreshing = true
    r.suspended = false
    let minimum = 60_000,
      fileSource = false
    try {
      const a = this.adapter(c)
      fileSource = a.sourceKind === 'file'
      minimum = Math.max(fileSource ? 5000 : 60_000, a.minimumRefreshSeconds * 1000)
    } catch {
      /* Collection reports the actionable configuration failure. */
    }
    r.due = this.now() + minimum
    r.flight = (async () => {
      try {
        const sub = await this.load(c, controller.signal)
        if (
          controller.signal.aborted ||
          revision !== this.revision ||
          this.runtime.get(c.id) !== r ||
          this.stopped
        )
          return
        const now = this.now()
        const receivedAt = new Date(now).toISOString()
        const snapshots = c.adapterId === CLAUDE_SNAPSHOT_ADAPTER.id
        sub.metrics = sub.metrics.map((metric) => {
          const previous = r.subscription?.metrics.find((m) => m.id === metric.id)
          // Rule 16 across polls: a deleted newest session file cannot bring back an older value.
          // Only a kept window whose numeric reset is still ahead is protected; an expired or
          // unknown-reset window is replaced by the current read.
          if (snapshots && previous?.resetsAt && Date.parse(previous.resetsAt) > now) {
            const kept = windowKey(previous),
              next = windowKey(metric)
            if (kept && next && newerWindow(kept, next, now)) return previous
          }
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
        // Local file sources retry at their own cadence; command/API sources back off (rule 13).
        if (!r.suspended && !fileSource)
          r.due =
            this.now() +
            Math.max(
              minimum,
              Math.min(300, 60 * 2 ** Math.min(r.failures - 1, 3)) * 1000,
              (r.error.retryAfterSeconds ?? 0) * 1000,
            )
        this.exportDocument()
      } finally {
        if (revision === this.revision && this.runtime.get(c.id) === r) {
          r.refreshing = false
          r.flight = undefined
          r.controller = undefined
        }
      }
    })()
    return r.flight
  }
  private document(): UsageDocument {
    return {
      schemaVersion: 1,
      subscriptions: this.settings.connections
        .filter((c) => c.enabled)
        .map((c) => {
          const r = this.runtimeFor(c.id)
          return r.subscription
            ? { ...r.subscription, status: r.error ? 'error' : r.subscription.status }
            : {
                id: c.id,
                providerId: c.providerId,
                label: c.label,
                sourceKind: this.adapter(c).sourceKind,
                metrics: [],
                status: r.error ? 'error' : 'unavailable',
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
