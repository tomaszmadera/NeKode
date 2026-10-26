import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { KanbanBoardStatus } from './KanbanBoardStatus'

afterEach(() => {
  cleanup()
})

describe('KanbanBoardStatus', () => {
  it('shows loading, empty, and nothing on a ready board without an error', () => {
    const onConfigure = vi.fn()
    const { rerender, container } = render(
      <KanbanBoardStatus
        phase="loading"
        error={null}
        sourceMissing={false}
        onConfigure={onConfigure}
      />,
    )
    expect(screen.getByTestId(TEST_ID.kanbanBoardLoading).getAttribute('role')).toBe('status')

    rerender(
      <KanbanBoardStatus
        phase="empty"
        error={null}
        sourceMissing={false}
        onConfigure={onConfigure}
      />,
    )
    expect(screen.getByTestId(TEST_ID.kanbanBoardEmpty)).toBeTruthy()

    rerender(
      <KanbanBoardStatus
        phase="ready"
        error={null}
        sourceMissing={false}
        onConfigure={onConfigure}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('offers Configure when not configured and hides the validation message', () => {
    const onConfigure = vi.fn()
    render(
      <KanbanBoardStatus
        phase="not-configured"
        error="Project p1 has no task source"
        sourceMissing={false}
        onConfigure={onConfigure}
      />,
    )
    expect(screen.queryByTestId(TEST_ID.kanbanBoardError)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardConfigure))
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })

  it('shows the typed error, and Use a local task list only for a missing task file', () => {
    const onUseLocalTaskList = vi.fn(() => Promise.resolve())
    const { rerender } = render(
      <KanbanBoardStatus
        phase="error"
        error="Task file is missing"
        sourceMissing
        onConfigure={vi.fn()}
        onUseLocalTaskList={onUseLocalTaskList}
      />,
    )
    expect(screen.getByTestId(TEST_ID.kanbanBoardError).textContent).toBe('Task file is missing')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardUseLocal))
    expect(onUseLocalTaskList).toHaveBeenCalledTimes(1)

    rerender(
      <KanbanBoardStatus
        phase="error"
        error="Offline"
        sourceMissing={false}
        onConfigure={vi.fn()}
        onUseLocalTaskList={onUseLocalTaskList}
      />,
    )
    expect(screen.queryByTestId(TEST_ID.kanbanBoardUseLocal)).toBeNull()
  })
})
