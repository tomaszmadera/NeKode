import { AppError } from './ipc-error'

export const USAGE_MAX_BYTES = 1024 * 1024
export const USAGE_STATE_KEY = 'usage.settings'
/** Global `Show usage quota` switch (spec rule 1); a missing value means off. */
export const USAGE_ENABLED_KEY = 'usage.enabled'
export type UsageErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'protocol'
  | 'timeout'
  | 'auth'
  | 'network'
  | 'rate_limited'
  | 'unsupported'
  | 'config'
  | 'io'
export interface UsageFailure {
  code: UsageErrorCode
  message: string
  retryAfterSeconds?: number
}
export interface UsageMetric {
  id: string
  label: string
  kind: 'window' | 'credits' | 'balance'
  observedAt: string | null
  state: 'available' | 'unavailable' | 'expired'
  collectedAt?: string | null
  receivedAt?: string | null
  reason?: string
  usedPercent?: number | null
  used?: number | null
  limit?: number | null
  unit?: string | null
  amount?: number | null
  currency?: string | null
  bucketId?: string | null
  periodStart?: string | null
  resetsAt?: string | null
  windowDurationSeconds?: number | null
  /**
   * Provider of this one metric when an adapter aggregates several providers in one subscription
   * (spec rule 6); the row avatar uses it instead of the account's provider id.
   */
  providerId?: string
}
export interface UsageSubscription {
  id: string
  providerId: string
  label: string
  sourceKind: 'api' | 'cli' | 'file'
  status: 'available' | 'unavailable' | 'error'
  metrics: UsageMetric[]
  collectedAt?: string | null
}
export interface UsageDocument {
  schemaVersion: 1
  subscriptions: UsageSubscription[]
}
export interface UsageConfigField {
  key: string
  label: string
  type: 'text' | 'secret' | 'boolean' | 'choice' | 'file'
  required?: boolean
  choices?: string[]
  /** Optional help shown with the field (at most 512 characters). */
  description?: string
}
/**
 * Adapter request action (spec L2): `read` for scheduled collection, `refresh` for a manual
 * `Refresh usage`, which must return values obtained from the provider during the request.
 */
export type UsageAdapterAction = 'read' | 'refresh'
export interface UsageAdapter {
  id: string
  name: string
  protocolVersion: 2
  invocation: { command: string; args: string[] }
  sourceKind: 'api' | 'cli'
  capabilities: string[]
  minimumRefreshSeconds: number
  configSchema: UsageConfigField[]
  /** Optional explanation shown in settings before enabling, such as required privileges. */
  description?: string
  /** Optional fixed next action per declared failure code, replacing the generic one. */
  errorActions?: Partial<Record<UsageErrorCode, string>>
  /** Provider id the service reports; main assigns it to accounts (spec rule 23). */
  providerId?: string
  /** One sentence for the service picker (spec rule 22, at most 160 characters). */
  summary?: string
  /** Shown as `Experimental` in the service picker. */
  experimental?: boolean
  directory?: string
  /** Shipped with NeKode (spec rule 17); absent for user-added adapters. */
  bundled?: boolean
  error?: string
}
/**
 * Adapter ids of the removed passive sources (spec L6-L7): the built-in JSON file reader and the
 * Claude snapshot reader. A stored account of either is kept and never collected.
 */
export const USAGE_REMOVED_ADAPTER_IDS: readonly string[] = ['usage-file', 'claude-code-snapshots']
export const USAGE_REMOVED_ADAPTER_MESSAGE =
  'This adapter is no longer available. Remove the source and add it again with a supported adapter.'
export interface UsageConnection {
  id: string
  label: string
  providerId: string
  adapterId: string
  enabled: boolean
  config: Record<string, string | boolean>
  secretKeys?: string[]
}
export interface UsagePin {
  connectionId: string
  metricId: string
}
export interface UsageSettings {
  connections: UsageConnection[]
  pin: UsagePin | null
  export: { enabled: boolean; path: string | null; replaceExisting?: boolean }
}
export interface UsageRefreshSkip {
  connectionId: string
  until: string
  reason: 'interval' | 'backoff'
}
/** Terminal result of one operation source, window or the whole refresh. */
export type UsageRefreshSourceStatus =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'unsupported'
  | 'unavailable'
  | 'rate_limited'
  | 'stale_observation'
