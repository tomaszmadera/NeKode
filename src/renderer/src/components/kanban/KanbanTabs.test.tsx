import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  ChatInfo,
  FileEntry,
  KanbanBoard,
  ProjectInfo,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { emptyGitWorktree, projectKanbanAdapterKey } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Kanban entry points (spec kanban-adapter-interface Behaviour 14, AC14): a
// project with a stored Kanban binding shows a `Kanban` tile as the first
// element of its expanded left-navigation content and a non-closable `Kanban`
// tab immediately after the chat tab; a project without a binding shows
// neither. Selecting either entry point shows the board in the center surface
// on its default List view (one lazy listBoard load), and the Board switch
// turns it into columns; selecting the chat tab or a file tab returns to
// that surface. No center-surface `Files | Kanban` view-switch strip exists.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))
vi.mock('../files/MonacoPreview', () => ({
  MonacoPreview: ({ content, language }: { content: string; language: string | null }) => (
    <pre data-testid="file-preview-monaco" data-language={language ?? 'plaintext'}>
      {content}
    </pre>
  ),
}))

function createAppApiStub(): AppApi {
  return {
    actions: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
    },
    projects: {
      wslDirectories: vi.fn(() => Promise.resolve([])),
      wslDistributions: vi.fn().mockResolvedValue([]),
      addWsl: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 't9', projectId: 'p1', name: 'PowerShell' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockResolvedValue('term-1'),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      shellName: vi.fn().mockResolvedValue('PowerShell'),
      shellList: vi.fn().mockResolvedValue([]),
      shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
      shellAddCustom: vi.fn().mockResolvedValue({ id: 'default', label: 'PowerShell' }),
      terminate: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi
        .fn()
        .mockResolvedValue({ branch: 'main', dirty: false, worktree: emptyGitWorktree() }),
      fileStatuses: vi.fn().mockResolvedValue({}),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
      openRoot: vi.fn().mockResolvedValue(undefined),
    },
    handoffs: {
      list: vi.fn().mockResolvedValue([]),
    },
    kanban: {
      adaptersList: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ adapterId: null, values: {}, secretKeys: [] }),
      setConfig: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue(undefined),
      listBoard: vi.fn().mockResolvedValue({ states: [], items: [] }),
      createItem: vi.fn(),
      updateItem: vi.fn(),
      getItem: vi.fn(),
      launchTask: vi.fn(),
      handoffCandidates: vi.fn(),
      handoffAvailability: vi.fn(async () => ({
        state: 'ready' as const,
        items: [],
        rejections: [],
      })),
    },
    agentProfiles: {
      get: vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }),
      put: vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }),
      delete: vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }),
    },
    dialogs: {
      pickDirectory: vi.fn().mockResolvedValue(null),
    },
  }
}

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

const rootEntries: FileEntry[] = [{ name: 'README.md', relativePath: 'README.md', kind: 'file' }]

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

