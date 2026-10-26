import type {
  AppApi,
  KanbanAdapterInfo,
  KanbanConfigField,
  KanbanProjectConfig,
} from '@shared/ipc-contract'
import {
  AGENT_SKILL_FILE_PATH,
  LOCAL_FILE_ADAPTER_ID,
  LOCAL_TASK_FILE_PATH,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { ConfirmDialog } from '../layout/ConfirmDialog'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  InfoStrip,
  MaskedKeyControl,
  monoClass,
  PageIntro,
  primaryClass,
  RequiredMark,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  secondaryClass,
} from './settings-ui'

// Kanban tab of the Project Settings modal (spec kanban-adapter-interface
// Behaviour 7–8, 12–13). The adapter select lists the fresh discovery scan;
// selecting one renders its manifest `configSchema` as a form. Secret fields
// are write-only: `kanban:getConfig` returns null for them plus `secretKeys`,
// so the form shows "stored" and never renders a stored value. Save forwards
// { adapterId, values } through the Stage 1 channel only; an empty secret is
// omitted (keep the stored secret) while an empty non-secret is sent as ''
// (main clears it). Test connection invokes the adapter with the currently
// entered values, unsaved, and renders its result inline — never a toast.
// The built-in `Local file` source (project-home spec Behaviour 7, 10) is the
// first adapter entry: it has no fields, shows its relative path and Test
// (which parses the file), and while no source is bound the section offers
// `Use a local task list`. While a source is bound, `Teach agents` opens a
// confirm dialog that names the one skill file main writes (project-home spec
// Behaviour 11) and lists the project's selected agent profiles; only the
// project id crosses the bridge, main builds the text.

interface KanbanSettingsProps {
  app: AppApi
  projectId: string | null
  onInvalidate?: (projectId: string | null) => void
}

type TestState = 'idle' | 'running' | 'success' | 'error'

/** Open `Teach agents` dialog: whether the file exists and the selected profile names. */
interface TeachDialogState {
  exists: boolean
  profiles: { id: string; name: string }[]
}

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

