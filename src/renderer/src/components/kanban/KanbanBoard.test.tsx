import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  KanbanHandoffAvailabilityResult,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { restoreClipboard, stubClipboard } from '../../test/clipboard-stub'
import { kanbanBoardFixture as fixture, kanbanWorkItem as item } from '../../test/kanban-fixtures'
import { KanbanBoard, kanbanCollapsedStorageKey, kanbanSortStorageKey } from './KanbanBoard'
import { KanbanSessions } from './KanbanSessions'

// Read-only board surface (spec kanban-adapter-interface Behaviour 14, AC14):
// the grouped list in adapter order, item review, and every inline state
// (loading, ready groups, empty board, typed error, not-configured with a
// working Configure callback), plus the refresh icon re-running the load.

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

function listedKanbanItemIds(group: HTMLElement): Array<string | null> {
  return within(group)
    .getAllByTestId(/^kanban-item-NK-/)
    .map((element) => element.getAttribute('data-testid'))
}

describe('cached background refresh', () => {
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
    const unchanged = await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    const root = screen.getByTestId(TEST_ID.kanbanBoard)
    root.scrollTop = 180
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active={false} />)
    ui.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={onConfigure} active />)
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBe(unchanged)
    expect(screen.getByRole('status').textContent).toBe('Refreshing board...')
    expect(root.scrollTop).toBe(180)
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
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
    const groups = screen.getAllByTestId(/^kanban-list-group-/)
    expect(groups[0]?.getAttribute('data-testid')).toBe(testIdFor.kanbanListGroup('s2'))
    expect(within(groups[0] as HTMLElement).getByText('Working')).toBeTruthy()
    const backlog = screen.getByTestId(testIdFor.kanbanListGroup('s1'))
    expect(listedKanbanItemIds(backlog)).toEqual([
      testIdFor.kanbanItem('NK-1'),
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-9'),
    ])
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
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
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
  return {
    kanban: {
      listBoard,
      // Available by default so the Resume control renders where the existing
      // tests expect it; availability-specific tests override this mock.
      handoffAvailability: vi.fn(
        async (input: { items: Array<{ itemId: string; ref: string }> }) => ({
          state: 'ready' as const,
          items: input.items.map((entry) => ({ ...entry, available: true })),
          rejections: [],
        }),
      ),
    },
  } as unknown as AppApi
}

describe('kanban board — columns (spec Behaviour 14, AC14)', () => {
  it('orders columns by the adapter order key and lists item titles underneath', async () => {
    const listBoard = vi.fn().mockResolvedValue(fixture)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    const backlog = await screen.findByTestId(testIdFor.kanbanListGroup('s1'))
    // Groups follow the adapter `order` (s1=1, s2=2, s3=3), not the array order.
    const columnIds = screen
      .getAllByTestId(/^kanban-list-group-/)
      .map((element) => element.getAttribute('data-testid'))
    expect(columnIds).toEqual([
      testIdFor.kanbanListGroup('s1'),
      testIdFor.kanbanListGroup('s2'),
      testIdFor.kanbanListGroup('s3'),
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
    const started = screen.getByTestId(testIdFor.kanbanListGroup('s2'))
    expect(within(started).getByTestId(testIdFor.kanbanItem('NK-2')).textContent).toContain(
      'Second task',
    )
    expect(within(started).queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(listBoard).toHaveBeenCalledTimes(1)
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

    const orphan = await screen.findByTestId(testIdFor.kanbanListGroup('sx'))
    expect(within(orphan).getByText('Ghost state')).toBeTruthy()
    expect(within(orphan).getByTestId(testIdFor.kanbanItem('NK-2')).textContent).toContain(
      'Orphan task',
    )
    // The unmatched group trails the adapter-ordered states.
    expect(
      screen
        .getAllByTestId(/^kanban-list-group-/)
        .map((element) => element.getAttribute('data-testid')),
    ).toEqual([testIdFor.kanbanListGroup('s1'), testIdFor.kanbanListGroup('sx')])
  })

  it('does not treat a board with items but no states as empty', async () => {
    const listBoard = vi.fn().mockResolvedValue({
      states: [],
      items: [{ ...item('NK-9', 'Orphan', 'sx'), stateName: 'Ghost state' }],
    } satisfies KanbanBoardData)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    expect(await screen.findByTestId(testIdFor.kanbanListGroup('sx'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanBoardEmpty)).toBeNull()
  })
})

describe('kanban board — header (spec Behaviour 14, AC14)', () => {
  it('opens on the list, with an icon refresh on the right and no board view', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )

    expect(await screen.findByTestId(TEST_ID.kanbanList)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Board view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'List view' })).toBeNull()

    const title = screen.getByRole('heading', { name: 'Kanban' })
    const refresh = screen.getByLabelText('Refresh')
    expect(refresh.tagName).toBe('BUTTON')
    expect(refresh.textContent).toBe('')
    expect(title.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    await screen.findByTestId(testIdFor.kanbanListGroup('s1'))
    expect(listBoard).toHaveBeenCalledTimes(1)
    view.rerender(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await waitFor(() => expect(listBoard).toHaveBeenCalledTimes(1))
  })

  it('invalidates in-flight listBoard and resets board when projectId changes on mounted board', async () => {
    const pendingP1 = deferred<KanbanBoardData>()
    const boardP2: KanbanBoardData = {
      states: [{ id: 's-done', name: 'Done', group: 'completed', order: 1 }],
      items: [
        {
          id: 'i-p2-1',
          ref: 'P2-1',
          title: 'Project 2 Task',
          description: null,
          stateId: 's-done',
          stateName: 'Done',
          stateGroup: 'completed',
          priority: null,
          assignee: null,
          url: null,
          updatedAt: null,
        },
      ],
    }
    const listBoard = vi.fn().mockImplementation((projectId: string) => {
      if (projectId === 'p1') return pendingP1.promise
      if (projectId === 'p2') return Promise.resolve(boardP2)
      return Promise.reject(new Error('Unknown project'))
    })
    const app = appWith(listBoard)
    const ui = render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} active />)
    expect(listBoard).toHaveBeenCalledWith('p1')

    // While listBoard('p1') is in flight, projectId changes to 'p2'
    ui.rerender(<KanbanBoard app={app} projectId="p2" onConfigure={vi.fn()} active />)

    // listBoard should be called for 'p2' (not swallowed by pending guard!)
    await waitFor(() => expect(listBoard).toHaveBeenCalledWith('p2'))

    // Now resolve the old p1 load
    const boardP1: KanbanBoardData = {
      states: [{ id: 's-todo', name: 'Todo', group: 'unstarted', order: 1 }],
      items: [
        {
          id: 'i-p1-1',
          ref: 'P1-1',
          title: 'Project 1 Task',
          description: null,
          stateId: 's-todo',
          stateName: 'Todo',
          stateGroup: 'unstarted',
          priority: null,
          assignee: null,
          url: null,
          updatedAt: null,
        },
      ],
    }
    await act(async () => pendingP1.resolve(boardP1))

    // The component should display P2's board and NOT P1's board
    await screen.findByTestId(testIdFor.kanbanItem('P2-1'))
    expect(screen.queryByTestId(testIdFor.kanbanItem('P1-1'))).toBeNull()
  })

  it('re-runs the load when the refresh control is used', async () => {
    const changed: KanbanBoardData = {
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [item('NK-9', 'Refreshed task', 's1')],
    }
    const listBoard = vi.fn().mockResolvedValueOnce(fixture).mockResolvedValueOnce(changed)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByTestId(testIdFor.kanbanListGroup('s1'))

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(await screen.findByTestId(testIdFor.kanbanItem('NK-9'))).toBeTruthy()
    expect(listBoard).toHaveBeenCalledTimes(2)
    // The stale column content is gone with the refreshed board.
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-2'))).toBeNull()
  })
})