export interface UsageRefreshWindowResult {
  metricId: string
  status: UsageRefreshSourceStatus
  errorCode?: UsageErrorCode
  /** Full UTC provider retry deadline; may be later than one day. */
  nextAllowedAt?: string
}
export interface UsageRefreshSourceResult {
  sourceId: string
  status: UsageRefreshSourceStatus
  errorCode?: UsageErrorCode
  nextAllowedAt?: string
  windows: UsageRefreshWindowResult[]
}
/**
 * Typed `partial-refresh-v1` result of a manual refresh (PDH-13). A missing `refresh` field on an
 * adapter response stays valid, so adapters without the capability keep the old transport.
 */
export interface UsageRefreshResult {
  status: 'success' | 'partial' | 'failed'
  sources: UsageRefreshSourceResult[]
  requestId: string
  measurementId?: string
  reportId?: string
}
export interface UsageConnectionSnapshot {
  connection: Omit<UsageConnection, 'config'>
  subscription: UsageSubscription | null
  refreshing: boolean
  error: UsageFailure | null
  /** Earliest time a manual refresh may start (spec L5), or null when it may start now. */
  nextRefreshAt: string | null
  /** Last manual refresh outcome, kept across automatic polls and restarts. */
  refreshResult?: UsageRefreshResult | null
}
export interface UsageSnapshot {
  connections: UsageConnectionSnapshot[]
  pin: UsagePin | null
  cacheError: string | null
  exportError: string | null
  /** Present only on a manual refresh response; read includes joined and failed reads. */
  refresh?: { read: string[]; skipped: UsageRefreshSkip[] }
}
export interface UsageApi {
  listAdapters(): Promise<UsageAdapter[]>
  getSettings(): Promise<UsageSettings>
  saveSettings(settings: UsageSettings): Promise<UsageSettings>
  read(): Promise<UsageSnapshot>
  refresh(): Promise<UsageSnapshot>
  test(connection: UsageConnection): Promise<void>
  pickFile(output: boolean): Promise<string | null>
  /** Read the global `Show usage quota` switch. */
  getEnabled(): Promise<boolean>
  /** Persist the switch; off stops all usage activity and keeps settings. Returns the new value. */
  setEnabled(enabled: boolean): Promise<boolean>
  /** Create `<userData>/usage-adapters` when missing and open it (spec rule 26). */
  openAdaptersFolder(): Promise<void>
}

