import type { KanbanState } from '@shared/ipc-contract'
import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { KANBAN_FIELD_CLASS } from './KanbanItemActions'
import {
  type NewTaskDraft,
  PRIORITY_COLOR,
  PRIORITY_OPTIONS,
  priorityFromSelect,
  prioritySelectValue,
  statesInAdapterOrder,
} from './kanban-board-logic'

// New task form under the board header (spec kanban-adapter-interface
// Behaviour 14). The board owns the draft and the `kanban:createItem` call;
// this form edits the draft, submits it, and cancels on Escape unless busy.

export interface KanbanCreateTaskFormProps {
  states: readonly KanbanState[]
  draft: NewTaskDraft
  /** True while the create request is in flight. */
  busy: boolean
  error: string | null
  onChange: (next: NewTaskDraft) => void
  onSubmit: () => void
  onCancel: () => void
}

export function KanbanCreateTaskForm({
  states,
  draft,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: KanbanCreateTaskFormProps): React.JSX.Element {
  const ordered = statesInAdapterOrder(states)
  const canCreate = draft.title.trim() !== '' && draft.stateRef.trim() !== '' && !busy
  return (
    <form
      className="mb-3 flex flex-col gap-3 rounded-md border border-edge p-3"
      aria-label="New task"
      data-testid={TEST_ID.kanbanNewTaskForm}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={(event) => {
        if (busy || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskStatus}>
          Status
        </label>
        <select
          id={TEST_ID.kanbanNewTaskStatus}
          className={`h-control ${KANBAN_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskStatus}
          value={draft.stateRef}
          onChange={(event) => {
            onChange({ ...draft, stateRef: event.target.value })
          }}
        >
          {draft.stateRef === '' ? <option value=""> </option> : null}
          {ordered.map((state) => (
            <option key={state.id} value={state.name}>
              {state.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskPriority}>
          Priority
        </label>
        <select
          id={TEST_ID.kanbanNewTaskPriority}
          className={`h-control ${KANBAN_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskPriority}
          value={prioritySelectValue(draft.priority)}
          style={draft.priority ? { color: PRIORITY_COLOR[draft.priority] } : undefined}
          onChange={(event) => {
            onChange({ ...draft, priority: priorityFromSelect(event.target.value) })
          }}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              style={option.value !== 'none' ? { color: PRIORITY_COLOR[option.value] } : undefined}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskTitle}>
          Title
        </label>
        <input
          id={TEST_ID.kanbanNewTaskTitle}
          type="text"
          className={`h-control ${KANBAN_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskTitle}
          value={draft.title}
          onChange={(event) => {
            onChange({ ...draft, title: event.target.value })
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskDescription}>
          Description
        </label>
        <textarea
          id={TEST_ID.kanbanNewTaskDescription}
          className={`min-h-16 py-2 ${KANBAN_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskDescription}
          value={draft.description}
          onChange={(event) => {
            onChange({ ...draft, description: event.target.value })
          }}
        />
      </div>
      {error !== null ? (
        <p
          role="alert"
          className="text-[12.6px] text-error"
          data-testid={TEST_ID.kanbanNewTaskError}
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          data-testid={TEST_ID.kanbanNewTaskCreate}
          disabled={!canCreate}
        >
          Create
        </button>
        <button
          type="button"
          className="h-control rounded-md px-4 text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          data-testid={TEST_ID.kanbanNewTaskCancel}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