const longTitle = 'Write the migration notes for the session scroll fix and keep every word'

function copyBoard(): KanbanBoardData {
  return {
    states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
    items: [
      { ...item('NK-1', 'First task', 's1'), url: ' https://plane.example/NK-1 ' },
      { ...item('NK-2', 'Second task', 's1'), url: null },
      { ...item('NK-3', 'Third task', 's1'), url: '   ' },
    ],
  }
}

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
  it('shows separate slug and title columns with the priority label and no inline editor', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )

    await screen.findByTestId(TEST_ID.kanbanList)
    const groups = screen
      .getAllByTestId(/^kanban-list-group-/)
      .map((element) => element.getAttribute('data-testid'))
    expect(groups).toEqual([testIdFor.kanbanListGroup('s1'), testIdFor.kanbanListGroup('s2')])
    const row = within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).getByTestId(
      testIdFor.kanbanItem('NK-1'),
    )
    const slug = within(row).getByTestId(testIdFor.kanbanItemRef('NK-1'))
    const title = within(row).getByTestId(testIdFor.kanbanItemTitle('NK-1'))
    // Column separation: the slug and the title are their own cells with their
    // own text, and no separate link element carries either.
    expect(slug.textContent).toBe('NK-1')
    expect(title.textContent).toBe(longTitle)
    expect(within(row).queryByTestId('kanban-item-link-NK-1')).toBeNull()
    // The priority label sits beside the title text, never inside it; the row
    // carries no inline status editor.
    expect(title.textContent).not.toContain('High')
    expect(within(row).getByText('High')).toBeTruthy()
    expect(within(row).queryByRole('combobox')).toBeNull()
    const blank = within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).getByTestId(
      testIdFor.kanbanItem('NK-2'),
    )
    expect(within(blank).getByText('None')).toBeTruthy()
    expect(within(blank).getByTestId(testIdFor.kanbanItemRef('NK-2')).textContent).toBe('NK-2')
    expect(within(blank).getByTestId(testIdFor.kanbanItemTitle('NK-2')).textContent).toBe(
      'Second task',
    )
  })

  it('opens a review with the full title and the description, then Back returns to the list', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))

    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const title = within(review).getByTestId(TEST_ID.kanbanReviewTitle)
    const priority = within(review).getByTestId(TEST_ID.kanbanReviewPriority)
    const status = within(review).getByTestId(TEST_ID.kanbanReviewStatus)
    const columns = title.parentElement?.parentElement
    // Full review content: the whole title, the description verbatim, and the
    // ref, priority and status.
    expect(title.textContent).toBe(longTitle)
    // Column separation: the title column holds the title; the controls column
    // holds the priority and status controls.
    expect(columns?.children[0]?.contains(title)).toBe(true)
    expect(columns?.children[1]?.contains(priority)).toBe(true)
    expect(columns?.children[1]?.contains(status)).toBe(true)
    expect(columns?.children[0]?.contains(priority)).toBe(false)
    const back = screen.getByTestId(TEST_ID.kanbanReviewBack)
    expect(back.textContent).toBe('Back')
    expect(review.textContent).toContain('NK-1')
    expect(review.textContent).toContain('High')
    expect(review.textContent).toContain('Backlog')
    expect(within(review).getByTestId(TEST_ID.kanbanReviewDescription).textContent).toBe(
      'Line one\n\nLine two',
    )
    expect(screen.queryByTestId(TEST_ID.kanbanList)).toBeNull()

    fireEvent.click(back)
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
    expect(screen.queryByTestId(/^kanban-column-/)).toBeNull()
  })

  it('says there is no description when the item has none', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-2')))
    expect(await screen.findByTestId(TEST_ID.kanbanReviewDescription)).toHaveProperty(
      'textContent',
      'No description.',
    )
  })

  it('closes the review when a refresh drops the open item', async () => {
    const kept = richBoard()
    const dropped: KanbanBoardData = {
      states: kept.states,
      items: [kept.items[1]],
    }
    const listBoard = vi.fn().mockResolvedValueOnce(kept).mockResolvedValueOnce(dropped)
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
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
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
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
})

describe('kanban list — sorting items', () => {
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
    let itemRefs = listedKanbanItemIds(s1Group)
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-1'),
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-10'),
    ])

    fireEvent.click(directionBtn)
    expect(directionBtn.getAttribute('aria-label')).toBe('Sort descending')
    itemRefs = listedKanbanItemIds(s1Group)
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-10'),
      testIdFor.kanbanItem('NK-2'),
      testIdFor.kanbanItem('NK-1'),
    ])

    fireEvent.change(sortSelect, { target: { value: 'priority' } })
    expect(sortSelect.value).toBe('priority')
    itemRefs = listedKanbanItemIds(s1Group)
    expect(itemRefs).toEqual([
      testIdFor.kanbanItem('NK-1'),
      testIdFor.kanbanItem('NK-10'),
      testIdFor.kanbanItem('NK-2'),
    ])

    fireEvent.click(directionBtn)
    expect(directionBtn.getAttribute('aria-label')).toBe('Sort ascending')
    itemRefs = listedKanbanItemIds(s1Group)
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

  it('hides sort controls while reviewing an item', async () => {
    const listBoard = vi.fn().mockResolvedValue(richBoard())
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)

    await screen.findByTestId(TEST_ID.kanbanSortBy)

    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanSortBy)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanSortDirection)).toBeNull()
  })
})