function invalid(message: string): never {
  throw new AppError('validation_error', message)
}
export function usageObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Usage value must be an object.')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0'))
    invalid('Usage text must contain 1 to 256 characters.')
  return value
}
function timestamp(value: unknown, future: boolean, now: number): string | null {
  if (value === null || value === undefined) return null
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    invalid('Invalid usage UTC timestamp.')
  if (future && Date.parse(value) > now + 60_000) invalid('Usage observation is in the future.')
  return value
}
function number(value: unknown, nonnegative = false): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0))
    invalid('Invalid usage number.')
  return value
}
function only(object: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(object).some((key) => !keys.includes(key))) invalid('Unexpected usage field.')
}
export function parseUsageDocument(value: unknown, now = Date.now()): UsageDocument {
  if (JSON.stringify(value).length > USAGE_MAX_BYTES) invalid('Usage document exceeds 1 MiB.')
  const doc = usageObject(value)
  only(doc, ['schemaVersion', 'subscriptions'])
  if (doc.schemaVersion !== 1) invalid('Unsupported usage schema version.')
  if (!Array.isArray(doc.subscriptions) || doc.subscriptions.length > 100)
    invalid('Invalid usage subscriptions.')
  const ids = new Set<string>()
  const subscriptions = doc.subscriptions.map((raw) => {
    const sub = usageObject(raw)
    only(sub, ['id', 'providerId', 'label', 'sourceKind', 'status', 'metrics', 'collectedAt'])
    const id = text(sub.id)
    if (ids.has(id)) invalid('Duplicate usage subscription id.')
    ids.add(id)
    if (
      !['api', 'cli', 'file'].includes(sub.sourceKind as string) ||
      !['available', 'unavailable', 'error'].includes(sub.status as string) ||
      !Array.isArray(sub.metrics) ||
      sub.metrics.length > 50
    )
      invalid('Invalid usage subscription.')
    const metricIds = new Set<string>()
    const metrics = sub.metrics.map((rawMetric) => {
      const m = usageObject(rawMetric)
      if (!Object.hasOwn(m, 'observedAt')) invalid('Usage metric requires observedAt or null.')
      only(m, [
        'id',
        'label',
        'kind',
        'observedAt',
        'state',
        'collectedAt',
        'receivedAt',
        'reason',
        'usedPercent',
        'used',
        'limit',
        'unit',
        'amount',
        'currency',
        'bucketId',
        'periodStart',
        'resetsAt',
        'windowDurationSeconds',
        'providerId',
      ])
      const metric: UsageMetric = {
        id: text(m.id),
        label: text(m.label),
        kind: m.kind as UsageMetric['kind'],
        observedAt: timestamp(m.observedAt, true, now),
        state: m.state as UsageMetric['state'],
      }
      if (metricIds.has(metric.id)) invalid('Duplicate usage metric id.')
      metricIds.add(metric.id)
      if (
        !['window', 'credits', 'balance'].includes(metric.kind) ||
        !['available', 'unavailable', 'expired'].includes(metric.state)
      )
        invalid('Invalid usage metric kind or state.')
      metric.collectedAt = timestamp(m.collectedAt, true, now)
      metric.receivedAt = timestamp(m.receivedAt, true, now)
      metric.periodStart = timestamp(m.periodStart, false, now)
      metric.resetsAt = timestamp(m.resetsAt, false, now)
      metric.windowDurationSeconds = number(m.windowDurationSeconds, true)
      if (metric.windowDurationSeconds !== null && metric.windowDurationSeconds <= 0)
        invalid('Usage duration must be positive.')
      if (
        metric.periodStart &&
        metric.resetsAt &&
        Date.parse(metric.resetsAt) <= Date.parse(metric.periodStart)
      )
        invalid('Usage end must follow start.')
      for (const key of ['usedPercent', 'used', 'limit', 'amount'] as const)
        metric[key] = number(m[key], key === 'usedPercent' || key === 'used')
      for (const key of ['unit', 'currency', 'bucketId', 'reason'] as const)
        metric[key] = m[key] == null ? undefined : text(m[key])
      if (m.providerId != null) {
        if (typeof m.providerId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.providerId))
          invalid('Invalid usage metric provider id.')
        metric.providerId = m.providerId
      }
      if (metric.state === 'unavailable') {
        if (
          !metric.reason ||
          ['usedPercent', 'used', 'limit', 'amount'].some((key) => m[key] != null)
        )
          invalid('Unavailable usage requires a reason and no numeric value.')
      } else if (
        (metric.kind === 'window' && metric.usedPercent == null) ||
        (metric.kind === 'credits' &&
          (metric.used == null || metric.limit == null || !metric.unit)) ||
        (metric.kind === 'balance' &&
          (metric.amount == null || !/^[A-Z]{3}$/.test(metric.currency ?? '')))
      )
        invalid('Available usage metric is missing its value.')
      return metric
    })
    return {
      id,
      providerId: text(sub.providerId),
      label: text(sub.label),
      sourceKind: sub.sourceKind as UsageSubscription['sourceKind'],
      status: sub.status as UsageSubscription['status'],
      metrics,
      collectedAt: timestamp(sub.collectedAt, true, now),
    }
  })
  return { schemaVersion: 1, subscriptions }
}

/**
 * Status union of a final `partial-refresh-v1` response. `pending` and `running` are never final.
 */
export const USAGE_REFRESH_STATUSES: readonly UsageRefreshSourceStatus[] = [
  'succeeded',
  'failed',
  'timed_out',
  'unsupported',
  'unavailable',
  'rate_limited',
  'stale_observation',
]
const USAGE_ERROR_CODES: readonly UsageErrorCode[] = [
  'validation_error',
  'not_found',
  'protocol',
  'timeout',
  'auth',
  'network',
  'rate_limited',
  'unsupported',
  'config',
  'io',
]
function refreshErrorCode(value: unknown): UsageErrorCode | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !USAGE_ERROR_CODES.includes(value as UsageErrorCode))
    invalid('Invalid usage refresh error code.')
  return value as UsageErrorCode
}
function refreshStatus(value: unknown): UsageRefreshSourceStatus {
  if (
    typeof value !== 'string' ||
    !USAGE_REFRESH_STATUSES.includes(value as UsageRefreshSourceStatus)
  )
    invalid('Invalid usage refresh status.')
  return value as UsageRefreshSourceStatus
}
/**
 * Strict `partial-refresh-v1` result parser. It validates unknown keys, closed statuses, unique
 * source and metric ids, metric membership in the document, completeness and UTC deadlines.
 * Every metric in `document` must be a succeeded window, so a failed window cannot carry a value.
 */
