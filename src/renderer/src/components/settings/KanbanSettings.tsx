import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AppApi,
  KanbanAdapterInfo,
  KanbanConfigField,
  KanbanProjectConfig,
} from '../../../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Kanban tab of the Project Settings modal (spec kanban-adapter-interface
// Behaviour 7–8, 12–13). The adapter select lists the fresh discovery scan;
// selecting one renders its manifest `configSchema` as a form. Secret fields
// are write-only: `kanban:getConfig` returns null for them plus `secretKeys`,
// so the form shows "stored" and never renders a stored value. Save forwards
// { adapterId, values } through the Stage 1 channel only; an empty secret is
// omitted (keep the stored secret) while an empty non-secret is sent as ''
// (main clears it). Test connection invokes the adapter with the currently
// entered values, unsaved, and renders its result inline — never a toast.

interface KanbanSettingsProps {
  app: AppApi
  projectId: string | null
}

type TestState = 'idle' | 'running' | 'success' | 'error'

/** Effective stored values as returned by getConfig (non-secret) or null. */
type StoredValues = Record<string, string | null>

/**
 * Initial form values for a schema: stored non-secret values win, then the
 * manifest default, then an empty/select-first fallback. Secret fields always
 * start empty — a stored secret is never echoed into the DOM.
 */
function initialValues(stored: StoredValues, schema: KanbanConfigField[]): Record<string, string> {
  const next: Record<string, string> = {}
  for (const field of schema) {
    if (field.type === 'secret') {
      next[field.key] = ''
      continue
    }
    const value = stored[field.key] ?? null
    if (field.type === 'boolean') {
      if (value !== null) {
        next[field.key] = value === 'true' ? 'true' : 'false'
      } else {
        next[field.key] = field.default === true ? 'true' : 'false'
      }
      continue
    }
    if (field.type === 'select') {
      const options = field.options ?? []
      const fallback = typeof field.default === 'string' ? field.default : ''
      const candidate = value ?? fallback
      next[field.key] =
        candidate.length > 0 && options.includes(candidate) ? candidate : (options[0] ?? '')
      continue
    }
    next[field.key] = value ?? (typeof field.default === 'string' ? field.default : '')
  }
  return next
}

/**
 * Values payload for kanban:setConfig / kanban:test. An empty secret is
 * omitted (main keeps the stored secret); every non-secret is sent verbatim,
 * so an empty one clears the stored value (spec Behaviour 7, AC5).
 */
function valuesPayload(
  schema: KanbanConfigField[],
  values: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const field of schema) {
    const value = values[field.key] ?? ''
    if (field.type === 'secret') {
      if (value !== '') payload[field.key] = value
      continue
    }
    payload[field.key] = value
  }
  return payload
}

/** Required-field check mirroring main's save validation (Spec Errors). */
function requiredError(
  schema: KanbanConfigField[],
  values: Record<string, string>,
  secretKeys: ReadonlySet<string>,
): string | null {
  for (const field of schema) {
    if (!field.required) continue
    const value = (values[field.key] ?? '').trim()
    if (field.type === 'secret') {
      if (value === '' && !secretKeys.has(field.key)) {
        return `Field "${field.label}" is required.`
      }
      continue
    }
    if (value === '') {
      return `Field "${field.label}" is required.`
    }
  }
  return null
}

