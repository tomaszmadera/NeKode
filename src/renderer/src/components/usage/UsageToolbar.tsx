import type {
  UsageApi,
  UsageConnectionSnapshot,
  UsageErrorCode,
  UsageMetric,
  UsageRefreshSourceResult,
  UsageRefreshSourceStatus,
  UsageRefreshWindowResult,
  UsageSnapshot,
} from '@shared/contracts/usage-contract'
import { usageFreshness, usagePercent, usageSlices } from '@shared/contracts/usage-contract'
import { formatErrorMessage } from '@shared/ipc-error'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './usage.css'

const EMPTY: UsageSnapshot = { connections: [], pin: null, cacheError: null, exportError: null }
function badge(source: UsageConnectionSnapshot, metric: UsageMetric, now: number): string {
  const freshness = usageFreshness(metric, now)
  return source.error
    ? 'usage-stale'
    : freshness.startsWith('Fresh')
      ? 'usage-fresh'
      : freshness.startsWith('Aging')
        ? 'usage-aging'
        : freshness === 'Age unknown'
          ? ''
          : 'usage-stale'
}
/** Row avatar: the subscription that owns the metric (NEKODE-191 U4). */
function avatar(_source: UsageConnectionSnapshot, metric: UsageMetric): string {
  return metric.subscriptionId.slice(0, 2).toUpperCase()
}
function value(metric: UsageMetric): string {
  if (metric.state === 'unavailable') return 'Unavailable'
  if (metric.kind === 'balance') return `${metric.currency} ${metric.amount?.toFixed(2)}`
  const percent = usagePercent(metric)
  return percent === null
    ? `${metric.used ?? '?'} / ${metric.limit ?? '?'} ${metric.unit ?? ''}`
    : `${Math.round(percent)}%`
}
function reset(metric: UsageMetric, now: number): string {
  if (!metric.resetsAt) return ''
  const minutes = Math.ceil((Date.parse(metric.resetsAt) - now) / 60_000)
  return minutes <= 0
    ? 'Expired'
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}
export function UsageGraphic({
  metric,
  now,
}: {
  metric: UsageMetric
  now: number
}): React.JSX.Element | null {
  const percent = usagePercent(metric)
  if (percent === null || metric.kind === 'balance') return null
  const slices = usageSlices(metric, now)
  let offset = 0
  return (
    <span
      className="usage-graphic"
      aria-hidden="true"
      style={
        slices ? ({ '--usage-slices': slices.shares.length } as React.CSSProperties) : undefined
      }
    >
      {slices ? (
        slices.shares.map((share, index) => {
          const fill = Math.max(0, Math.min(1, (percent - offset) / share)) * 100
          offset += share
          return (
            <span
              key={offset}
              className={`usage-slice ${index === slices.current ? 'usage-current' : ''} ${slices.pace?.startsWith('↑') && index < slices.current ? 'usage-unused' : ''} ${slices.pace === 'Ahead of pace' && index > slices.current ? 'usage-ahead' : ''}`}
            >
              <span style={{ width: `${fill}%` }} />
            </span>
          )
        })
      ) : (
        <span className="usage-bar">
          <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </span>
      )}
    </span>
  )
}
function tooltip(source: UsageConnectionSnapshot, metric: UsageMetric, now: number): string {
  return `${source.connection.label}; ${metricName(source, metric)}; ${value(metric)}; ${source.error?.message ?? usageFreshness(metric, now)}; observation ${metric.observedAt ?? 'unknown'}; collected ${metric.collectedAt ?? source.subscription?.collectedAt ?? 'unknown'}; source ${source.connection.adapterId}; reset ${metric.resetsAt ?? 'unknown'}. Pace compares elapsed allowance slices, not a provider restriction or prediction.`
}
/** One manual refresh target (spec A6, U7): an account, or one subscription of it. */
interface RefreshTarget {
  connectionId: string
  subscriptionId?: string
}
/** A group menu opened from its trigger or a right-click on the group heading (spec M2). */
interface MenuState extends RefreshTarget {
  x: number
  y: number
}
const targetKey = (target: RefreshTarget) =>
  JSON.stringify([target.connectionId, target.subscriptionId ?? null])
