import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
  boardColumns,
  compareRefs,
  DEFAULT_KANBAN_SORT,
  KanbanBoard,
  kanbanCollapsedStorageKey,
  kanbanSortStorageKey,
  parseCollapsedStateIds,
  parseKanbanSort,
  reconcileBoard,
  sortWorkItems,
} from './KanbanBoard'
import { KanbanSessions } from './KanbanSessions'

// Read-only board surface (spec kanban-adapter-interface Behaviour 14, AC14):
// list view (the default) and board columns in adapter order, item review, and
// every inline state (loading, ready columns, empty board, typed error,
// not-configured with a working Configure callback), plus the icon controls
// (view switch + refresh) re-running the load.

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function item(ref: string, title: string, stateId: string): WorkItem {
  return {
    ref,
    id: `id-${ref}`,
    title,
    description: null,
    stateId,
    stateName: stateId,
    stateGroup: 'backlog',
    priority: null,
    assignee: null,
    url: null,
    updatedAt: null,
  }
}

const fixture: KanbanBoardData = {
  states: [
    { id: 's2', name: 'In Progress', group: 'started', order: 2 },
    { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
    { id: 's3', name: 'Done', group: 'completed', order: 3 },
  ],
  items: [
    item('NK-1', 'First task', 's1'),
    item('NK-3', 'Third task', 's1'),
    item('NK-2', 'Second task', 's2'),
  ],
}

describe('cached background refresh', () => {
  it('reuses unchanged item and state objects while applying updates and order', () => {
    const next = structuredClone(fixture)
    next.items.reverse()
    next.items[0].title = 'Changed'
    const result = reconcileBoard(fixture, next)
    expect(result.states[0]).toBe(fixture.states[0])
    expect(result.items[2]).toBe(fixture.items[0])
    expect(result.items[0]).not.toBe(fixture.items[2])
    expect(result.items[0].title).toBe('Changed')
  })

  it('deduplicates activation while the first request is pending and preserves an empty snapshot on failure', async () => {
    const pending = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'timeout', message: 'Timed out' })
    const app = appWith(listBoard)
    const onConfigure = vi.fn()
    const ui = render(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active />)
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active={false} />)
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active />)
    expect(listBoard).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ states: [], items: [] }))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect((await screen.findByRole('alert')).textContent).toBe('Timed out')
    expect(screen.getByTestId(TEST_ID.kanbanBoardEmpty)).toBeTruthy()
  })

  it('disposes removed and invalidated sessions and excludes their late responses', async () => {
    const old = deferred<KanbanBoardData>()
    const fresh = deferred<KanbanBoardData>()
    const removed = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockReturnValueOnce(removed.promise)
      .mockResolvedValueOnce({ states: [], items: [] })
    const app = appWith(listBoard)
    const onConfigure = vi.fn()
    const ui = render(
      <KanbanSessions
        app={app}
        projectIds={new Set(['p1'])}
        activeProjectId="p1"
        versions={{}}
        onConfigure={onConfigure}
      />,
    )
    ui.rerender(
      <KanbanSessions
        app={app}
        projectIds={new Set(['p1'])}
        activeProjectId="p1"
        versions={{ p1: 1 }}
        onConfigure={onConfigure}
      />,
    )
    await act(async () => old.resolve(fixture))
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    await act(async () => fresh.resolve({ ...fixture, items: [item('NEW', 'New binding', 's1')] }))
    expect(screen.getByTestId(testIdFor.kanbanItem('NEW'))).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    ui.rerender(
      <KanbanSessions
        app={app}
        projectIds={new Set()}
        activeProjectId={null}
        versions={{ p1: 1 }}
        onConfigure={onConfigure}
      />,
    )
    await act(async () => removed.resolve(fixture))
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()
    ui.rerender(
      <KanbanSessions
        app={app}
        projectIds={new Set(['p1'])}
        activeProjectId="p1"
        versions={{ p1: 1 }}
        onConfigure={onConfigure}
      />,
    )
    await screen.findByTestId(TEST_ID.kanbanBoardEmpty)
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(listBoard).toHaveBeenCalledTimes(4)
  })
  it('keeps content, DOM identity, view and scroll while reactivating and reconciling snapshots', async () => {
    const pending = deferred<KanbanBoardData>()
    const listBoard = vi.fn().mockResolvedValueOnce(fixture).mockReturnValueOnce(pending.promise)
    const app = appWith(listBoard)
    const onConfigure = vi.fn()
    const ui = render(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active />)
    await switchToBoard()
    const unchanged = screen.getByTestId(testIdFor.kanbanItem('NK-1'))
    const root = screen.getByTestId(TEST_ID.kanbanBoard)
    root.scrollTop = 180
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active={false} />)
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active />)
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBe(unchanged)
    expect(screen.getByRole('status').textContent).toBe('Refreshing board...')
    expect(root.scrollTop).toBe(180)
    expect(screen.getByTestId(TEST_ID.kanbanViewBoard).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    await act(async () =>
      pending.resolve({
        states: fixture.states.map((s) =>
          s.id === 's2' ? { ...s, order: 0, name: 'Working' } : s,
        ),
        items: [
          item('NK-9', 'New task', 's1'),
          fixture.items[0],
          { ...fixture.items[2], title: 'Moved task', stateId: 's1' },
        ],
      }),
    )
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-3'))).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBe(unchanged)
    const backlog = screen.getByTestId(testIdFor.kanbanColumn('s1'))
    expect(
      within(backlog)
        .getAllByRole('button')
        .map((b) => b.dataset.testid),
    ).toEqual(['kanban-item-NK-9', 'kanban-item-NK-1', 'kanban-item-NK-2'])
    expect(screen.getAllByTestId(/^kanban-column-/)[0].textContent).toBe('Working')
    expect(root.scrollTop).toBe(180)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('retains and updates review, keeps cached data after failure, retries and closes a removed review', async () => {
    const pending = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(fixture)
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'network', message: 'Offline' })
      .mockResolvedValueOnce({ ...fixture, items: [] })
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-1')))
    const review = screen.getByTestId(TEST_ID.kanbanReview)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    await act(async () =>
      pending.resolve({
        ...fixture,
        items: fixture.items.map((i) =>
          i.ref === 'NK-1' ? { ...i, title: 'Edited', description: 'New description' } : i,
        ),
      }),
    )
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Edited')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect((await screen.findByRole('alert')).textContent).toBe('Offline')
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull())
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
    expect(listBoard).toHaveBeenCalledTimes(4)
  })

  it.each(['validation', 'not_found'])('clears cached data on binding error %s', async (code) => {
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(fixture)
      .mockRejectedValueOnce({ nekodeAppError: true, code, message: 'Binding unavailable' })
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull())
    expect(screen.queryByRole('status')).toBeNull()
  })
})