export function KanbanSettings({ app, projectId }: KanbanSettingsProps): React.JSX.Element {
  const [adapters, setAdapters] = useState<KanbanAdapterInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adaptersDir, setAdaptersDir] = useState('')
  const [adapterId, setAdapterId] = useState<string | null>(null)
  // The binding id last confirmed by getConfig / a successful save. Test
  // connection runs against the STORED binding in main (`kanban:test` resolves
  // the persisted adapter), so it may only run when the displayed adapter is
  // this one — otherwise it would test the previously bound adapter with the
  // new values or reject with "No Kanban adapter is configured" (Behaviour 8).
  const [persistedAdapterId, setPersistedAdapterId] = useState<string | null>(null)
  const [storedValues, setStoredValues] = useState<StoredValues>({})
  const [secretKeys, setSecretKeys] = useState<ReadonlySet<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [savedState, setSavedState] = useState<'idle' | 'saved'>('idle')
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)

  // One scan + config load on tab entry. The component mounts fresh each time
  // the tab is selected, so a plain mount effect is the entry hook (AC1: a
  // newly dropped adapter appears without restart).
  const fetchState = useCallback(async () => {
    const [list, dir] = await Promise.all([
      app.kanban.adaptersList(),
      app.state.get(APP_STATE_KEY.kanbanAdaptersDir),
    ])
    const config = projectId === null ? null : await app.kanban.getConfig(projectId)
    return { list, dir: dir ?? '', config }
  }, [app, projectId])

  const applyState = useCallback(
    (state: {
      list: KanbanAdapterInfo[]
      dir: string
      config: KanbanProjectConfig | null
    }): void => {
      const schema =
        state.config === null
          ? []
          : (state.list.find((adapter) => adapter.id === state.config?.adapterId)?.configSchema ??
            [])
      setAdapters(state.list)
      setAdaptersDir(state.dir)
      setAdapterId(state.config?.adapterId ?? null)
      setPersistedAdapterId(state.config?.adapterId ?? null)
      setStoredValues(state.config?.values ?? {})
      const keys = new Set(state.config?.secretKeys ?? [])
      setSecretKeys(keys)
      setValues(state.config === null ? {} : initialValues(state.config.values, schema))
      setSavedState('idle')
      setFormError(null)
      setTestState('idle')
      setTestMessage(null)
    },
    [],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchState()
      .then((state) => {
        if (alive) {
          applyState(state)
          setLoading(false)
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setLoading(false)
          setLoadError(
            parseAppErrorPayload(cause)?.message ?? 'Failed to load the Kanban settings.',
          )
        }
      })
    return () => {
      alive = false
    }
  }, [fetchState, applyState])

  const selectedAdapter =
    adapterId === null ? null : (adapters.find((adapter) => adapter.id === adapterId) ?? null)
  const schema = selectedAdapter?.configSchema ?? []
  // A stored binding whose adapter is gone from the directory is marked
  // "(missing)" and stays clearable/re-bindable (spec Edge cases).
  const missing = adapterId !== null && selectedAdapter === null
  // Test connection is only valid once the displayed adapter equals the
  // persisted binding: `kanban:test` resolves the STORED binding in main, so a
  // freshly selected or changed adapter is not yet testable (Behaviour 8). The
  // binding is made testable by the Save button — never by an implicit persist.
  const bindingSaved = adapterId !== null && adapterId === persistedAdapterId

  function selectAdapter(nextId: string): void {
    const next = nextId === '' ? null : nextId
    setAdapterId(next)
    setSavedState('idle')
    setFormError(null)
    setTestState('idle')
    setTestMessage(null)
    const nextSchema =
      next === null ? [] : (adapters.find((adapter) => adapter.id === next)?.configSchema ?? [])
    setValues(initialValues(storedValues, nextSchema))
  }

  function updateValue(key: string, value: string): void {
    setValues((previous) => ({ ...previous, [key]: value }))
    setSavedState('idle')
    setFormError(null)
  }

  async function save(): Promise<void> {
    if (projectId === null) return
    setFormError(null)
    setSavedState('idle')
    if (adapterId === null) {
      // Deselecting clears the binding; stored field values stay (Behaviour 7).
      try {
        await app.kanban.setConfig(projectId, { adapterId: null, values: {} })
        setPersistedAdapterId(null)
        setSavedState('saved')
      } catch (cause) {
        setFormError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the Kanban settings.')
      }
      return
    }
    const invalid = requiredError(schema, values, secretKeys)
    if (invalid !== null) {
      setFormError(invalid)
      return
    }
    try {
      await app.kanban.setConfig(projectId, {
        adapterId,
        values: valuesPayload(schema, values),
      })
    } catch (cause) {
      // A failed setConfig leaves the binding unsaved (Test stays gated).
      setFormError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the Kanban settings.')
      return
    }
    // setConfig resolved, so main holds this binding: mark it persisted/testable
    // now, independently of the reload below, which may fail without
    // un-persisting anything (Behaviour 7–8 gating).
    setPersistedAdapterId(adapterId)
    setSavedState('saved')
    try {
      // Refresh the stored-secret view: a typed secret now reads "stored" and
      // its plaintext is dropped from the form (never re-rendered).
      const state = await fetchState()
      applyState(state)
      setSavedState('saved')
    } catch (cause) {
      // The binding is persisted; only the refresh failed. Surface it inline
      // without reverting the saved/persisted state.
      setFormError(parseAppErrorPayload(cause)?.message ?? 'Failed to reload the Kanban settings.')
    }
  }

  async function runTest(): Promise<void> {
    // Guard the exact rule the button state expresses: never test against an
    // unsaved binding (the displayed adapter must equal the persisted one) and
    // never start a second run while one is already in flight.
    if (projectId === null || !bindingSaved || testState === 'running') return
    setTestState('running')
    setTestMessage(null)
    try {
      await app.kanban.test(projectId, valuesPayload(schema, values))
      setTestState('success')
    } catch (cause) {
      setTestState('error')
      setTestMessage(parseAppErrorPayload(cause)?.message ?? 'The adapter connection test failed.')
    }
  }

  async function browseDir(): Promise<void> {
    setLoadError(null)
    const current = adaptersDir.trim()
    try {
      const picked = await app.dialogs.pickDirectory(current.length > 0 ? current : null)
      if (picked === null) return
      await app.state.set(APP_STATE_KEY.kanbanAdaptersDir, picked)
      // Persist-then-rescan (Behaviour 12 / AC13): the list reflects the new
      // directory immediately, with no restart.
      const list = await app.kanban.adaptersList()
      if (projectId === null) {
        setAdapters(list)
        setAdaptersDir(picked)
        return
      }
      const config = await app.kanban.getConfig(projectId)
      applyState({ list, dir: picked, config })
    } catch (cause) {
      setLoadError(
        parseAppErrorPayload(cause)?.message ?? 'Failed to change the adapters directory.',
      )
    }
  }

  function renderField(field: KanbanConfigField): React.JSX.Element {
    const value = values[field.key] ?? ''
    const testId = testIdFor.kanbanField(field.key)
    if (field.type === 'boolean') {
      return (
        <label key={field.key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === 'true'}
            data-testid={testId}
            onChange={(event) => updateValue(field.key, event.target.checked ? 'true' : 'false')}
          />
          {field.label}
        </label>
      )
    }
    return (
      <label key={field.key} className="block" htmlFor={testId}>
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
        {field.type === 'select' ? (
          <select
            id={testId}
            className="mt-1 block w-full rounded-sm bg-highlight p-1"
            value={value}
            data-testid={testId}
            onChange={(event) => updateValue(field.key, event.target.value)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <input
              id={testId}
              type={field.type === 'secret' ? 'password' : 'text'}
              className="min-w-0 flex-1 rounded-sm bg-highlight p-1"
              value={value}
              placeholder={field.type === 'secret' && secretKeys.has(field.key) ? '••••••' : ''}
              data-testid={testId}
              onChange={(event) => updateValue(field.key, event.target.value)}
            />
            {field.type === 'secret' && secretKeys.has(field.key) ? (
              <span
                className="shrink-0 text-success"
                data-testid={testIdFor.kanbanSecretStored(field.key)}
              >
                stored
              </span>
            ) : null}
          </div>
        )}
      </label>
    )
  }

  return (
    <div data-testid={TEST_ID.settingsKanbanPanel} className="text-xs">
      {loading ? (
        <p
          className="mt-4 text-ink-secondary"
          data-testid={TEST_ID.settingsKanbanLoading}
          role="status"
        >
          Loading adapters…
        </p>
      ) : (
        <>
          {loadError ? (
            <p role="alert" className="mt-4 text-error">
              {loadError}
            </p>
          ) : null}
          {projectId === null ? (
            <p className="mt-4 text-ink-secondary">Select a project to bind a Kanban adapter.</p>
          ) : (
            <>
              <label className="mt-4 block" htmlFor="settings-kanban-adapter">
                Adapter
                <select
                  id="settings-kanban-adapter"
                  className="mt-1 block w-full rounded-sm bg-highlight p-1"
                  value={adapterId ?? ''}
                  data-testid={TEST_ID.settingsKanbanAdapterSelect}
                  onChange={(event) => selectAdapter(event.target.value)}
                >
                  <option value="">(none)</option>
                  {adapters.map((adapter) => (
                    <option key={adapter.id} value={adapter.id}>
                      {adapter.name} · {adapter.id}
                    </option>
                  ))}
                  {missing ? (
                    <option value={adapterId as string}>{adapterId} (missing)</option>
                  ) : null}
                </select>
              </label>
              {adapters.length === 0 ? (
                <p className="mt-2 text-ink-muted" data-testid={TEST_ID.settingsKanbanEmpty}>
                  No adapters found in the adapters directory. Add an adapter folder containing an
                  adapter.json, then reopen this tab.
                </p>
              ) : null}
              {missing ? (
                <p className="mt-2 text-error" data-testid={TEST_ID.settingsKanbanAdapterMissing}>
                  The selected adapter “{adapterId}” is not installed in the adapters directory.
                  Requests through it will fail until it is restored; you can clear or re-bind here.
                </p>
              ) : null}
              {schema.length > 0 ? (
                <div className="mt-3 grid gap-2">{schema.map((field) => renderField(field))}</div>
              ) : null}
              {formError ? (
                <p role="alert" className="mt-2 text-error">
                  {formError}
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
                  data-testid={TEST_ID.settingsKanbanSave}
                  onClick={() => {
                    void save()
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="h-control rounded-md px-4 text-ink-secondary hover:bg-highlight hover:text-ink disabled:opacity-50"
                  data-testid={TEST_ID.settingsKanbanTest}
                  disabled={!bindingSaved || testState === 'running'}
                  onClick={() => {
                    void runTest()
                  }}
                >
                  Test connection
                </button>
                {savedState === 'saved' ? (
                  <span className="text-success" data-testid={TEST_ID.settingsKanbanSaved}>
                    Saved
                  </span>
                ) : null}
              </div>
              {adapterId !== null && !bindingSaved ? (
                <p className="mt-2 text-ink-secondary" data-testid={TEST_ID.settingsKanbanTestHint}>
                  Save the adapter binding before testing the connection.
                </p>
              ) : null}
              {testState === 'running' ? (
                <span
                  className="mt-2 inline-block text-ink-secondary"
                  data-testid={TEST_ID.settingsKanbanTestResult}
                >
                  Testing…
                </span>
              ) : null}
              {testState === 'success' ? (
                <span
                  className="mt-2 inline-block text-success"
                  data-testid={TEST_ID.settingsKanbanTestResult}
                >
                  Connection succeeded.
                </span>
              ) : null}
              {testState === 'error' && testMessage !== null ? (
                <p
                  role="alert"
                  className="mt-2 text-error"
                  data-testid={TEST_ID.settingsKanbanTestResult}
                >
                  {testMessage}
                </p>
              ) : null}
            </>
          )}
          {/* Adapters directory (Behaviour 12): app-level, shown regardless of
              project. The renderer only knows the stored override; the default
              location is resolved in main, so an unset override shows a label. */}
          <div className="mt-4 border-t border-edge pt-3">
            <p className="text-ink-secondary">
              Adapters directory:{' '}
              <span className="text-ink" data-testid={TEST_ID.settingsKanbanDir}>
                {adaptersDir.trim().length > 0 ? adaptersDir : 'Default (application data folder)'}
              </span>
            </p>
            <button
              type="button"
              className="mt-2 h-control rounded-md bg-button px-3 text-ink hover:bg-button-hover"
              data-testid={TEST_ID.settingsKanbanDirBrowse}
              onClick={() => {
                void browseDir()
              }}
            >
              Browse…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