/**
 * Subscription label for headings, menus and messages (U4): the label the report declares, never a
 * capitalised id. A retained metric without a declaration keeps its id unchanged.
 */
function subscriptionLabel(source: UsageConnectionSnapshot, subscriptionId: string): string {
  return (
    source.subscription?.subscriptions.find((item) => item.id === subscriptionId)?.label ??
    subscriptionId
  )
}
/**
 * Metric name for a pinned meter and row labels (U4): the metric label, prefixed with the declared
 * subscription label when a retained label does not already name it.
 */
function metricName(source: UsageConnectionSnapshot, metric: UsageMetric): string {
  const label = subscriptionLabel(source, metric.subscriptionId)
  return metric.label.includes(label) ? metric.label : `${label} ${metric.label}`
}
function targetLabel(source: UsageConnectionSnapshot, subscriptionId?: string): string {
  const label = source.connection.label
  return subscriptionId === undefined
    ? label
    : `${subscriptionLabel(source, subscriptionId)} in ${label}`
}
/**
 * Rows grouped by subscription (U11): declared subscriptions in report order, then any undeclared
 * retained subscription in first-appearance order. An account whose report declares subscriptions
 * always shows its subscription headings; a subscription without metrics gets no group (R3).
 * Null when the report declares none or has no metric.
 */