function appWith(listBoard: AppApi['kanban']['listBoard']): AppApi {
  return { kanban: { listBoard } } as unknown as AppApi
}

/**
 * The surface opens on the List view (user request 2026-10-05), so the column
 * tests switch to Board explicitly — which also proves the switch works.
 */
async function switchToBoard(): Promise<void> {
  fireEvent.click(await screen.findByTestId(TEST_ID.kanbanViewBoard))
}

describe('kanban board — columns (spec Behaviour 14, AC14)', () => {
  it('orders columns by the adapter order key and lists item titles underneath', async () => {
    const listBoard = vi.fn().mockResolvedValue(fixture)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await switchToBoard()

    const backlog = await screen.findByTestId(testIdFor.kanbanColumn('s1'))
    // Columns follow the adapter `order` (s1=1, s2=2, s3=3), not the array order.
    const columnIds = screen
      .getAllByTestId(/^kanban-column-/)
      .map((element) => element.getAttribute('data-testid'))
    expect(columnIds).toEqual([
      testIdFor.kanbanColumn('s1'),
      testIdFor.kanbanColumn('s2'),
      testIdFor.kanbanColumn('s3'),
    ])
    // State name is the heading; the item titles sit underneath.
    expect(within(backlog).getByText('Backlog')).toBeTruthy()
    expect(within(backlog).getByTestId(testIdFor.kanbanItem('NK-1')).textContent).toContain(
      'First task',
    )
    expect(within(backlog).getByTestId(testIdFor.kanbanItem('NK-3')).textContent).toContain(
      'Third task',
    )
    // Items are grouped by their state, never leaked into another column.
    const started = screen.getByTestId(testIdFor.kanbanColumn('s2'))
    expect(within(started).getByTestId(testIdFor.kanbanItem('NK-2')).textContent).toContain(
      'Second task',
    )
    expect(within(started).queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(listBoard).toHaveBeenCalledTimes(1)
  })

  it('boardColumns groups items by state id, keeping the adapter item order', () => {
    const columns = boardColumns(fixture)
    expect(columns.map((column) => column.name)).toEqual(['Backlog', 'In Progress', 'Done'])
    expect(columns[0].items.map((entry) => entry.ref)).toEqual(['NK-1', 'NK-3'])
    expect(columns[2].items).toEqual([])
  })

  // The spec fixes the WorkItem/KanbanState shapes independently and Stage 1
  // normalization never cross-checks an item's stateId against the state ids,
  // so an unmatched state id is possible. Such items must not be dropped.
  it('boardColumns keeps every item: an unmatched stateId gets a trailing column labelled from the item', () => {
    const columns = boardColumns({
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [
        item('NK-1', 'Known task', 's1'),
        { ...item('NK-2', 'Orphan one', 'sx'), stateName: 'Ghost state' },
        item('NK-3', 'Orphan two', 'sx'),
      ],
    })
    // Matched column first, unmatched trailing; label from the item's stateName.
    expect(columns.map((column) => column.name)).toEqual(['Backlog', 'Ghost state'])
    expect(columns[1].stateId).toBe('sx')
    expect(columns[1].items.map((entry) => entry.ref)).toEqual(['NK-2', 'NK-3'])
    // Nothing is dropped: every item appears in exactly one column.
    expect(
      columns
        .flatMap((column) => column.items)
        .map((entry) => entry.ref)
        .sort(),
    ).toEqual(['NK-1', 'NK-2', 'NK-3'])
  })

  it('renders unmatched-state items in a trailing column instead of dropping them', async () => {
    const listBoard = vi.fn().mockResolvedValue({
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [
        item('NK-1', 'Known task', 's1'),
        { ...item('NK-2', 'Orphan task', 'sx'), stateName: 'Ghost state' },
      ],
    } satisfies KanbanBoardData)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await switchToBoard()

    const orphan = await screen.findByTestId(testIdFor.kanbanColumn('sx'))
    expect(within(orphan).getByText('Ghost state')).toBeTruthy()
    expect(within(orphan).getByTestId(testIdFor.kanbanItem('NK-2')).textContent).toContain(
      'Orphan task',
    )
    // The unmatched column trails the adapter-ordered states.
    expect(
      screen
        .getAllByTestId(/^kanban-column-/)
        .map((element) => element.getAttribute('data-testid')),
    ).toEqual([testIdFor.kanbanColumn('s1'), testIdFor.kanbanColumn('sx')])
  })

  it('does not treat a board with items but no states as empty', async () => {
    const listBoard = vi.fn().mockResolvedValue({
      states: [],
      items: [{ ...item('NK-9', 'Orphan', 'sx'), stateName: 'Ghost state' }],
    } satisfies KanbanBoardData)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await switchToBoard()

    expect(await screen.findByTestId(testIdFor.kanbanColumn('sx'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanBoardEmpty)).toBeNull()
  })
})

describe('kanban board — view switch (spec Behaviour 14, AC14)', () => {
  it('opens on the List view, with an icon switch and icon refresh on the right', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )

    // List is the default: the grouped list renders, no column does.
    expect((await screen.findByTestId(TEST_ID.kanbanViewList)).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByTestId(TEST_ID.kanbanViewBoard).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.kanbanColumn('s1'))).toBeNull()

    // Icon-only controls carry accessible names (UX-UI §63) and sit after the
    // title, i.e. on the header's right side.
    const title = screen.getByRole('heading', { name: 'Kanban' })
    for (const name of ['Board view', 'List view', 'Refresh']) {
      const control = screen.getByLabelText(name)
      expect(control.tagName).toBe('BUTTON')
      expect(control.textContent).toBe('')
      expect(title.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // The switch reads List then Board: the default view's icon comes first.
    expect(
      screen
        .getByTestId(TEST_ID.kanbanViewList)
        .compareDocumentPosition(screen.getByTestId(TEST_ID.kanbanViewBoard)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // Choosing Board swaps the arrangement, and the switch shows the choice.
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewBoard))
    expect(await screen.findByTestId(testIdFor.kanbanColumn('s1'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanList)).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanViewBoard).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(TEST_ID.kanbanViewList).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('kanban board — inline states (spec Behaviour 14, AC14)', () => {
  it('shows the loading state until the load resolves', () => {
    // A load that never settles keeps the surface in its loading phase.
    const listBoard = vi.fn().mockReturnValue(new Promise<KanbanBoardData>(() => undefined))
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    expect(screen.getByTestId(TEST_ID.kanbanBoardLoading)).toBeTruthy()
  })

  it('shows the empty-board state when the adapter returns no states', async () => {
    const listBoard = vi.fn().mockResolvedValue({ states: [], items: [] })
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    expect(await screen.findByTestId(TEST_ID.kanbanBoardEmpty)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanBoardUnconfigured)).toBeNull()
  })

  it('shows a typed error inline (never a toast or a Configure button)', async () => {
    const listBoard = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'network',
      message: 'Backend unreachable.',
    })
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    const error = await screen.findByTestId(TEST_ID.kanbanBoardError)
    expect(error.textContent).toContain('Backend unreachable.')
    expect(error.getAttribute('role')).toBe('alert')
    expect(screen.queryByTestId(TEST_ID.kanbanBoardConfigure)).toBeNull()
  })

  it('treats the unconfigured validation error as the not-configured state with a Configure button', async () => {
    const listBoard = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'No Kanban adapter is configured for project "p1".',
    })
    const onConfigure = vi.fn()
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={onConfigure} />)
    expect(await screen.findByTestId(TEST_ID.kanbanBoardUnconfigured)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanBoardError)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardConfigure))
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })
})

