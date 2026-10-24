import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  ChatInfo,
  KanbanBoard,
  ProjectInfo,
  WorkItem,
} from '../../../../shared/ipc-contract'
import {
  APP_STATE_KEY,
  LOCAL_TASK_FILE_MISSING,
  projectKanbanAdapterKey,
} from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Project home tab (project-home spec Behaviour 1-5, AC1-4; replaces the
// kanban-adapter-interface Behaviour 14 entry-point rule): every selected
// project, bound or not, has a non-closable home tab first in the strip,
// labeled with the project name. A bound project's home tab shows the grouped
// list (one listBoard load when it activates); an unbound one's shows the
// setup welcome and never calls listBoard. The project name opens the home
// tab. Selecting the chat tab or a file tab returns to that surface. No
// center-surface `Files | Kanban` view-switch strip exists.

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

  it('sits as the first tab for a bound and an unbound project, before the chat tab, non-closable', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const homeTab = await screen.findByTestId(TEST_ID.kanbanTab)
    const strip = screen.getByTestId(TEST_ID.tabStrip)
    const chatTab = screen.getByTestId(TEST_ID.tabTerminal)
    expect(strip.firstElementChild).toBe(homeTab)
    expect(homeTab.nextElementSibling).toBe(chatTab)
    // Non-closable: no close control inside the tab.
    expect(within(homeTab).queryByRole('button', { name: /Close/ })).toBeNull()
    // Icon plus the project name (cased per the default uppercase setting);
    // full name in the tooltip, which is also part of the accessible name.
    expect(homeTab.textContent).toBe('DEMO')
    expect(homeTab.getAttribute('title')).toBe('Tasks: DEMO')
    expect(screen.getByRole('button', { name: 'Tasks: DEMO' })).toBe(homeTab)
    // Bound: the home tab shows the task list.
    await screen.findByTestId(TEST_ID.kanbanList)

    // Unbound project: the same home tab, first in the strip, shows the welcome.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    const otherTab = screen.getByTestId(TEST_ID.kanbanTab)
    expect(screen.getByTestId(TEST_ID.tabStrip).firstElementChild).toBe(otherTab)
    expect(otherTab.nextElementSibling).toBe(screen.getByTestId(TEST_ID.tabTerminal))
    expect(otherTab.textContent).toBe('OTHER')
    expect(otherTab.getAttribute('title')).toBe('Tasks: OTHER')
    expect(otherTab.getAttribute('data-selected')).toBe('true')
  })

  it('shortens a long project name on the tab and keeps the full name in the tooltip', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([
      { ...projectB, name: 'Very long project name' },
    ])
    mockBindings(app, [])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p2')))
    const homeTab = await screen.findByTestId(TEST_ID.kanbanTab)
    expect(homeTab.textContent).toBe('VERY LONG…')
    expect(homeTab.getAttribute('title')).toBe('Tasks: VERY LONG PROJECT NAME')
  })

  it('renders no home tab without a project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([])

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.welcomeSurface)
    expect(screen.queryByTestId(TEST_ID.kanbanTab)).toBeNull()
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

  it('loads the board once, when the home tab activates (lazy)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    // Lazy: nothing loaded before the project's home tab is active.
    await screen.findByTestId(testIdFor.projectSelect('p1'))
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()

    // The project name opens the home tab; clicking the tab again is a no-op.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
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

  it('closing Project Settings after an unbind keeps the home tab and shows the welcome', async () => {
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

    // The board is gone (unbound), but the home tab stays selected and shows
    // the setup welcome: no redirect to the chat tab (project-home Behaviour 2).
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(isSelected(TEST_ID.tabTerminal)).toBe(false)
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
  })
})