describe('kanban work item controls (task launch navigation)', () => {
  it('opens the review only from the link, by click, Enter, and Space', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )

    const row = await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    expect(within(row).getByTestId(testIdFor.kanbanItemStart('NK-1')).textContent).toBe('Start')
    expect((await within(row).findByTestId(testIdFor.kanbanItemResume('NK-1'))).textContent).toBe(
      'Resume',
    )

    const link = within(row).getByTestId(testIdFor.kanbanItemTitle('NK-1'))
    const slug = within(row).getByTestId(testIdFor.kanbanItemRef('NK-1'))
    const start = within(row).getByTestId(testIdFor.kanbanItemStart('NK-1'))
    const resume = await within(row).findByTestId(testIdFor.kanbanItemResume('NK-1'))
    // Start stays blocked while the item has a Resume.
    expect(start.hasAttribute('disabled')).toBe(true)
    // Submit guard re-pin: the row controls must carry type="button" so they
    // cannot trigger an accidental form submit.
    for (const control of [start, resume]) {
      expect(control.getAttribute('type')).toBe('button')
    }
    // The review-open controls are buttons and each one is reachable by focus.
    const buttons = within(row).getAllByRole('button')
    for (const control of [slug, link, resume]) {
      expect(buttons).toContain(control)
      control.focus()
      expect(document.activeElement).toBe(control)
    }

    fireEvent.click(row)
    fireEvent.click(within(row).getByText('High'))
    start.focus()
    fireEvent.keyDown(start, { key: 'Enter' })
    fireEvent.keyDown(start, { key: ' ' })
    fireEvent.click(start)
    resume.focus()
    fireEvent.keyDown(resume, { key: 'Enter' })
    fireEvent.keyDown(resume, { key: ' ' })
    fireEvent.click(resume)
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    link.focus()
    fireEvent.keyDown(link, { key: 'Enter' })
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(longTitle)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))

    const spaced = screen.getByTestId(testIdFor.kanbanItemTitle('NK-1'))
    spaced.focus()
    fireEvent.keyDown(spaced, { key: ' ' })
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))

    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))

    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemRef('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
  })

  it('asks the host to open Resume and blocks Start when Resume exists', async () => {
    const onStart = vi.fn()
    const onResume = vi.fn()
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
        onStart={onStart}
        onResume={onResume}
      />,
    )
    const start = await screen.findByTestId(testIdFor.kanbanItemStart('NK-1'))
    await screen.findByTestId(testIdFor.kanbanItemResume('NK-1'))
    fireEvent.click(start)
    expect(onStart).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemResume('NK-1')))
    expect(onStart).not.toHaveBeenCalled()
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume.mock.calls[0]?.[0].ref).toBe('NK-1')
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
  })

  it('leaves Resume inert when the host wires no handler', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemResume('NK-1')))
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('kanban item copy menu', () => {
  afterEach(() => {
    restoreClipboard()
  })

  async function renderCopyList(): Promise<void> {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(copyBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1'))
  }

  it('copies the ref or the exact url from the link menu and closes on success', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard({ writeText })
    await renderCopyList()
    const link = screen.getByTestId(testIdFor.kanbanItemTitle('NK-1'))
    expect(fireEvent.contextMenu(link)).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Copy slug' }).textContent).toBe('Copy slug')
    expect(screen.getByRole('menuitem', { name: 'Copy link' }).textContent).toBe('Copy link')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy slug' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('NK-1'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()

    fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(' https://plane.example/NK-1 '))
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not close the menu until the clipboard write succeeds', async () => {
    let finish: () => void = () => {}
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    stubClipboard({ writeText })
    await renderCopyList()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy slug' }))
    expect(writeText).toHaveBeenCalledWith('NK-1')
    expect(screen.getByRole('menu')).toBeTruthy()
    await act(async () => {
      finish()
    })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it.each([
    ['keeps a clipboard failure visible and does not treat it as success', 'reject'],
    ['shows a clipboard failure when the clipboard is missing', 'missing'],
  ] as Array<[string, 'reject' | 'missing']>)('%s', async (_title, cause) => {
    const writeText = cause === 'reject' ? vi.fn(() => Promise.reject(new Error('denied'))) : null
    stubClipboard(writeText === null ? { missing: true } : { writeText })
    await renderCopyList()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy slug' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy to the clipboard.')
    expect(screen.getByRole('menu')).toBeTruthy()
    if (cause === 'reject') {
      // A failed write is not a success: the item stays actionable and no
      // review side effect fires.
      expect(screen.getByRole('menuitem', { name: 'Copy slug' })).toBeTruthy()
      expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
      expect(writeText).toHaveBeenCalledTimes(1)
    }
  })

  it('disables Copy link when the url is null or blank', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard({ writeText })
    await renderCopyList()
    for (const ref of ['NK-2', 'NK-3']) {
      fireEvent.contextMenu(screen.getByTestId(testIdFor.kanbanItemTitle(ref)))
      const copyLink = screen.getByRole('menuitem', { name: 'Copy link' }) as HTMLButtonElement
      expect(copyLink.disabled).toBe(true)
      fireEvent.click(copyLink)
      expect(writeText).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })

  it('opens from the context-menu key or Shift+F10 and closes on Escape or an outside pointer', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard({ writeText })
    await renderCopyList()
    const link = screen.getByTestId(testIdFor.kanbanItemTitle('NK-1'))
    link.focus()
    fireEvent.keyDown(link, { key: 'F10' })
    expect(screen.queryByRole('menu')).toBeNull()

    link.focus()
    fireEvent.keyDown(link, { key: 'ContextMenu' })
    expect(screen.getByRole('menuitem', { name: 'Copy slug' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()

    link.focus()
    fireEvent.keyDown(link, { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menu'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does not open from Start, Resume, priority, or the row background', async () => {
    await renderCopyList()
    const row = screen.getByTestId(testIdFor.kanbanItem('NK-1'))
    const start = within(row).getByTestId(testIdFor.kanbanItemStart('NK-1'))
    expect(fireEvent.contextMenu(start)).toBe(true)
    expect(
      fireEvent.contextMenu(await within(row).findByTestId(testIdFor.kanbanItemResume('NK-1'))),
    ).toBe(true)
    expect(fireEvent.contextMenu(within(row).getByText('None'))).toBe(true)
    expect(fireEvent.contextMenu(row)).toBe(true)
    expect(fireEvent.contextMenu(within(row).getByTestId(testIdFor.kanbanItemRef('NK-1')))).toBe(
      false,
    )
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    start.focus()
    fireEvent.keyDown(start, { key: 'ContextMenu' })
    fireEvent.keyDown(start, { key: 'F10', shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

// Handoff availability (spec Dostępność Resume): Resume renders only for an
// item the batch check proved available; Start and the directory notices stay.
describe('kanban handoff availability', () => {
  function appWithAvailability(
    listBoard: AppApi['kanban']['listBoard'],
    handoffAvailability: AppApi['kanban']['handoffAvailability'],
  ): AppApi {
    return { kanban: { listBoard, handoffAvailability } } as unknown as AppApi
  }

  it('disables Start only for items with Resume and re-enables it after handoff removal', async () => {
    const availability = vi
      .fn()
      .mockResolvedValueOnce({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: true }],
        rejections: [],
      })
      .mockResolvedValue({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: false }],
        rejections: [],
      })
    const onStart = vi.fn()
    const onResume = vi.fn()
    const app = appWithAvailability(vi.fn().mockResolvedValue(richBoard()), availability)
    render(
      <KanbanBoard
        app={app}
        projectId="p1"
        onConfigure={vi.fn()}
        onStart={onStart}
        onResume={onResume}
      />,
    )
    await screen.findByTestId(testIdFor.kanbanItemResume('NK-1'))
    const start = screen.getByTestId(testIdFor.kanbanItemStart('NK-1')) as HTMLButtonElement
    const otherStart = screen.getByTestId(testIdFor.kanbanItemStart('NK-2')) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(start.className).not.toContain('hover:underline')
    expect(otherStart.className).toContain('hover:underline')
    expect(screen.getByTestId(testIdFor.kanbanItemResume('NK-1')).className).toContain(
      'hover:underline',
    )
    start.focus()
    expect(document.activeElement).not.toBe(start)
    fireEvent.click(start)
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItem('NK-2')))
    fireEvent.click(within(screen.getByTestId(testIdFor.kanbanItem('NK-2'))).getByText('None'))
    expect(onStart).not.toHaveBeenCalled()
    expect(otherStart.disabled).toBe(false)
    fireEvent.click(otherStart)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-2' }))
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemResume('NK-1')))
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-1' }))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    await screen.findByTestId(TEST_ID.kanbanHandoffEmpty)
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    expect(start.disabled).toBe(false)
    expect(start.className).toContain('hover:underline')
    fireEvent.click(start)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ ref: 'NK-1' }))
  })

  it('hides Resume until the batch check succeeds, and always shows Start', async () => {
    const pending = deferred<KanbanHandoffAvailabilityResult>()
    const app = appWithAvailability(
      vi.fn().mockResolvedValue(richBoard()),
      vi.fn(() => pending.promise),
    )
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByTestId(testIdFor.kanbanItemStart('NK-1'))
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    await act(async () =>
      pending.resolve({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: true }],
        rejections: [],
      }),
    )
    expect(await screen.findByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeTruthy()
    // The other loaded item had no candidate: its Resume stays hidden.
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-2'))).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItemStart('NK-2'))).toBeTruthy()
  })

  it('shows the not-configured notice with Configure handoffs and hides Resume', async () => {
    const onConfigureHandoffs = vi.fn()
    const app = appWithAvailability(
      vi.fn().mockResolvedValue(richBoard()),
      vi.fn().mockResolvedValue({ state: 'not-configured' }),
    )
    render(
      <KanbanBoard
        app={app}
        projectId="p1"
        onConfigure={vi.fn()}
        onConfigureHandoffs={onConfigureHandoffs}
      />,
    )
    await screen.findByTestId(TEST_ID.kanbanHandoffNotConfigured)
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    // The loaded board is never removed by a scan state.
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffConfigure))
    expect(onConfigureHandoffs).toHaveBeenCalledTimes(1)
  })

  it('shows a directory read error with Retry and keeps the board', async () => {
    const availability = vi
      .fn()
      .mockResolvedValueOnce({
        state: 'error',
        message: 'Handoff directory not found: D:/nowhere',
      })
      .mockResolvedValueOnce({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: true }],
        rejections: [],
      })
    const app = appWithAvailability(vi.fn().mockResolvedValue(richBoard()), availability)
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    const notice = await screen.findByTestId(TEST_ID.kanbanHandoffError)
    expect(notice.textContent).toContain('Handoff directory not found: D:/nowhere')
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItem('NK-1'))).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffRetry))
    expect(await screen.findByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeTruthy()
    expect(availability).toHaveBeenCalledTimes(2)
  })

  it('treats a ready scan with no candidate as an empty state, not an error', async () => {
    const app = appWithAvailability(
      vi.fn().mockResolvedValue(richBoard()),
      vi.fn().mockResolvedValue({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: false }],
        rejections: [],
      }),
    )
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByTestId(TEST_ID.kanbanHandoffEmpty)
    expect(screen.queryByTestId(TEST_ID.kanbanHandoffError)).toBeNull()
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItemStart('NK-1'))).toBeTruthy()
  })

  it('names rejected files as warnings without hiding the available Resume', async () => {
    const app = appWithAvailability(
      vi.fn().mockResolvedValue(richBoard()),
      vi.fn().mockResolvedValue({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: true }],
        rejections: [{ name: 'big.md', path: 'h/big.md', reason: 'File is larger than 1 MiB.' }],
      }),
    )
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    const warnings = await screen.findByTestId(TEST_ID.kanbanHandoffWarnings)
    expect(warnings.textContent).toContain('big.md')
    expect(warnings.textContent).toContain('File is larger than 1 MiB.')
    expect(await screen.findByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeTruthy()
  })

  it('shows task details without a manual handoff action', async () => {
    const onResume = vi.fn()
    const app = appWithAvailability(
      vi.fn().mockResolvedValue(richBoard()),
      vi.fn().mockResolvedValue({ state: 'ready', items: [], rejections: [] }),
    )
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} onResume={onResume} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link handoff' })).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(
      richBoard().items[0]?.title,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItemStart('NK-1'))).toBeTruthy()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('never restores Resume from a late response after the project changes', async () => {
    const stale = deferred<KanbanHandoffAvailabilityResult>()
    const availability = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ state: 'ready', items: [], rejections: [] })
    const app = appWithAvailability(vi.fn().mockResolvedValue(richBoard()), availability)
    const ui = render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    ui.rerender(<KanbanBoard app={app} projectId="p2" onConfigure={vi.fn()} />)
    await act(async () =>
      stale.resolve({
        state: 'ready',
        items: [{ itemId: 'id-NK-1', ref: 'NK-1', available: true }],
        rejections: [],
      }),
    )
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
  })

  it('coalesces parallel triggers of the same check into one request', async () => {
    const pending = deferred<KanbanHandoffAvailabilityResult>()
    const availability = vi.fn(() => pending.promise)
    const listBoard = vi.fn().mockResolvedValue(richBoard())
    const app = appWithAvailability(listBoard, availability)
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} active />)
    await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    expect(availability).toHaveBeenCalledTimes(1)
    // Refresh re-loads the board with the same item set while the first check
    // is still in flight: the availability request is coalesced.
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    await waitFor(() => expect(listBoard).toHaveBeenCalledTimes(2))
    expect(availability).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ state: 'ready', items: [], rejections: [] }))
  })
})