export function KanbanSettings({
  app,
  projectId,
  onInvalidate,
}: KanbanSettingsProps): React.JSX.Element {
  const [adapters, setAdapters] = useState<KanbanAdapterInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adapterId, setAdapterId] = useState<string | null>(null)
  // The binding id last confirmed by getConfig / a successful save. Test
  // connection runs against the STORED binding in main (`kanban:test` resolves
  // the persisted adapter), so it may only run when the displayed adapter is
  // this one — otherwise it would test the previously bound adapter with the
  // new values or reject with "No Kanban adapter is configured" (Behaviour 8).
  const [persistedAdapterId, setPersistedAdapterId] = useState<string | null>(null)
  const [storedValues, setStoredValues] = useState<StoredValues>({})
  const [secretKeys, setSecretKeys] = useState<ReadonlySet<string>>(new Set())
  const [sessionOnlySecrets, setSessionOnlySecrets] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [savedState, setSavedState] = useState<'idle' | 'saved'>('idle')
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [teachDialog, setTeachDialog] = useState<TeachDialogState | null>(null)
  const [teachWriting, setTeachWriting] = useState(false)
  const [teachError, setTeachError] = useState<string | null>(null)
  const [teachDone, setTeachDone] = useState(false)
  // A stored secret stays masked until Change. There is no clear: an empty
  // secret is omitted on save and main keeps the stored value.
  const [editingSecrets, setEditingSecrets] = useState<ReadonlySet<string>>(new Set())
  // The opener is disabled while the status loads, so the dialog cannot rely
  // on the element focused at its mount; focus returns here on close.
  const teachButtonRef = useRef<HTMLButtonElement>(null)
  const teachWasOpen = useRef(false)
  const guard = useMutationGuard()

  useEffect(() => {
    if (teachDialog !== null) {
      teachWasOpen.current = true
      return
    }
    if (!teachWasOpen.current) return
    teachWasOpen.current = false
    // Runs after the dialog's unmount cleanup, so this focus wins.
    teachButtonRef.current?.focus()
  }, [teachDialog])

  // One scan + config load on tab entry. The component mounts fresh each time
  // the tab is selected, so a plain mount effect is the entry hook (AC1: a
  // newly dropped adapter appears without restart).
  const fetchState = useCallback(async () => {
    const list = await app.kanban.adaptersList()
    const config = projectId === null ? null : await app.kanban.getConfig(projectId)
    return { list, config }
  }, [app, projectId])

  const applyState = useCallback(
    (state: { list: KanbanAdapterInfo[]; config: KanbanProjectConfig | null }): void => {
      const schema =
        state.config === null
          ? []
          : (state.list.find((adapter) => adapter.id === state.config?.adapterId)?.configSchema ??
            [])
      setAdapters(state.list)
      setAdapterId(state.config?.adapterId ?? null)
      setPersistedAdapterId(state.config?.adapterId ?? null)
      setStoredValues(state.config?.values ?? {})
      const keys = new Set(state.config?.secretKeys ?? [])
      setSecretKeys(keys)
      setSessionOnlySecrets(state.config?.sessionOnlySecrets === true)
      setValues(state.config === null ? {} : initialValues(state.config.values, schema))
      setSavedState('idle')
      setFormError(null)
      setTestState('idle')
      setTestMessage(null)
      setTeachDone(false)
      setEditingSecrets(new Set())
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
            parseAppErrorPayload(cause)?.message ?? 'Failed to load the task source settings.',
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
  const isLocalFile = adapterId === LOCAL_FILE_ADAPTER_ID
  // The built-in entry is always listed; the empty notice is about the
  // adapters directory only.
  const discoveredCount = adapters.filter((adapter) => adapter.id !== LOCAL_FILE_ADAPTER_ID).length

  function selectAdapter(nextId: string): void {
    const next = nextId === '' ? null : nextId
    setAdapterId(next)
    setSavedState('idle')
    setFormError(null)
    setTestState('idle')
    setTestMessage(null)
    setEditingSecrets(new Set())
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
    await guard.run(async () => {
      setFormError(null)
      setSavedState('idle')
      if (adapterId === null) {
        // Deselecting clears the binding; stored field values stay (Behaviour 7).
        try {
          await app.kanban.setConfig(projectId, { adapterId: null, values: {} })
          onInvalidate?.(projectId)
          setPersistedAdapterId(null)
          setSavedState('saved')
        } catch (cause) {
          setFormError(
            parseAppErrorPayload(cause)?.message ?? 'Failed to save the task source settings.',
          )
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
        setFormError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to save the task source settings.',
        )
        return
      }
      // setConfig resolved, so main holds this binding: mark it persisted/testable
      // now, independently of the reload below, which may fail without
      // un-persisting anything (Behaviour 7–8 gating).
      onInvalidate?.(projectId)
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
        setFormError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to reload the task source settings.',
        )
      }
    })
  }

  /**
   * `Use a local task list` (project-home spec Behaviour 7): offered only while
   * no source is bound. Main creates the file when absent and binds it.
   */
  async function startLocalTaskList(): Promise<void> {
    if (projectId === null || persistedAdapterId !== null) return
    await guard.run(async () => {
      setFormError(null)
      setSavedState('idle')
      try {
        await app.kanban.bindLocalFile(projectId)
      } catch (cause) {
        setFormError(
          parseAppErrorPayload(cause)?.message ?? 'Could not create the local task list.',
        )
        return
      }
      onInvalidate?.(projectId)
      setAdapterId(LOCAL_FILE_ADAPTER_ID)
      setPersistedAdapterId(LOCAL_FILE_ADAPTER_ID)
      try {
        applyState(await fetchState())
      } catch (cause) {
        setFormError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to reload the task source settings.',
        )
      }
    })
  }

  /**
   * `Teach agents` (project-home spec Behaviour 11): reads whether the skill
   * file exists and the project's selected profiles, then opens the confirm
   * dialog. Nothing is written until Confirm.
   */
  async function openTeachAgents(): Promise<void> {
    if (projectId === null || persistedAdapterId === null) return
    await guard.run(async () => {
      setFormError(null)
      setTeachDone(false)
      try {
        const [status, document] = await Promise.all([
          app.kanban.skillStatus(projectId),
          app.agentProfiles.get(projectId),
        ])
        setTeachError(null)
        setTeachDialog({
          exists: status.exists,
          profiles: document.profiles.map((profile) => ({ id: profile.id, name: profile.name })),
        })
      } catch (cause) {
        setFormError(
          parseAppErrorPayload(cause)?.message ?? 'Could not prepare the agent skill file.',
        )
      }
    })
  }

  /** Confirm: one write; a failure stays inline and keeps the dialog open (spec Errors). */
  async function confirmTeachAgents(): Promise<void> {
    if (projectId === null || teachWriting) return
    setTeachWriting(true)
    setTeachError(null)
    try {
      await app.kanban.writeSkill(projectId)
      setTeachDialog(null)
      setTeachDone(true)
    } catch (cause) {
      setTeachError(
        parseAppErrorPayload(cause)?.message ?? `Could not write ${AGENT_SKILL_FILE_PATH}.`,
      )
    } finally {
      setTeachWriting(false)
    }
  }

  async function runTest(): Promise<void> {
    // Guard the exact rule the button state expresses: never test against an
    // unsaved binding (the displayed adapter must equal the persisted one) and
    // never start a second run while one is already in flight.
    if (projectId === null || !bindingSaved || testState === 'running' || guard.inFlight()) return
    setTestState('running')
    setTestMessage(null)
    try {
      await app.kanban.test(projectId, valuesPayload(schema, values))
      setTestState('success')
    } catch (cause) {
      setTestState('error')
      setTestMessage(
        parseAppErrorPayload(cause)?.message ??
          (isLocalFile
            ? 'The task file could not be read.'
            : 'The adapter connection test failed.'),
      )
    }
  }

  function beginSecretEdit(key: string): void {
    setEditingSecrets((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
  }

  function cancelSecretEdit(key: string): void {
    setEditingSecrets((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
    updateValue(key, '')
  }

  function fieldLabel(field: KanbanConfigField): React.JSX.Element {
    return (
      <>
        <span>{field.label}</span>
        {field.required ? <RequiredMark /> : null}
      </>
    )
  }

  function renderField(field: KanbanConfigField, divided: boolean): React.JSX.Element {
    const value = values[field.key] ?? ''
    const testId = testIdFor.kanbanField(field.key)
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
    if (field.type === 'secret') {
      const masked = secretKeys.has(field.key) && !editingSecrets.has(field.key)
      return (
        <FieldRow
          key={field.key}
          label={fieldLabel(field)}
          htmlFor={masked ? undefined : testId}
          description="Stored securely on this computer."
          divided={divided}
        >
          <MaskedKeyControl
            masked={masked ? 'Stored' : null}
            tone="stored"
            value={value}
            inputId={testId}
            onValueChange={(next) => updateValue(field.key, next)}
            onEdit={() => beginSecretEdit(field.key)}
            onCancel={editingSecrets.has(field.key) ? () => cancelSecretEdit(field.key) : undefined}
            previewTestId={testIdFor.kanbanSecretStored(field.key)}
            inputTestId={testId}
          />
        </FieldRow>
      )
    }
    return (
      <FieldRow key={field.key} label={fieldLabel(field)} htmlFor={testId} divided={divided}>
        {field.type === 'select' ? (
          <SettingsSelect
            id={testId}
            value={value}
            testId={testId}
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
            onChange={(event) => updateValue(field.key, event.target.value)}
          />
        )}
      </FieldRow>
    )
  }

  const testStatus =
    testState === 'running' ? (
      <span className="text-ink-secondary" data-testid={TEST_ID.settingsKanbanTestResult}>
        Testing…
      </span>
    ) : testState === 'success' ? (
      <span className="text-success" data-testid={TEST_ID.settingsKanbanTestResult}>
        {isLocalFile ? 'The task file is readable.' : 'Connection succeeded.'}
      </span>
    ) : testState === 'error' && testMessage !== null ? (
      <span role="alert" className="text-error" data-testid={TEST_ID.settingsKanbanTestResult}>
        {testMessage}
      </span>
    ) : savedState === 'saved' ? (
      <span className="text-success" data-testid={TEST_ID.settingsKanbanSaved}>
        Saved
      </span>
    ) : (
      <span role="status">Not tested yet</span>
    )

  return (
    <div data-testid={TEST_ID.settingsKanbanPanel} className="flex max-w-[660px] flex-col gap-7">
      <PageIntro title="Tasks" description="The tracker this project's board reads tasks from." />
      {loading ? (
        <p
          className="text-[13px] text-ink-secondary"
          data-testid={TEST_ID.settingsKanbanLoading}
          role="status"
        >
          Loading adapters…
        </p>
      ) : (
        <>
          {loadError ? (
            <p role="alert" className="text-[13px] text-error">
              {loadError}
            </p>
          ) : null}
          {projectId === null ? (
            <p className="text-[13px] text-ink-secondary">
              Select a project to connect a task source.
            </p>
          ) : (
            <>
              <SettingsGroup label="Tracker">
                <SectionLabel title="Tracker" />
                <GroupBox>
                  <FieldRow
                    label="Adapter"
                    htmlFor="settings-kanban-adapter"
                    description="Task tracker integration."
                  >
                    <SettingsSelect
                      id="settings-kanban-adapter"
                      value={adapterId ?? ''}
                      testId={TEST_ID.settingsKanbanAdapterSelect}
                      onChange={selectAdapter}
                    >
                      <option value="">(none)</option>
                      {adapters.map((adapter) => (
                        <option key={adapter.id} value={adapter.id}>
                          {adapter.id === LOCAL_FILE_ADAPTER_ID
                            ? adapter.name
                            : `${adapter.name} · ${adapter.id}`}
                        </option>
                      ))}
                      {missing ? (
                        <option value={adapterId as string}>{adapterId} (missing)</option>
                      ) : null}
                    </SettingsSelect>
                  </FieldRow>
                  {isLocalFile ? (
                    <InfoStrip>
                      Task file:{' '}
                      <code
                        className="font-mono text-ink-secondary"
                        data-testid={TEST_ID.settingsKanbanLocalPath}
                      >
                        {LOCAL_TASK_FILE_PATH}
                      </code>
                    </InfoStrip>
                  ) : null}
                  {schema.map((field) => renderField(field, true))}
                  {discoveredCount === 0 ? (
                    <p
                      className="border-t border-edge px-4 py-3 text-xs text-ink-muted"
                      data-testid={TEST_ID.settingsKanbanEmpty}
                    >
                      No task adapters are installed. Copy an adapter folder with its adapter.json
                      into the kanban-adapters folder of the NeKode application data directory, then
                      reopen this tab.
                    </p>
                  ) : null}
                  {missing ? (
                    <p
                      className="border-t border-edge px-4 py-3 text-xs text-error"
                      data-testid={TEST_ID.settingsKanbanAdapterMissing}
                    >
                      The selected adapter “{adapterId}” is not installed in the adapters directory.
                      Requests through it will fail until it is restored; you can clear or re-bind
                      here.
                    </p>
                  ) : null}
                  {sessionOnlySecrets && schema.some((field) => field.type === 'secret') ? (
                    <p
                      role="status"
                      className="border-t border-edge px-4 py-3 text-xs text-warning"
                      data-testid={TEST_ID.settingsKanbanSecretSessionOnly}
                    >
                      No system keyring is available, so secrets are kept only until NeKode closes
                      and are never saved in plain text. Install and unlock a keyring (for example
                      gnome-keyring with libsecret) to keep them across restarts.
                    </p>
                  ) : null}
                  {formError ? (
                    <p role="alert" className="border-t border-edge px-4 py-2 text-xs text-error">
                      {formError}
                    </p>
                  ) : null}
                  {adapterId !== null && !bindingSaved ? (
                    <p
                      className="border-t border-edge px-4 py-2 text-xs text-ink-secondary"
                      data-testid={TEST_ID.settingsKanbanTestHint}
                    >
                      Save the adapter binding before testing the connection.
                    </p>
                  ) : null}
                  <GroupFooter status={testStatus}>
                    {persistedAdapterId === null ? (
                      <button
                        type="button"
                        disabled={guard.busy}
                        className={secondaryClass}
                        data-testid={TEST_ID.settingsKanbanUseLocal}
                        onClick={() => {
                          void startLocalTaskList()
                        }}
                      >
                        Use a local task list
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={secondaryClass}
                      data-testid={TEST_ID.settingsKanbanTest}
                      disabled={!bindingSaved || testState === 'running' || guard.busy}
                      onClick={() => {
                        void runTest()
                      }}
                    >
                      {isLocalFile ? 'Test' : 'Test connection'}
                    </button>
                    <button
                      type="button"
                      disabled={guard.busy}
                      className={primaryClass}
                      data-testid={TEST_ID.settingsKanbanSave}
                      onClick={() => {
                        void save()
                      }}
                    >
                      Save
                    </button>
                  </GroupFooter>
                </GroupBox>
              </SettingsGroup>
              {persistedAdapterId !== null ? (
                <SettingsGroup label="Agents">
                  <SectionLabel title="Agents" />
                  <GroupBox>
                    <div className="flex items-center gap-6 px-4 py-3">
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
                        Teach agents how to use this tracker
                      </span>
                      <button
                        ref={teachButtonRef}
                        type="button"
                        disabled={guard.busy}
                        className={secondaryClass}
                        data-testid={TEST_ID.settingsKanbanTeachAgents}
                        onClick={() => {
                          void openTeachAgents()
                        }}
                      >
                        Teach agents
                      </button>
                    </div>
                    {teachDone ? (
                      <p
                        className="border-t border-edge px-4 py-2 text-xs text-success"
                        data-testid={TEST_ID.settingsKanbanTeachDone}
                      >
                        Wrote {AGENT_SKILL_FILE_PATH}.
                      </p>
                    ) : null}
                  </GroupBox>
                </SettingsGroup>
              ) : null}
              {/* Portaled to the body so the confirm sits above the Project
                  Settings modal instead of inside its scrolling panel. */}
              {teachDialog !== null
                ? createPortal(
                    <ConfirmDialog
                      title="Teach agents"
                      body="NeKode writes one project skill file that tells agents where this project's tasks live. It contains no tasks and no tracker settings."
                      confirmLabel="Write skill file"
                      confirmDisabled={teachWriting}
                      onConfirm={() => {
                        void confirmTeachAgents()
                      }}
                      onCancel={() => {
                        if (teachWriting) return
                        setTeachDialog(null)
                        setTeachError(null)
                      }}
                    >
                      <div className="mt-3 text-xs text-ink-secondary">
                        <p>
                          File:{' '}
                          <code className="text-ink" data-testid={TEST_ID.settingsKanbanTeachFile}>
                            {AGENT_SKILL_FILE_PATH}
                          </code>
                        </p>
                        {teachDialog.exists ? (
                          <p
                            className="mt-2 text-warning"
                            data-testid={TEST_ID.settingsKanbanTeachReplace}
                          >
                            This replaces {AGENT_SKILL_FILE_PATH}.
                          </p>
                        ) : null}
                        <p className="mt-3">Agents that can read a project skill:</p>
                        {teachDialog.profiles.length > 0 ? (
                          <ul
                            className="mt-1 list-disc pl-5 text-ink"
                            data-testid={TEST_ID.settingsKanbanTeachProfiles}
                          >
                            {teachDialog.profiles.map((profile) => (
                              <li key={profile.id}>{profile.name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p
                            className="mt-1 text-ink-muted"
                            data-testid={TEST_ID.settingsKanbanTeachNoProfiles}
                          >
                            No agent profile is selected for this project.
                          </p>
                        )}
                        {teachError !== null ? (
                          <p
                            role="alert"
                            className="mt-3 text-error"
                            data-testid={TEST_ID.settingsKanbanTeachError}
                          >
                            {teachError}
                          </p>
                        ) : null}
                      </div>
                    </ConfirmDialog>,
                    document.body,
                  )
                : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
