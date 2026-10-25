import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  AppApi,
  TaskProgressAdapterInfo,
  TaskProgressConfigField,
  TaskProgressSnapshot,
  TaskProgressTestResult,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  monoClass,
  PageIntro,
  primaryClass,
  RequiredMark,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  secondaryClass,
} from './settings-ui'

// Task progress tab of Project Settings (spec task-progress-adapters Behaviour
// 7-10). The adapter list is a fresh scan of the one fixed adapters directory
// on every mount; there is no directory choice. `Test` runs the adapter with
// the values in the form, unsaved; `Save` persists the adapter id and values;
// `None` removes the binding while main keeps the stored values; `Copy from
// project` fills the form from another project's binding without saving.
// The last-read state (Behaviour 11) follows `taskProgress:changed` events.

interface TaskProgressSettingsProps {
  app: AppApi
  projectId: string | null
}

interface CopySource {
  projectId: string
  name: string
  adapterId: string
  config: Record<string, string>
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: TaskProgressTestResult }
  /** The channel itself rejected (for example an unknown project). */
  | { kind: 'failed'; message: string }

/** Form values for a schema: stored value, then manifest default, then a type fallback. */
function initialValues(
  stored: Record<string, string>,
  schema: TaskProgressConfigField[],
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const field of schema) {
    const value = stored[field.key]
    if (field.type === 'boolean') {
      next[field.key] =
        value === 'true' || value === 'false' ? value : field.default === true ? 'true' : 'false'
    } else if (field.type === 'select') {
      const options = field.options ?? []
      const candidate = value ?? (typeof field.default === 'string' ? field.default : '')
      next[field.key] = options.includes(candidate) ? candidate : (options[0] ?? '')
    } else {
      next[field.key] = value ?? (typeof field.default === 'string' ? field.default : '')
    }
  }
  return next
}

/** Values limited to the selected schema, the exact payload Test and Save send. */
function schemaValues(
  schema: TaskProgressConfigField[],
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(schema.map((field) => [field.key, values[field.key] ?? '']))
}

function errorMessage(cause: unknown, fallback: string): string {
  return parseAppErrorPayload(cause)?.message ?? fallback
}

