import { formatErrorMessage } from '@shared/ipc-error'
import type {
  UsageApi,
  UsageConnectionSnapshot,
  UsageErrorCode,
  UsageMetric,
  UsageRefreshSourceResult,
  UsageRefreshSourceStatus,
  UsageRefreshWindowResult,
  UsageSnapshot,
} from '@shared/usage-contract'
import { usageFreshness, usagePercent, usageSlices } from '@shared/usage-contract'
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
/** Row avatar: the metric's own provider for an aggregating account, else the account's. */
function avatar(source: UsageConnectionSnapshot, metric: UsageMetric): string {
  return (metric.providerId ?? source.connection.providerId).slice(0, 2).toUpperCase()
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
  return `${source.connection.label}; ${metric.label}; ${value(metric)}; ${source.error?.message ?? usageFreshness(metric, now)}; observation ${metric.observedAt ?? 'unknown'}; collected ${metric.collectedAt ?? source.subscription?.collectedAt ?? 'unknown'}; source ${source.connection.adapterId}; reset ${metric.resetsAt ?? 'unknown'}. Pace compares elapsed allowance slices, not a provider restriction or prediction.`
}
function refreshState(source: UsageConnectionSnapshot, now: number): string {
  const label = source.connection.label
  if (source.refreshing) return `${label} is refreshing`
  const until = source.nextRefreshAt
  const seconds = until ? Math.ceil((Date.parse(until) - now) / 1000) : 0
  return seconds > 0 ? `${label} can refresh again in ${seconds} s` : `${label} is ready to refresh`
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
function refreshSourceLine(result: UsageRefreshSourceResult, now: number): string {
  const status = refreshStatusText(result.status, result.errorCode)
  const retry = retryMessage(result.nextAllowedAt, now)
  return `${result.sourceId}: ${status}.${retry ? ` ${retry}` : ''}`
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
  return `${window.metricId}: ${status}.${retry ? ` ${retry}` : ''}${retained}`.trim()
}
function refreshOutcome(snapshot: UsageSnapshot, current: UsageSnapshot, now: number): string {
  const result = snapshot.refresh
  // Only connections read by this request feed the summary. An earlier attempt's stored result
  // stays visible as per-source detail but must not describe a request that read nothing.
  const read = new Set(result?.read ?? [])
  const refreshResults = snapshot.connections.flatMap((c) =>
    c.refreshResult && read.has(c.connection.id) ? [c.refreshResult] : [],
  )
  const failedSources = refreshResults
    .flatMap((r) => r.sources)
    .filter((source) => source.status !== 'succeeded').length
  const failedWindows = refreshResults
    .flatMap((r) => r.sources)
    .flatMap((source) => source.windows)
    .filter((window) => window.status !== 'succeeded').length
  // Any connection that did not fully succeed makes the outcome partial, including one that
  // failed outright while another connection succeeded.
  const partial = refreshResults.some((r) => r.status !== 'success')
  const failedRefresh =
    refreshResults.length > 0 && refreshResults.every((r) => r.status === 'failed')
  const failed = snapshot.connections.filter(
    (c) => result?.read.includes(c.connection.id) && c.error,
  ).length
  // An all-failed request keeps its explicit message; every other non-success outcome is partial.
  const summary = failed
    ? `Usage refresh completed; ${failed} source(s) failed.`
    : failedRefresh
      ? 'Usage refresh failed; earlier values were kept.'
      : partial
        ? `Usage refresh partially completed; ${failedSources} source(s) and ${failedWindows} window(s) failed.`
        : result?.read.length
          ? 'Usage refreshed.'
          : snapshot.connections.length
            ? 'Last refresh request read no sources.'
            : 'No usage accounts enabled.'
  const skipped =
    result?.skipped.map((skip) => {
      const source = current.connections.find((c) => c.connection.id === skip.connectionId)
      const label =
        source?.connection.label ??
        snapshot.connections.find((c) => c.connection.id === skip.connectionId)?.connection.label ??
        skip.connectionId
      const reason = skip.reason === 'backoff' ? 'provider backoff' : '60-second limit'
      const skipped = `${label} was skipped (${reason}).`
      return source ? `${skipped} ${refreshState(source, now)}.` : skipped
    }) ?? []
  return [summary, ...skipped].join(' ')
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
    [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 12, top: 46 })
  const [manualPending, setManualPending] = useState(false),
    [manualResult, setManualResult] = useState<UsageSnapshot | null>(null)
  const manualFlight = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null)
  const readFlight = useRef<{ api: UsageApi; promise: Promise<UsageSnapshot> } | null>(null),
    alive = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A successful settings save invalidates the renderer snapshot.
  useEffect(() => {
    let mounted = true
    let reading = false
    alive.current = true
    setManualResult(null)
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
  const refreshing = manualPending || snapshot.connections.some((c) => c.refreshing)
  const refreshDescription = snapshot.connections.length
    ? snapshot.connections.map((c) => `${refreshState(c, now)}.`).join(' ')
    : 'No usage accounts enabled.'
  async function refresh(): Promise<void> {
    if (manualFlight.current) return
    manualFlight.current = true
    setManualPending(true)
    setManualResult(null)
    try {
      const s = await api.refresh()
      if (alive.current) {
        setSnapshot(s)
        setManualResult(s)
        setNow(Date.now())
        setError(null)
      }
    } catch (e) {
      if (alive.current) {
        setError(formatErrorMessage(e))
      }
    } finally {
      manualFlight.current = false
      if (alive.current) setManualPending(false)
    }
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
            <span className="usage-trigger-period">{pinned.label}</span>
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
                  <button
                    type="button"
                    aria-label="Refresh usage"
                    title={refreshDescription}
                    aria-description={refreshDescription}
                    onClick={() => void refresh()}
                    disabled={refreshing}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    aria-label="Close usage panel"
                    onClick={() => setOpen(false)}
                  >
                    ×
                  </button>
                </header>
                {manualPending || manualResult ? (
                  <p role="status" className="usage-message">
                    {manualPending
                      ? 'Refreshing usage...'
                      : manualResult
                        ? refreshOutcome(manualResult, snapshot, now)
                        : ''}
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="usage-message">
                    {error}
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
                    const refreshDetail =
                      manualResult?.connections.find(
                        (c) => c.connection.id === source.connection.id,
                      )?.refreshResult ?? source.refreshResult
                    return (
                      <div key={source.connection.id} className="usage-source">
                        <h3>{source.connection.label}</h3>
                        {source.subscription?.metrics.length ? (
                          source.subscription.metrics.map((metric) => {
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
                                aria-label={`${source.connection.label}, ${metric.label}, ${value(metric)}, ${source.error ? `Error: ${source.error.message}, ` : ''}${freshness}${slices?.pace ? `, ${slices.pace}` : ''}`}
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
                                <strong
                                  className={metric.kind === 'balance' ? 'usage-balance' : ''}
                                >
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
                          })
                        ) : (
                          <p className="usage-message">
                            {source.subscription?.status === 'unavailable'
                              ? 'Unavailable'
                              : 'No usage data yet'}
                          </p>
                        )}
                        {refreshDetail ? (
                          <div className="usage-refresh-detail">
                            {refreshDetail.sources.map((result) => (
                              <div key={result.sourceId}>
                                <p className="usage-message">{refreshSourceLine(result, now)}</p>
                                {result.windows.map((window) => (
                                  <p
                                    className="usage-message"
                                    key={window.metricId}
                                    title={window.nextAllowedAt ?? undefined}
                                  >
                                    {refreshWindowLine(window, source, now)}
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {source.error ? (
                          <p className="usage-source-note">
                            {source.error.message}
                            {/[.!?]$/.test(source.error.message) ? '' : '.'}
                          </p>
                        ) : null}
                      </div>
                    )
                  })
                )}
                {snapshot.cacheError ? (
                  <p role="status" className="usage-message">
                    {snapshot.cacheError}
                  </p>
                ) : null}
                {snapshot.exportError ? (
                  <p role="alert" className="usage-message">
                    {snapshot.exportError}
                  </p>
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