export function parseUsageRefreshResult(
  value: unknown,
  document?: UsageDocument,
  now = Date.now(),
): UsageRefreshResult {
  const result = usageObject(value)
  only(result, ['status', 'sources', 'requestId', 'measurementId', 'reportId'])
  if (!['success', 'partial', 'failed'].includes(result.status as string))
    invalid('Invalid usage refresh outcome.')
  const requestId = text(result.requestId)
  const measurementId = result.measurementId === undefined ? undefined : text(result.measurementId)
  const reportId = result.reportId === undefined ? undefined : text(result.reportId)
  if (!Array.isArray(result.sources) || result.sources.length === 0 || result.sources.length > 50)
    invalid('Invalid usage refresh sources.')
  const documentMetrics =
    document === undefined
      ? null
      : new Map(
          document.subscriptions.flatMap((sub) => sub.metrics.map((metric) => [metric.id, metric])),
        )
  const sourceIds = new Set<string>()
  const metricIds = new Set<string>()
  let succeededSources = 0
  let succeededWindows = 0
  let failedParts = 0
  const sources = result.sources.map((rawSource) => {
    const source = usageObject(rawSource)
    only(source, ['sourceId', 'status', 'errorCode', 'nextAllowedAt', 'windows'])
    const sourceId = text(source.sourceId)
    if (sourceIds.has(sourceId)) invalid('Duplicate usage refresh source id.')
    sourceIds.add(sourceId)
    const status = refreshStatus(source.status)
    if (status === 'succeeded') succeededSources++
    else failedParts++
    if (!Array.isArray(source.windows) || source.windows.length > 50)
      invalid('Invalid usage refresh windows.')
    let sourceWindowSuccesses = 0
    const windows = source.windows.map((rawWindow) => {
      const window = usageObject(rawWindow)
      only(window, ['metricId', 'status', 'errorCode', 'nextAllowedAt'])
      const metricId = text(window.metricId)
      if (metricIds.has(metricId)) invalid('Duplicate usage refresh metric id.')
      metricIds.add(metricId)
      const windowStatus = refreshStatus(window.status)
      const metric = documentMetrics?.get(metricId)
      if (windowStatus === 'succeeded') {
        succeededWindows++
        sourceWindowSuccesses++
        if (documentMetrics) {
          if (!metric) invalid('Usage refresh metric is missing from the usage document.')
          if (metric.state === 'unavailable' || !metric.observedAt)
            invalid('Usage refresh succeeded window has no live metric.')
        }
      } else {
        failedParts++
        // A failed window must not supply a numeric value for its metric.
        if (metric) invalid('Usage refresh failed window carries a value.')
      }
      return {
        metricId,
        status: windowStatus,
        ...(window.errorCode === undefined
          ? {}
          : { errorCode: refreshErrorCode(window.errorCode) }),
        ...(window.nextAllowedAt === undefined
          ? {}
          : { nextAllowedAt: timestamp(window.nextAllowedAt, false, now) as string }),
      }
    })
    if (sourceWindowSuccesses > 0 && status !== 'succeeded')
      invalid('Usage refresh source status contradicts its windows.')
    return {
      sourceId,
      status,
      ...(source.errorCode === undefined ? {} : { errorCode: refreshErrorCode(source.errorCode) }),
      ...(source.nextAllowedAt === undefined
        ? {}
        : { nextAllowedAt: timestamp(source.nextAllowedAt, false, now) as string }),
      windows,
    }
  })
  if (documentMetrics)
    for (const metricId of documentMetrics.keys())
      if (!metricIds.has(metricId)) invalid('Usage refresh result omits a document metric.')
  const overall = result.status as UsageRefreshResult['status']
  if (overall === 'success') {
    if (succeededSources !== sources.length || succeededWindows === 0 || failedParts > 0)
      invalid('Usage refresh success is incomplete.')
    if (!measurementId || !reportId)
      invalid('Usage refresh success requires measurement and report ids.')
  } else if (overall === 'partial') {
    if ((succeededSources === 0 && succeededWindows === 0) || failedParts === 0)
      invalid('Usage refresh partial result is inconsistent.')
  } else if (succeededSources > 0 || succeededWindows > 0) {
    invalid('Usage refresh failure carries a succeeded result.')
  }
  return {
    status: overall,
    sources,
    requestId,
    ...(measurementId === undefined ? {} : { measurementId }),
    ...(reportId === undefined ? {} : { reportId }),
  }
}