function paneDisplay(relativePath: string): string {
  return screen.getByTestId(testIdFor.filePreviewPane(relativePath)).style.display
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

async function enterFilesMode(app: AppApi, projectId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testIdFor.projectFiles(projectId)))
  await screen.findByTestId(TEST_ID.fileTree)
  expect(app.files.list).toHaveBeenCalled()
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

  it('renders only for a bound project, as the first element under the project name row', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    // Expand the bound project; the tile proves the binding set has loaded.
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const tile = await screen.findByTestId(testIdFor.projectKanban('p1'))

    // …and expand the unbound project (both stay open).
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))

    // Bound project: tile present. Unbound project: none.
    expect(screen.getByTestId(testIdFor.projectKanban('p1'))).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.projectKanban('p2'))).toBeNull()

    // Position discriminator: the tile is the project row's immediate next
    // sibling (the first element of the expanded content), above the chat list.
    const row = screen.getByTestId(testIdFor.projectRow('p1'))
    expect(row.nextElementSibling?.contains(tile)).toBe(true)
    const chats = screen.getByTestId(testIdFor.projectChats('p1'))
    expect(tile.compareDocumentPosition(chats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const chatRow = screen.getByTestId(testIdFor.chatRow('t1'))
    expect(tile.compareDocumentPosition(chatRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the tile for a collapsed bound project (expanded content only)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectSelect('p1'))
    // Collapsed: no expanded content at all.
    expect(screen.queryByTestId(testIdFor.projectKanban('p1'))).toBeNull()
    fireEvent.click(row)
    expect(await screen.findByTestId(testIdFor.projectKanban('p1'))).toBeTruthy()
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

  it('sits immediately after the chat tab and only for a bound project, non-closable', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    // Bound project: the tab appears (its presence proves the binding loaded).
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const kanbanTab = await screen.findByTestId(TEST_ID.kanbanTab)
    const strip = screen.getByTestId(TEST_ID.tabStrip)
    const chatTab = screen.getByTestId(TEST_ID.tabTerminal)
    expect(strip.firstElementChild).toBe(chatTab)
    expect(chatTab.nextElementSibling).toBe(kanbanTab)
    // Non-closable: no close control inside the tab.
    expect(within(kanbanTab).queryByRole('button', { name: /Close/ })).toBeNull()

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

  it('selecting the nav tile activates the Kanban tab and loads the board once (lazy)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const tile = await screen.findByTestId(testIdFor.projectKanban('p1'))
    // Lazy: nothing loaded before the tile is selected.
    expect(app.kanban.listBoard).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).toBeNull()

    fireEvent.click(tile)
    // The default view is the list; the load fires once either way.
    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(1)
    expect(app.kanban.listBoard).toHaveBeenCalledWith('p1')
    // The Board switch renders the fixture columns (state name + titles).
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanViewBoard))
    const backlog = await screen.findByTestId(testIdFor.kanbanColumn('s1'))
    expect(within(backlog).getByText('Backlog')).toBeTruthy()
    expect(within(backlog).getByTestId(testIdFor.kanbanItem('NK-1')).textContent).toContain(
      'First task',
    )
    // The Kanban tab is the active tab while the board shows.
    expect(isSelected(TEST_ID.kanbanTab)).toBe(true)
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
  })

  it('selecting the top-strip tab shows the board, which the chat tab then leaves', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))

    await screen.findByTestId(TEST_ID.kanbanList)
    expect(app.kanban.listBoard).toHaveBeenCalledWith('p1')

    // Chat tab shows the terminal surface instead; the board unmounts.
    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
    )
    expect(screen.getByTestId(TEST_ID.kanbanBoard).parentElement?.style.display).toBe('none')
    expect(isSelected(TEST_ID.tabTerminal)).toBe(true)
  })

  it('a file tab returns to its preview from the board', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(fixture)
    mockBindings(app, ['p1'])
    vi.mocked(app.files.list).mockImplementation(async (_projectId, relativePath) =>
      relativePath === null ? rootEntries : [],
    )

    render(<App app={app} />)
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))

    // Board up: the active file tab's preview is hidden.
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(TEST_ID.kanbanBoard)
    expect(paneDisplay('README.md')).toBe('none')

    // Selecting the file tab is a "show me this file" gesture: the preview
    // returns and the board unmounts.
    const readmeTab = screen.getByTestId(testIdFor.tabFile('README.md'))
    fireEvent.click(within(readmeTab).getByRole('button', { name: 'README.md' }))
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
    expect(screen.getByTestId(TEST_ID.kanbanBoard).parentElement?.style.display).toBe('none')
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

  it('keeps a chat selected in the tile project, so the chat tab still shows it', async () => {
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

    // The nav tile is an equivalent entry point (Behaviour 14): opening the
    // board of the already-selected project must NOT discard its chat selection.
    fireEvent.click(await screen.findByTestId(testIdFor.projectKanban('p1')))
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
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanViewBoard))
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemTitle(fixture.items[0].ref)))
    const board = screen.getByTestId(TEST_ID.kanbanBoard)
    const review = screen.getByTestId(TEST_ID.kanbanReview)
    board.scrollTop = 80
    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    expect(board.parentElement?.style.display).toBe('none')
    expect(app.kanban.listBoard).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanTab))
    expect(board.parentElement?.style.display).toBe('flex')
    expect(screen.getByTestId(TEST_ID.kanbanReview)).toBe(review)
    expect(screen.getByRole('status').textContent).toBe('Refreshing board...')
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
    expect(within(board).getByTestId(TEST_ID.kanbanViewBoard).getAttribute('aria-pressed')).toBe(
      'true',
    )
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
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanBoardRefresh))
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