describe('project home tab without a task source (project-home spec Behaviour 2-5, AC1, AC3, AC4)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('shows the setup welcome, stays on the home tab and never calls listBoard', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockBindings(app, [])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const welcome = await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(within(welcome).getByRole('heading', { name: 'No task list yet' })).toBeTruthy()
    expect(welcome.textContent).toContain(
      'Keep tasks in a file in this project, or connect a tracker.',
    )
    // Primary local action first, then the tracker action.
    const buttons = within(welcome).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Use a local task list',
      'Connect a tracker',
    ])
    expect(welcome.textContent).not.toMatch(/kanban/i)
    // Showing the welcome writes nothing.
    expect(app.kanban.bindLocalFile).not.toHaveBeenCalled()
    // The home tab stays selected; the chat surface is hidden.
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
    // No board toolbar on the welcome.
    expect(screen.queryByTestId(TEST_ID.kanbanBoardRefresh)).toBeNull()
    // The binding read ran and settled; still no redirect and no board load.
    expect(app.state.get).toHaveBeenCalledWith(projectKanbanAdapterKey('p1'))
    await act(async () => {})
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
  })

  it('shows a loading line until the binding read settles, then the welcome', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    let settle!: (value: string | null) => void
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === projectKanbanAdapterKey('p1')) {
        return new Promise<string | null>((resolve) => {
          settle = resolve
        })
      }
      return null
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(TEST_ID.projectHomeLoading)
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    await act(async () => settle(null))
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(screen.queryByTestId(TEST_ID.projectHomeLoading)).toBeNull()
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
  })

  it('shows a failed binding read inline on the home tab instead of the loading line', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === projectKanbanAdapterKey('p1')) throw new Error('state read failed')
      return null
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const error = await screen.findByTestId(TEST_ID.projectHomeError)
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toBe('Failed to load task sources.')
    expect(screen.queryByTestId(TEST_ID.projectHomeLoading)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.projectHomeWelcome)).toBeNull()
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    // A later action that clears the shell notice keeps the inline error.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    expect(screen.getByTestId(TEST_ID.projectHomeError).textContent).toBe(
      'Failed to load task sources.',
    )
    expect(app.kanban.listBoard).not.toHaveBeenCalled()

    // The read recovers: a re-read (closing Project Settings) replaces the
    // inline error with the welcome.
    vi.mocked(app.state.get).mockResolvedValue(null)
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project Settings' }))
    await screen.findByRole('dialog', { name: 'Project Settings' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(screen.queryByTestId(TEST_ID.projectHomeError)).toBeNull()
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
  })

  it('Connect a tracker opens Project Settings on the Tasks section of that project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockBindings(app, [])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.projectHomeConnectTracker))
    await screen.findByRole('dialog', { name: 'Project Settings' })
    const tasksTab = screen.getByTestId(TEST_ID.settingsKanbanTab)
    expect(tasksTab.textContent).toBe('Tasks')
    await waitFor(() => expect(tasksTab.getAttribute('aria-selected')).toBe('true'))
    expect(await screen.findByTestId(TEST_ID.settingsKanbanPanel)).toBeTruthy()
    await waitFor(() => expect(app.kanban.getConfig).toHaveBeenCalledWith('p1'))
  })

  it('name click on the current project keeps the chat; on another project clears it and opens its home tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    mockBindings(app, [])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(isSelected(TEST_ID.tabTerminal)).toBe(true))
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')

    // Current project: the home tab opens and the chat stays selected.
    vi.mocked(app.state.set).mockClear()
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() => expect(isSelected(TEST_ID.kanbanTab)).toBe(true))
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
    // The chat tab still names the same chat.
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')

    // Another project: selected, chat cleared, its home tab active.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.projectRow('p2')).getAttribute('data-selected')).toBe(
        'true',
      ),
    )
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(screen.getByTestId(TEST_ID.kanbanTab).textContent).toBe('OTHER')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p2')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('Chat')
  })

  it('launch with a restored chat opens the chat tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      return null
    })

    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    expect(isSelected(TEST_ID.tabTerminal)).toBe(true)
    expect(isSelected(TEST_ID.kanbanTab)).toBe(false)
  })

  it('launch with a restored project and no restored chat opens the home tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      // A stale chat id that no longer exists restores no chat.
      if (key === APP_STATE_KEY.selectedChatId) return 'gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(isSelected(TEST_ID.tabTerminal)).toBe(false)
    expect(app.terminals.create).not.toHaveBeenCalled()
  })
})

