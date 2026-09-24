import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo, TaskInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY, type AppApi } from '../../shared/ipc-contract'
import { App, TEST_ID, testIdFor } from './App'

// xterm.js needs a real canvas; mock it at the module boundary so App renders
// the task workspace in jsdom (the wiring is asserted in TaskTerminal.test).
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
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 't1',
        projectId: 'p1',
        name: 'Demo task',
        status: 'idle',
      }),
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
const taskOne: TaskInfo = { id: 't1', projectId: 'p1', name: 'First task', status: 'idle' }
const taskTwo: TaskInfo = { id: 't2', projectId: 'p1', name: 'Second task', status: 'idle' }

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

describe('project and task data flow', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the real project list and expands a project to its tasks', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.textContent).toContain('Demo')
    expect(screen.queryByTestId(TEST_ID.emptyProjectList)).toBeNull()

    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const taskRow = await screen.findByTestId(testIdFor.taskRow('t1'))
    expect(taskRow.textContent).toBe('First task')
    expect(app.tasks.list).toHaveBeenCalledWith('p1')
    // The active project gets the New Task input (UX-UI §10).
    expect(screen.getByTestId(TEST_ID.newTaskInput)).toBeTruthy()
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
    expect(screen.getByTestId(TEST_ID.newTaskInput)).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, '')
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

  it('new-task: creates the task under the active project and selects it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])
    vi.mocked(app.tasks.create).mockResolvedValue(taskTwo)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const input = await screen.findByTestId(TEST_ID.newTaskInput)
    fireEvent.change(input, { target: { value: 'Second task' } })
    fireEvent.submit(screen.getByTestId(TEST_ID.newTaskForm))

    await screen.findByTestId(testIdFor.taskRow('t2'))
    expect(app.tasks.create).toHaveBeenCalledWith('p1', 'Second task')
    const taskRow = getByTestIdString(testIdFor.taskRow('t2'))
    expect(taskRow.getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, 't2')
    expect((getByTestIdString(TEST_ID.newTaskInput) as HTMLInputElement).value).toBe('')
  })

  it('new-task: failures surface the typed error message and keep the input', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.create).mockRejectedValue({
      nekodeAppError: true,
      code: 'conflict',
      message: 'A task named "Dup" already exists in this project.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const input = await screen.findByTestId(TEST_ID.newTaskInput)
    fireEvent.change(input, { target: { value: 'Dup' } })
    fireEvent.submit(screen.getByTestId(TEST_ID.newTaskForm))

    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('already exists')
    expect((getByTestIdString(TEST_ID.newTaskInput) as HTMLInputElement).value).toBe('Dup')
  })

  it('remove-project: falls back to the default empty state and drops removed data', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.taskRow('t1'))

    fireEvent.click(screen.getByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    expect(await screen.findByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.headerProjectName)).toBeNull()
    expect(screen.queryByTestId(testIdFor.taskRow('t1'))).toBeNull()
    expect(app.projects.list).toHaveBeenCalledTimes(2)
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, '')
  })

  it('remove-project: keeps the current selection when a different project is removed', async () => {
    vi.mocked(app.projects.list)
      .mockResolvedValueOnce([projectA, projectNoRuntime])
      .mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.taskRow('t1'))
    fireEvent.click(screen.getByTestId(testIdFor.taskRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, 't1')

    vi.mocked(app.state.set).mockClear()
    fireEvent.click(screen.getByTestId(testIdFor.removeProject('p2')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(app.projects.list).toHaveBeenCalledTimes(2))

    expect(screen.queryByTestId(testIdFor.projectRow('p2'))).toBeNull()
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.taskRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, '')
  })

  it('writes the selection keys on every selection change', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, '')

    fireEvent.click(await screen.findByTestId(testIdFor.taskRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedTaskId, 't1')
  })

  it('hydrates the persisted selection without rewriting it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedTaskId) return 't1'
      return null
    })

    render(<App app={app} />)
    const taskRow = await screen.findByTestId(testIdFor.taskRow('t1'))
    expect(taskRow.getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(app.state.set).not.toHaveBeenCalled()
  })

  it('drops a stale persisted selection pointing at a removed project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p-gone'
      if (key === APP_STATE_KEY.selectedTaskId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe(
      'false',
    )
    expect(screen.queryByTestId(TEST_ID.headerProjectName)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.newTaskInput)).toBeNull()
    expect(app.tasks.list).not.toHaveBeenCalled()
  })

  it('drops a stale persisted task but keeps the valid project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedTaskId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.headerProjectName)
    expect(screen.getByTestId(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(getByTestIdString(testIdFor.taskRow('t1')).getAttribute('data-selected')).toBe('false')
    expect(screen.getByTestId(TEST_ID.newTaskInput)).toBeTruthy()
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

describe('task workspace (Stage 3)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('task selection opens the task workspace with the primary terminal', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.taskRow('t1')))

    const workspace = getByTestIdString(TEST_ID.taskWorkspace)
    expect(workspace.textContent).toContain('First task')
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // Lazy spawn on first attach: one PTY, cwd = the project directory.
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
  })

  it('switching tasks keeps both sessions (no respawn for the first task)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.tasks.list).mockResolvedValue([taskOne, taskTwo])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.taskRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId(testIdFor.taskRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByTestId(testIdFor.taskRow('t1')))
    // Back to task one: the same session is re-attached, not re-created.
    await waitFor(() => expect(screen.getByTestId(TEST_ID.taskWorkspace)).toBeTruthy())
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