describe('kanban board — load count and refresh (spec Behaviour 14, AC14)', () => {
  it('loads exactly once on mount and does not re-fire on re-render', async () => {
    const listBoard = vi.fn().mockResolvedValue(fixture)
    const app = appWith(listBoard)
    const view = render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await switchToBoard()
    await screen.findByTestId(testIdFor.kanbanColumn('s1'))
    expect(listBoard).toHaveBeenCalledTimes(1)
    view.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await waitFor(() => expect(listBoard).toHaveBeenCalledTimes(1))
  })

  it('re-runs the load when the refresh control is used', async () => {
    const changed: KanbanBoardData = {
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [item('NK-9', 'Refreshed task', 's1')],
    }
    const listBoard = vi.fn().mockResolvedValueOnce(fixture).mockResolvedValueOnce(changed)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await switchToBoard()
    await screen.findByTestId(testIdFor.kanbanColumn('s1'))

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(await screen.findByTestId(testIdFor.kanbanItem('NK-9'))).toBeTruthy()
    expect(listBoard).toHaveBeenCalledTimes(2)
    // The stale column content is gone with the refreshed board.
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-2'))).toBeNull()
  })
})

const longTitle = 'Write the migration notes for the session scroll fix and keep every word'

function richBoard(): KanbanBoardData {
  return {
    states: [
      { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
      { id: 's2', name: 'Done', group: 'completed', order: 2 },
    ],
    items: [
      {
        ...item('NK-1', longTitle, 's1'),
        description: 'Line one\n\nLine two',
        priority: 'high',
        stateName: 'Backlog',
      },
      {
        ...item('NK-2', 'Second task', 's1'),
        description: null,
        priority: null,
        stateName: 'Backlog',
      },
    ],
  }
}

describe('kanban board: list view and item review (spec Behaviour 14, AC14)', () => {
  it('shows the ref, a truncated title, and the priority on the list and the board', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )

    // List is the default view (user request 2026-10-05).
    await screen.findByTestId(TEST_ID.kanbanViewList)
    const groups = screen
      .getAllByTestId(/^kanban-list-group-/)
      .map((element) => element.getAttribute('data-testid'))
    expect(groups).toEqual([testIdFor.kanbanListGroup('s1'), testIdFor.kanbanListGroup('s2')])
    const row = within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).getByTestId(
      testIdFor.kanbanItem('NK-1'),
    )
    expect(row.textContent).toContain('NK-1')
    expect(row.textContent).toContain('High')
    expect(within(row).getByText(longTitle).className).toContain('truncate')
    const blank = within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).getByTestId(
      testIdFor.kanbanItem('NK-2'),
    )
    expect(within(blank).getByText('None')).toBeTruthy()

    // The board shows the same fields on its cards.
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewBoard))
    const card = await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    expect(card.textContent).toContain('NK-1')
    expect(card.textContent).toContain('High')
    expect(within(card).getByText(longTitle).className).toContain('truncate')
  })

  it('opens a review with the full title and the description, then Back returns to the list', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-1')))

    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const title = within(review).getByTestId(TEST_ID.kanbanReviewTitle)
    expect(title.textContent).toBe(longTitle)
    expect(title.className).not.toContain('truncate')
    expect(review.textContent).toContain('NK-1')
    expect(review.textContent).toContain('High')
    expect(review.textContent).toContain('Backlog')
    expect(within(review).getByTestId(TEST_ID.kanbanReviewDescription).textContent).toBe(
      'Line one\n\nLine two',
    )
    expect(screen.queryByTestId(TEST_ID.kanbanList)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.kanbanColumn('s1'))).toBeNull()
  })

  it('says there is no description when the item has none', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-2')))
    expect(await screen.findByTestId(TEST_ID.kanbanReviewDescription)).toHaveProperty(
      'textContent',
      'No description.',
    )
  })

  it('leaves the review for the view that was chosen', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-1')))
    await screen.findByTestId(TEST_ID.kanbanReview)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewBoard))
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanColumn('s1'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanList)).toBeNull()
  })

  it('closes the review when a refresh drops the open item', async () => {
    const kept = richBoard()
    const dropped: KanbanBoardData = {
      states: kept.states,
      items: [kept.items[1]],
    }
    const listBoard = vi.fn().mockResolvedValueOnce(kept).mockResolvedValueOnce(dropped)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-1')))
    await screen.findByTestId(TEST_ID.kanbanReview)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(await screen.findByTestId(testIdFor.kanbanItem('NK-2'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(listBoard).toHaveBeenCalledTimes(2)
  })

  it('keeps the review open when a refresh still includes that item', async () => {
    const listBoard = vi.fn().mockResolvedValue(richBoard())
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItem('NK-1')))
    await screen.findByTestId(TEST_ID.kanbanReview)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(await screen.findByTestId(TEST_ID.kanbanReviewTitle)).toHaveProperty(
      'textContent',
      longTitle,
    )
    expect(listBoard).toHaveBeenCalledTimes(2)
  })
})