// New task form (kanban item editing amendment, acceptance criteria 3 and 4).
describe('kanban new task form', () => {
  function todoBoard(): KanbanBoardData {
    return {
      states: [
        { id: 's-done', name: 'Done', group: 'completed', order: 3 },
        { id: 's-todo-late', name: 'TODO', group: 'unstarted', order: 2 },
        { id: 's-backlog', name: 'Backlog', group: 'backlog', order: 0 },
        { id: 's-todo', name: 'todo', group: 'unstarted', order: 1 },
      ],
      items: [item('NK-1', 'First task', 's-backlog')],
    }
  }

  function renderReady(
    board: KanbanBoardData,
    createItem: AppApi['kanban']['createItem'] = vi.fn(),
  ): AppApi['kanban']['createItem'] {
    const app = appWith(vi.fn().mockResolvedValue(board))
    app.kanban.createItem = createItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    return createItem
  }

  async function openForm(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: /^New task$/ }))
    return screen.getByRole('form', { name: 'New task' })
  }

  function field(form: HTMLElement, name: 'Status' | 'Title' | 'Description'): HTMLElement {
    return within(form).getByLabelText(name)
  }

  function groupItemCount(stateId: string): number {
    const toggle = screen.getByTestId(testIdFor.kanbanGroupToggle(stateId))
    const count = toggle.lastElementChild?.textContent
    if (count === null || count === undefined) {
      throw new Error(`missing count for ${stateId}`)
    }
    return Number(count)
  }

  it('shows New task only when the board is ready and the review is closed', async () => {
    const pending = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ states: [], items: [] })
    render(<KanbanBoard app={appWith(listBoard)} projectId="p1" onConfigure={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^New task$/ })).toBeNull()

    await act(async () => pending.resolve(todoBoard()))
    const opener = await screen.findByRole('button', { name: /^New task$/ })
    expect(opener.textContent?.replace(/\s+/g, ' ').trim()).toBe('New task')
    expect(opener.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(opener.className).toContain('border-edge')
    expect(opener.className).toContain('bg-panel')
    const headerBar = screen.getByRole('heading', { name: /^Kanban$/ }).parentElement
    expect(headerBar?.contains(opener)).toBe(true)

    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^New task$/ })).toBeNull()
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getByRole('button', { name: /^New task$/ })).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    await screen.findByTestId(TEST_ID.kanbanBoardEmpty)
    expect(screen.queryByRole('button', { name: /^New task$/ })).toBeNull()
  })

  it('defaults Status to the first Todo and keeps Create disabled until the title is non-empty', async () => {
    const createItem = renderReady(todoBoard())
    const form = await openForm()
    const headerBar = screen.getByRole('heading', { name: /^Kanban$/ }).parentElement
    expect(headerBar?.contains(form)).toBe(false)
    expect(
      (headerBar?.compareDocumentPosition(form) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(field(form, 'Status')).toBeTruthy()
    expect(field(form, 'Title')).toBeTruthy()
    expect(field(form, 'Description')).toBeTruthy()
    expect(within(form).getByRole('button', { name: /^Create$/ })).toBeTruthy()
    expect(within(form).getByRole('button', { name: /^Cancel$/ })).toBeTruthy()
    expect(within(form).queryByLabelText('Column')).toBeNull()
    expect(within(form).queryByLabelText('Priority')).toBeNull()

    const status = field(form, 'Status') as HTMLSelectElement
    expect(Array.from(status.options).map((option) => option.value)).toEqual([
      'Backlog',
      'todo',
      'TODO',
      'Done',
    ])
    expect(Array.from(status.options).map((option) => option.textContent)).toEqual([
      'Backlog',
      'todo',
      'TODO',
      'Done',
    ])
    expect(status.value).toBe('todo')

    const create = within(form).getByRole('button', { name: /^Create$/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(field(form, 'Title'), { target: { value: '   ' } })
    expect(create.disabled).toBe(true)
    fireEvent.submit(form)
    expect(createItem).not.toHaveBeenCalled()

    fireEvent.change(field(form, 'Title'), { target: { value: '  Ship the form  ' } })
    expect(create.disabled).toBe(false)
  })

  it('keeps Create disabled when the board has no Todo until a status is selected', async () => {
    renderReady(fixture)
    const form = await openForm()
    const status = field(form, 'Status') as HTMLSelectElement
    expect(status.value).toBe('')
    expect(
      Array.from(status.options)
        .map((option) => option.value)
        .filter((value) => value !== ''),
    ).toEqual(['Backlog', 'In Progress', 'Done'])
    fireEvent.change(field(form, 'Title'), { target: { value: 'Needs a status' } })
    const create = within(form).getByRole('button', { name: /^Create$/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    fireEvent.change(status, { target: { value: 'In Progress' } })
    expect(status.value).toBe('In Progress')
    expect(create.disabled).toBe(false)
  })

  it('inserts the created item into the selected status and closes the form without opening review', async () => {
    const pending = deferred<WorkItem>()
    const firstCreated: WorkItem = {
      ...item('NK-40', 'Ship the form', 's-todo'),
      stateName: 'todo',
      url: 'https://plane.example/NK-40',
    }
    const secondCreated: WorkItem = {
      ...item('NK-41', 'Another', 's-todo'),
      stateName: 'todo',
      description: ' Notes ',
    }
    const createItem = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(secondCreated)
    renderReady(todoBoard(), createItem)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: '  Ship the form  ' } })
    fireEvent.change(field(form, 'Description'), { target: { value: '   ' } })
    const create = within(form).getByRole('button', { name: /^Create$/ }) as HTMLButtonElement
    fireEvent.click(create)
    fireEvent.click(create)
    expect(createItem).toHaveBeenCalledTimes(1)
    expect(createItem.mock.calls[0]).toEqual([
      'p1',
      { title: '  Ship the form  ', stateRef: 'todo' },
    ])
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-40'))).toBeNull()
    expect(screen.getAllByTestId(/^kanban-item-NK-/)).toHaveLength(1)

    await act(async () => pending.resolve(firstCreated))
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
    const column = screen.getByTestId(testIdFor.kanbanListGroup('s-todo'))
    expect(within(column).getByTestId(testIdFor.kanbanItemTitle('NK-40')).textContent).toBe(
      'Ship the form',
    )
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s-backlog'))).queryByTestId(
        testIdFor.kanbanItem('NK-40'),
      ),
    ).toBeNull()
    expect(
      within(screen.getByTestId(testIdFor.kanbanItem('NK-40'))).queryByRole('combobox'),
    ).toBeNull()

    const again = await openForm()
    expect((field(again, 'Title') as HTMLInputElement).value).toBe('')
    expect((field(again, 'Description') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(field(again, 'Title'), { target: { value: 'Another' } })
    fireEvent.change(field(again, 'Description'), { target: { value: ' Notes ' } })
    fireEvent.click(within(again).getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(screen.getByTestId(testIdFor.kanbanItem('NK-41'))).toBeTruthy())
    expect(createItem.mock.calls[1]).toEqual([
      'p1',
      { title: 'Another', stateRef: 'todo', description: ' Notes ' },
    ])
    expect(screen.queryByTestId(TEST_ID.kanbanReview)).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()
  })

  it('keeps the draft and shows the error when create fails', async () => {
    const createItem = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'adapter',
      message: 'Plane refused the item.',
    })
    renderReady(todoBoard(), createItem)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'Ship the form' } })
    fireEvent.change(field(form, 'Description'), { target: { value: 'Keep me' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Create$/ }))

    expect((await within(form).findByRole('alert')).textContent).toBe('Plane refused the item.')
    expect(screen.getByRole('form', { name: 'New task' })).toBe(form)
    expect((field(form, 'Title') as HTMLInputElement).value).toBe('Ship the form')
    expect((field(form, 'Description') as HTMLTextAreaElement).value).toBe('Keep me')
    expect((field(form, 'Status') as HTMLSelectElement).value).toBe('todo')
    expect(
      (within(form).getByRole('button', { name: /^Create$/ }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-40'))).toBeNull()
    expect(screen.getAllByTestId(/^kanban-item-NK-/)).toHaveLength(1)
    expect(createItem).toHaveBeenCalledTimes(1)
    expect(createItem.mock.calls[0]).toEqual([
      'p1',
      { title: 'Ship the form', stateRef: 'todo', description: 'Keep me' },
    ])
  })

  it('drops the draft on Cancel, opening an item, and Escape inside the form', async () => {
    renderReady(todoBoard())
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'Draft title' } })
    fireEvent.change(field(form, 'Description'), { target: { value: 'Draft body' } })
    fireEvent.change(field(form, 'Status'), { target: { value: 'Done' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Cancel$/ }))
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()

    const reopened = await openForm()
    expect((field(reopened, 'Title') as HTMLInputElement).value).toBe('')
    expect((field(reopened, 'Description') as HTMLTextAreaElement).value).toBe('')
    expect((field(reopened, 'Status') as HTMLSelectElement).value).toBe('todo')

    fireEvent.change(field(reopened, 'Title'), { target: { value: 'Draft title' } })
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^New task$/ })).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))

    const afterReview = await openForm()
    expect((field(afterReview, 'Title') as HTMLInputElement).value).toBe('')
    fireEvent.change(field(afterReview, 'Title'), { target: { value: 'Draft title' } })

    const forEscape = screen.getByRole('form', { name: 'New task' })
    const title = field(forEscape, 'Title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Escape me' } })
    title.focus()
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()

    const staying = await openForm()
    const stayTitle = field(staying, 'Title') as HTMLInputElement
    fireEvent.change(stayTitle, { target: { value: 'Stay' } })
    const opener = screen.getByRole('button', { name: /^New task$/ })
    opener.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(opener, { key: 'Escape' })
    expect(screen.getByRole('form', { name: 'New task' })).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Stay')
  })

  it('keeps in-flight create valid and upserts the item when form is dismissed by opening an item', async () => {
    const pending = deferred<WorkItem>()
    const createItem = vi.fn().mockReturnValue(pending.promise)
    renderReady(todoBoard(), createItem)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'In flight task' } })
    const createBtn = within(form).getByRole('button', { name: /^Create$/ })
    fireEvent.click(createBtn)
    expect(createItem).toHaveBeenCalledTimes(1)

    // Cancel button should be disabled while busy
    const cancelBtn = within(form).getByRole('button', { name: /^Cancel$/ }) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(true)

    // Escape should be ignored while busy
    fireEvent.keyDown(field(form, 'Title'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'New task' })).not.toBeNull()

    // Dismissing by clicking an existing item title to open review
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')))
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBeTruthy()

    // Resolve the in-flight create
    const createdItem: WorkItem = {
      ...item('NK-40', 'In flight task', 's-todo'),
      stateName: 'todo',
    }
    await act(async () => pending.resolve(createdItem))

    // Close review to return to list
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getByTestId(TEST_ID.kanbanList)).toBeTruthy()

    // The created item MUST be present on the board
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40'))).toBeTruthy()
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s-todo'))).getByTestId(
        testIdFor.kanbanItemTitle('NK-40'),
      ).textContent,
    ).toBe('In flight task')
  })

  it('keeps one copy when an in-flight list already contains the created ref', async () => {
    const initial = todoBoard()
    const fromBoard: WorkItem = {
      ...item('NK-40', 'From board', 's-todo'),
      stateName: 'todo',
    }
    const created: WorkItem = {
      ...item('NK-40', 'Ship the form', 's-todo'),
      stateName: 'todo',
    }
    const overlapping = deferred<KanbanBoardData>()
    const later = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
      .mockReturnValueOnce(later.promise)
    const createPending = deferred<WorkItem>()
    const createItem = vi.fn().mockReturnValueOnce(createPending.promise)
    const app = appWith(listBoard)
    app.kanban.createItem = createItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByRole('button', { name: /^New task$/ })

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'Ship the form' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Create$/ }))
    expect(createItem).toHaveBeenCalledTimes(1)

    await act(async () => {
      overlapping.resolve({ ...initial, items: [...initial.items, fromBoard] })
    })
    expect(groupItemCount('s-todo')).toBe(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40')).textContent).toBe('From board')

    await act(async () => {
      createPending.resolve(created)
    })
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(groupItemCount('s-todo')).toBe(1)
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-40'))).toHaveLength(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40')).textContent).toBe('Ship the form')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(3)
    await act(async () => {
      later.resolve({ ...initial, items: [...initial.items, fromBoard] })
    })
    expect(groupItemCount('s-todo')).toBe(1)
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-40'))).toHaveLength(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40')).textContent).toBe('From board')
  })

  it('keeps one copy when create lands before an in-flight list that already has that ref', async () => {
    const initial = todoBoard()
    const created: WorkItem = {
      ...item('NK-40', 'Ship the form', 's-todo'),
      stateName: 'todo',
    }
    const fromBoard: WorkItem = {
      ...item('NK-40', 'From board', 's-todo'),
      stateName: 'todo',
    }
    const overlapping = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
    const createPending = deferred<WorkItem>()
    const createItem = vi.fn().mockReturnValueOnce(createPending.promise)
    const app = appWith(listBoard)
    app.kanban.createItem = createItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByRole('button', { name: /^New task$/ })

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'Ship the form' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Create$/ }))
    await act(async () => {
      createPending.resolve(created)
    })
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(groupItemCount('s-todo')).toBe(1)

    await act(async () => {
      overlapping.resolve({ ...initial, items: [...initial.items, fromBoard] })
    })
    expect(groupItemCount('s-todo')).toBe(1)
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-40'))).toHaveLength(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40')).textContent).toBe('From board')
  })

  it('keeps a created ref omitted by an in-flight list and lets a later refresh remove it', async () => {
    const initial = todoBoard()
    const created: WorkItem = {
      ...item('NK-40', 'Ship the form', 's-todo'),
      stateName: 'todo',
    }
    const overlapping = deferred<KanbanBoardData>()
    const later = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
      .mockReturnValueOnce(later.promise)
    const createPending = deferred<WorkItem>()
    const createItem = vi.fn().mockReturnValueOnce(createPending.promise)
    const app = appWith(listBoard)
    app.kanban.createItem = createItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    await screen.findByRole('button', { name: /^New task$/ })

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    const form = await openForm()
    fireEvent.change(field(form, 'Title'), { target: { value: 'Ship the form' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Create$/ }))

    await act(async () => {
      createPending.resolve(created)
    })
    expect(screen.queryByRole('form', { name: 'New task' })).toBeNull()
    expect(groupItemCount('s-todo')).toBe(1)
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle('NK-40')))
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Ship the form')

    const takenBeforeCreate: KanbanBoardData = {
      ...initial,
      items: initial.items.map((entry) =>
        entry.ref === 'NK-1' ? { ...entry, title: 'Renamed while creating' } : entry,
      ),
    }
    await act(async () => {
      overlapping.resolve(takenBeforeCreate)
    })
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Ship the form')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(groupItemCount('s-todo')).toBe(1)
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-40'))).toHaveLength(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe(
      'Renamed while creating',
    )

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(3)
    await act(async () => {
      later.resolve(initial)
    })
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-40'))).toBeNull()
    expect(groupItemCount('s-todo')).toBe(0)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe('First task')
  })
})

