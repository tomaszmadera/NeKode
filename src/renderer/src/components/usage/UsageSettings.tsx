import { useEffect, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { formatErrorMessage } from '../../../../shared/ipc-error'
import type {
  UsageSettings as Settings,
  UsageAdapter,
  UsageConnection,
} from '../../../../shared/usage-contract'

export function UsageSettings({
  app,
  onSaved,
}: {
  app: AppApi
  onSaved?(): void
}): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null),
    [adapters, setAdapters] = useState<UsageAdapter[]>([]),
    [savedIds, setSavedIds] = useState<string[]>([]),
    [enabled, setEnabled] = useState(false)
  const [rowKeys, setRowKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all([app.usage.getSettings(), app.usage.listAdapters(), app.usage.getEnabled()])
      .then(([s, a, on]) => {
        if (alive) {
          setEnabled(on)
          setSettings(s)
          setRowKeys(s.connections.map(() => crypto.randomUUID()))
          setSavedIds(s.connections.map((c) => c.id))
          setAdapters(a)
        }
      })
      .catch((e) => {
        if (alive) setError(formatErrorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [app])
  function update(index: number, patch: Partial<UsageConnection>): void {
    setSettings((s) =>
      s
        ? { ...s, connections: s.connections.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
        : s,
    )
    setNotice(null)
  }
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
  if (!settings)
    return <p role={error ? 'alert' : 'status'}>{error ?? 'Loading usage settings...'}</p>
  const s = settings
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
        Connections, the pin and cached values are kept.
      </p>
      <p className="text-ink-secondary">
        Connections belong to a subscription or account across all projects. No source runs until
        you save an enabled connection.
      </p>
      <label className="block">
        Adapters directory
        <input
          className="mt-1 w-full rounded border border-edge bg-app p-2"
          aria-label="Usage adapters directory"
          value={s.adaptersDirectory ?? ''}
          onChange={(e) => setSettings({ ...s, adaptersDirectory: e.target.value || null })}
        />
      </label>
      <button
        type="button"
        className="rounded border border-edge px-3 py-1"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const path = await app.dialogs.pickDirectory(s.adaptersDirectory)
            if (path) setSettings({ ...s, adaptersDirectory: path })
          })
        }
      >
        Choose adapters directory
      </button>
      <p className="text-xs text-ink-muted">
        Default: your NeKode user data directory, usage-adapters. Save to discover a changed
        directory. Plugins are trusted executables: enabling one lets it run with your permissions.
      </p>
      {s.connections.map((c, index) => {
        const adapter = adapters.find((a) => a.id === c.adapterId)
        return (
          <fieldset
            key={rowKeys[index]}
            className="space-y-2 rounded border border-edge p-3"
            disabled={busy}
          >
            <legend className="px-1">{c.label || 'New connection'}</legend>
            <label className="block">
              Connection id
              <input
                aria-label={`Connection id ${index + 1}`}
                className="ml-2 rounded border border-edge bg-app p-1"
                disabled={savedIds.includes(c.id)}
                value={c.id}
                onChange={(e) => update(index, { id: e.target.value })}
              />
            </label>
            <label className="block">
              Account label
              <input
                aria-label={`Account label ${index + 1}`}
                className="ml-2 rounded border border-edge bg-app p-1"
                value={c.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
            </label>
            <label className="block">
              Provider id
              <input
                aria-label={`Provider id ${index + 1}`}
                className="ml-2 rounded border border-edge bg-app p-1"
                value={c.providerId}
                onChange={(e) => update(index, { providerId: e.target.value })}
              />
            </label>
            <label className="block">
              Source
              <select
                aria-label={`Usage source ${index + 1}`}
                className="ml-2 rounded border border-edge bg-app p-1"
                value={c.adapterId}
                onChange={(e) => update(index, { adapterId: e.target.value, config: {} })}
              >
                {adapters.map((a) => (
                  <option key={`${a.id}:${a.directory ?? ''}`} value={a.id} disabled={!!a.error}>
                    {a.name}
                    {a.error ? `: ${a.error}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-ink-muted">
              {adapter?.sourceKind ?? 'Unavailable'};{' '}
              {adapter?.capabilities.join(', ') ?? 'No capabilities'}. Executable:{' '}
              {adapter?.invocation.command ?? 'Unavailable'} {adapter?.invocation.args.join(' ')}
            </p>
            {adapter?.description ? (
              <p className="text-xs text-ink-secondary">{adapter.description}</p>
            ) : null}
            {adapter?.configSchema.map((f) => (
              <div key={f.key}>
                <label className="block" htmlFor={`usage-${c.id}-${f.key}`}>
                  {f.label}
                  {f.type === 'boolean' ? (
                    <input
                      id={`usage-${c.id}-${f.key}`}
                      aria-label={`${f.label} ${index + 1}`}
                      type="checkbox"
                      aria-describedby={f.description ? `usage-${c.id}-${f.key}-help` : undefined}
                      checked={c.config[f.key] === true}
                      onChange={(e) =>
                        update(index, { config: { ...c.config, [f.key]: e.target.checked } })
                      }
                    />
                  ) : f.type === 'choice' ? (
                    <select
                      id={`usage-${c.id}-${f.key}`}
                      aria-label={`${f.label} ${index + 1}`}
                      aria-describedby={f.description ? `usage-${c.id}-${f.key}-help` : undefined}
                      value={String(c.config[f.key] ?? '')}
                      onChange={(e) =>
                        update(index, { config: { ...c.config, [f.key]: e.target.value } })
                      }
                    >
                      <option value="">Choose</option>
                      {f.choices?.map((choice) => (
                        <option key={choice}>{choice}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`usage-${c.id}-${f.key}`}
                      aria-label={`${f.label} ${index + 1}`}
                      type={f.type === 'secret' ? 'password' : 'text'}
                      aria-describedby={f.description ? `usage-${c.id}-${f.key}-help` : undefined}
                      autoComplete="off"
                      className="mt-1 w-full rounded border border-edge bg-app p-2"
                      placeholder={
                        c.secretKeys?.includes(f.key) ? 'Secret stored; leave blank to keep' : ''
                      }
                      value={String(c.config[f.key] ?? '')}
                      onChange={(e) => {
                        const config = { ...c.config }
                        if (e.target.value || f.type !== 'secret') config[f.key] = e.target.value
                        else delete config[f.key]
                        update(index, { config })
                      }}
                    />
                  )}
                </label>
                {f.description ? (
                  <p id={`usage-${c.id}-${f.key}-help`} className="text-xs text-ink-muted">
                    {f.description}
                  </p>
                ) : null}
                {f.type === 'directory' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void action(async () => {
                        const current = c.config[f.key]
                        const path = await app.dialogs.pickDirectory(
                          typeof current === 'string' && current ? current : null,
                        )
                        if (path) update(index, { config: { ...c.config, [f.key]: path } })
                      })
                    }
                  >
                    Choose directory
                  </button>
                ) : null}
                {adapter.id === 'claude-code-snapshots' ? (
                  <p className="text-xs text-ink-muted">
                    One directory per Claude account. With the Agent Harness, select its snapshot
                    directory; otherwise install the NeKode snapshot writer (see the Claude Code
                    usage guide).
                  </p>
                ) : null}
                {f.type === 'file' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void action(async () => {
                        const path = await app.usage.pickFile(false)
                        if (path) update(index, { config: { ...c.config, [f.key]: path } })
                      })
                    }
                  >
                    Choose JSON input
                  </button>
                ) : null}
                {f.type === 'secret' ? (
                  <button
                    type="button"
                    onClick={() => update(index, { config: { ...c.config, [f.key]: '' } })}
                  >
                    Clear stored {f.label}
                  </button>
                ) : null}
              </div>
            ))}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => update(index, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!enabled}
                aria-describedby={enabled ? undefined : `usage-test-off-${index}`}
                onClick={() =>
                  void action(async () => {
                    await app.usage.test(c)
                    setNotice(`Connection test succeeded: ${c.label}`)
                  })
                }
              >
                Test connection
              </button>
              {enabled ? null : (
                <span id={`usage-test-off-${index}`} className="text-xs text-ink-muted">
                  Turn on Show usage quota to test connections.
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSettings({ ...s, connections: s.connections.filter((_, i) => i !== index) })
                  setRowKeys((keys) => keys.filter((_, i) => i !== index))
                }}
              >
                Remove connection
              </button>
            </div>
          </fieldset>
        )
      })}
      <button
        type="button"
        disabled={busy}
        className="rounded border border-edge px-3 py-1"
        onClick={() => {
          setRowKeys((keys) => [...keys, crypto.randomUUID()])
          setSettings({
            ...s,
            connections: [
              ...s.connections,
              {
                id: crypto.randomUUID(),
                label: '',
                providerId: '',
                adapterId: 'usage-file',
                enabled: false,
                config: {},
              },
            ],
          })
        }}
      >
        Add connection
      </button>
      <fieldset className="space-y-2 rounded border border-edge p-3" disabled={busy}>
        <legend className="px-1">Local JSON export</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.export.enabled}
            onChange={(e) =>
              setSettings({ ...s, export: { ...s.export, enabled: e.target.checked } })
            }
          />
          Enable export
        </label>
        <label className="block">
          Output file
          <input
            aria-label="Usage export output file"
            className="mt-1 w-full rounded border border-edge bg-app p-2"
            value={s.export.path ?? ''}
            onChange={(e) =>
              setSettings({ ...s, export: { ...s.export, path: e.target.value || null } })
            }
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void action(async () => {
              const path = await app.usage.pickFile(true)
              if (path) setSettings({ ...s, export: { ...s.export, path } })
            })
          }
        >
          Choose output file
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.export.replaceExisting === true}
            onChange={(e) =>
              setSettings({ ...s, export: { ...s.export, replaceExisting: e.target.checked } })
            }
          />
          Replace an existing file at the selected output
        </label>
        <p className="text-xs text-ink-muted">
          Export excludes secrets. Use a separate file from every input. Turning export off retains
          the last file. A hosted consumer needs its own synchronization.
        </p>
      </fieldset>
      <button
        type="button"
        disabled={busy}
        className="rounded border border-edge bg-highlight px-3 py-2"
        onClick={() =>
          void action(async () => {
            const next = await app.usage.saveSettings(s)
            setSettings(next)
            setSavedIds(next.connections.map((c) => c.id))
            setAdapters(await app.usage.listAdapters())
            setNotice('Usage settings saved.')
            onSaved?.()
          })
        }
      >
        {busy ? 'Working...' : 'Save usage settings'}
      </button>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  )
}
