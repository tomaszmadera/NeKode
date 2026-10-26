import type { WorkItem } from '@shared/ipc-contract'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { restoreClipboard, stubClipboard } from '../../test/clipboard-stub'
import { kanbanBoardFixture, kanbanWorkItem } from '../../test/kanban-fixtures'
import {
  ItemCopyMenu,
  KanbanListView,
  type KanbanListViewProps,
  useKanbanListPrefs,
} from './KanbanListView'
import {
  boardColumns,
  DEFAULT_KANBAN_SORT,
  kanbanCollapsedStorageKey,
  kanbanSortStorageKey,
} from './kanban-board-logic'

afterEach(() => {
  cleanup()
  restoreClipboard()
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

describe('ItemCopyMenu', () => {
  it('copies the slug and closes, and disables Copy link for a blank url', async () => {
    const clipboard = stubClipboard()
    const onClose = vi.fn()
    render(<ItemCopyMenu item={kanbanWorkItem('NK-1', 'T', 's1')} x={0} y={0} onClose={onClose} />)
    expect(
      (screen.getByRole('menuitem', { name: 'Copy link' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy slug' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(clipboard.writeText).toHaveBeenCalledWith('NK-1')
  })

  it('copies the url and reports a missing clipboard', async () => {
    const clipboard = stubClipboard()
    const onClose = vi.fn()
    const item = { ...kanbanWorkItem('NK-1', 'T', 's1'), url: 'https://example.test/NK-1' }
    render(<ItemCopyMenu item={item} x={0} y={0} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('https://example.test/NK-1')
    })
    cleanup()

    stubClipboard({ missing: true })
    render(<ItemCopyMenu item={item} x={0} y={0} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy slug' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy to the clipboard.')
  })
})

describe('useKanbanListPrefs', () => {
  it('loads, persists, and reloads the collapsed groups and the sort per project', () => {
    localStorage.setItem(kanbanCollapsedStorageKey('p1'), JSON.stringify(['s1']))
    const { result } = renderHook(() => useKanbanListPrefs('p1'))
    expect([...result.current.collapsedStates]).toEqual(['s1'])
    expect(result.current.sortState).toEqual(DEFAULT_KANBAN_SORT)

    act(() => {
      result.current.onToggleCollapse('s1')
      result.current.onSortByChange('priority')
      result.current.onToggleSortDirection()
    })
    expect(result.current.collapsedStates.size).toBe(0)
    expect(localStorage.getItem(kanbanCollapsedStorageKey('p1'))).toBeNull()
    expect(result.current.sortState).toEqual({ sortBy: 'priority', direction: 'desc' })
    expect(JSON.parse(localStorage.getItem(kanbanSortStorageKey('p1')) ?? '')).toEqual({
      sortBy: 'priority',
      direction: 'desc',
    })

    localStorage.setItem(kanbanCollapsedStorageKey('p2'), JSON.stringify(['s2']))
    act(() => {
      result.current.reload('p2')
    })
    expect([...result.current.collapsedStates]).toEqual(['s2'])
    expect(result.current.sortState).toEqual(DEFAULT_KANBAN_SORT)
  })
})