// Review status (kanban item editing amendment, acceptance criteria 5 and 6).
describe('kanban review status change', () => {
  function statusBoard(): KanbanBoardData {
    return {
      states: [
        { id: 's2', name: 'Done', group: 'completed', order: 2 },
        { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
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

  function listGroupCount(stateId: string): number {
    const toggle = screen.getByTestId(testIdFor.kanbanGroupToggle(stateId))
    const count = toggle.lastElementChild?.textContent
    if (count === null || count === undefined) {
      throw new Error(`missing count for ${stateId}`)
    }
    return Number(count)
  }

  function savedItem(board: KanbanBoardData): WorkItem {
    return {
      ...board.items[0],
      title: 'Status saved',
      stateId: 's2',
      stateName: 'Done',
    }
  }

  it('does not put a status control on the list row', async () => {
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(statusBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    const row = await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).queryByLabelText('Status')).toBeNull()
  })

  it('saves only stateRef from the review and keeps that review on the returned item', async () => {
    const board = statusBoard()
    const updated: WorkItem = { ...savedItem(board), stateName: 'Shipped' }
    const listBoard = vi.fn().mockResolvedValue(board)
    const updateItem = vi.fn().mockResolvedValue(updated)
    const app = appWith(listBoard)
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))

    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const status = within(review).getByLabelText('Status') as HTMLSelectElement
    expect(status.getAttribute('data-testid')).toBe(TEST_ID.kanbanReviewStatus)
    expect(Array.from(status.options).map((option) => option.value)).toEqual(['Backlog', 'Done'])
    expect(Array.from(status.options).map((option) => option.textContent)).toEqual([
      'Backlog',
      'Done',
    ])
    expect(status.value).toBe('Backlog')
    expect(within(review).queryByRole('textbox')).toBeNull()
    expect(within(review).getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(longTitle)
    expect(within(review).getByTestId(TEST_ID.kanbanReviewDescription).textContent).toBe(
      'Line one\n\nLine two',
    )
    expect(review.textContent).toContain('NK-1')
    expect(review.textContent).toContain('High')

    fireEvent.change(status, { target: { value: 'Done' } })
    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { stateRef: 'Done' }])
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Shipped')
    expect(within(review).getByTestId(TEST_ID.kanbanReviewDescription).textContent).toBe(
      'Line one\n\nLine two',
    )
    expect(review.textContent).toContain('High')
    expect(within(review).queryByRole('textbox')).toBeNull()
    expect(listBoard).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s2')).toBe(1)
    expect(listGroupCount('s1')).toBe(1)
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s2'))).getByTestId(
        testIdFor.kanbanItem('NK-1'),
      ),
    ).toBeTruthy()
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).queryByTestId(
        testIdFor.kanbanItem('NK-1'),
      ),
    ).toBeNull()
  })

  it('keeps a state name that is not on the board as the selected Status option', async () => {
    const board = statusBoard()
    board.items[0] = { ...board.items[0], stateName: 'Ghost state' }
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(board))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const status = within(await screen.findByTestId(TEST_ID.kanbanReview)).getByLabelText(
      'Status',
    ) as HTMLSelectElement
    expect(Array.from(status.options).map((option) => option.value)).toEqual([
      'Backlog',
      'Done',
      'Ghost state',
    ])
    expect(Array.from(status.options).map((option) => option.textContent)).toEqual([
      'Backlog',
      'Done',
      'Ghost state',
    ])
    expect(status.value).toBe('Ghost state')
  })

  it('restores the confirmed status and shows the error when the update fails', async () => {
    const pendingUpdate = deferred<WorkItem>()
    const listBoard = vi.fn().mockResolvedValue(statusBoard())
    const updateItem = vi.fn().mockReturnValueOnce(pendingUpdate.promise)
    const app = appWith(listBoard)
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const status = within(review).getByLabelText('Status') as HTMLSelectElement
    expect(status.value).toBe('Backlog')

    fireEvent.change(status, { target: { value: 'Done' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { stateRef: 'Done' }])
    expect(status.value).toBe('Done')

    await act(async () => {
      pendingUpdate.reject({
        nekodeAppError: true,
        code: 'adapter',
        message: 'Plane refused the status.',
      })
    })
    const alert = within(review).getByRole('alert')
    expect(alert.textContent).toBe('Plane refused the status.')
    expect(alert.getAttribute('data-testid')).toBe(TEST_ID.kanbanReviewError)
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Backlog')
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(longTitle)
    expect(listBoard).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s1')).toBe(2)
    expect(listGroupCount('s2')).toBe(0)
  })

  it('ignores a second Status change while the first update is in flight', async () => {
    const initial = statusBoard()
    const updated = savedItem(initial)
    const staleItem: WorkItem = { ...initial.items[0], title: 'Stale snapshot' }
    const overlapping = deferred<KanbanBoardData>()
    const pendingUpdate = deferred<WorkItem>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
    const updateItem = vi.fn().mockReturnValueOnce(pendingUpdate.promise).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'adapter',
      message: 'Plane refused the follow-up.',
    })
    const app = appWith(listBoard)
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const status = within(review).getByLabelText('Status') as HTMLSelectElement
    expect(status.disabled).toBe(false)
    expect(status.value).toBe('Backlog')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    fireEvent.change(status, { target: { value: 'Done' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { stateRef: 'Done' }])
    expect(status.disabled).toBe(true)
    expect(status.value).toBe('Done')

    fireEvent.change(status, { target: { value: 'Backlog' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls).toEqual([['p1', 'NK-1', { stateRef: 'Done' }]])
    expect(status.disabled).toBe(true)
    expect(status.value).toBe('Done')
    expect(within(review).queryByRole('alert')).toBeNull()
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(longTitle)

    await act(async () => {
      pendingUpdate.resolve(updated)
    })
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).disabled).toBe(false)
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Done')
    expect(within(review).queryByRole('alert')).toBeNull()
    expect(updateItem).toHaveBeenCalledTimes(1)

    await act(async () => {
      overlapping.resolve({ ...initial, items: [staleItem, initial.items[1]] })
    })
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Done')
    expect(within(review).queryByRole('alert')).toBeNull()
    expect(updateItem).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s2')).toBe(1)
    expect(listGroupCount('s1')).toBe(1)
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).queryByTestId(
        testIdFor.kanbanItem('NK-1'),
      ),
    ).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe('Status saved')
  })

  it('keeps one updated copy when an in-flight list still has the old item', async () => {
    const initial = statusBoard()
    const updated = savedItem(initial)
    const staleItem: WorkItem = { ...initial.items[0], title: 'Stale snapshot' }
    const overlapping = deferred<KanbanBoardData>()
    const laterStale = deferred<KanbanBoardData>()
    const laterMissing = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
      .mockReturnValueOnce(laterStale.promise)
      .mockReturnValueOnce(laterMissing.promise)
    const updatePending = deferred<WorkItem>()
    const updateItem = vi.fn().mockReturnValueOnce(updatePending.promise)
    const app = appWith(listBoard)
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    fireEvent.change(within(review).getByLabelText('Status'), { target: { value: 'Done' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { stateRef: 'Done' }])

    await act(async () => {
      updatePending.resolve(updated)
    })
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Done')

    await act(async () => {
      overlapping.resolve({ ...initial, items: [staleItem, initial.items[1]] })
    })
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Done')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s2')).toBe(1)
    expect(listGroupCount('s1')).toBe(1)
    expect(
      within(screen.getByTestId(testIdFor.kanbanListGroup('s1'))).queryByTestId(
        testIdFor.kanbanItem('NK-1'),
      ),
    ).toBeNull()
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe('Status saved')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(3)
    await act(async () => {
      laterStale.resolve({ ...initial, items: [staleItem, initial.items[1]] })
    })
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s1')).toBe(2)
    expect(listGroupCount('s2')).toBe(0)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe('Stale snapshot')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(4)
    await act(async () => {
      laterMissing.resolve({ ...initial, items: [initial.items[1]] })
    })
    expect(screen.queryByTestId(testIdFor.kanbanItem('NK-1'))).toBeNull()
    expect(listGroupCount('s1')).toBe(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-2')).textContent).toBe('Second task')
  })

  it('keeps an updated ref that an in-flight list omits', async () => {
    const initial = statusBoard()
    const updated = savedItem(initial)
    const overlapping = deferred<KanbanBoardData>()
    const listBoard = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(overlapping.promise)
    const updatePending = deferred<WorkItem>()
    const updateItem = vi.fn().mockReturnValueOnce(updatePending.promise)
    const app = appWith(listBoard)
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
    expect(listBoard).toHaveBeenCalledTimes(2)
    fireEvent.change(within(review).getByLabelText('Status'), { target: { value: 'Done' } })
    await act(async () => {
      updatePending.resolve(updated)
    })
    await act(async () => {
      overlapping.resolve({
        ...initial,
        items: [{ ...initial.items[1], title: 'Other kept' }],
      })
    })

    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('Status saved')
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).value).toBe('Done')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    expect(screen.getAllByTestId(testIdFor.kanbanItem('NK-1'))).toHaveLength(1)
    expect(listGroupCount('s2')).toBe(1)
    expect(listGroupCount('s1')).toBe(1)
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-1')).textContent).toBe('Status saved')
    expect(screen.getByTestId(testIdFor.kanbanItemTitle('NK-2')).textContent).toBe('Other kept')
  })
})

