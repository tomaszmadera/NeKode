import type React from 'react'
import { useEffect, useState } from 'react'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
import { projectHandoffDirKey } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID } from '../../lib/test-ids'

interface Props {
  app: AppApi
  actions: ActionControl[]
  projectId: string | null
  /** Project root (Browse fallback when no directory is set yet); null without a project. */
  projectPath: string | null
  /** Application-global Handoff/Resume auto-send (spec Behaviour 6). */
  autoSend: boolean
  onAutoSendChange: (next: boolean) => void
  onRefresh: () => Promise<void>
  onClose: () => void
}

function nextSortOrder(actions: ActionControl[]): number {
  let max = -1
  for (const action of actions) {
    if (action.sortOrder > max) max = action.sortOrder
  }
  return max + 1
}

function emptyInput(projectId: string | null, sortOrder: number): ActionInput {
  return {
    scope: projectId === null ? 'global' : 'project',
    projectId,
    title: '',
    icon: null,
    command: '',
    cwd: null,
    runMode: 'background',
    confirm: false,
    sortOrder,
  }
}

export function ActionSettings({
  app,
  actions,
  projectId,
  projectPath,
  autoSend,
  onAutoSendChange,
  onRefresh,
  onClose,
}: Props): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ActionInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visible = actions.filter(
    (action) => action.scope === 'global' || action.projectId === projectId,
  )

  // Configuration section state (spec handoff-resume-flow Behaviour 6): the
  // handoff directory loads once per bound project; Save persists the exact
  // input (empty clears the setting). Auto-send persists immediately.
  const [handoffDir, setHandoffDir] = useState('')
  const [handoffDirSaved, setHandoffDirSaved] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => {
    if (projectId === null) {
      setHandoffDir('')
      return
    }
    let alive = true
    setHandoffDirSaved(false)
    setConfigError(null)
    void app.state
      .get(projectHandoffDirKey(projectId))
      .then((value) => {
        if (alive) setHandoffDir(value ?? '')
      })
      .catch(() => {
        // An unloaded setting is an empty input, not a blocking failure: the
        // user can still type and save the directory.
        if (alive) setHandoffDir('')
      })
    return () => {
      alive = false
    }
  }, [app, projectId])

  async function saveHandoffDir(): Promise<void> {
    if (projectId === null) return
    try {
      await app.state.set(projectHandoffDirKey(projectId), handoffDir.trim())
      setHandoffDirSaved(true)
      setConfigError(null)
    } catch (cause) {
      setHandoffDirSaved(false)
      setConfigError(
        parseAppErrorPayload(cause)?.message ?? 'Failed to save the handoff directory.',
      )
    }
  }

  async function browseHandoffDir(): Promise<void> {
    try {
      const picked = await app.dialogs.pickDirectory(
        handoffDir.trim().length > 0 ? handoffDir.trim() : projectPath,
      )
      if (picked !== null) {
        setHandoffDir(picked)
        setHandoffDirSaved(false)
      }
    } catch (cause) {
      setConfigError(parseAppErrorPayload(cause)?.message ?? 'Failed to open the directory picker.')
    }
  }

  function edit(action: ActionControl): void {
    setEditingId(action.id)
    setForm({
      scope: action.scope,
      projectId: action.projectId,
      title: action.title,
      icon: action.icon,
      command: action.command,
      cwd: action.cwd,
      runMode: action.runMode,
      confirm: action.confirm,
      sortOrder: action.sortOrder,
    })
    setError(null)
  }

  async function save(): Promise<void> {
    if (!form) return
    if (!form.title.trim() || !form.command.trim()) {
      setError('Title and command are required.')
      return
    }
    try {
      if (editingId) await app.actions.update(editingId, form)
      else await app.actions.create(form)
      await onRefresh()
      setForm(null)
      setEditingId(null)
      setError(null)
    } catch (cause) {
      setError(parseAppErrorPayload(cause)?.message ?? 'Failed to save action.')
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await app.actions.delete(id)
      await onRefresh()
      if (editingId === id) {
        setForm(null)
        setEditingId(null)
      }
      setError(null)
    } catch (cause) {
      setError(parseAppErrorPayload(cause)?.message ?? 'Failed to delete action.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Project Settings"
        className="max-h-[85vh] w-[min(36rem,90vw)] overflow-y-auto rounded-lg border border-edge bg-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Project Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {/* Configuration (spec handoff-resume-flow Behaviour 6): auto-send is
            application-global; the handoff directory is per project. */}
        <div className="mt-4 text-xs" data-testid={TEST_ID.settingsConfigSection}>
          <h3 className="border-b border-edge pb-2 text-sm font-semibold">Configuration</h3>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoSend}
              data-testid={TEST_ID.settingsAutoSend}
              onChange={(event) => {
                onAutoSendChange(event.target.checked)
              }}
            />
            Auto-send after Handoff/Resume
          </label>
          {projectId !== null ? (
            <div className="mt-2">
              <label>
                Handoff directory (absolute, or relative to the project root)
                <div className="mt-1 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-sm bg-highlight p-1"
                    value={handoffDir}
                    placeholder="e.g. .agents/handoffs"
                    data-testid={TEST_ID.settingsHandoffDir}
                    onChange={(event) => {
                      setHandoffDir(event.target.value)
                      setHandoffDirSaved(false)
                    }}
                  />
                  <button
                    type="button"
                    className="h-control shrink-0 rounded-md bg-button px-3 text-ink hover:bg-button-hover"
                    data-testid={TEST_ID.settingsHandoffDirBrowse}
                    onClick={() => {
                      void browseHandoffDir()
                    }}
                  >
                    Browse
                  </button>
                </div>
              </label>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Save handoff directory"
                  className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
                  data-testid={TEST_ID.settingsHandoffDirSave}
                  onClick={() => {
                    void saveHandoffDir()
                  }}
                >
                  Save
                </button>
                {handoffDirSaved ? (
                  <span className="text-success" data-testid={TEST_ID.settingsHandoffDirSaved}>
                    Saved
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {configError ? (
            <p role="alert" className="mt-2 text-error">
              {configError}
            </p>
          ) : null}
        </div>
        <h3 className="mt-4 border-b border-edge pb-2 text-sm font-semibold">Actions</h3>
        <ul className="mt-2 space-y-2">
          {visible.map((action) => (
            <li
              key={action.id}
              className="flex items-center gap-2 rounded border border-edge px-2 py-1 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{action.title}</div>
                <div className="truncate text-ink-secondary" title={action.command}>
                  {action.command}
                </div>
                <div className="text-ink-muted">
                  {action.runMode === 'background'
                    ? 'Background'
                    : action.runMode === 'bottom-terminal'
                      ? 'Bottom terminal'
                      : 'New terminal'}{' '}
                  · {action.scope}
                </div>
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                onClick={() => edit(action)}
              >
                Edit
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-error/10 hover:text-error"
                onClick={() => {
                  void remove(action.id)
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
          onClick={() => {
            setEditingId(null)
            setForm(emptyInput(projectId, nextSortOrder(actions)))
            setError(null)
          }}
        >
          Add Action
        </button>
        {form !== null ? (
          <form
            className="mt-4 grid gap-3 text-xs"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <h4 className="font-semibold">{editingId ? 'Edit Action' : 'Add Action'}</h4>
            <label>
              Scope
              <select
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.scope}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scope: event.target.value as ActionInput['scope'],
                    projectId: event.target.value === 'global' ? null : projectId,
                  })
                }
              >
                <option value="project" disabled={projectId === null}>
                  Project
                </option>
                <option value="global">Global</option>
              </select>
            </label>
            <label>
              Title
              <input
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Icon (optional)
              <input
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.icon ?? ''}
                onChange={(event) => setForm({ ...form, icon: event.target.value || null })}
              />
            </label>
            <label>
              Command
              <input
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.command}
                onChange={(event) => setForm({ ...form, command: event.target.value })}
              />
            </label>
            <label>
              Working Directory (project root by default)
              <input
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.cwd ?? ''}
                onChange={(event) => setForm({ ...form, cwd: event.target.value || null })}
              />
            </label>
            <label>
              Run In
              <select
                className="mt-1 block w-full rounded-sm bg-highlight p-1"
                value={form.runMode}
                onChange={(event) =>
                  setForm({ ...form, runMode: event.target.value as ActionInput['runMode'] })
                }
              >
                <option value="background">Background</option>
                <option value="new-terminal">New terminal</option>
                <option value="bottom-terminal">Bottom terminal</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.confirm}
                onChange={(event) => setForm({ ...form, confirm: event.target.checked })}
              />
              Ask for confirmation
            </label>
            {error ? (
              <p role="alert" className="text-error">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
              >
                Save
              </button>
              <button
                type="button"
                className="h-control rounded-md px-4 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                onClick={() => {
                  setForm(null)
                  setError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : error ? (
          <p role="alert" className="mt-2 text-xs text-error">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
