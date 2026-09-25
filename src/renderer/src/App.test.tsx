import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatInfo, ProjectInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY, type AppApi } from '../../shared/ipc-contract'
import { App, TEST_ID, testIdFor } from './App'
import { resetMockFitAddons } from './test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from './test/xterm-mock'

// xterm.js needs a real canvas; mock it at the module boundary so App renders
// the chat workspace in jsdom (the wiring is asserted in ChatTerminal.test).
vi.mock('@xterm/xterm', () => import('./test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./test/fit-addon-mock'))

function createAppApiStub(): AppApi {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({
        id: 'p1',
        name: 'Demo',
        path: 'D:/code/demo',
        runtimeLabel: 'Node',
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 't1',
        projectId: 'p1',
        name: 'Demo chat',
      }),
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
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', dirty: false }),
    },
  }
}

function getByTestIdString(testId: string): HTMLElement {
  const element = screen.getByTestId(testId)
  expect(element).toBeTruthy()
  return element
}

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  coordinates: { clientX?: number; clientY?: number } = {},
): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        button: 0,
        pointerId: 1,
        ...coordinates,
      }),
    )
  })
}

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const projectNoRuntime: ProjectInfo = {
  id: 'p2',
  name: 'Plain',
  path: 'D:/code/plain',
  runtimeLabel: null,
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }
const chatTwo: ChatInfo = { id: 't2', projectId: 'p1', name: 'Second chat' }

describe('application shell', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the five shell regions', () => {
    render(<App app={app} />)
    expect(screen.getByTestId(TEST_ID.topBar)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.leftNav)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.centerHeader)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.centerSurface)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.bottomRegion)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.rightRegion)).toBeTruthy()
  })

  it('shows the default empty state (UX-UI §6)', async () => {
    render(<App app={app} />)
    const emptyList = getByTestIdString(TEST_ID.emptyProjectList)
    expect(emptyList.textContent).toContain('No projects yet')
    const welcome = getByTestIdString(TEST_ID.welcomeSurface)
    expect(welcome.textContent).toContain('Welcome to NeKode')
    expect(getByTestIdString(TEST_ID.rightRegion).style.display).toBe('none')
    expect(getByTestIdString(TEST_ID.bottomRegion).style.display).toBe('none')
    await Promise.resolve()
    expect(app.projects.list).toHaveBeenCalledTimes(1)
  })

  it('offers an Add Project affordance and resizable handles', () => {
    render(<App app={app} />)
    const addProject = getByTestIdString(TEST_ID.addProjectButton)
    expect(addProject.textContent).toBe('Add Project')
    expect(screen.getByTestId(TEST_ID.leftResizeHandle)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.bottomResizeHandle)).toBeTruthy()
  })

  it('keeps the region contract when projects.list rejects', async () => {
    vi.mocked(app.projects.list).mockRejectedValueOnce(new Error('stub rejected'))
    render(<App app={app} />)
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.getByTestId(TEST_ID.appShell)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
  })
})