function subscriptionGroups(source: UsageConnectionSnapshot): [string, UsageMetric[]][] | null {
  const report = source.subscription
  if (!report || report.subscriptions.length === 0) return null
  const groups = new Map<string, UsageMetric[]>(report.subscriptions.map((item) => [item.id, []]))
  for (const metric of report.metrics)
    groups.set(metric.subscriptionId, [...(groups.get(metric.subscriptionId) ?? []), metric])
  const filled = [...groups].filter(([, metrics]) => metrics.length > 0)
  // Without any metric the account shows its empty message instead of headings (rule 11).
  return filled.length > 0 ? filled : null
}
/** Subscription of the metrics a refresh source covers, when they all belong to one. */
function sourceSubscription(
  source: UsageConnectionSnapshot,
  result: UsageRefreshSourceResult,
): string | undefined {
  const ids = new Set(
    result.windows.map(
      (window) =>
        source.subscription?.metrics.find((metric) => metric.id === window.metricId)
          ?.subscriptionId,
    ),
  )
  const [only] = ids
  return ids.size === 1 ? only : undefined
}
/** Spec A4: refreshing, countdown from the absolute deadline, or ready, for one group. */
function refreshState(
  source: UsageConnectionSnapshot,
  now: number,
  subscriptionId?: string,
  pending = false,
): string {
  const label = targetLabel(source, subscriptionId)
  if (pending || (subscriptionId === undefined && source.refreshing))
    return `${label} is refreshing`
  const until =
    subscriptionId === undefined
      ? source.nextRefreshAt
      : source.subscriptions?.find((item) => item.subscriptionId === subscriptionId)?.nextRefreshAt
  const seconds = until ? Math.ceil((Date.parse(until) - now) / 1000) : 0
  return seconds > 0 ? `${label} can refresh again in ${seconds} s` : `${label} is ready to refresh`
}
/** The short visible state beside a menu item; the full sentence stays in its description. */
function refreshShortState(
  source: UsageConnectionSnapshot,
  now: number,
  subscriptionId?: string,
  pending = false,
): string {
  if (pending || (subscriptionId === undefined && source.refreshing)) return 'Refreshing...'
  const until =
    subscriptionId === undefined
      ? source.nextRefreshAt
      : source.subscriptions?.find((item) => item.subscriptionId === subscriptionId)?.nextRefreshAt
  const seconds = until ? Math.ceil((Date.parse(until) - now) / 1000) : 0
  return seconds > 0 ? `in ${seconds} s` : 'Ready'
}
/** Fixed text for the closed refresh statuses; adapter/provider text is never rendered. */
const REFRESH_STATUS_TEXT: Record<UsageRefreshSourceStatus, string> = {
  succeeded: 'updated',
  failed: 'failed',
  timed_out: 'timed out',
  unsupported: 'not supported by the Hub',
  unavailable: 'unavailable',
  rate_limited: 'rate limited',
  stale_observation: 'observation was stale',
}
const REFRESH_ERROR_TEXT: Partial<Record<UsageErrorCode, string>> = {
  validation_error: 'invalid response',
  not_found: 'not found',
  protocol: 'invalid response',
  timeout: 'timed out',
  auth: 'sign-in required',
  network: 'network error',
  rate_limited: 'rate limited',
  unsupported: 'not supported',
  config: 'configuration error',
  io: 'read error',
}
function refreshStatusText(status: UsageRefreshSourceStatus, errorCode?: UsageErrorCode): string {
  const base = REFRESH_STATUS_TEXT[status]
  const code = errorCode ? REFRESH_ERROR_TEXT[errorCode] : undefined
  return code && code !== base ? `${base} (${code})` : base
}
function retryMessage(nextAllowedAt: string | undefined, now: number): string {
  if (!nextAllowedAt) return ''
  const remaining = Date.parse(nextAllowedAt) - now
  if (!Number.isFinite(remaining)) return ''
  if (remaining <= 0) return 'Retry now.'
  const minutes = Math.ceil(remaining / 60_000)
  const value =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  return `Retry in ${value}.`
}
/** The original age of the value retained for a failed window, or explicit absence. */
function retainedValue(source: UsageConnectionSnapshot, metricId: string, now: number): string {
  const metric = source.subscription?.metrics.find((m) => m.id === metricId)
  if (!metric || metric.state === 'unavailable') return 'No earlier value.'
  return `Earlier value ${usageFreshness(metric, now)}.`
}
/** U11: a console line names its account and, when known, the subscription; a source id is a source. */
function refreshSourceLine(
  result: UsageRefreshSourceResult,
  source: UsageConnectionSnapshot,
  now: number,
): string {
  const status = refreshStatusText(result.status, result.errorCode)
  const retry = retryMessage(result.nextAllowedAt, now)
  const label = targetLabel(source, sourceSubscription(source, result))
  return `${label}: source ${result.sourceId}: ${status}.${retry ? ` ${retry}` : ''}`
}
function refreshWindowLine(
  window: UsageRefreshWindowResult,
  source: UsageConnectionSnapshot,
  now: number,
): string {
  const status = refreshStatusText(window.status, window.errorCode)
  const retry = retryMessage(window.nextAllowedAt, now)
  const retained =
    window.status === 'succeeded' ? '' : ` ${retainedValue(source, window.metricId, now)}`
  const label = targetLabel(
    source,
    source.subscription?.metrics.find((metric) => metric.id === window.metricId)?.subscriptionId,
  )
  return `${label}: ${window.metricId}: ${status}.${retry ? ` ${retry}` : ''}${retained}`.trim()
}
/** Spec A5: the outcome of the last manual request, naming its account or subscription. */
function refreshOutcome(
  target: RefreshTarget,
  snapshot: UsageSnapshot,
  current: UsageSnapshot,
  now: number,
): string {
  const result = snapshot.refresh
  const source =
    current.connections.find((c) => c.connection.id === target.connectionId) ??
    snapshot.connections.find((c) => c.connection.id === target.connectionId)
  const label = source ? targetLabel(source, target.subscriptionId) : target.connectionId
  const skip = result?.skipped.find((s) => s.connectionId === target.connectionId)
  if (skip) {
    const reason = skip.reason === 'backoff' ? 'provider backoff' : '60-second limit'
    const skipped = `${label} was skipped (${reason}).`
    return source ? `${skipped} ${refreshState(source, now, target.subscriptionId)}.` : skipped
  }
  const read = snapshot.connections.find(
    (c) => c.connection.id === target.connectionId && result?.read.includes(c.connection.id),
  )
  if (!read) return `${label} was not refreshed.`
  if (read.error) return `${label} refresh failed.`
  // The operation result excludes earlier attempts retained in per-source detail. A joined
  // account refresh may also contain other subscriptions, so filter its known windows by the target.
  const owners = new Map(
    (read.subscription?.metrics ?? []).map((metric) => [metric.id, metric.subscriptionId]),
  )
  const sources = (result?.result?.sources ?? read.refreshResult?.sources ?? []).filter(
    (s) =>
      target.subscriptionId === undefined ||
      // A source may fail before it reports any windows, so it cannot be assigned to a subscription.
      // Keep that failure visible instead of treating the missing windows as a successful read.
      s.windows.length === 0 ||
      s.windows.some((w) => owners.get(w.metricId) === target.subscriptionId),
  )
  const failedSources = sources.filter((s) => s.status !== 'succeeded').length
  const failedWindows = sources
    .flatMap((s) => s.windows)
    .filter((w) => w.status !== 'succeeded').length
  if (sources.length > 0 && failedSources === sources.length)
    return `${label} refresh failed; earlier values were kept.`
  if (failedSources > 0 || failedWindows > 0)
    return `${label} refresh partially completed; ${failedSources} source(s) and ${failedWindows} window(s) failed.`
  return `${label} refreshed.`
}
export function UsageToolbar({
  api,
  version = 0,
  onConfigure,
}: {
  api: UsageApi
  version?: number
  onConfigure(): void
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(EMPTY),
    [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState<string | null>(null),
    [menu, setMenu] = useState<MenuState | null>(null),
    [errorsOpen, setErrorsOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 46 })
  // Spec A4-A5: pending targets, and the last clicked target with its result.
  const [pending, setPending] = useState<string[]>([]),
    [manual, setManual] = useState<{ target: RefreshTarget; result: UsageSnapshot | null } | null>(
      null,
    )
  const manualFlights = useRef(new Set<string>()),
    manualSequence = useRef(0)
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLDivElement>(null),
    menuReturnFocus = useRef<HTMLElement | null>(null)
  const readFlight = useRef<{ api: UsageApi; promise: Promise<UsageSnapshot> } | null>(null),
    alive = useRef(false),
    lastErrorSignature = useRef('')
  const errorItems: { key: string; text: string; signature: string }[] = []
  const addError = (key: string, text: string, signature = text) =>
    errorItems.push({ key, text, signature })
  if (error) addError('ipc', error)
  for (const source of snapshot.connections) {
    const label = source.connection.label
    if (source.error) {
      const text = `${label}: ${/[.!?]$/.test(source.error.message) ? source.error.message : `${source.error.message}.`}`
      addError(
        `source:${source.connection.id}`,
        text,
        `${source.connection.id}\u0000${source.error.message}`,
      )
    }
    const detail =
      manual?.result?.connections.find((c) => c.connection.id === source.connection.id)
        ?.refreshResult ?? source.refreshResult
    for (const result of detail?.sources ?? []) {
      if (result.status !== 'succeeded')
        addError(
          `refresh:${source.connection.id}:${result.sourceId}`,
          refreshSourceLine(result, source, now),
          `${source.connection.id}\u0000${result.sourceId}\u0000${result.status}\u0000${result.errorCode ?? ''}\u0000${result.nextAllowedAt ?? ''}`,
        )
      for (const window of result.windows)
        if (window.status !== 'succeeded')
          addError(
            `window:${source.connection.id}:${result.sourceId}:${window.metricId}`,
            refreshWindowLine(window, source, now),
            `${source.connection.id}\u0000${result.sourceId}\u0000${window.metricId}\u0000${window.status}\u0000${window.errorCode ?? ''}\u0000${window.nextAllowedAt ?? ''}`,
          )
    }
  }
  if (snapshot.cacheError) addError('cache', snapshot.cacheError)
  if (snapshot.exportError) addError('export', snapshot.exportError)
  const errorSignature = errorItems.map((item) => `${item.key}\u0000${item.signature}`).join('\n')
  useEffect(() => {
    if (!errorSignature) {
      lastErrorSignature.current = ''
      setErrorsOpen(false)
      return
    }
    if (errorSignature !== lastErrorSignature.current) {
      lastErrorSignature.current = errorSignature
      setErrorsOpen(true)
    }
  }, [errorSignature])
  useEffect(() => {
    if (!errorsOpen || !errorSignature) return
    const timer = setTimeout(() => setErrorsOpen(false), 60_000)
    return () => clearTimeout(timer)
  }, [errorsOpen, errorSignature])
  useEffect(() => {
    if (!menu) return
    const item = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    ;(item ?? menuRef.current)?.focus()
  }, [menu])
  useEffect(() => {
    if (menu) return
    const target = menuReturnFocus.current
    if (target?.isConnected) target.focus()
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (menuRef.current?.contains(target) || target.closest('.usage-group-menu')) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [menu])
  useEffect(() => {
    if (!open) setMenu(null)
  }, [open])
  // biome-ignore lint/correctness/useExhaustiveDependencies: A successful settings save invalidates the renderer snapshot.
  useEffect(() => {
    let mounted = true
    let reading = false
    alive.current = true
    setManual(null)
    const read = async () => {
      if (document.hidden || reading) return
      reading = true
      const request = readFlight.current?.api === api ? readFlight.current.promise : api.read()
      readFlight.current = { api, promise: request }
      try {
        const next = await request
        if (mounted) {
          setSnapshot(next)
          setError(null)
          setNow(Date.now())
        }
      } catch (e) {
        if (mounted) setError(formatErrorMessage(e, 'Cannot read usage.'))
      } finally {
        reading = false
        if (readFlight.current?.promise === request) readFlight.current = null
      }
    }
    void read()
    const timer = setInterval(() => {
      void read()
    }, 5000)
    // Countdown is derived from main's absolute deadlines, independent of snapshot polling.
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, 1000)
    document.addEventListener('visibilitychange', read)
    return () => {
      mounted = false
      alive.current = false
      clearInterval(timer)
      clearInterval(clock)
      document.removeEventListener('visibilitychange', read)
    }
  }, [api, version])
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect)
        setPosition({
          left: Math.max(
            12,
            Math.min(rect.left, window.innerWidth - Math.min(400, window.innerWidth - 24) - 12),
          ),
          top: rect.bottom + 6,
        })
    }
    place()
    window.addEventListener('resize', place)
    dialog.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    return () => {
      window.removeEventListener('resize', place)
      trigger.current?.focus()
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (
        dialog.current &&
        !dialog.current.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])
  const pinnedSource = snapshot.connections.find(
    (c) => c.connection.id === snapshot.pin?.connectionId,
  )
  const pinned = pinnedSource?.subscription?.metrics.find((m) => m.id === snapshot.pin?.metricId)
  const refreshing = pending.length > 0 || snapshot.connections.some((c) => c.refreshing)
  const menuSource = menu
    ? snapshot.connections.find((c) => c.connection.id === menu.connectionId)
    : undefined
  const menuTarget: RefreshTarget | null = menu
    ? {
        connectionId: menu.connectionId,
        ...(menu.subscriptionId === undefined ? {} : { subscriptionId: menu.subscriptionId }),
      }
    : null
  const menuEnabled =
    menuSource && menu
      ? menu.subscriptionId === undefined
        ? menuSource.subscriptions == null || menuSource.subscriptions.length > 0
        : (menuSource.subscriptions?.some((item) => item.subscriptionId === menu.subscriptionId) ??
          false)
      : false
  const isPending = (target: RefreshTarget) =>
    pending.includes(targetKey({ connectionId: target.connectionId })) ||
    (target.subscriptionId !== undefined && pending.includes(targetKey(target)))
  async function refresh(target: RefreshTarget): Promise<void> {
    const key = targetKey(target)
    if (manualFlights.current.has(key)) return
    manualFlights.current.add(key)
    const sequence = ++manualSequence.current
    setPending((keys) => [...keys, key])
    setManual({ target, result: null })
    try {
      const s = await api.refresh(target)
      if (alive.current) {
        setSnapshot(s)
        // A newer click owns the status message (spec A5).
        if (sequence === manualSequence.current) setManual({ target, result: s })
        setNow(Date.now())
        setError(null)
      }
    } catch (e) {
      if (alive.current) {
        if (sequence === manualSequence.current) setManual(null)
        setError(formatErrorMessage(e))
      }
    } finally {
      manualFlights.current.delete(key)
      if (alive.current) setPending((keys) => keys.filter((k) => k !== key))
    }
  }
  function closeMenu(): void {
    setMenu(null)
  }
  function openMenuAt(
    source: UsageConnectionSnapshot,
    subscriptionId: string | undefined,
    x: number,
    y: number,
    returnFocus: HTMLElement | null,
  ): void {
    menuReturnFocus.current = returnFocus
    setMenu({
      connectionId: source.connection.id,
      ...(subscriptionId === undefined ? {} : { subscriptionId }),
      x: Math.max(8, Math.min(x, window.innerWidth - 228)),
      y: Math.max(8, Math.min(y, window.innerHeight - 128)),
    })
  }
  function openMenuFromButton(
    event: React.MouseEvent<HTMLButtonElement>,
    source: UsageConnectionSnapshot,
    subscriptionId?: string,
  ): void {
    const rect = event.currentTarget.getBoundingClientRect()
    openMenuAt(source, subscriptionId, rect.left, rect.bottom + 4, event.currentTarget)
  }
  function openMenuFromHeading(
    event: React.MouseEvent<HTMLDivElement>,
    source: UsageConnectionSnapshot,
    subscriptionId?: string,
  ): void {
    event.preventDefault()
    const trigger = event.currentTarget.querySelector<HTMLElement>('.usage-group-menu')
    openMenuAt(source, subscriptionId, event.clientX, event.clientY, trigger)
  }
  function menuKeydown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ]
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }
  function runMenu(target: RefreshTarget): void {
    closeMenu()
    void refresh(target)
  }
  function menuItem(
    target: RefreshTarget,
    enabled: boolean,
    reason?: string,
  ): React.JSX.Element | null {
    const source = snapshot.connections.find((c) => c.connection.id === target.connectionId)
    if (!source) return null
    if (!enabled)
      return (
        <button type="button" role="menuitem" disabled className="usage-menu-item">
          {reason ?? 'No refresh source in the Hub'}
        </button>
      )
    const busy = isPending(target)
    const state = `${refreshState(source, now, target.subscriptionId, busy)}.`
    return (
      <button
        type="button"
        role="menuitem"
        className="usage-menu-item"
        aria-label={`Refresh ${targetLabel(source, target.subscriptionId)}`}
        aria-description={state}
        title={state}
        disabled={busy}
        onClick={() => runMenu(target)}
      >
        <span>Refresh {targetLabel(source, target.subscriptionId)}</span>
        <span className="usage-menu-state">
          {refreshShortState(source, now, target.subscriptionId, busy)}
        </span>
      </button>
    )
  }
  /** Spec M2: a visible menu trigger on every group, plus the same menu from a heading right-click. */
  function groupHead(source: UsageConnectionSnapshot, subscriptionId?: string): React.JSX.Element {
    const label = targetLabel(source, subscriptionId)
    const hasMenu = subscriptionId === undefined || source.subscriptions != null
    const expanded =
      menu?.connectionId === source.connection.id && menu.subscriptionId === subscriptionId
    const Heading = subscriptionId === undefined ? 'h3' : 'h4'
    return (
      <div
        className="usage-group-head"
        role="group"
        aria-label={label}
        onContextMenu={
          hasMenu ? (event) => openMenuFromHeading(event, source, subscriptionId) : undefined
        }
      >
        <Heading>
          {subscriptionId === undefined
            ? source.connection.label
            : subscriptionLabel(source, subscriptionId)}
        </Heading>
        {subscriptionId === undefined && source.error ? (
          <span className="usage-group-error" aria-hidden="true">
            Error
          </span>
        ) : null}
        {hasMenu ? (
          <button
            type="button"
            className="usage-group-menu"
            aria-label={`Refresh options for ${label}`}
            aria-haspopup="menu"
            aria-expanded={expanded}
            onClick={(event) => openMenuFromButton(event, source, subscriptionId)}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              openMenuAt(source, subscriptionId, rect.left, rect.bottom + 4, event.currentTarget)
            }}
          >
            ⋯
          </button>
        ) : null}
      </div>
    )
  }
  async function pin(connectionId: string, metricId: string): Promise<void> {
    try {
      const settings = await api.getSettings()
      await api.saveSettings({ ...settings, pin: { connectionId, metricId } })
      if (alive.current) setSnapshot(await api.read())
    } catch (e) {
      if (alive.current) setError(formatErrorMessage(e))
    }
  }
  function keydown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    if (event.key === 'Tab') {
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex="0"]',
        ) ?? []),
      ]
      const index = controls.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="usage-trigger no-drag"
        aria-label={
          pinned && pinnedSource
            ? `Usage quota: ${tooltip(pinnedSource, pinned, now)}`
            : 'Usage quota'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {pinned && pinnedSource ? (
          <>
            <span className={`usage-avatar ${badge(pinnedSource, pinned, now)}`}>
              {avatar(pinnedSource, pinned)}
            </span>
            <span className="usage-trigger-period">{metricName(pinnedSource, pinned)}</span>
            <UsageGraphic metric={pinned} now={now} />
            <strong>{value(pinned)}</strong>
            <span className="usage-trigger-age">
              {pinnedSource.error
                ? `Error - ${usageFreshness(pinned, now)}`
                : usageFreshness(pinned, now)}
            </span>
          </>
        ) : (
          <span>
            ◴ <span className="usage-trigger-word">Usage</span>
          </span>
        )}
        <span aria-hidden="true">⌄</span>
      </button>
      {open
        ? createPortal(
            <>
              <div
                className="usage-backdrop no-drag"
                onMouseDown={() => setOpen(false)}
                aria-hidden="true"
              />
              <section
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="usage-title"
                className="usage-panel no-drag"
                style={position}
                onKeyDown={keydown}
              >
                <header>
                  <h2 id="usage-title">Usage</h2>
                  <span className="usage-head-note">
                    {refreshing ? 'Refreshing usage...' : `${snapshot.connections.length} sources`}
                  </span>
                  {errorItems.length > 0 ? (
                    <button
                      type="button"
                      className="usage-errors-toggle"
                      aria-expanded={errorsOpen}
                      aria-controls="usage-errors"
                      onClick={() => setErrorsOpen((value) => !value)}
                    >
                      Errors ({errorItems.length})
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Close usage panel"
                    onClick={() => setOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <span className="usage-row-status" aria-live="polite">
                  {errorItems.length > 0 ? `${errorItems.length} usage errors` : ''}
                </span>
                {manual ? (
                  <p role="status" className="usage-message">
                    {manual.result
                      ? refreshOutcome(manual.target, manual.result, snapshot, now)
                      : `Refreshing ${(() => {
                          const source = snapshot.connections.find(
                            (c) => c.connection.id === manual.target.connectionId,
                          )
                          return source
                            ? targetLabel(source, manual.target.subscriptionId)
                            : manual.target.connectionId
                        })()}...`}
                  </p>
                ) : null}
                {snapshot.connections.length === 0 ? (
                  <div className="usage-empty">
                    <p>No usage accounts enabled.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onConfigure()
                      }}
                    >
                      Configure usage
                    </button>
                  </div>
                ) : (
                  snapshot.connections.map((source) => {
                    const groups = subscriptionGroups(source)
                    const row = (metric: UsageMetric) => {
                      const selected =
                        snapshot.pin?.connectionId === source.connection.id &&
                        snapshot.pin.metricId === metric.id
                      const freshness = usageFreshness(metric, now),
                        slices = usageSlices(metric, now)
                      return (
                        <button
                          type="button"
                          className={`usage-row ${selected ? 'usage-pinned' : ''} ${freshness.startsWith('Stale') || freshness.startsWith('Expired') ? 'usage-old' : ''}`}
                          key={metric.id}
                          aria-pressed={selected}
                          disabled={metric.state === 'unavailable'}
                          aria-label={`${source.connection.label}, ${metricName(source, metric)}, ${value(metric)}, ${source.error ? `Error: ${source.error.message}, ` : ''}${freshness}${slices?.pace ? `, ${slices.pace}` : ''}`}
                          title={tooltip(source, metric, now)}
                          onClick={() => {
                            setOpen(false)
                            void pin(source.connection.id, metric.id)
                          }}
                        >
                          <span className="usage-name">
                            <span className={`usage-avatar ${badge(source, metric, now)}`}>
                              {avatar(source, metric)}
                            </span>
                            <span>{metric.label}</span>
                          </span>
                          <UsageGraphic metric={metric} now={now} />
                          <strong className={metric.kind === 'balance' ? 'usage-balance' : ''}>
                            {value(metric)}
                          </strong>
                          <span
                            className={`usage-hint ${slices?.pace?.startsWith('↑') ? 'usage-behind' : ''}`}
                          >
                            {slices?.pace?.startsWith('↑') ? slices.pace : reset(metric, now)}
                          </span>
                          <span className="usage-row-status">
                            {source.error ? 'Error; ' : ''}
                            {freshness}
                            {slices?.pace === 'Ahead of pace' ? '; Ahead of pace' : ''}
                          </span>
                        </button>
                      )
                    }
                    return (
                      <div key={source.connection.id} className="usage-source">
                        {groupHead(source)}
                        {groups ? (
                          groups.map(([subscriptionId, metrics]) => (
                            <div key={subscriptionId} className="usage-subscription">
                              {groupHead(source, subscriptionId)}
                              {metrics.map(row)}
                            </div>
                          ))
                        ) : source.subscription?.metrics.length ? (
                          source.subscription.metrics.map(row)
                        ) : (
                          <p className="usage-message">
                            {source.subscription?.status === 'unavailable'
                              ? 'Unavailable'
                              : 'No usage data yet'}
                          </p>
                        )}
                      </div>
                    )
                  })
                )}
                {errorItems.length > 0 && errorsOpen ? (
                  <section id="usage-errors" aria-label="Usage errors" className="usage-errors">
                    <div className="usage-errors-head">
                      <span>Usage errors</span>
                      <button
                        type="button"
                        aria-label="Close usage errors"
                        onClick={() => setErrorsOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="usage-errors-body">
                      {errorItems.map((item) => (
                        <p key={item.key} className="usage-message">
                          {item.text}
                        </p>
                      ))}
                    </div>
                  </section>
                ) : null}
                {menu && menuSource && menuTarget ? (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label={`Actions for ${targetLabel(menuSource, menu.subscriptionId)}`}
                    className="usage-menu"
                    style={{ left: menu.x, top: menu.y }}
                    tabIndex={-1}
                    onKeyDown={menuKeydown}
                  >
                    {menuItem(
                      menuTarget,
                      menuEnabled,
                      menu.subscriptionId === undefined
                        ? 'No refresh source in the Hub'
                        : 'No refresh source for this subscription in the Hub',
                    )}
                  </div>
                ) : null}
                {snapshot.connections.length > 0 ? (
                  <footer>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onConfigure()
                      }}
                    >
                      Configure usage
                    </button>
                  </footer>
                ) : null}
              </section>
            </>,
            document.body,
          )
        : null}
    </>
  )
}
