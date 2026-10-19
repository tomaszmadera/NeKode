import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  ChatInfo,
  KanbanBoard,
  ProjectInfo,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { projectKanbanAdapterKey } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Kanban entry points (spec kanban-adapter-interface Behaviour 14, AC14): a
// project with a stored Kanban binding shows a `Kanban` tile as the first
// element of its expanded left-navigation content and a non-closable `Kanban`
// tab immediately after the chat tab; a project without a binding shows
// neither. Selecting either entry point shows the grouped list in the center
// surface (one lazy listBoard load). Selecting the chat tab or a file tab
// returns to that surface. No center-surface `Files | Kanban` view-switch
// strip exists.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))
vi.mock('../files/MonacoPreview', () => ({
  MonacoPreview: ({ content, language }: { content: string; language: string | null }) => (
    <pre data-testid="file-preview-monaco" data-language={language ?? 'plaintext'}>
      {content}
    </pre>
  ),
}))

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const projectB: ProjectInfo = {
  id: 'p2',
  name: 'Other',
  path: 'D:/code/other',
  runtimeLabel: null,
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }

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

const fixture: KanbanBoard = {
  states: [
    { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
    { id: 's2', name: 'In Progress', group: 'started', order: 2 },
  ],
  items: [item('NK-1', 'First task', 's1'), item('NK-2', 'Second task', 's2')],
}

function isSelected(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute('data-selected') === 'true'
}

/** Key-aware binding mock: only the listed projects read back as bound. */
function mockBindings(app: AppApi, boundProjectIds: readonly string[]): void {
  const bound = new Set(boundProjectIds)
  vi.mocked(app.state.get).mockImplementation(async (key) => {
    for (const projectId of bound) {
      if (key === projectKanbanAdapterKey(projectId)) {
        return 'plane'
      }
    }
    return null
  })
}

describe('kanban nav tile (spec Behaviour 14, AC14)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('does not render the retired nav tile under the project name row', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    expect(screen.queryByTestId(testIdFor.projectKanban('p1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.projectKanban('p2'))).toBeNull()
  })
})

describe('kanban top-strip tab (spec Behaviour 14, AC14)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('sits as the first tab when bound, before the chat tab, non-closable and icon-only', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    // Bound project: the tab appears (its presence proves the binding loaded).
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const kanbanTab = await screen.findByTestId(TEST_ID.kanbanTab)
    const strip = screen.getByTestId(TEST_ID.tabStrip)
    const chatTab = screen.getByTestId(TEST_ID.tabTerminal)
    expect(strip.firstElementChild).toBe(kanbanTab)
    expect(kanbanTab.nextElementSibling).toBe(chatTab)
    // Non-closable: no close control inside the tab.
    expect(within(kanbanTab).queryByRole('button', { name: /Close/ })).toBeNull()
    // Icon-only without title text, square (aspect-square) with centered content (justify-center):
    expect(kanbanTab.textContent).toBe('')
    expect(kanbanTab.className).toContain('aspect-square')
    expect(kanbanTab.className).toContain('justify-center')

    // Unbound project: no Kanban tab at all.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.kanbanTab)).toBeNull())
  })

  it('no Files | Kanban center-surface strip remains in the DOM', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(TEST_ID.kanbanTab)
    expect(screen.queryByTestId('project-surface-tabs')).toBeNull()
    expect(screen.queryByTestId('project-surface-files')).toBeNull()
    expect(screen.queryByTestId('project-surface-kanban')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Project view' })).toBeNull()
    // Structural guard (not id-literal): the retired view-switch strip was a
    // `Files | Kanban` button pair inside the center surface — its absence is
    // asserted by role+name, so a strip rebuilt with fresh testids still fails.
    const centerSurface = screen.getByTestId(TEST_ID.centerSurface)
    expect(within(centerSurface).queryByRole('button', { name: 'Files' })).toBeNull()
    expect(within(centerSurface).queryByRole('button', { name: 'Kanban' })).toBeNull()
  })
})

describe('kanban entry points open and leave the board (spec Behaviour 14, AC14)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('selecting the Kanban tab loads the board once (lazy)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const tab = await screen.findByTestId(TEST_ID.kanbanTab)
    // Lazy: nothing loaded before the tab is selected.
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()

    fireEvent.click(tab)
    // The default view is the list; the load fires once either way.
    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(1)
    expect(app.kanban.listBoard).toHaveBeenCalledWith('p1')
    const backlog = await screen.findByTestId(testIdFor.kanbanListGroup('s1'))
    expect(within(backlog).getByText('Backlog')).toBeTruthy()
    expect(within(backlog).getByTestId(testIdFor.kanbanItem('NK-1')).textContent).toContain(
      'First task',
    )
    // The Kanban tab is the active tab while the board shows.
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
  })

  it('selecting the top-strip tab shows the board', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))

    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.listBoard).toHaveBeenCalledWith('p1')
  })

  it('not-configured board offers Configure that opens Project Settings on the Kanban tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'No Kanban adapter is configured for project "p1".',
    })
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))

    await screen.findByTestId(TEST_ID.kanbanBoardUnconfigured)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardConfigure))
    await screen.findByRole('dialog', { name: 'Project Settings' })
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTab).getAttribute('aria-selected')).toBe(
        'true',
      ),
    )
    expect(await screen.findByTestId(TEST_ID.settingsKanbanPanel)).toBeTruthy()
  })

  it('keeps a chat selected in the active project, so the chat tab still shows it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    // Select the project, then its chat: the terminal surface shows it.
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t1'))
    fireEvent.click(chatRow)
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block'),
    )
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')

    // Opening the board of the already-selected project must NOT discard its chat selection.
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(TEST_ID.kanbanBoard)
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')

    // Returning via the chat tab shows the same chat, not an empty surface.
    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block'),
    )
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(screen.queryByTestId(TEST_ID.startNewChatState)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
  })
})