describe('kanban review priority change', () => {
  it('saves priority only from the review, including None', async () => {
    const board = richBoard()
    const lowered = { ...board.items[0], priority: 'low' as const }
    const cleared = { ...lowered, priority: null }
    const updateItem = vi.fn().mockResolvedValueOnce(lowered).mockResolvedValueOnce(cleared)
    const app = appWith(vi.fn().mockResolvedValue(board))
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)

    const row = await screen.findByTestId(testIdFor.kanbanItem('NK-1'))
    expect(within(row).queryByLabelText('Priority')).toBeNull()
    expect(within(row).queryByRole('combobox')).toBeNull()
    fireEvent.click(within(row).getByTestId(testIdFor.kanbanItemTitle('NK-1')))

    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const priority = within(review).getByLabelText('Priority') as HTMLSelectElement
    expect(priority.getAttribute('data-testid')).toBe(TEST_ID.kanbanReviewPriority)
    expect(Array.from(priority.options).map((option) => option.value)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ])
    expect(Array.from(priority.options).map((option) => option.textContent)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
      'None',
    ])
    expect(priority.value).toBe('high')

    fireEvent.change(priority, { target: { value: 'low' } })
    await waitFor(() => {
      expect((within(review).getByLabelText('Priority') as HTMLSelectElement).value).toBe('low')
    })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { priority: 'low' }])
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)

    fireEvent.change(within(review).getByLabelText('Priority'), { target: { value: 'none' } })
    await waitFor(() => {
      expect(updateItem).toHaveBeenCalledTimes(2)
    })
    expect(updateItem.mock.calls[1]).toEqual(['p1', 'NK-1', { priority: null }])
    expect((within(review).getByLabelText('Priority') as HTMLSelectElement).value).toBe('none')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewBack))
    const saved = screen.getByTestId(testIdFor.kanbanItem('NK-1'))
    expect(within(saved).getByText('None')).toBeTruthy()
    expect(within(saved).queryByRole('combobox')).toBeNull()
  })

  it('restores priority when the update fails and ignores another write while it is in flight', async () => {
    const pendingUpdate = deferred<WorkItem>()
    const board = richBoard()
    const updateItem = vi.fn().mockReturnValueOnce(pendingUpdate.promise)
    const app = appWith(vi.fn().mockResolvedValue(board))
    app.kanban.updateItem = updateItem
    render(<KanbanBoard app={app} projectId="p1" onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const priority = within(review).getByLabelText('Priority') as HTMLSelectElement
    const status = within(review).getByLabelText('Status') as HTMLSelectElement

    fireEvent.change(priority, { target: { value: 'low' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0]).toEqual(['p1', 'NK-1', { priority: 'low' }])
    expect(priority.disabled).toBe(true)
    expect(status.disabled).toBe(true)
    expect(priority.value).toBe('low')

    fireEvent.change(priority, { target: { value: 'urgent' } })
    fireEvent.change(status, { target: { value: 'Done' } })
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(priority.value).toBe('low')
    expect(status.value).toBe('Backlog')

    await act(async () => {
      pendingUpdate.reject({
        nekodeAppError: true,
        code: 'adapter',
        message: 'Plane refused the priority.',
      })
    })
    const alert = within(review).getByRole('alert')
    expect(alert.textContent).toBe('Plane refused the priority.')
    expect(alert.getAttribute('data-testid')).toBe(TEST_ID.kanbanReviewPriorityError)
    expect((within(review).getByLabelText('Priority') as HTMLSelectElement).value).toBe('high')
    expect((within(review).getByLabelText('Priority') as HTMLSelectElement).disabled).toBe(false)
    expect((within(review).getByLabelText('Status') as HTMLSelectElement).disabled).toBe(false)
    expect(updateItem).toHaveBeenCalledTimes(1)
  })
})

describe('kanban review text selection', () => {
  afterEach(() => {
    restoreClipboard()
    vi.restoreAllMocks()
  })

  it('selects review text and copies that selection', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard({ writeText })
    render(
      <KanbanBoard
        app={appWith(vi.fn().mockResolvedValue(richBoard()))}
        projectId="p1"
        onConfigure={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle('NK-1')))
    const review = await screen.findByTestId(TEST_ID.kanbanReview)
    const title = within(review).getByTestId(TEST_ID.kanbanReviewTitle)
    const description = within(review).getByTestId(TEST_ID.kanbanReviewDescription)

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Line one',
    } as Selection)
    // The text surfaces open the copy menu and the copy carries the current
    // selection, not the whole field.
    expect(fireEvent.contextMenu(title)).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Line one'))
    expect(screen.queryByRole('menu')).toBeNull()

    // A blank selection disables Copy: the menu stays open and nothing is written.
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '   ',
    } as Selection)
    fireEvent.contextMenu(description)
    const copy = screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menu', { name: 'Copy selection' })).toBeTruthy()

    // Escape dismisses the menu; non-text surfaces never open it.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fireEvent.contextMenu(screen.getByTestId(TEST_ID.kanbanReviewBack))).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
