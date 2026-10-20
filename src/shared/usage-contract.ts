import { AppError } from './ipc-error'

export const USAGE_MAX_BYTES = 1024 * 1024
export const USAGE_STATE_KEY = 'usage.settings'
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
}
export interface UsageAdapter {
  id: string
  name: string
  protocolVersion: 1
  invocation: { command: string; args: string[] }
  sourceKind: 'api' | 'cli' | 'file'
  capabilities: string[]
  minimumRefreshSeconds: number
  configSchema: UsageConfigField[]
  directory?: string
  error?: string
}
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
  adaptersDirectory: string | null
  export: { enabled: boolean; path: string | null; replaceExisting?: boolean }
}
export interface UsageConnectionSnapshot {
  connection: Omit<UsageConnection, 'config'>
  subscription: UsageSubscription | null
  refreshing: boolean
  error: UsageFailure | null
}
export interface UsageSnapshot {
  connections: UsageConnectionSnapshot[]
  pin: UsagePin | null
  cacheError: string | null
  exportError: string | null
}
export interface UsageApi {
  listAdapters(): Promise<UsageAdapter[]>
  getSettings(): Promise<UsageSettings>
  saveSettings(settings: UsageSettings): Promise<UsageSettings>
  read(): Promise<UsageSnapshot>
  refresh(): Promise<UsageSnapshot>
  test(connection: UsageConnection): Promise<void>
  pickFile(output: boolean): Promise<string | null>
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

export function parseUsageSettings(value: unknown): UsageSettings {
  const s = usageObject(value)
  only(s, ['connections', 'pin', 'adaptersDirectory', 'export'])
  if (!Array.isArray(s.connections) || s.connections.length > 100)
    invalid('Invalid usage connections.')
  const ids = new Set<string>()
  const connections = s.connections.map((raw) => {
    const c = usageObject(raw)
    only(c, ['id', 'label', 'providerId', 'adapterId', 'enabled', 'config', 'secretKeys'])
    const id = text(c.id)
    if (ids.has(id)) invalid('Duplicate usage connection.')
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
      providerId: text(c.providerId),
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
    adaptersDirectory: path(s.adaptersDirectory),
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
  const step = duration === 7 * day ? day : 7 * day
  const shares: number[] = []
  for (let remaining = duration; remaining > 0; remaining -= step)
    shares.push((Math.min(step, remaining) / duration) * 100)
  if (shares.length > 60) return null
  const elapsed = Math.max(0, Math.min(duration - 1, now - start))
  const current = Math.min(shares.length - 1, Math.floor(elapsed / step))
  const lower = shares.slice(0, current).reduce((a, b) => a + b, 0),
    upper = lower + shares[current]
  const percent = usagePercent(metric)
  const fresh =
    metric.observedAt &&
    now - Date.parse(metric.observedAt) <= 3_600_000 &&
    now < end &&
    metric.state === 'available'
  const pace =
    fresh && percent !== null
      ? percent < lower
        ? `↑ ${Math.round(lower - percent)}pp`
        : percent > upper
          ? 'Ahead of pace'
          : null
      : null
  return { shares, current, pace }
}
