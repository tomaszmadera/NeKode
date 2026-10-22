import { useEffect, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { formatErrorMessage } from '../../../../shared/ipc-error'
import type {
  UsageAdapter,
  UsageConnection,
  UsageFileSubscription,
} from '../../../../shared/usage-contract'

const FILE_ADAPTER_ID = 'usage-file'
const CLAUDE_ADAPTER_ID = 'claude-code-snapshots'
const input = 'mt-1 w-full rounded border border-edge bg-app p-2'

/** One account of one service (usage-quota spec rules 23-25). */
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
  const [subscriptions, setSubscriptions] = useState<UsageFileSubscription[] | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const isFile = adapter?.id === FILE_ADAPTER_ID,
    isClaude = adapter?.id === CLAUDE_ADAPTER_ID

  // Spec rule 24: a new Claude account starts with NeKode's proposed directory.
  useEffect(() => {
    if (!isNew || !isClaude || initial.config.directory) return
    let alive = true
    app.usage
      .claudeSetup(initial.id, null)
      .then((setup) => {
        if (alive) setC((x) => ({ ...x, config: { ...x.config, directory: setup.directory } }))
      })
      .catch((e) => {
        if (alive) setError(formatErrorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [app, isNew, isClaude, initial])

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
  /** Spec rule 25: read the file's subscriptions; one is chosen automatically. */
  async function inspect(path: string): Promise<void> {
    setSubscriptions(null)
    config('subscriptionId', undefined)
    const found = await app.usage.inspectFile(path)
    setSubscriptions(found)
    if (found.length === 0) throw new Error('The JSON file contains no subscriptions.')
    if (found.length === 1) choose(found[0])
  }
  function choose(sub: UsageFileSubscription): void {
    setC((x) => ({
      ...x,
      label: x.label.trim() ? x.label : sub.label,
      providerId: sub.providerId,
      config: { ...x.config, subscriptionId: sub.id },
    }))
  }

  if (!adapter)
    return (
      <div className="space-y-2 rounded border border-edge p-3">
        <p role="alert" className="text-error">
          The service of this account ({initial.adapterId}) is unavailable. Remove the account or
          restore its adapter.
        </p>
        <button type="button" onClick={onCancel}>
          Back
        </button>
      </div>
    )
  // A file account needs a chosen subscription, except a saved one whose file is unchanged.
  const fileReady =
    !isFile ||
    !!c.config.subscriptionId ||
    (!isNew && c.config.path === initial.config.path && !subscriptions)
  const fields = adapter.configSchema.filter((f) => !(isFile && f.key === 'subscriptionId'))
  return (
    <form
      className="space-y-3 rounded border border-edge p-3"
      aria-label={`${isNew ? 'New' : 'Edit'} ${adapter.name} account`}
      onSubmit={(e) => {
        e.preventDefault()
        void action(() => onSave(c))
      }}
    >
      <h3 className="font-semibold">
        {isNew ? `New ${adapter.name} account` : `Edit ${c.label || adapter.name}`}
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
      {adapter.description ? (
        <p className="text-xs text-ink-secondary">{adapter.description}</p>
      ) : null}
      {fields.map((f) => {
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
                onBlur={(e) => {
                  if (
                    isFile &&
                    f.type === 'file' &&
                    e.target.value &&
                    e.target.value !== initial.config.path
                  )
                    void action(() => inspect(e.target.value))
                }}
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
                    if (!path) return
                    config(f.key, path)
                    await inspect(path)
                  })
                }
              >
                Choose JSON file
              </button>
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
                    if (path) config(f.key, path)
                  })
                }
              >
                Choose directory
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
      {isFile && subscriptions && subscriptions.length > 1 ? (
        <label className="block">
          Subscription
          <select
            aria-label="Subscription"
            className="ml-2 rounded border border-edge bg-app p-1"
            value={String(c.config.subscriptionId ?? '')}
            onChange={(e) => {
              const sub = subscriptions.find((x) => x.id === e.target.value)
              if (sub) choose(sub)
            }}
          >
            <option value="">Choose</option>
            {subscriptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} ({x.id})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {isFile && subscriptions?.length === 1 ? (
        <p className="text-xs text-ink-muted">
          Reads the subscription {subscriptions[0].label} ({subscriptions[0].id}).
        </p>
      ) : null}
      {isClaude ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            Use one directory per Claude account. Record each account once on this computer: if
            another tool already records Claude usage, choose its directory instead of installing
            the NeKode writer. Otherwise run the setup command in PowerShell; it previews the change
            and applies it only when you repeat it with --apply.
          </p>
          <button
            type="button"
            disabled={typeof c.config.directory !== 'string' || !c.config.directory}
            onClick={() =>
              void action(async () => {
                const setup = await app.usage.claudeSetup(c.id, c.config.directory as string)
                setCommand(setup.command)
                await navigator.clipboard.writeText(setup.command)
                setNotice('Setup command copied.')
              })
            }
          >
            Copy setup command
          </button>
          {command ? <code className="block break-all text-xs">{command}</code> : null}
        </div>
      ) : null}
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
            Turn on Show usage quota to test accounts.
          </span>
        )}
        <button
          type="submit"
          disabled={busy || !c.label.trim() || !fileReady}
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