describe('kanban list — collapsible status sections', () => {
  it('toggles collapse and expand on list section headers, updating aria-expanded and hiding items', async () => {
    const listBoard = vi.fn().mockResolvedValue(fixture)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    // Wait for list to render
    const toggleS1 = await screen.findByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(toggleS1.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBeTruthy()
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-3'))).toBeTruthy()

    // Collapse section s1
    fireEvent.click(toggleS1)
    expect(toggleS1.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-3'))).toBeNull()
    // Section s2 is still expanded
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-2'))).toBeTruthy()

    // Expand section s1 back
    fireEvent.click(toggleS1)
    expect(toggleS1.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBeTruthy()
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-3'))).toBeTruthy()
  })

  it('persists collapsed state in localStorage and restores it on remount', async () => {
    const listBoard = vi.fn().mockResolvedValue(fixture)
    const { unmount } = render(
      <KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />,
    )

    const toggleS1 = await screen.findByTestId(testIdFor.kanbanGroupToggle('s1'))
    fireEvent.click(toggleS1)

    // Check localStorage
    const saved = localStorage.getItem(kanbanCollapsedStorageKey('p1'))
    expect(saved).not.toBeNull()
    expect(JSON.parse(saved as string)).toContain('s1')

    unmount()

    // Remount - s1 should start collapsed
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    const newToggleS1 = await screen.findByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(newToggleS1.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()

    // Expanding it clears the collapsed state from storage
    fireEvent.click(newToggleS1)
    expect(newToggleS1.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBeTruthy()
    expect(localStorage.getItem(kanbanCollapsedStorageKey('p1'))).toBeNull()
  })

  it('isolates collapsed states between different projects', async () => {
    localStorage.setItem(kanbanCollapsedStorageKey('p1'), JSON.stringify(['s1']))

    const listBoard = vi.fn().mockResolvedValue(fixture)
    const ui = render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    // For p1, s1 is collapsed
    const toggleP1 = await screen.findByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(toggleP1.getAttribute('aria-expanded')).toBe('false')

    ui.unmount()

    // For p2, s1 is not collapsed
    render(<KanbanBoard app={appWith(listBoard)} projectId="p2" onConfigure={vi.fn()} />)
    const toggleP2 = await screen.findByTestId(testIdFor.kanbanGroupToggle('s1'))
    expect(toggleP2.getAttribute('aria-expanded')).toBe('true')
  })

  it('parses collapsed state ids safely', () => {
    expect(parseCollapsedStateIds(null)).toEqual(new Set())
    expect(parseCollapsedStateIds('')).toEqual(new Set())
    expect(parseCollapsedStateIds('not-json')).toEqual(new Set())
    expect(parseCollapsedStateIds('{"not": "array"}')).toEqual(new Set())
    expect(parseCollapsedStateIds('["s1", 123]')).toEqual(new Set())
    expect(parseCollapsedStateIds('["s1", "s2"]')).toEqual(new Set(['s1', 's2']))
  })
})

describe('kanban list — sorting items', () => {
  const unsortedItems: WorkItem[] = [
    { ...item('NK-10', 'Task 10', 's1'), priority: 'low' },
    { ...item('NK-2', 'Task 2', 's1'), priority: 'urgent' },
    { ...item('NK-1', 'Task 1', 's1'), priority: null },
    { ...item('NK-3', 'Task 3', 's1'), priority: 'urgent' },
    { ...item('NK-5', 'Task 5', 's1'), priority: 'high' },
    { ...item('NK-4', 'Task 4', 's1'), priority: 'medium' },
  ]

  it('natural sort orders task slugs correctly', () => {
    expect(compareRefs('NK-2', 'NK-10')).toBeLessThan(0)
    expect(compareRefs('NK-10', 'NK-2')).toBeGreaterThan(0)
    expect(compareRefs('NK-1', 'NK-1')).toBe(0)
  })

  it('sorts by slug ascending by default (natural numerical order)', () => {
    const sorted = sortWorkItems(unsortedItems, 'slug', 'asc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-1', 'NK-2', 'NK-3', 'NK-4', 'NK-5', 'NK-10'])
  })

  it('sorts by slug descending when direction is desc', () => {
    const sorted = sortWorkItems(unsortedItems, 'slug', 'desc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-10', 'NK-5', 'NK-4', 'NK-3', 'NK-2', 'NK-1'])
  })

  it('sorts by priority ascending (urgent -> high -> medium -> low -> none) with secondary slug', () => {
    const sorted = sortWorkItems(unsortedItems, 'priority', 'asc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-2', 'NK-3', 'NK-5', 'NK-4', 'NK-10', 'NK-1'])
    expect(sorted.map((i) => i.priority)).toEqual([
      'urgent',
      'urgent',
      'high',
      'medium',
      'low',
      null,
    ])
  })

  it('sorts by priority descending (none -> low -> medium -> high -> urgent) with secondary slug reversed', () => {
    const sorted = sortWorkItems(unsortedItems, 'priority', 'desc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-1', 'NK-10', 'NK-4', 'NK-5', 'NK-3', 'NK-2'])
    expect(sorted.map((i) => i.priority)).toEqual([
      null,
      'low',
      'medium',
      'high',
      'urgent',
      'urgent',
    ])
  })

  it('parses stored kanban sort settings safely', () => {
    expect(parseKanbanSort(null)).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort('')).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort('not-json')).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort(JSON.stringify({ sortBy: 'priority', direction: 'desc' }))).toEqual({
      sortBy: 'priority',
      direction: 'desc',
    })
    expect(parseKanbanSort(JSON.stringify({ sortBy: 'unknown', direction: 'invalid' }))).toEqual({
      sortBy: 'slug',
      direction: 'asc',
    })
  })

  it('renders sort controls in header on list view and re-sorts on user interaction', async () => {
    const boardWithUnsorted: KanbanBoardData = {
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [
        { ...item('NK-10', 'Task 10', 's1'), priority: 'low' },
        { ...item('NK-2', 'Task 2', 's1'), priority: 'urgent' },
        { ...item('NK-1', 'Task 1', 's1'), priority: null },
      ],
    }

    const listBoard = vi.fn().mockResolvedValue(boardWithUnsorted)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    await screen.findByTestId(TEST_ID.kanbanList)

    const sortSelect = screen.getByTestId<HTMLSelectElement>(TEST_ID.kanbanSortBy)
    const directionBtn = screen.getByTestId(TEST_ID.kanbanSortDirection)
    expect(sortSelect.value).toBe('slug')
    expect(within(sortSelect).getByRole('option', { name: 'Slug' })).toBeTruthy()
    expect(within(sortSelect).getByRole('option', { name: 'Priority' })).toBeTruthy()
    expect(directionBtn.getAttribute('aria-label')).toBe('Sort ascending')

    const s1Group = screen.getByTestId(testIdFor.kanbanListGroup('s1'))
    let itemRefs = within(s1Group)
      .getAllByRole('button')
      .slice(1)
      .map((btn) => btn.getAttribute('data-testid'))
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-1'),
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-10'),
    ])

    fireEvent.click(directionBtn)
    expect(directionBtn.getAttribute('aria-label')).toBe('Sort descending')
    itemRefs = within(s1Group)
      .getAllByRole('button')
      .slice(1)
      .map((btn) => btn.getAttribute('data-testid'))
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-10'),
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-1'),
    ])

    fireEvent.change(sortSelect, { target: { value: 'priority' } })
    expect(sortSelect.value).toBe('priority')
    itemRefs = within(s1Group)
      .getAllByRole('button')
      .slice(1)
      .map((btn) => btn.getAttribute('data-testid'))
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-1'),
      testIdFor.kanbanItem('NK-10'),
      testIdFor.kanbanItem('NK-2'),
    ])

    fireEvent.click(directionBtn)
    expect(directionBtn.getAttribute('aria-label')).toBe('Sort ascending')
    itemRefs = within(s1Group)
      .getAllByRole('button')
      .slice(1)
      .map((btn) => btn.getAttribute('data-testid'))
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-10'),
      testIdFor.kanbanItem('NK-1'),
    ])
  })

  it('persists sort settings to localStorage and restores on remount', async () => {
    const boardWithUnsorted: KanbanBoardData = {
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [
        { ...item('NK-10', 'Task 10', 's1'), priority: 'low' },
        { ...item('NK-2', 'Task 2', 's1'), priority: 'urgent' },
      ],
    }

    const listBoard = vi.fn().mockResolvedValue(boardWithUnsorted)
    const { unmount } = render(
      <KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />,
    )

    const sortSelect = await screen.findByTestId<HTMLSelectElement>(TEST_ID.kanbanSortBy)
    const directionBtn = screen.getByTestId(TEST_ID.kanbanSortDirection)

    fireEvent.change(sortSelect, { target: { value: 'priority' } })
    fireEvent.click(directionBtn)

    const saved = localStorage.getItem(kanbanSortStorageKey('p1'))
    expect(saved).not.toBeNull()
    expect(JSON.parse(saved as string)).toEqual({ sortBy: 'priority', direction: 'desc' })

    unmount()

    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    const newSelect = await screen.findByTestId<HTMLSelectElement>(TEST_ID.kanbanSortBy)
    const newDirection = screen.getByTestId(TEST_ID.kanbanSortDirection)
    expect(newSelect.value).toBe('priority')
    expect(newDirection.getAttribute('aria-label')).toBe('Sort descending')
  })

  it('hides sort controls when switched to board view or reviewing an item', async () => {
    const listBoard = vi.fn().mockResolvedValue(richBoard())
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    await screen.findByTestId(TEST_ID.kanbanSortBy)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewBoard))
    expect(screen.queryByTestId(TEST_ID.kanbanSortBy)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanSortDirection)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewList))
    expect(screen.getByTestId(TEST_ID.kanbanSortBy)).toBeTruthy()

    fireEvent.click(screen.getByTestId(testIdFor.kanbanItem('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanSortBy)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanSortDirection)).toBeNull()
  })
})
