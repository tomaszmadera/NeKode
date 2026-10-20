import { useEffect, useRef, useState } from 'react'
import { formatErrorMessage } from '../../../../shared/ipc-error'
import type {
  UsageApi,
  UsageConnectionSnapshot,
  UsageMetric,
  UsageSnapshot,
} from '../../../../shared/usage-contract'
import { usageFreshness, usagePercent, usageSlices } from '../../../../shared/usage-contract'
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
    <span className="usage-graphic" aria-hidden="true">
      {slices ? (
        slices.shares.map((share, index) => {
          const fill = Math.max(0, Math.min(1, (percent - offset) / share)) * 100
          offset += share
          return (
            <span
              key={offset}
              className={`usage-slice ${index === slices.current ? 'usage-current' : ''} ${slices.pace?.startsWith('↑') && index < slices.current ? 'usage-unused' : ''} ${slices.pace === 'Ahead of pace' && index > slices.current ? 'usage-ahead' : ''}`}
              style={{ flexGrow: share }}
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
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null)
  const readFlight = useRef<{ api: UsageApi; promise: Promise<UsageSnapshot> } | null>(null),
    alive = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A successful settings save invalidates the renderer snapshot.
  useEffect(() => {
    let mounted = true
    let reading = false
    alive.current = true
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
    document.addEventListener('visibilitychange', read)
    return () => {
      mounted = false
      alive.current = false
      clearInterval(timer)
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
  const pinnedSource = snapshot.connections.find(
    (c) => c.connection.id === snapshot.pin?.connectionId,
  )
  const pinned = pinnedSource?.subscription?.metrics.find((m) => m.id === snapshot.pin?.metricId)
  const refreshing = snapshot.connections.some((c) => c.refreshing)
  async function refresh(): Promise<void> {
    try {
      setSnapshot((s) => ({
        ...s,
        connections: s.connections.map((c) => ({ ...c, refreshing: true })),
      }))
      const s = await api.refresh()
      if (alive.current) {
        setSnapshot(s)
        setError(null)
      }
    } catch (e) {
      if (alive.current) {
        setError(formatErrorMessage(e))
        setSnapshot((s) => ({
          ...s,
          connections: s.connections.map((c) => ({ ...c, refreshing: false })),
        }))
      }
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
              {pinnedSource.connection.providerId.slice(0, 2).toUpperCase()}
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
      {open ? (
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
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                ↻
              </button>
              <button type="button" aria-label="Close usage panel" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            {error ? (
              <p role="alert" className="usage-message">
                {error}
              </p>
            ) : null}
            {snapshot.connections.length === 0 ? (
              <div className="usage-empty">
                <p>No usage connections enabled.</p>
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
              snapshot.connections.map((source) => (
                <div key={source.connection.id} className="usage-source">
                  <h3>{source.connection.label}</h3>
                  {source.subscription?.metrics.length ? (
                    source.subscription.metrics.map((metric, index) => {
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
                          onClick={() => void pin(source.connection.id, metric.id)}
                        >
                          <span className="usage-name">
                            {index === 0 ? (
                              <span className={`usage-avatar ${badge(source, metric, now)}`}>
                                {source.connection.providerId.slice(0, 2).toUpperCase()}
                              </span>
                            ) : (
                              <span className="usage-avatar-space" />
                            )}
                            <span>{metric.label}</span>
                          </span>
                          <UsageGraphic metric={metric} now={now} />
                          <strong className={metric.kind === 'balance' ? 'usage-balance' : ''}>
                            {value(metric)}
                          </strong>
                          <span className="usage-hint">
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
                  <p className="usage-source-note">
                    {source.connection.adapterId}
                    {source.error
                      ? `: ${source.error.message}${/[.!?]$/.test(source.error.message) ? '' : '.'} `
                      : '. '}
                    {source.subscription?.metrics
                      .map((metric) => `${metric.label}: ${usageFreshness(metric, now)}`)
                      .join('; ')}
                  </p>
                </div>
              ))
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
          </section>
        </>
      ) : null}
    </>
  )
}
