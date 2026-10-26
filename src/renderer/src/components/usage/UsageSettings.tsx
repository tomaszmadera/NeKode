import type {
  UsageSettings as Settings,
  UsageAdapter,
  UsageConnection,
  UsageSnapshot,
} from '@shared/contracts/usage-contract'
import type { AppApi } from '@shared/ipc-contract'
import { formatErrorMessage } from '@shared/ipc-error'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import {
  GroupBox,
  GroupFooter,
  monoClass,
  PageIntro,
  primaryClass,
  quietClass,
  SectionLabel,
  SettingsGroup,
  SettingsSwitch,
  StackedRow,
  secondaryClass,
} from '../settings/settings-ui'
import { UsageAccountEditor } from './UsageAccountEditor'

type View =
  | { kind: 'list' }
  | { kind: 'pick' }
  | { kind: 'edit'; connection: UsageConnection; isNew: boolean }

/** Where an adapter comes from (spec rule 26). */
function origin(adapter: UsageAdapter): string {
  return adapter.bundled ? 'Shipped' : 'Added by you'
}

function age(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

function limitCount(c: UsageConnection, snapshot: UsageSnapshot | null): string {
  const subscription = snapshot?.connections.find((s) => s.connection.id === c.id)?.subscription
  if (!subscription) return 'No limits yet'
  const count = subscription.metrics.length
  return `${count} ${count === 1 ? 'limit' : 'limits'}`
}

/** Textual source status for the list (spec rule 21). */
function status(c: UsageConnection, snapshot: UsageSnapshot | null, now: number): string {
  if (!c.enabled) return 'Disabled'
  const source = snapshot?.connections.find((s) => s.connection.id === c.id)
  if (source?.error) return source.error.message
  const metrics = source?.subscription?.metrics ?? []
  if (metrics.length === 0) return 'No reading yet'
  const observed = metrics
    .map((m) => (m.observedAt ? Date.parse(m.observedAt) : null))
    .filter((t): t is number => t !== null)
  return observed.length
    ? `Last reading ${age(now - Math.max(...observed))}`
    : 'Last reading, age unknown'
}

export function UsageSettings({
  app,
  onSaved,
}: {
  app: AppApi
  onSaved?(): void
}): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null),
    [adapters, setAdapters] = useState<UsageAdapter[]>([]),
    [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null),
    [enabled, setEnabled] = useState(false),
    [view, setView] = useState<View>({ kind: 'list' }),
    [removing, setRemoving] = useState<string | null>(null),
    [exportDraft, setExportDraft] = useState<Settings['export'] | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [adaptersOpen, setAdaptersOpen] = useState(true)
  useEffect(() => {
    let alive = true
    void Promise.all([
      app.usage.getSettings(),
      app.usage.listAdapters(),
      app.usage.getEnabled(),
      app.usage.read(),
    ])
      .then(([s, a, on, snap]) => {
        if (alive) {
          setEnabled(on)
          setSettings(s)
          setExportDraft(s.export)
          setAdapters(a)
          setSnapshot(snap)
        }
      })
      .catch((e) => {
        if (alive) setError(formatErrorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [app])
  async function action(operation: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await operation()
    } catch (e) {
      setError(formatErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  /** Store a whole settings value built from the stored one (spec rules 23, 27). */
  async function store(next: Settings, message: string): Promise<Settings> {
    const saved = await app.usage.saveSettings(next)
    setSettings(saved)
    setAdapters(await app.usage.listAdapters())
    setSnapshot(await app.usage.read())
    setNotice(message)
    onSaved?.()
    return saved
  }
  if (!settings || !exportDraft)
    return <p role={error ? 'alert' : 'status'}>{error ?? 'Loading usage settings...'}</p>
  const s = settings
  const usable = adapters.filter((a) => !a.error)
  const byOrigin = [...adapters.filter((a) => a.bundled), ...adapters.filter((a) => !a.bundled)]
  const now = Date.now()

  let sources: React.JSX.Element | null
  if (view.kind === 'edit') {
    const adapter = usable.find((a) => a.id === view.connection.adapterId)
    sources = (
      <UsageAccountEditor
        app={app}
        adapter={adapter}
        initial={view.connection}
        isNew={view.isNew}
        switchOn={enabled}
        onCancel={() => setView({ kind: 'list' })}
        onSave={async (c) => {
          const connections = view.isNew
            ? [...s.connections, c]
            : s.connections.map((x) => (x.id === c.id ? c : x))
          const saved = await app.usage.saveSettings({ ...s, connections })
          setSettings(saved)
          setSnapshot(await app.usage.read())
          setView({ kind: 'list' })
          setNotice(`Source saved: ${c.label}`)
          onSaved?.()
        }}
      />
    )
  } else if (view.kind === 'pick') {
    sources = (
      <fieldset className="space-y-2" aria-label="Choose an adapter">
        <legend>Choose an adapter</legend>
        {usable.map((a) => (
          <button
            key={`${a.id}:${a.directory ?? ''}`}
            type="button"
            className="block w-full rounded border border-edge p-2 text-left"
            onClick={() =>
              setView({
                kind: 'edit',
                isNew: true,
                connection: {
                  id: crypto.randomUUID(),
                  label: '',
                  providerId: '',
                  adapterId: a.id,
                  enabled: true,
                  config: {},
                },
              })
            }
          >
            <span className="font-semibold">{a.name}</span>
            <span className="ml-2 text-xs">{origin(a)}</span>
            {a.experimental ? <span className="ml-2 text-xs">Experimental</span> : null}
            {a.summary ? <span className="block text-xs text-ink-muted">{a.summary}</span> : null}
          </button>
        ))}
        <button type="button" onClick={() => setView({ kind: 'list' })}>
          Back
        </button>
      </fieldset>
    )
  } else {
    sources =
      s.connections.length > 0 ? (
        <ul
          className="overflow-hidden rounded-[10px] border border-edge bg-group"
          aria-label="Sources"
        >
          {s.connections.map((c) => {
            const sourceStatus = status(c, snapshot, now)
            const fresh = sourceStatus.startsWith('Last reading')
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 border-t border-edge px-4 py-3 first:border-t-0"
              >
                <span
                  aria-hidden
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-button font-mono text-[10px] font-bold text-ink"
                >
                  {c.label.slice(0, 1).toUpperCase()}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    fresh
                      ? 'bg-success'
                      : sourceStatus === 'No reading yet' || sourceStatus === 'Disabled'
                        ? 'bg-ink-muted'
                        : 'bg-error',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                  <span className="block text-xs text-ink-secondary">
                    {adapters.find((a) => a.id === c.adapterId)?.name ?? c.adapterId}
                  </span>
                  <span className="text-xs text-ink-secondary">{limitCount(c, snapshot)}</span>
                  <span className="ml-2 text-xs text-ink-muted">{sourceStatus}</span>
                </span>
                <span className="flex gap-1">
                  {removing === c.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(quietClass, 'text-error')}
                        onClick={() =>
                          void action(async () => {
                            await store(
                              { ...s, connections: s.connections.filter((x) => x.id !== c.id) },
                              `Source removed: ${c.label}`,
                            )
                            setRemoving(null)
                          })
                        }
                      >
                        Confirm remove {c.label}
                      </button>
                      <button
                        type="button"
                        className={quietClass}
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${c.label}`}
                        className={quietClass}
                        onClick={() => setView({ kind: 'edit', isNew: false, connection: c })}
                      >
                        <Icon.edit size={13} aria-hidden />
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${c.label}`}
                        className={cn(quietClass, 'text-error')}
                        onClick={() => setRemoving(c.id)}
                      >
                        <Icon.trash size={13} aria-hidden />
                        Remove
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null
  }

  const writeOn = exportDraft.enabled
  return (
    <div className="flex max-w-[660px] flex-col gap-7 text-sm">
      <PageIntro
        title="Usage"
        description="Quota in the title bar, the sources that feed it, and an optional JSON export."
      />
      <SettingsGroup label="Quota">
        <GroupBox>
          <SettingsSwitch
            id="usage-show-quota"
            label="Show usage quota"
            description="Off hides the title-bar button and stops every usage read, adapter process and export. Sources, the pin and cached values are kept."
            checked={enabled}
            disabled={busy}
            onChange={(next) => {
              void action(async () => {
                setEnabled(await app.usage.setEnabled(next))
                onSaved?.()
              })
            }}
          />
        </GroupBox>
      </SettingsGroup>
      <section className="flex flex-col gap-2.5" aria-labelledby="usage-sources">
        <div className="flex items-center gap-3">
          <h3
            id="usage-sources"
            className="m-0 flex-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase"
          >
            Sources
          </h3>
          {view.kind === 'list' ? (
            <button
              type="button"
              disabled={busy}
              className={cn(secondaryClass, 'gap-1.5')}
              onClick={() => setView({ kind: 'pick' })}
            >
              <Icon.plus size={14} aria-hidden />
              Add source
            </button>
          ) : null}
        </div>
        <p className="text-[13px] text-ink-muted">
          Each source reads quota limits through an adapter and shows them in the title bar. One
          source can report one account or, like a hub, several agents.
        </p>
        {sources}
      </section>
      <SettingsGroup label="JSON export">
        <SectionLabel title="JSON export" />
        <p id="usage-export" className="text-xs text-ink-muted">
          Other programs on this computer, such as dashboards or sync scripts, can read this file.
          It contains no secrets. Use a separate file from every input. Turning this off keeps the
          last file.
        </p>
        <GroupBox>
          <SettingsSwitch
            id="usage-export-write"
            label="Write usage to a JSON file"
            checked={writeOn}
            disabled={busy}
            onChange={(next) => setExportDraft({ ...exportDraft, enabled: next })}
          />
          <StackedRow label="Output file" htmlFor="usage-export-path" divided dimmed={!writeOn}>
            <div className="flex gap-2">
              <input
                id="usage-export-path"
                aria-label="Usage export output file"
                disabled={!writeOn}
                className={monoClass}
                value={exportDraft.path ?? ''}
                onChange={(e) => setExportDraft({ ...exportDraft, path: e.target.value || null })}
              />
              <button
                type="button"
                disabled={busy}
                aria-label="Choose output file"
                className={secondaryClass}
                onClick={() =>
                  void action(async () => {
                    const path = await app.usage.pickFile(true)
                    if (path) setExportDraft({ ...exportDraft, path })
                  })
                }
              >
                Choose
              </button>
            </div>
          </StackedRow>
          <SettingsSwitch
            id="usage-export-replace"
            label="Replace an existing file at the selected output"
            checked={exportDraft.replaceExisting === true}
            disabled={!writeOn || busy}
            divided
            onChange={(next) => setExportDraft({ ...exportDraft, replaceExisting: next })}
          />
          <GroupFooter>
            <button
              type="button"
              disabled={busy}
              aria-label="Save export settings"
              className={primaryClass}
              onClick={() =>
                void action(async () => {
                  const saved = await store({ ...s, export: exportDraft }, 'Export settings saved.')
                  setExportDraft(saved.export)
                })
              }
            >
              Save
            </button>
          </GroupFooter>
        </GroupBox>
      </SettingsGroup>
      <section className="flex flex-col gap-2.5" aria-label="Adapters">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-expanded={adaptersOpen}
            className="inline-flex h-8 flex-1 items-center gap-2 text-left"
            onClick={() => setAdaptersOpen((open) => !open)}
          >
            <Icon.chevronRight
              size={14}
              aria-hidden
              className={cn(
                'shrink-0 text-ink-muted transition-transform',
                adaptersOpen && 'rotate-90',
              )}
            />
            <span className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
              Adapters
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="Open adapters folder"
            className={cn(secondaryClass, 'gap-1.5')}
            onClick={() => void action(() => app.usage.openAdaptersFolder())}
          >
            <Icon.directory size={14} aria-hidden />
            Open folder
          </button>
        </div>
        {adaptersOpen ? (
          <GroupBox>
            <p className="px-4 py-3 text-xs text-ink-muted">
              Adapters are trusted executables: enabling a source lets its adapter run with your
              permissions. To add your own adapter, put a folder with a usage-adapter.json manifest
              in the adapters folder; one with a shipped adapter's id replaces it. Reopen settings
              to list it.
            </p>
            <ul className="border-t border-edge" aria-label="Usage adapters">
              {byOrigin.map((a) => (
                <li
                  key={`${a.id}:${a.directory ?? ''}`}
                  className="flex flex-col gap-1.5 border-t border-edge px-4 py-3 text-xs first:border-t-0"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{a.name}</span>
                    <span className="rounded-[5px] border border-edge bg-button px-1.5 font-mono text-[11px]">
                      {a.id}
                    </span>
                    <span>{origin(a)}</span>
                  </span>
                  <span>
                    {a.sourceKind}; {a.capabilities.join(', ')}
                  </span>
                  <span className="break-all font-mono">
                    Executable: {a.invocation.command} {a.invocation.args.join(' ')}
                  </span>
                  {a.directory ? <span className="block break-all">{a.directory}</span> : null}
                  {a.error ? <span className="block text-error">{a.error}</span> : null}
                </li>
              ))}
            </ul>
          </GroupBox>
        ) : null}
      </section>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  )
}