describe('project and chat data flow', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the real project list and expands a project to its chats', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.textContent).toContain('Demo')
    expect(screen.queryByTestId(TEST_ID.emptyProjectList)).toBeNull()

    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(chatRow.textContent).toBe('First chat')
    expect(app.chats.list).toHaveBeenCalledWith('p1')
    // The active project gets the New Chat button (UX-UI §10): no naming form.
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('add-project: dialog result refreshes the list and selects the new project', async () => {
    let resolveInitialList: ((projects: ProjectInfo[]) => void) | null = null
    vi.mocked(app.projects.list)
      .mockImplementationOnce(
        () =>
          new Promise<ProjectInfo[]>((resolve) => {
            resolveInitialList = resolve
          }),
      )
      .mockResolvedValue([projectA])
    vi.mocked(app.projects.add).mockResolvedValue(projectA)

    render(<App app={app} />)
    await act(async () => {
      resolveInitialList?.([])
    })
    expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy()

    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))
    expect(app.projects.list).toHaveBeenCalledTimes(2)

    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('add-project: cancelling the dialog (null) keeps the default empty state', async () => {
    vi.mocked(app.projects.add).mockResolvedValue(null)

    render(<App app={app} />)
    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))

    expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(app.projects.list).toHaveBeenCalledTimes(1)
    expect(app.state.set).not.toHaveBeenCalled()
  })

  it('add-project: failures surface the typed error message', async () => {
    vi.mocked(app.projects.add).mockRejectedValue({
      nekodeAppError: true,
      code: 'conflict',
      message: 'This directory is already registered as a project.',
    })

    render(<App app={app} />)
    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('already registered')
  })

  it('new-chat: creates the chat immediately (no naming form) and selects it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.chats.create).mockResolvedValue(chatTwo)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    // No name is typed anywhere: the button creates the chat right away and
    // main derives the name from the shell (spec Behaviour 3).
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))

    await screen.findByTestId(testIdFor.chatRow('t2'))
    expect(app.chats.create).toHaveBeenCalledWith('p1')
    expect(app.chats.create).toHaveBeenCalledTimes(1)
    const chatRow = getByTestIdString(testIdFor.chatRow('t2'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  it('new-chat: two chats may carry the same name (shell label, duplicates allowed)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    // Both chats share the same shell-derived name.
    vi.mocked(app.chats.create)
      .mockResolvedValueOnce({ id: 't1', projectId: 'p1', name: 'PowerShell' })
      .mockResolvedValueOnce({ id: 't2', projectId: 'p1', name: 'PowerShell' })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    fireEvent.click(screen.getByTestId(TEST_ID.newChatButton))
    await screen.findByTestId(testIdFor.chatRow('t2'))

    expect(screen.getByTestId(testIdFor.chatRow('t1')).textContent).toBe('PowerShell')
    expect(screen.getByTestId(testIdFor.chatRow('t2')).textContent).toBe('PowerShell')
    expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true')
  })

  it('Start new chat expands a collapsed project so the new chat row is visible', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't9',
      projectId: 'p1',
      name: 'PowerShell',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    // An empty selected project shows the "Start new chat" empty state
    // (spec Behaviour 11)…
    await screen.findByTestId(TEST_ID.startNewChatState)
    // …and the user collapses the project node: its chat subtree unmounts.
    fireEvent.click(screen.getByTestId(testIdFor.projectToggle('p1')))
    expect(screen.queryByTestId(testIdFor.projectChats('p1'))).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.startNewChatButton))
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    // The chat is created and selected — and its row must be visible in the
    // tree: creating a chat re-expands its project node (spec Behaviour 3).
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t9'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(testIdFor.projectChats('p1'))).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('new-chat: failures surface the typed error message and keep the affordance', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.create).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'Project not found.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))

    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Project not found.')
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('remove-project: falls back to the default empty state and drops removed data', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))

    fireEvent.click(screen.getByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    expect(await screen.findByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.headerProjectName)).toBeNull()
    expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull()
    expect(app.projects.list).toHaveBeenCalledTimes(2)
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('remove-project: keeps the current selection when a different project is removed', async () => {
    vi.mocked(app.projects.list)
      .mockResolvedValueOnce([projectA, projectNoRuntime])
      .mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')

    vi.mocked(app.state.set).mockClear()
    fireEvent.click(screen.getByTestId(testIdFor.removeProject('p2')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(app.projects.list).toHaveBeenCalledTimes(2))

    expect(screen.queryByTestId(testIdFor.projectRow('p2'))).toBeNull()
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('writes the selection keys on every selection change', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')

    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')
  })

  it('hydrates the persisted selection without rewriting it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      return null
    })

    render(<App app={app} />)
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(app.state.set).not.toHaveBeenCalled()
  })

  it('drops a stale persisted selection pointing at a removed project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p-gone'
      if (key === APP_STATE_KEY.selectedChatId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe(
      'false',
    )
    expect(screen.queryByTestId(TEST_ID.headerProjectName)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.newChatButton)).toBeNull()
    expect(app.chats.list).not.toHaveBeenCalled()
  })

  it('drops a stale persisted chat but keeps the valid project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.headerProjectName)
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('false')
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('renders the project name, absolute path and runtime label in the context header', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(screen.getByTestId(TEST_ID.headerProjectPath).textContent).toBe('D:/code/demo')
    expect(screen.getByTestId(TEST_ID.headerRuntimeLabel).textContent).toBe('Node 24')
  })

  it('omits the runtime badge when the project has no runtime label', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectNoRuntime])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p2')))

    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Plain')
    expect(screen.queryByTestId(TEST_ID.headerRuntimeLabel)).toBeNull()
  })

  it('hydrates region sizes from persisted state', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.leftRegionWidth) return '340'
      if (key === APP_STATE_KEY.bottomRegionHeight) return '300'
      return null
    })

    render(<App app={app} />)
    await waitFor(() => {
      expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('340px')
    })
    expect(app.state.get).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth)
    expect(app.state.get).toHaveBeenCalledWith(APP_STATE_KEY.bottomRegionHeight)
  })

  it('falls back to default region sizes for unparsable persisted values', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.leftRegionWidth) return 'not-a-size'
      return null
    })

    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalledTimes(1))
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('280px')
  })

  it('persists the left region width when the resize ends', () => {
    render(<App app={app} />)
    const handle = screen.getByTestId(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 350 })
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, expect.anything())

    firePointer(handle, 'pointerup', { clientX: 350 })
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, '350')
  })
})