describe('kanban binding reactivity (spec Behaviour 14, AC14)', () => {
  let app: AppApi
  let boundProjectIds: Set<string>

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
    boundProjectIds = new Set(['p1'])
    // Mutable key-aware binding mock: unbinding p1 mid-test changes the read.
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      for (const projectId of boundProjectIds) {
        if (key === projectKanbanAdapterKey(projectId)) {
          return 'plane'
        }
      }
      return null
    })
  })
  afterEach(() => {
    cleanup()
  })

  it('shows the cached review immediately on tab return and preserves project isolation', async () => {
    boundProjectIds = new Set(['p1', 'p2'])
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    let finish!: (board: KanbanBoard) => void
    const pending = new Promise<KanbanBoard>((resolve) => {
      finish = resolve
    })
    vi.mocked(app.kanban.listBoard)
      .mockResolvedValueOnce(fixture)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ ...fixture, items: [item('OTHER-1', 'Other project', 's1')] })
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemTitle(fixture.items[0].ref)))
    const board = screen.getByTestId(TEST_ID.kanbanBoard)
    const review = screen.getByTestId(TEST_ID.kanbanReview)
    board.scrollTop = 80
    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    expect(board.parentElement?.style.display).toBe('none')
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanTab))
    expect(board.parentElement?.style.display).toBe('flex')
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    const refreshBtn = screen.getByTestId(TEST_ID.kanbanBoardRefresh) as HTMLButtonElement
    expect(refreshBtn.disabled).toBe(true)
    expect(refreshBtn.firstElementChild?.classList.contains('animate-spin')).toBe(true)
    expect(board.scrollTop).toBe(80)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p2')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    const other = await screen.findByTestId(testIdFor.kanbanItem('OTHER-1'))
    expect(other.closest('[data-testid="kanban-board"]')?.parentElement?.style.display).toBe('flex')
    expect(board.parentElement?.style.display).toBe('none')
    await act(async () =>
      finish({
        ...fixture,
        items: fixture.items.map((i, index) =>
          index === 0 ? { ...i, title: 'Updated hidden review' } : i,
        ),
      }),
    )
    expect(other.textContent).toContain('Other project')
    expect(within(board).getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe(
      'Updated hidden review',
    )
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(3)
    vi.mocked(app.kanban.listBoard).mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    expect(board.parentElement?.style.display).toBe('flex')
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
  })

  it('invalidates a saved configuration immediately and excludes a superseded request', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.kanban.adaptersList).mockResolvedValue([
      { id: 'plane', name: 'Plane', configSchema: [] },
    ])
    vi.mocked(app.kanban.getConfig).mockResolvedValue({
      adapterId: 'plane',
      values: {},
      secretKeys: [],
    })
    let finish!: (board: KanbanBoard) => void
    const pending = new Promise<KanbanBoard>((resolve) => {
      finish = resolve
    })
    vi.mocked(app.kanban.listBoard)
      .mockResolvedValueOnce(fixture)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ states: [], items: [] })
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(testIdFor.kanbanItem(fixture.items[0].ref))
    // The board commits before its toolbar controls reach the host.
    const refresh = screen.getByTestId(TEST_ID.kanbanBoardRefresh) as HTMLButtonElement
    await waitFor(() => expect(refresh.disabled).toBe(false))
    fireEvent.click(refresh)
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(2)
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project Settings' }))
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsKanbanTab))
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(app.kanban.setConfig).toHaveBeenCalledWith('p1', { adapterId: 'plane', values: {} }),
    )
    await screen.findByTestId(TEST_ID.kanbanBoardEmpty)
    await act(async () => finish(fixture))
    expect(screen.queryByTestId(testIdFor.kanbanItem(fixture.items[0].ref))).toBeNull()
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(3)
  })

  it('disposes a removed project while its request is pending', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    let finish!: (board: KanbanBoard) => void
    vi.mocked(app.kanban.listBoard).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(TEST_ID.kanbanBoardLoading)
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull())
    await act(async () => finish(fixture))
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()
    expect(screen.queryByTestId(testIdFor.kanbanItem(fixture.items[0].ref))).toBeNull()
  })

  it('closing Project Settings after an unbind hides the entry points and resets the Kanban tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(TEST_ID.kanbanBoard)
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)

    // Unbind p1 and re-read the bindings by closing Project Settings.
    boundProjectIds = new Set()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project Settings' }))
    await screen.findByRole('dialog', { name: 'Project Settings' })
    fireEvent.keyDown(window, { key: 'Escape' })

    // Entry points gone (unbound); the active tab reset terminates the board
    // instead of leaving a Kanban tab that no longer exists.
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.kanbanTab)).toBeNull())
    expect(screen.queryByTestId(testIdFor.projectKanban('p1'))).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
    )
    expect(isSelected(TEST_ID.tabTerminal)).toBe(true)
  })
})
