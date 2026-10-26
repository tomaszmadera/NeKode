import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { KanbanHeader, useKanbanToolbarBridge } from './KanbanHeader'
import { DEFAULT_KANBAN_SORT, type KanbanToolbarControls } from './kanban-board-logic'

// KanbanHeader renders the board's own header; useKanbanToolbarBridge reports
// the same controls to an external toolbar host instead.

afterEach(() => {
  cleanup()
})

function controls(overrides: Partial<KanbanToolbarControls> = {}): KanbanToolbarControls {
  return {
    phase: 'ready',
    refreshing: false,
    isReviewing: false,
    creatingBusy: false,
    sortState: DEFAULT_KANBAN_SORT,
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    onSortByChange: vi.fn(),
    onToggleSortDirection: vi.fn(),
    onRefresh: vi.fn(),
    onNewTask: vi.fn(),
    onCloseReview: vi.fn(),
    ...overrides,
  }
}

describe('KanbanHeader', () => {
  it('shows list controls on a ready board and routes each control to its callback', () => {
    const props = controls()
    render(<KanbanHeader {...props} />)

    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanReviewBack)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanNewTask))
    expect(props.onNewTask).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByTestId(TEST_ID.kanbanSortBy), { target: { value: 'priority' } })
    expect(props.onSortByChange).toHaveBeenCalledWith('priority')

    const direction = screen.getByTestId(TEST_ID.kanbanSortDirection)
    expect(direction.getAttribute('aria-label')).toBe('Sort ascending')
    fireEvent.click(direction)
    expect(props.onToggleSortDirection).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('shows only Back and Refresh while reviewing, and Back closes the review', () => {
    const props = controls({ isReviewing: true })
    render(<KanbanHeader {...props} />)

    expect(screen.queryByTestId(TEST_ID.kanbanNewTask)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanSortBy)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(props.onCloseReview).toHaveBeenCalledTimes(1)
  })

  it('hides list controls before the board is ready and disables busy controls', () => {
    const { rerender } = render(
      <KanbanHeader {...controls({ phase: 'loading', refreshing: true })} />,
    )
    expect(screen.queryByTestId(TEST_ID.kanbanNewTask)).toBeNull()
    expect((screen.getByTestId(TEST_ID.kanbanBoardRefresh) as HTMLButtonElement).disabled).toBe(
      true,
    )

    rerender(<KanbanHeader {...controls({ creatingBusy: true })} />)
    expect((screen.getByTestId(TEST_ID.kanbanNewTask) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('useKanbanToolbarBridge', () => {
  it('reports once per shown change, null when inactive, and null on unmount', () => {
    const report = vi.fn()
    const first = controls()
    const { rerender, unmount } = renderHook(
      ({ active, value }: { active: boolean; value: KanbanToolbarControls }) => {
        useKanbanToolbarBridge(report, active, value)
      },
      { initialProps: { active: true, value: first } },
    )
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.lastCall?.[0]).toMatchObject({ phase: 'ready', refreshing: false })

    rerender({ active: true, value: { ...first } })
    expect(report).toHaveBeenCalledTimes(1)

    rerender({ active: true, value: { ...first, refreshing: true } })
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.lastCall?.[0]).toMatchObject({ refreshing: true })

    rerender({ active: false, value: { ...first, refreshing: true } })
    expect(report).toHaveBeenCalledTimes(3)
    expect(report.mock.lastCall?.[0]).toBeNull()

    rerender({ active: true, value: first })
    expect(report).toHaveBeenCalledTimes(4)
    unmount()
    expect(report).toHaveBeenCalledTimes(5)
    expect(report.mock.lastCall?.[0]).toBeNull()
  })

  it('reports nothing without a host callback', () => {
    expect(() =>
      renderHook(() => {
        useKanbanToolbarBridge(undefined, true, controls())
      }).unmount(),
    ).not.toThrow()
  })
})