describe('chat workspace (Stage 3)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('chat selection opens the chat workspace with the primary terminal', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))

    const workspace = getByTestIdString(TEST_ID.chatWorkspace)
    expect(workspace.textContent).toContain('First chat')
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // Lazy spawn on first attach: one PTY, cwd = the project directory.
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
  })

  it('switching chats keeps both sessions (no respawn for the first chat)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    // Back to chat one: the same session is re-attached, not re-created.
    await waitFor(() => expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBeTruthy())
    expect(app.terminals.create).toHaveBeenCalledTimes(2)
  })

  it('shows the git branch and worktree status in the context header', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.git.getStatus).mockResolvedValue({ branch: 'feature/meta-pixel', dirty: true })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledWith('D:/code/demo'))
    expect((await screen.findByTestId(TEST_ID.headerGitBranch)).textContent).toBe(
      'feature/meta-pixel',
    )
    expect(screen.getByTestId(TEST_ID.headerGitStatus).textContent).toContain('dirty')
  })

  it('shows a clean worktree status', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.git.getStatus).mockResolvedValue({ branch: 'main', dirty: false })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    expect((await screen.findByTestId(TEST_ID.headerGitBranch)).textContent).toBe('main')
    expect(screen.getByTestId(TEST_ID.headerGitStatus).textContent).toContain('clean')
  })

  it('degrades the header to "no git" when git fails (spec Errors)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.git.getStatus).mockRejectedValue(new Error('git missing'))

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    expect(await screen.findByTestId(TEST_ID.headerGitNone)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.headerGitBranch)).toBeNull()
    // The workspace still renders despite the git failure.
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
  })
})

describe('resize persistence refinements (Stage 3 carry-over)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not persist the size on a zero-move click', () => {
    render(<App app={app} />)
    const handle = screen.getByTestId(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointerup', { clientX: 280 })
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, expect.anything())
  })

  it('supports keyboard resize via the separator handle (a11y)', () => {
    render(<App app={app} />)
    const handle = screen.getByTestId(TEST_ID.leftResizeHandle)
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-valuenow')).toBe('280')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('296px')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, '296')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('280px')
  })

  it('surfaces state.set rejections in the notice banner (spec Errors)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.set).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Database is locked.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database is locked.')
  })
})