export function TaskProgressSettings({
  app,
  projectId,
}: TaskProgressSettingsProps): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adapters, setAdapters] = useState<TaskProgressAdapterInfo[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [adapterId, setAdapterId] = useState<string | null>(null)
  // Values main holds for this project; None keeps them (Behaviour 7).
  const [storedConfig, setStoredConfig] = useState<Record<string, string>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })
  const [copySources, setCopySources] = useState<CopySource[] | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null)
  const [readState, setReadState] = useState<TaskProgressSnapshot | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  // Each Test run takes a token; a result whose token is no longer current
  // (selection, values, or project changed meanwhile) is ignored.
  const testRequest = useRef(0)
  const guard = useMutationGuard()

  useEffect(() => {
    testRequest.current += 1
    setTestState({ kind: 'idle' })
    setReadState(null)
    setReadError(null)
    if (projectId === null) return
    let alive = true
    // An event that arrives first is newer than the pending get result.
    let receivedEvent = false
    const unsubscribe = app.taskProgress.onChanged((event) => {
      if (!alive || event.projectId !== projectId) return
      receivedEvent = true
      setReadError(null)
      setReadState('cleared' in event ? null : event)
    })
    app.taskProgress
      .get(projectId)
      .then((snapshot) => {
        if (alive && !receivedEvent) setReadState(snapshot)
      })
      .catch((cause: unknown) => {
        if (alive && !receivedEvent) {
          setReadError(errorMessage(cause, 'Failed to load the last read state.'))
        }
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [app, projectId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    Promise.all([
      app.taskProgress.adaptersList(),
      projectId === null ? Promise.resolve(null) : app.taskProgress.getBinding(projectId),
    ])
      .then(([list, binding]) => {
        if (!alive) return
        setAdapters(list.adapters)
        setWarnings(list.warnings)
        setAdapterId(binding?.adapterId ?? null)
        setStoredConfig(binding?.config ?? {})
        const schema =
          list.adapters.find((adapter) => adapter.id === binding?.adapterId)?.configSchema ?? []
        setValues(initialValues(binding?.config ?? {}, schema))
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setLoadError(errorMessage(cause, 'Failed to load the task progress settings.'))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [app, projectId])

  const selected = adapters.find((adapter) => adapter.id === adapterId) ?? null
  const schema = selected?.configSchema ?? []
  const missing = adapterId !== null && selected === null

  function resetFeedback(): void {
    setFormError(null)
    setSaved(false)
    testRequest.current += 1
    setTestState({ kind: 'idle' })
    setCopiedFrom(null)
  }

  function selectAdapter(nextId: string, stored: Record<string, string>): void {
    const next = nextId === '' ? null : nextId
    setAdapterId(next)
    resetFeedback()
    const nextSchema = adapters.find((adapter) => adapter.id === next)?.configSchema ?? []
    setValues(initialValues(stored, nextSchema))
  }

  function updateValue(key: string, value: string): void {
    setValues((previous) => ({ ...previous, [key]: value }))
    setSaved(false)
    setFormError(null)
    if (testState.kind === 'running') {
      // The running Test checks the old values; its result no longer applies.
      testRequest.current += 1
      setTestState({ kind: 'idle' })
    }
  }

  async function save(): Promise<void> {
    if (projectId === null) return
    await guard.run(async () => {
      resetFeedback()
      const payload = adapterId === null ? {} : schemaValues(schema, values)
      try {
        await app.taskProgress.saveBinding(projectId, adapterId, payload)
      } catch (cause) {
        setFormError(errorMessage(cause, 'Failed to save the task progress settings.'))
        return
      }
      if (adapterId !== null) {
        setStoredConfig(payload)
      }
      setSaved(true)
    })
  }

  async function runTest(): Promise<void> {
    if (projectId === null || adapterId === null || missing || testState.kind === 'running') return
    testRequest.current += 1
    const token = testRequest.current
    setTestState({ kind: 'running' })
    try {
      const result = await app.taskProgress.test(projectId, adapterId, schemaValues(schema, values))
      if (token !== testRequest.current) return
      setTestState({ kind: 'done', result })
    } catch (cause) {
      if (token !== testRequest.current) return
      setTestState({
        kind: 'failed',
        message: errorMessage(cause, 'The task progress test failed.'),
      })
    }
  }

  async function loadCopySources(): Promise<void> {
    setCopyError(null)
    try {
      const projects = await app.projects.list()
      const others = projects.filter((project) => project.id !== projectId)
      const bindings = await Promise.all(
        others.map((project) => app.taskProgress.getBinding(project.id)),
      )
      const sources: CopySource[] = []
      others.forEach((project, index) => {
        const binding = bindings[index]
        if (binding?.adapterId) {
          sources.push({
            projectId: project.id,
            name: project.name,
            adapterId: binding.adapterId,
            config: binding.config,
          })
        }
      })
      setCopySources(sources)
    } catch (cause) {
      setCopySources(null)
      setCopyError(errorMessage(cause, 'Failed to load the other projects.'))
    }
  }

  function copyFrom(source: CopySource): void {
    // One-time copy into the form; Save persists it (Behaviour 9).
    selectAdapter(source.adapterId, source.config)
    setCopiedFrom(source.name)
    setCopySources(null)
  }

  function fieldLabel(field: TaskProgressConfigField): React.JSX.Element {
    return (
      <>
        <span>{field.label}</span>
        {field.required ? <RequiredMark /> : null}
      </>
    )
  }

  function renderField(field: TaskProgressConfigField): React.JSX.Element {
    const value = values[field.key] ?? ''
    const testId = testIdFor.taskProgressField(field.key)
    if (field.type === 'boolean') {
      return (
        <label
          key={field.key}
          className="flex items-center gap-2 border-t border-edge px-4 py-3 text-[13px] font-medium text-ink"
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value === 'true'}
            data-testid={testId}
            onChange={(event) => updateValue(field.key, event.target.checked ? 'true' : 'false')}
          />
          <span>{field.label}</span>
          {field.required ? <RequiredMark /> : null}
        </label>
      )
    }
    return (
      <FieldRow key={field.key} label={fieldLabel(field)} htmlFor={testId} divided>
        {field.type === 'select' ? (
          <SettingsSelect
            id={testId}
            value={value}
            testId={testId}
            required={field.required}
            onChange={(next) => updateValue(field.key, next)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SettingsSelect>
        ) : (
          <input
            id={testId}
            type="text"
            className={monoClass}
            value={value}
            spellCheck={false}
            data-testid={testId}
            required={field.required}
            onChange={(event) => updateValue(field.key, event.target.value)}
          />
        )}
      </FieldRow>
    )
  }

  function renderTestResult(): React.JSX.Element | null {
    if (testState.kind === 'idle') return null
    if (testState.kind === 'running') {
      return (
        <p
          className="mt-2 text-ink-secondary"
          role="status"
          data-testid={TEST_ID.settingsTaskProgressTestResult}
        >
          Testing...
        </p>
      )
    }
    if (testState.kind === 'failed') {
      return (
        <p
          className="mt-2 text-error"
          role="alert"
          data-testid={TEST_ID.settingsTaskProgressTestResult}
        >
          {testState.message}
        </p>
      )
    }
    const { result } = testState
    return result.ok ? (
      <p
        className="mt-2 text-success"
        role="status"
        data-testid={TEST_ID.settingsTaskProgressTestResult}
      >
        {result.summary}
      </p>
    ) : (
      <p
        className="mt-2 text-error"
        role="alert"
        data-testid={TEST_ID.settingsTaskProgressTestResult}
      >
        {result.error.code}: {result.error.message}
      </p>
    )
  }

  function renderReadState(): React.JSX.Element {
    let body: React.JSX.Element
    if (readError !== null) {
      body = (
        <p role="alert" className="text-error">
          {readError}
        </p>
      )
    } else if (readState === null) {
      body = (
        <p className="text-ink-muted">
          Not read. Progress is read while the project has a saved adapter and is selected or
          expanded in the navigation.
        </p>
      )
    } else {
      const invalid = readState.tasks.filter((task) => task.recordState !== 'valid')
      body = (
        <>
          <p>
            {readState.receivedAt === null ? (
              'No valid snapshot yet.'
            ) : (
              <>
                Last valid snapshot:{' '}
                <time dateTime={readState.receivedAt}>
                  {new Date(readState.receivedAt).toLocaleString()}
                </time>
                {' · '}
                {readState.tasks.length} {readState.tasks.length === 1 ? 'task' : 'tasks'}
              </>
            )}
          </p>
          {readState.error !== undefined ? (
            <p role="alert" className="text-error">
              {readState.status === 'stale' ? 'Out of date:' : 'Retrying:'} {readState.error.code}:{' '}
              {readState.error.message}
            </p>
          ) : null}
          {invalid.length > 0 ? (
            <ul className="list-disc pl-4 text-warning">
              {invalid.map((task) => (
                <li key={task.id}>
                  {task.id} ({task.recordState})
                  {task.errors.length > 0 ? `: ${task.errors.join('; ')}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )
    }
    return (
      <section
        className="flex flex-col gap-2.5"
        aria-label="Last read"
        data-testid={TEST_ID.settingsTaskProgressReadState}
      >
        <SectionLabel title="Last read" />
        <GroupBox>
          <div className="flex items-start gap-2.5 px-4 py-3 text-[13px] text-ink-secondary">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-edge" />
            <div className="flex min-w-0 flex-col gap-1">{body}</div>
          </div>
        </GroupBox>
      </section>
    )
  }

  return (
    <div
      data-testid={TEST_ID.settingsTaskProgressPanel}
      className="flex max-w-[660px] flex-col gap-7"
    >
      <PageIntro
        title="Task progress"
        description="Phase and step progress shown on agent sessions."
      />
      {loading ? (
        <p
          className="text-[13px] text-ink-secondary"
          role="status"
          data-testid={TEST_ID.settingsTaskProgressLoading}
        >
          Loading adapters...
        </p>
      ) : loadError !== null ? (
        <p role="alert" className="text-[13px] text-error">
          {loadError}
        </p>
      ) : projectId === null ? (
        <p className="text-[13px] text-ink-secondary">
          Select a project to bind a task progress adapter.
        </p>
      ) : (
        <>
          <SettingsGroup label="Progress adapter">
            <SectionLabel title="Adapter" />
            <GroupBox>
              <FieldRow
                label="Progress adapter"
                htmlFor="settings-task-progress-adapter"
                description="Reads progress from the agent harness."
              >
                <SettingsSelect
                  id="settings-task-progress-adapter"
                  value={adapterId ?? ''}
                  testId={TEST_ID.settingsTaskProgressAdapterSelect}
                  onChange={(next) => selectAdapter(next, storedConfig)}
                >
                  <option value="">None</option>
                  {adapters.map((adapter) => (
                    <option key={adapter.id} value={adapter.id}>
                      {adapter.name} · {adapter.id}
                    </option>
                  ))}
                  {missing ? (
                    <option value={adapterId as string}>{adapterId} (missing)</option>
                  ) : null}
                </SettingsSelect>
              </FieldRow>
              {adapters.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-1.5 border-t border-edge px-6 py-6 text-center"
                  data-testid={TEST_ID.settingsTaskProgressEmpty}
                >
                  <Icon.package size={22} aria-hidden className="text-ink-muted" />
                  <span className="text-[13px] text-ink-secondary">
                    No progress adapters installed
                  </span>
                  <p className="max-w-[460px] text-xs leading-normal text-ink-muted">
                    No task progress adapters are installed. Copy an adapter folder with its{' '}
                    <code className="font-mono text-ink-secondary">adapter.json</code> into the{' '}
                    <code className="font-mono text-ink-secondary">task-progress-adapters</code>{' '}
                    folder of the NeKode application data directory, then reopen this tab. The
                    protocol and install commands are described in{' '}
                    <code className="font-mono text-ink-secondary">
                      adapters/task-progress-example/README.md
                    </code>
                    .
                  </p>
                </div>
              ) : null}
              {warnings.length > 0 ? (
                <div
                  className="border-t border-edge px-4 py-3 text-xs text-warning"
                  data-testid={TEST_ID.settingsTaskProgressWarnings}
                >
                  <p>Skipped adapter folders:</p>
                  <ul className="list-disc pl-4">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {missing ? (
                <p
                  className="border-t border-edge px-4 py-3 text-xs text-error"
                  data-testid={TEST_ID.settingsTaskProgressAdapterMissing}
                >
                  The selected adapter "{adapterId}" is not installed. Install it again, or choose
                  another adapter or None.
                </p>
              ) : null}
              {schema.map((field) => renderField(field))}
              {copiedFrom !== null ? (
                <p
                  className="border-t border-edge px-4 py-2 text-xs text-ink-secondary"
                  role="status"
                  data-testid={TEST_ID.settingsTaskProgressCopyNotice}
                >
                  Copied from {copiedFrom}. Save to apply it to this project.
                </p>
              ) : null}
              {formError !== null ? (
                <p
                  role="alert"
                  className="border-t border-edge px-4 py-2 text-xs text-error"
                  data-testid={TEST_ID.settingsTaskProgressFormError}
                >
                  {formError}
                </p>
              ) : null}
              <GroupFooter
                status={
                  <button
                    type="button"
                    className={secondaryClass}
                    data-testid={TEST_ID.settingsTaskProgressCopy}
                    onClick={() => {
                      void loadCopySources()
                    }}
                  >
                    Copy from project
                  </button>
                }
              >
                <button
                  type="button"
                  disabled={adapterId === null || missing || testState.kind === 'running'}
                  className={secondaryClass}
                  data-testid={TEST_ID.settingsTaskProgressTest}
                  onClick={() => {
                    void runTest()
                  }}
                >
                  Test
                </button>
                <button
                  type="button"
                  disabled={guard.busy}
                  className={primaryClass}
                  data-testid={TEST_ID.settingsTaskProgressSave}
                  onClick={() => {
                    void save()
                  }}
                >
                  Save
                </button>
              </GroupFooter>
            </GroupBox>
          </SettingsGroup>
          {saved ? (
            <p className="text-xs text-success" data-testid={TEST_ID.settingsTaskProgressSaved}>
              Saved
            </p>
          ) : null}
          {copyError !== null ? (
            <p role="alert" className="text-xs text-error">
              {copyError}
            </p>
          ) : null}
          {copySources !== null ? (
            <div data-testid={TEST_ID.settingsTaskProgressCopyList}>
              {copySources.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  No other project has a task progress adapter.
                </p>
              ) : (
                <ul className="grid gap-1">
                  {copySources.map((source) => (
                    <li key={source.projectId}>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-left text-[13px] text-ink hover:bg-highlight"
                        data-testid={testIdFor.taskProgressCopySource(source.projectId)}
                        onClick={() => copyFrom(source)}
                      >
                        {source.name} · {source.adapterId}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {renderTestResult()}
          {renderReadState()}
        </>
      )}
    </div>
  )
}
