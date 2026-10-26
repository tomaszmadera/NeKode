import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { kanbanBoardFixture } from '../../test/kanban-fixtures'
import { KanbanCreateTaskForm, type KanbanCreateTaskFormProps } from './KanbanCreateTaskForm'
import type { NewTaskDraft } from './kanban-board-logic'

afterEach(() => {
  cleanup()
})

const EMPTY_DRAFT: NewTaskDraft = { stateRef: '', title: '', description: '', priority: null }

function renderForm(overrides: Partial<KanbanCreateTaskFormProps> = {}): KanbanCreateTaskFormProps {
  const props: KanbanCreateTaskFormProps = {
    states: kanbanBoardFixture.states,
    draft: EMPTY_DRAFT,
    busy: false,
    error: null,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<KanbanCreateTaskForm {...props} />)
  return props
}

describe('KanbanCreateTaskForm', () => {
  it('lists states in adapter order with a blank first option and edits each draft field', () => {
    const props = renderForm()
    const status = screen.getByTestId(TEST_ID.kanbanNewTaskStatus) as HTMLSelectElement
    expect([...status.options].map((option) => option.value)).toEqual([
      '',
      'Backlog',
      'In Progress',
      'Done',
    ])

    fireEvent.change(status, { target: { value: 'Done' } })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_DRAFT, stateRef: 'Done' })
    fireEvent.change(screen.getByTestId(TEST_ID.kanbanNewTaskPriority), {
      target: { value: 'high' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_DRAFT, priority: 'high' })
    fireEvent.change(screen.getByTestId(TEST_ID.kanbanNewTaskTitle), { target: { value: 'T' } })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_DRAFT, title: 'T' })
    fireEvent.change(screen.getByTestId(TEST_ID.kanbanNewTaskDescription), {
      target: { value: 'D' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_DRAFT, description: 'D' })
  })

  it('enables Create only for a title and a state, and submits through onSubmit', () => {
    renderForm()
    expect((screen.getByTestId(TEST_ID.kanbanNewTaskCreate) as HTMLButtonElement).disabled).toBe(
      true,
    )
    cleanup()

    const props = renderForm({ draft: { ...EMPTY_DRAFT, stateRef: 'Backlog', title: 'New' } })
    const create = screen.getByTestId(TEST_ID.kanbanNewTaskCreate) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape and Cancel, and shows the create error', () => {
    const props = renderForm({ error: 'Could not create the task.' })
    expect(screen.getByTestId(TEST_ID.kanbanNewTaskError).textContent).toBe(
      'Could not create the task.',
    )
    fireEvent.keyDown(screen.getByTestId(TEST_ID.kanbanNewTaskTitle), { key: 'Escape' })
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanNewTaskCancel))
    expect(props.onCancel).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape and disables Cancel and Create while busy', () => {
    const props = renderForm({
      busy: true,
      draft: { ...EMPTY_DRAFT, stateRef: 'Backlog', title: 'New' },
    })
    fireEvent.keyDown(screen.getByTestId(TEST_ID.kanbanNewTaskTitle), { key: 'Escape' })
    expect(props.onCancel).not.toHaveBeenCalled()
    expect((screen.getByTestId(TEST_ID.kanbanNewTaskCancel) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByTestId(TEST_ID.kanbanNewTaskCreate) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