describe('chat closing on terminal exit (Stage 4)', () => {
  let app: AppApi
  let exitListenersByChat: Map<string, Set<(exitCode: number) => void>>

  function emitExit(chatId: string, exitCode: number): void {
    act(() => {
      for (const listener of [...(exitListenersByChat.get(chatId) ?? [])]) {
        listener(exitCode)
      }
    })
  }

  beforeEach(() => {
    app = createAppApiStub()
    exitListenersByChat = new Map()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(app.terminals.onExit).mockImplementation(
      (chatId: string, callback: (exitCode: number) => void) => {
        const listeners = exitListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        exitListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
  })

  afterEach(() => {
    cleanup()
  })

  async function renderWithChats(chats: ChatInfo[], selectedChatId: string | null) {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue(chats)
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return selectedChatId
      return null
    })
    const view = render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    return view
  }

  it('terminal exit disposes the view, removes the chat and selects the next chat', async () => {
    const { unmount } = await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const firstTerminal = mockTerminalInstances[0]

    // `exit` in the chat terminal: the chat closes (spec Behaviour 11).
    emitExit('t1', 0)

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    // The terminal view is disposed with the close.
    await waitFor(() => expect(firstTerminal.dispose).toHaveBeenCalledTimes(1))
    // The chat disappears from the tree…
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    // …and the app continues on the next chat of the project in tree order.
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true'),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
    unmount()
  })

  it('Ctrl+D at an empty input line closes the chat like a terminal exit (spec AC9)', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const terminal = mockTerminalInstances[0]
    expect(terminal.keyHandler).not.toBeNull()

    // PowerShell does not end on Ctrl+D: the app intercepts the shortcut at an
    // empty input line and runs the same close flow as a terminal exit.
    act(() => {
      const allowed = (terminal.keyHandler as (event: KeyboardEvent) => boolean)(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }),
      )
      expect(allowed).toBe(false)
    })

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true'),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  it('closing the last chat selects the previous one, then the Start new chat state', async () => {
    await renderWithChats([chatOne, chatTwo], 't2')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', 'D:/code/demo'))

    // The closed chat was last in tree order: the previous chat is selected.
    emitExit('t2', 0)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull())
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true'),
    )

    // Closing that one too leaves the project without chats: the empty state
    // offers "Start new chat" (spec Behaviour 11).
    emitExit('t1', 0)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    const emptyState = await screen.findByTestId(TEST_ID.startNewChatState)
    expect(emptyState.textContent).toContain('No chats in this project')
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')

    // The affordance creates a chat immediately (spec Behaviour 3 — no form).
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't3',
      projectId: 'p1',
      name: 'PowerShell',
    })
    fireEvent.click(screen.getByTestId(TEST_ID.startNewChatButton))
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    await screen.findByTestId(testIdFor.chatRow('t3'))
    expect(getByTestIdString(testIdFor.chatRow('t3')).getAttribute('data-selected')).toBe('true')
  })

  it('a background chat that exits is removed without stealing the selection', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))

    // Chat one's hidden terminal exits on its own: the chat closes (removed
    // from the tree and the database) but the viewed chat stays selected.
    emitExit('t1', 3)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')
  })

  it('closing a chat surfaces a typed error when the removal fails', async () => {
    vi.mocked(app.chats.remove).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Database error.',
    })
    await renderWithChats([chatOne], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    emitExit('t1', 0)
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database error.')
  })

  it('quit does not remove chats: unmounting the app never calls chats.remove', async () => {
    const { unmount } = await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    // Application quit terminates PTYs in main and suppresses the exit events
    // that would start this close flow (spec Behaviour 8). Window teardown in
    // the renderer must not remove chats either — the tree and the database
    // survive the restart unchanged (spec Behaviours 8, 10).
    unmount()
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('two chats exiting in the same tick leave no dead selection (Start new chat)', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    // Open a session for the second chat as well, then look at the first.
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))

    // Both chat shells end in the same tick (near-simultaneous exits).
    act(() => {
      for (const listener of [...(exitListenersByChat.get('t1') ?? [])]) {
        listener(0)
      }
      for (const listener of [...(exitListenersByChat.get('t2') ?? [])]) {
        listener(0)
      }
    })

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(2))
    // The project is left without chats: the center surface shows the
    // "Start new chat" empty state — never a dead area caused by a selection
    // pointing at a chat that the other close flow already removed.
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull()
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.chatWorkspace)).toBeNull()
    // The persisted selection is cleared instead of keeping the dead id.
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('a failed removal leaves the chat closable: the next terminal exit closes it', async () => {
    vi.mocked(app.chats.remove)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'sqlite',
        message: 'Database error.',
      })
      .mockResolvedValue(undefined)
    await renderWithChats([chatOne], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    // First exit: the removal fails, so the chat stays in the tree…
    emitExit('t1', 0)
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database error.')
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()

    // …but re-selecting it opens a fresh session whose exit must close it —
    // the failed attempt must not leave the chat permanently un-closable.
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    emitExit('t1', 0)

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
  })
})
