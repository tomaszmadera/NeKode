import type { WorkItem } from '@shared/ipc-contract'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { kanbanBoardFixture } from '../../test/kanban-fixtures'
import { KanbanListView, type KanbanListViewProps, useKanbanListPrefs } from './KanbanListView'
import { boardColumns, DEFAULT_KANBAN_SORT } from './kanban-board-logic'

// The stored preferences are addressed by their literal key text: the key is
// the persistence contract, so it must not be derived from the code under test.
const COLLAPSED_KEY_P1 = 'nekode.kanban-collapsed-states.v1.p1'
const SORT_KEY_P1 = 'nekode.kanban-sort.v1.p1'
const COLLAPSED_KEY_P2 = 'nekode.kanban-collapsed-states.v1.p2'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderList(overrides: Partial<KanbanListViewProps> = {}): KanbanListViewProps {
  const props: KanbanListViewProps = {
    columns: boardColumns(kanbanBoardFixture),
    isFiltering: false,
    collapsedStates: new Set(),
    sortState: DEFAULT_KANBAN_SORT,
    itemResumable: () => false,
    onToggleCollapse: vi.fn(),
    onOpen: vi.fn(),
    onOpenMenu: vi.fn(),
    onStart: vi.fn(),
    onResume: vi.fn(),
    ...overrides,
  }
  render(<KanbanListView {...props} />)
  return props
}

