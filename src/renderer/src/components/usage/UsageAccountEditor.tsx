import type { AppApi } from '@shared/ipc-contract'
import { formatErrorMessage } from '@shared/ipc-error'
import {
  USAGE_REMOVED_ADAPTER_IDS,
  USAGE_REMOVED_ADAPTER_MESSAGE,
  type UsageAdapter,
  type UsageConnection,
} from '@shared/usage-contract'
import { useState } from 'react'

const input = 'mt-1 w-full rounded border border-edge bg-app p-2'

/** One source with one adapter (usage-quota spec rule 23). */
export function UsageAccountEditor({
  app,
  adapter,
  initial,
  isNew,
  switchOn,
  onSave,
  onCancel,
}: {
  app: AppApi
  adapter: UsageAdapter | undefined
  initial: UsageConnection
  isNew: boolean
  /** Global `Show usage quota` switch; tests need it on (spec rule 12). */
  switchOn: boolean
  onSave(connection: UsageConnection): Promise<void>
  onCancel(): void
}): React.JSX.Element {
  const [c, setC] = useState<UsageConnection>(initial)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  function config(key: string, value: string | boolean | undefined): void {
    setC((x) => {
      const next = { ...x.config }
      if (value === undefined) delete next[key]
      else next[key] = value
      return { ...x, config: next }
    })
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
  if (!adapter)
    return (
      <div className="space-y-2 rounded border border-edge p-3">
        <p role="alert" className="text-error">
          {USAGE_REMOVED_ADAPTER_IDS.includes(initial.adapterId)
            ? USAGE_REMOVED_ADAPTER_MESSAGE
            : `The adapter of this source (${initial.adapterId}) is unavailable. Remove the source or restore its adapter.`}
        </p>
        <button type="button" onClick={onCancel}>
          Back
        </button>
      </div>
    )
  return (
    <form
      className="space-y-3 rounded border border-edge p-3"
      aria-label={`${isNew ? 'New' : 'Edit'} ${adapter.name} source`}
      onSubmit={(e) => {
        e.preventDefault()
        void action(() => onSave(c))
      }}
    >
      <h3 className="font-semibold">
        {isNew ? `New ${adapter.name} source` : `Edit ${c.label || adapter.name}`}
      </h3>
      <label className="block">
        Name
        <input
          aria-label="Name"
          className={input}
          placeholder="For example: Claude Max (work)"
          value={c.label}
          onChange={(e) => setC({ ...c, label: e.target.value })}
        />
      </label>
      <label className="block">
        Adapter
        <input className={input} value={adapter.name} readOnly />
      </label>
      {adapter.description ? (
        <p className="text-xs text-ink-secondary">{adapter.description}</p>
      ) : null}
      {adapter.configSchema.map((f) => {
        const id = `usage-field-${f.key}`,
          help = f.description ? `${id}-help` : undefined
        return (
          <div key={f.key}>
            <label className="block" htmlFor={id}>
              {f.label}
            </label>
            {f.type === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                aria-describedby={help}
                checked={c.config[f.key] === true}
                onChange={(e) => config(f.key, e.target.checked)}
              />
            ) : f.type === 'choice' ? (
              <select
                id={id}
                aria-describedby={help}
                value={String(c.config[f.key] ?? '')}
                onChange={(e) => config(f.key, e.target.value)}
              >
                <option value="">Choose</option>
                {f.choices?.map((choice) => (
                  <option key={choice}>{choice}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={f.type === 'secret' ? 'password' : 'text'}
                aria-describedby={help}
                autoComplete="off"
                className={input}
                placeholder={
                  initial.secretKeys?.includes(f.key) ? 'Secret stored; leave blank to keep' : ''
                }
                value={String(c.config[f.key] ?? '')}
                onChange={(e) =>
                  config(f.key, e.target.value || f.type !== 'secret' ? e.target.value : undefined)
                }
              />
            )}
            {f.description ? (
              <p id={help} className="text-xs text-ink-muted">
                {f.description}
              </p>
            ) : null}
            {f.type === 'file' ? (
              <button
                type="button"
                onClick={() =>
                  void action(async () => {
                    const path = await app.usage.pickFile(false)
                    if (path) config(f.key, path)
                  })
                }
              >
                Choose JSON file
              </button>
            ) : null}
            {f.type === 'secret' ? (
              <button type="button" onClick={() => config(f.key, '')}>
                Clear stored {f.label}
              </button>
            ) : null}
          </div>
        )
      })}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={(e) => setC({ ...c, enabled: e.target.checked })}
        />
        Enabled
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !switchOn}
          aria-describedby={switchOn ? undefined : 'usage-test-off'}
          onClick={() =>
            void action(async () => {
              await app.usage.test(c)
              setNotice(`Test succeeded: ${c.label || adapter.name}`)
            })
          }
        >
          Test
        </button>
        {switchOn ? null : (
          <span id="usage-test-off" className="text-xs text-ink-muted">
            Turn on Show usage quota to test sources.
          </span>
        )}
        <button
          type="submit"
          disabled={busy || !c.label.trim()}
          className="rounded border border-edge bg-highlight px-3 py-1"
        >
          {busy ? 'Working...' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </form>
  )
}
