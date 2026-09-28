import type React from 'react'
import { useState } from 'react'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'

interface Props {
  app: AppApi
  actions: ActionControl[]
  projectId: string | null
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
  onRefresh,
  onClose,
}: Props): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ActionInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visible = actions.filter(
    (action) => action.scope === 'global' || action.projectId === projectId,
  )

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
        className="max-h-[85vh] w-[min(36rem,90vw)] overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Project Settings</h2>
          <button type="button" aria-label="Close settings" onClick={onClose}>
            Close
          </button>
        </div>
        <h3 className="mt-4 border-b border-neutral-700 pb-2 text-sm font-semibold">Actions</h3>
        <ul className="mt-2 space-y-2">
          {visible.map((action) => (
            <li
              key={action.id}
              className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{action.title}</div>
                <div className="truncate text-neutral-400" title={action.command}>
                  {action.command}
                </div>
                <div className="text-neutral-500">
                  {action.runMode === 'background'
                    ? 'Background'
                    : action.runMode === 'bottom-terminal'
                      ? 'Bottom terminal'
                      : 'New terminal'}{' '}
                  · {action.scope}
                </div>
              </div>
              <button type="button" onClick={() => edit(action)}>
                Edit
              </button>
              <button
                type="button"
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
          className="mt-3 rounded border border-neutral-700 px-2 py-1 text-xs"
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
                className="mt-1 block w-full bg-neutral-800 p-1"
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
                className="mt-1 block w-full bg-neutral-800 p-1"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Icon (optional)
              <input
                className="mt-1 block w-full bg-neutral-800 p-1"
                value={form.icon ?? ''}
                onChange={(event) => setForm({ ...form, icon: event.target.value || null })}
              />
            </label>
            <label>
              Command
              <input
                className="mt-1 block w-full bg-neutral-800 p-1"
                value={form.command}
                onChange={(event) => setForm({ ...form, command: event.target.value })}
              />
            </label>
            <label>
              Working Directory (project root by default)
              <input
                className="mt-1 block w-full bg-neutral-800 p-1"
                value={form.cwd ?? ''}
                onChange={(event) => setForm({ ...form, cwd: event.target.value || null })}
              />
            </label>
            <label>
              Run In
              <select
                className="mt-1 block w-full bg-neutral-800 p-1"
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
              <p role="alert" className="text-red-300">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" className="rounded border border-neutral-600 px-2 py-1">
                Save
              </button>
              <button
                type="button"
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
          <p role="alert" className="mt-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
