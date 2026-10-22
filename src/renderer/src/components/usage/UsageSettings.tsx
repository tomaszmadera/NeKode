import { useEffect, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { formatErrorMessage } from '../../../../shared/ipc-error'
import type {
  UsageSettings as Settings,
  UsageAdapter,
  UsageConnection,
  UsageSnapshot,
} from '../../../../shared/usage-contract'
import { UsageAccountEditor } from './UsageAccountEditor'

type View =
  | { kind: 'list' }
  | { kind: 'pick' }
  | { kind: 'edit'; connection: UsageConnection; isNew: boolean }

/** Where an adapter comes from (spec rules 18, 26); built-in readers have no directory. */
function origin(adapter: UsageAdapter): string {
  if (!adapter.directory) return 'Built in'
  return adapter.bundled ? 'Shipped with NeKode' : 'Added by you'
}

function age(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

/** Textual account status for the list (spec rule 21). */
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
    [notice, setNotice] = useState<string | null>(null)
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
  const now = Date.now()

  let accounts: React.JSX.Element
  if (view.kind === 'edit') {
    const adapter = usable.find((a) => a.id === view.connection.adapterId)
    accounts = (
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
          setNotice(`Account saved: ${c.label}`)
          onSaved?.()
        }}
      />
    )
  } else if (view.kind === 'pick') {
    accounts = (
      <fieldset className="space-y-2" aria-label="Choose a service">
        <legend>Choose the service that reports this account's limits.</legend>
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
            {a.experimental ? <span className="ml-2 text-xs">Experimental</span> : null}
            {a.directory && !a.bundled ? <span className="ml-2 text-xs">Added by you</span> : null}
            {a.summary ? <span className="block text-xs text-ink-muted">{a.summary}</span> : null}
          </button>
        ))}
        <button type="button" onClick={() => setView({ kind: 'list' })}>
          Back
        </button>
      </fieldset>
    )
  } else {
    accounts = (
      <div className="space-y-2">
        {s.connections.length > 0 ? (
          <ul className="space-y-2" aria-label="Accounts">
            {s.connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded border border-edge p-2"
              >
                <span className="font-semibold">{c.label}</span>
                <span className="text-xs text-ink-secondary">
                  {adapters.find((a) => a.id === c.adapterId)?.name ?? c.adapterId}
                </span>
                <span className="text-xs text-ink-muted">{status(c, snapshot, now)}</span>
                <span className="ml-auto flex gap-2">
                  {removing === c.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await store(
                              { ...s, connections: s.connections.filter((x) => x.id !== c.id) },
                              `Account removed: ${c.label}`,
                            )
                            setRemoving(null)
                          })
                        }
                      >
                        Confirm remove {c.label}
                      </button>
                      <button type="button" onClick={() => setRemoving(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${c.label}`}
                        onClick={() => setView({ kind: 'edit', isNew: false, connection: c })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${c.label}`}
                        onClick={() => setRemoving(c.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="rounded border border-edge px-3 py-1"
          onClick={() => setView({ kind: 'pick' })}
        >
          Add account
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked
            void action(async () => {
              setEnabled(await app.usage.setEnabled(next))
              onSaved?.()
            })
          }}
        />
        Show usage quota
      </label>
      <p className="text-xs text-ink-muted">
        Off hides the title-bar button and stops every usage read, adapter process and export.
        Accounts, the pin and cached values are kept.
      </p>
      <section className="space-y-2" aria-labelledby="usage-accounts">
        <h3 id="usage-accounts" className="font-semibold">
          Accounts
        </h3>
        <p className="text-ink-secondary">
          Add each subscription or API account you want to track. NeKode reads its limits from the
          service you choose and shows them in the title bar.
        </p>
        {accounts}
      </section>
      <section className="space-y-2 rounded border border-edge p-3" aria-labelledby="usage-export">
        <h3 id="usage-export" className="font-semibold">
          Write usage to a JSON file
        </h3>
        <p className="text-xs text-ink-muted">
          Other programs on this computer, such as dashboards or sync scripts, can read this file.
          It contains no secrets. Use a separate file from every input. Turning this off keeps the
          last file.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={exportDraft.enabled}
            onChange={(e) => setExportDraft({ ...exportDraft, enabled: e.target.checked })}
          />
          Write the file
        </label>
        <label className="block">
          Output file
          <input
            aria-label="Usage export output file"
            className="mt-1 w-full rounded border border-edge bg-app p-2"
            value={exportDraft.path ?? ''}
            onChange={(e) => setExportDraft({ ...exportDraft, path: e.target.value || null })}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void action(async () => {
              const path = await app.usage.pickFile(true)
              if (path) setExportDraft({ ...exportDraft, path })
            })
          }
        >
          Choose output file
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={exportDraft.replaceExisting === true}
            onChange={(e) => setExportDraft({ ...exportDraft, replaceExisting: e.target.checked })}
          />
          Replace an existing file at the selected output
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-edge bg-highlight px-3 py-1"
          onClick={() =>
            void action(async () => {
              const saved = await store({ ...s, export: exportDraft }, 'Export settings saved.')
              setExportDraft(saved.export)
            })
          }
        >
          Save export settings
        </button>
      </section>
      <details className="rounded border border-edge p-3">
        <summary>Advanced</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-ink-muted">
            Adapters are trusted executables: enabling an account lets its adapter run with your
            permissions. To add your own adapter, put a folder with a usage-adapter.json manifest in
            the adapters folder; one with a shipped adapter's id replaces it. Reopen settings to
            list it.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => app.usage.openAdaptersFolder())}
          >
            Open adapters folder
          </button>
          <ul className="space-y-2" aria-label="Usage adapters">
            {adapters.map((a) => (
              <li key={`${a.id}:${a.directory ?? ''}`} className="text-xs">
                <span className="font-semibold">{a.name}</span> ({a.id}). {origin(a)}.{' '}
                {a.sourceKind}; {a.capabilities.join(', ')}. Executable: {a.invocation.command}{' '}
                {a.invocation.args.join(' ')}
                {a.error ? <span className="block text-error">{a.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </details>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  )
}
