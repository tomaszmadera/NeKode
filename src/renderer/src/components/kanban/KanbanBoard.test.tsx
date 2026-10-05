import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { boardColumns, KanbanBoard } from './KanbanBoard'

// Read-only board surface (spec kanban-adapter-interface Behaviour 14, AC14):
// list view (the default) and board columns in adapter order, item review, and
// every inline state (loading, ready columns, empty board, typed error,
// not-configured with a working Configure callback), plus the icon controls
// (view switch + refresh) re-running the load.

afterEach(cleanup)

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