export function parseUsageSettings(value: unknown): UsageSettings {
  const s = usageObject(value)
  only(s, ['connections', 'pin', 'export'])
  if (!Array.isArray(s.connections) || s.connections.length > 100) invalid('Invalid usage sources.')
  const ids = new Set<string>()
  const connections = s.connections.map((raw) => {
    const c = usageObject(raw)
    only(c, ['id', 'label', 'providerId', 'adapterId', 'enabled', 'config', 'secretKeys'])
    const id = text(c.id)
    if (ids.has(id)) invalid('Duplicate usage source.')
    ids.add(id)
    if (typeof c.enabled !== 'boolean') invalid('Usage enabled must be boolean.')
    const config = usageObject(c.config)
    if (
      Object.keys(config).length > 50 ||
      Object.entries(config).some(
        ([k, v]) =>
          k.length > 256 ||
          (typeof v !== 'boolean' &&
            (typeof v !== 'string' || v.length > 4096 || v.includes('\0'))),
      )
    )
      invalid('Invalid usage configuration.')
    return {
      id,
      label: text(c.label),
      // Main assigns the provider id on save (spec rule 23); a new account may send none.
      providerId: c.providerId === undefined || c.providerId === '' ? '' : text(c.providerId),
      adapterId: text(c.adapterId),
      enabled: c.enabled,
      config: config as UsageConnection['config'],
    }
  })
  let pin: UsagePin | null = null
  if (s.pin != null) {
    const p = usageObject(s.pin)
    only(p, ['connectionId', 'metricId'])
    pin = { connectionId: text(p.connectionId), metricId: text(p.metricId) }
  }
  const e = usageObject(s.export)
  only(e, ['enabled', 'path', 'replaceExisting'])
  if (
    typeof e.enabled !== 'boolean' ||
    (e.replaceExisting !== undefined && typeof e.replaceExisting !== 'boolean')
  )
    invalid('Invalid usage export setting.')
  function path(v: unknown): string | null {
    if (v === null) return null
    if (typeof v !== 'string' || v.length > 4096 || v.includes('\0')) invalid('Invalid usage path.')
    return v
  }
  return {
    connections,
    pin,
    export: {
      enabled: e.enabled,
      path: path(e.path),
      replaceExisting: e.replaceExisting as boolean | undefined,
    },
  }
}

export function usagePercent(metric: UsageMetric): number | null {
  if (metric.state === 'unavailable') return null
  if (metric.kind === 'window') return metric.usedPercent ?? null
  return metric.kind === 'credits' &&
    metric.limit != null &&
    metric.limit > 0 &&
    metric.used != null
    ? (metric.used / metric.limit) * 100
    : null
}
export function usageFreshness(metric: UsageMetric, now: number): string {
  if (metric.state === 'unavailable') return 'Unavailable'
  if (metric.state === 'expired' || (metric.resetsAt && Date.parse(metric.resetsAt) <= now))
    return 'Expired - refresh required'
  if (!metric.observedAt) return 'Age unknown'
  const age = Math.max(0, now - Date.parse(metric.observedAt))
  const minutes = Math.floor(age / 60_000)
  return `${age <= 300_000 ? 'Fresh' : age <= 3_600_000 ? 'Aging' : 'Stale'} - ${minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`} old`
}
export function usageSlices(
  metric: UsageMetric,
  now: number,
): { shares: number[]; current: number; pace: string | null } | null {
  if (!metric.periodStart || !metric.resetsAt) return null
  const start = Date.parse(metric.periodStart),
    end = Date.parse(metric.resetsAt),
    duration = end - start
  const day = 86_400_000
  if (duration !== 7 * day && (duration < 28 * day || duration > 31 * day)) return null
  // A week has seven daily slices and a monthly cycle four equal quarters, so every
  // slice of one graphic has the same width.
  const count = duration === 7 * day ? 7 : 4
  const share = 100 / count
  const shares = Array.from({ length: count }, () => share)
  const elapsed = Math.max(0, Math.min(duration - 1, now - start))
  const current = Math.min(count - 1, Math.floor((elapsed * count) / duration))
  const lower = current * share,
    upper = lower + share
  const percent = usagePercent(metric)
  // Usage within a window never decreases, so any observation of an open window
  // supports pace advice, whatever its age (user decision 2026-10-22).
  const open = now < end && metric.state === 'available'
  const pace =
    open && percent !== null
      ? percent < lower
        ? `↑ ${Math.round(lower - percent)}pp`
        : percent > upper
          ? 'Ahead of pace'
          : null
      : null
  return { shares, current, pace }
}