describe('KanbanListView', () => {
  it('renders groups in column order with counts and items sorted by the sort state', () => {
    renderList({ sortState: { sortBy: 'slug', direction: 'desc' } })
    const backlog = screen.getByTestId(testIdFor.kanbanListGroup('s1'))
    expect(within(backlog).getByText('Backlog')).toBeTruthy()
    expect(within(backlog).getByText('2')).toBeTruthy()
    const refs = within(backlog)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('button')?.textContent)
    expect(refs).toEqual(['NK-3', 'NK-1'])
    expect(screen.getByTestId(testIdFor.kanbanListGroup('s3'))).toBeTruthy()
  })

  it('collapses a group from its toggle and hides collapsed items', () => {
    const props = renderList({ collapsedStates: new Set(['s1']) })
    const toggle = screen.getByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    fireEvent.click(toggle)
    expect(props.onToggleCollapse).toHaveBeenCalledWith('s1')
  })

  it('opens the review from the slug or title by click or Enter, and the menu by context menu', () => {
    const props = renderList()
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemRef('NK-1')))
    fireEvent.keyDown(screen.getByTestId(testIdFor.kanbanItemTitle('NK-2')), { key: 'Enter' })
    expect(props.onOpen).toHaveBeenNthCalledWith(1, 'NK-1')
    expect(props.onOpen).toHaveBeenNthCalledWith(2, 'NK-2')

    fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemTitle('NK-3')), {
      clientX: 7,
      clientY: 8,
    })
    expect(props.onOpenMenu).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-3' }), 7, 8)
  })

  it('routes Start and Resume, shows Resume only when resumable, and opens the Start menu', () => {
    const onOpenStartMenu = vi.fn()
    const props = renderList({
      itemResumable: (entry: WorkItem) => entry.ref === 'NK-2',
      onOpenStartMenu,
    })
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemStart('NK-1')))
    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-1' }))
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemResume('NK-2')))
    expect(props.onResume).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-2' }))

    fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemStart('NK-1')), {
      clientX: 3,
      clientY: 4,
    })
    expect(onOpenStartMenu).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-1' }), 3, 4)
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('renders a titled section header with a status icon, uppercase name, count pill, and no header rule', () => {
    renderList()
    const backlog = screen.getByTestId(testIdFor.kanbanListGroup('s1'))
    const header = within(backlog).getByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(backlog.getAttribute('aria-label')).toBe('Backlog')
    expect(header.querySelector('svg')).toBeTruthy()
    expect(within(header).getByText('Backlog').className).toContain('uppercase')
    expect(within(header).getByText('2').className).toContain('font-mono')
    expect(header.className).not.toContain('border-b')
    // The tasks sit in one rounded container; the header has no rule of its own.
    expect(backlog.querySelector('ul')?.className).toContain('rounded-[10px]')
  })

  it('marks every group with its own status icon', () => {
    const groups = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const
    const board = {
      states: groups.map((group, index) => ({
        id: `s-${group}`,
        name: group,
        group,
        order: index,
      })),
      items: groups.map((group, index) => ({
        ...kanbanBoardFixture.items[0],
        ref: `NK-${index + 10}`,
        stateId: `s-${group}`,
      })),
    }
    renderList({ columns: boardColumns(board) })

    // The chevron is the first SVG; the status mark follows it.
    const icon = (group: string): SVGSVGElement =>
      screen
        .getByTestId(testIdFor.kanbanGroupToggle(`s-${group}`))
        .querySelectorAll('svg')[1] as SVGSVGElement
    expect(icon('backlog').querySelector('circle')?.getAttribute('stroke-dasharray')).toBe('3 3')
    expect(icon('backlog').querySelector('path')).toBeNull()
    expect(icon('unstarted').querySelector('circle')?.getAttribute('stroke-dasharray')).toBeNull()
    expect(icon('started').querySelector('path')?.getAttribute('fill')).toBe('currentColor')
    expect(icon('completed').querySelector('path')?.getAttribute('d')).toBe(
      'M8 12.5l2.8 2.8L16.5 9.5',
    )
    expect(icon('cancelled').querySelector('path')?.getAttribute('d')).toBe('M9 9l6 6M15 9l-6 6')
  })

  it('renders only the header for an empty group and no empty container', () => {
    renderList()
    const done = screen.getByTestId(testIdFor.kanbanListGroup('s3'))
    expect(within(done).getByText('Done')).toBeTruthy()
    expect(within(done).getByText('0')).toBeTruthy()
    expect(done.querySelector('ul')).toBeNull()
    expect(within(done).queryByRole('listitem')).toBeNull()
  })

  it('shows a coloured priority dot with the label, and nothing for None', () => {
    const board = {
      states: [
        { id: 's1', name: 'Todo', group: 'unstarted' as const, order: 1 },
        { id: 's2', name: 'Done', group: 'completed' as const, order: 2 },
        { id: 's3', name: 'Cancelled', group: 'cancelled' as const, order: 3 },
      ],
      items: [
        { ...kanbanBoardFixture.items[0], ref: 'NK-4', stateId: 's1', priority: 'urgent' as const },
        { ...kanbanBoardFixture.items[1], ref: 'NK-5', stateId: 's1', priority: null },
        { ...kanbanBoardFixture.items[2], ref: 'NK-6', stateId: 's2', priority: null },
        { ...kanbanBoardFixture.items[0], ref: 'NK-7', stateId: 's3', priority: 'low' as const },
      ],
    }
    renderList({ columns: boardColumns(board) })

    const urgentRow = screen.getByTestId(testIdFor.kanbanItem('NK-4'))
    expect(within(urgentRow).getByText('Urgent')).toBeTruthy()
    expect(
      within(urgentRow).getByTestId(testIdFor.kanbanItemPriorityDot('NK-4')).style.backgroundColor,
    ).toBe('var(--color-error)')

    const noneRow = screen.getByTestId(testIdFor.kanbanItem('NK-5'))
    expect(within(noneRow).queryByTestId(testIdFor.kanbanItemPriorityDot('NK-5'))).toBeNull()
    expect(within(noneRow).getByTestId(testIdFor.kanbanItemPriority('NK-5')).textContent).toBe('')

    // Completed and Cancelled titles are muted and struck through.
    for (const ref of ['NK-6', 'NK-7']) {
      const title = within(screen.getByTestId(testIdFor.kanbanItem(ref))).getByTestId(
        testIdFor.kanbanItemTitle(ref),
      )
      expect(title.className).toContain('line-through')
      expect(title.className).toContain('text-ink-muted')
    }
  })

  it('reveals Start on row hover or focus and labels it with the ID', () => {
    renderList()
    const start = screen.getByTestId(testIdFor.kanbanItemStart('NK-1'))
    expect(start.getAttribute('aria-label')).toBe('Start NK-1')
    expect(start.className).toContain('opacity-0')
    expect(start.className).toContain('group-hover:opacity-100')
    expect(start.className).toContain('focus-visible:opacity-100')
    expect(start.className).toContain('[@media(hover:none)]:opacity-100')
  })

  it('reports no match while filtering an empty result and disables group toggles', () => {
    renderList({ columns: [], isFiltering: true })
    expect(screen.getByRole('status').textContent).toBe('No matching tasks.')
    cleanup()

    renderList({ columns: boardColumns(kanbanBoardFixture).slice(0, 1), isFiltering: true })
    expect(
      (screen.getByTestId(testIdFor.kanbanGroupToggle('s1')) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
  })
})

describe('useKanbanListPrefs', () => {
  it('loads, persists, and reloads the collapsed groups and the sort per project', () => {
    localStorage.setItem(COLLAPSED_KEY_P1, JSON.stringify(['s1']))
    const { result } = renderHook(() => useKanbanListPrefs('p1'))
    expect([...result.current.collapsedStates]).toEqual(['s1'])
    expect(result.current.sortState).toEqual(DEFAULT_KANBAN_SORT)

    act(() => {
      result.current.onToggleCollapse('s1')
      result.current.onSortByChange('priority')
      result.current.onToggleSortDirection()
    })
    expect(result.current.collapsedStates.size).toBe(0)
    expect(localStorage.getItem(COLLAPSED_KEY_P1)).toBeNull()
    expect(result.current.sortState).toEqual({ sortBy: 'priority', direction: 'desc' })
    expect(JSON.parse(localStorage.getItem(SORT_KEY_P1) ?? '')).toEqual({
      sortBy: 'priority',
      direction: 'desc',
    })

    localStorage.setItem(COLLAPSED_KEY_P2, JSON.stringify(['s2']))
    act(() => {
      result.current.reload('p2')
    })
    expect([...result.current.collapsedStates]).toEqual(['s2'])
    expect(result.current.sortState).toEqual(DEFAULT_KANBAN_SORT)
  })
})