describe('local task list (project-home spec Behaviour 7, AC5, AC7, Edge cases)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  /** Binding store that `bindLocalFile` writes, like main does. */
  function mockLocalBinding(initial: string | null): void {
    let binding = initial
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? binding : null,
    )
    vi.mocked(app.kanban.bindLocalFile).mockImplementation(async () => {
      binding = 'local-file'
    })
  }

  const emptyLocalBoard: KanbanBoard = {
    states: [
      { id: 'backlog', name: 'Backlog', group: 'backlog', order: 0 },
      { id: 'todo', name: 'Todo', group: 'unstarted', order: 1 },
    ],
    items: [],
    revision: 1,
  }

  it('Use a local task list binds local-file and shows the empty list with New task', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockLocalBinding(null)
    vi.mocked(app.kanban.listBoard).mockResolvedValue(emptyLocalBoard)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(TEST_ID.projectHomeWelcome)
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TEST_ID.projectHomeUseLocal))

    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.bindLocalFile).toHaveBeenCalledWith('p1')
    expect(app.kanban.bindLocalFile).toHaveBeenCalledTimes(1)
    expect(app.kanban.listBoard).toHaveBeenCalledWith('p1')
    expect(screen.queryByTestId(TEST_ID.projectHomeWelcome)).toBeNull()
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(await screen.findByRole('button', { name: 'New task' })).toBeTruthy()
  })

  it('a failed Use a local task list stays on the welcome with the error inline', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockBindings(app, [])
    vi.mocked(app.kanban.bindLocalFile).mockRejectedValue({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Could not create .nekode/tasks.json.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.projectHomeUseLocal))
    const error = await screen.findByTestId(TEST_ID.projectHomeUseLocalError)
    expect(error.textContent).toBe('Could not create .nekode/tasks.json.')
    expect(screen.getByTestId(TEST_ID.projectHomeWelcome)).toBeTruthy()
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
  })

  it('a local-file binding with a missing file shows the typed error and Use a local task list', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockLocalBinding('local-file')
    vi.mocked(app.kanban.listBoard)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'not_found',
        message:
          'The task file .nekode/tasks.json was not found. Use a local task list to create it.',
        detail: LOCAL_TASK_FILE_MISSING,
      })
      .mockResolvedValue(emptyLocalBoard)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const error = await screen.findByTestId(TEST_ID.kanbanBoardError)
    expect(error.textContent).toContain('.nekode/tasks.json was not found')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardUseLocal))
    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.bindLocalFile).toHaveBeenCalledWith('p1')
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId(TEST_ID.kanbanBoardUseLocal)).toBeNull()
  })

  it.each([
    ['a missing project folder', 'The project folder was not found.'],
    ['an unknown project', 'Project "p1" not found.'],
  ])(
    'a local-file binding with %s shows the typed error without Use a local task list',
    async (_label, message) => {
      vi.mocked(app.projects.list).mockResolvedValue([projectA])
      mockLocalBinding('local-file')
      vi.mocked(app.kanban.listBoard).mockRejectedValue({
        nekodeAppError: true,
        code: 'not_found',
        message,
      })

      render(<App app={app} />)
      fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
      const error = await screen.findByTestId(TEST_ID.kanbanBoardError)
      expect(error.textContent).toBe(message)
      // Creating the task file cannot fix this, so the action is not offered.
      expect(screen.queryByTestId(TEST_ID.kanbanBoardUseLocal)).toBeNull()
      expect(app.kanban.bindLocalFile).not.toHaveBeenCalled()
    },
  )

  it('a bound process-adapter project still renders the existing list and offers no local action', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockBindings(app, ['p1'])
    vi.mocked(app.kanban.listBoard)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'not_found',
        message: 'Kanban adapter "plane" is not installed in the adapters directory.',
      })
      .mockResolvedValue(fixture)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(TEST_ID.kanbanBoardError)
    // A missing process adapter is not a missing task file.
    expect(screen.queryByTestId(TEST_ID.kanbanBoardUseLocal)).toBeNull()
    // The toolbar Refresh stays disabled until the failed load reports done.
    const refresh = screen.getByTestId(TEST_ID.kanbanBoardRefresh) as HTMLButtonElement
    await waitFor(() => expect(refresh.disabled).toBe(false))
    fireEvent.click(refresh)
    await screen.findByTestId(TEST_ID.kanbanList)
    expect(screen.getByText('First task')).toBeTruthy()
    expect(screen.getByText('Second task')).toBeTruthy()
    expect(app.kanban.bindLocalFile).not.toHaveBeenCalled()
  })
})
