import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, ProjectInfo, TaskInfo } from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from '../../test/xterm-mock'
import { TaskWorkspace } from './TaskWorkspace'

// Session-host tests with the app bridge and xterm.js mocked: task selection
// opens the workspace, switching tasks preserves sessions and scrollback
// (same taskId keeps its session handle), and ended/failed sessions surface
// their states with a close-and-restart affordance.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const taskOne: TaskInfo = { id: 't1', projectId: 'p1', name: 'First task', status: 'idle' }
const taskTwo: TaskInfo = { id: 't2', projectId: 'p1', name: 'Second task', status: 'idle' }

interface AppMockBundle {
  app: AppApi
  exitListeners: Set<(exitCode: number) => void>
  emitExit: (exitCode: number) => void
  emitData: (taskId: string, data: string) => void
}

function createAppMock(): AppMockBundle {
  const exitListeners = new Set<(exitCode: number) => void>()
  const dataListenersByTask = new Map<string, Set<(data: string) => void>>()
  const app: AppApi = {
    projects: {
      list: vi.fn().mockResolvedValue([projectA]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([taskOne, taskTwo]),
      create: vi.fn().mockResolvedValue(taskTwo),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockImplementation((taskId: string) => Promise.resolve(taskId)),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((taskId: string, cb: (data: string) => void) => {
        const listeners = dataListenersByTask.get(taskId) ?? new Set()
        listeners.add(cb)
        dataListenersByTask.set(taskId, listeners)
        return () => {
          listeners.delete(cb)
        }
      }),
      onExit: vi.fn((_taskId: string, cb: (exitCode: number) => void) => {
        exitListeners.add(cb)
        return () => {
          exitListeners.delete(cb)
        }
      }),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', dirty: false }),
    },
  }
  return {
    app,
    exitListeners,
    emitExit: (exitCode) => {
      for (const listener of [...exitListeners]) {
        listener(exitCode)
      }
    },
    emitData: (taskId, data) => {
      for (const listener of [...(dataListenersByTask.get(taskId) ?? [])]) {
        listener(data)
      }
    },
  }
}

function renderWorkspace(
  bundle: AppMockBundle,
  props: { taskId: string | null; selectionNonce: number },
) {
  return render(
    <TaskWorkspace
      app={bundle.app}
      projects={[projectA]}
      tasksByProject={{ p1: [taskOne, taskTwo] }}
      selectedProjectId="p1"
      selectedTaskId={props.taskId}
      selectionNonce={props.selectionNonce}
    />,
  )
}

describe('TaskWorkspace session host', () => {
  beforeEach(() => {
    resetMockTerminals()
    resetMockFitAddons()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the welcome surface until a task is selected, then opens the workspace', async () => {
    const bundle = createAppMock()
    const { rerender } = renderWorkspace(bundle, { taskId: null, selectionNonce: 0 })
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.taskWorkspace)).toBeNull()
    expect(bundle.app.terminals.create).not.toHaveBeenCalled()

    rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[projectA]}
        tasksByProject={{ p1: [taskOne, taskTwo] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={1}
      />,
    )
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    const workspace = screen.getByTestId(TEST_ID.taskWorkspace)
    expect(workspace.textContent).toContain('First task')
    await waitFor(() =>
      expect(bundle.app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'),
    )
  })

  it('preserves sessions across task switches (same taskId keeps its session handle)', async () => {
    const bundle = createAppMock()
    const view = renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]

    // Switch to task two: its own lazy spawn; task one stays alive and hidden.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[projectA]}
        tasksByProject={{ p1: [taskOne, taskTwo] }}
        selectedProjectId="p1"
        selectedTaskId="t2"
        selectionNonce={2}
      />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    expect(bundle.app.terminals.create).toHaveBeenLastCalledWith('t2', 'D:/code/demo')
    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('none')
    expect(screen.getByTestId(testIdFor.terminalView('t2')).style.display).toBe('block')

    // Back to task one: re-attach to the same session — no respawn, no
    // scrollback reset (the same xterm instance keeps its buffer).
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[projectA]}
        tasksByProject={{ p1: [taskOne, taskTwo] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={3}
      />,
    )
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2)
    expect(mockTerminalInstances).toHaveLength(2)
    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block')

    // Background data keeps flowing into the hidden terminal's scrollback
    // (writes targeted at a hidden terminal still reach its PTY, spec Edge
    // cases — here the reverse direction: PTY output into the hidden view).
    act(() => {
      bundle.emitData('t1', 'background output')
    })
    expect(firstTerminal.written).toContain('background output')
  })

  it('shows the session-ended state with the exit code and can close it for a fresh session', async () => {
    const bundle = createAppMock()
    renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))

    act(() => {
      bundle.emitExit(3)
    })
    const ended = await screen.findByTestId(TEST_ID.terminalSessionEnded)
    expect(ended.textContent).toContain('exit code 3')

    // The dead session can be closed: starting over spawns a fresh process.
    fireEvent.click(screen.getByTestId(TEST_ID.terminalStartNewSession))
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    expect(bundle.app.terminals.create).toHaveBeenLastCalledWith('t1', 'D:/code/demo')
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.terminalSessionEnded)).toBeNull())
  })

  it('re-selecting an ended session spawns a fresh session (spec Edge cases)', async () => {
    const bundle = createAppMock()
    const view = renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    act(() => {
      bundle.emitExit(0)
    })
    await screen.findByTestId(TEST_ID.terminalSessionEnded)

    // Explicit re-selection (nonce bump, same task id) closes the dead
    // session and spawns a fresh one.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[projectA]}
        tasksByProject={{ p1: [taskOne, taskTwo] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={2}
      />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
  })

  it('a projects/tasks reload never respawns an ended session (explicit re-selection only)', async () => {
    const bundle = createAppMock()
    const view = renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]
    act(() => {
      bundle.emitExit(3)
    })
    await screen.findByTestId(TEST_ID.terminalSessionEnded)

    // Data refresh (e.g. removing an unrelated project re-fetches the lists):
    // same records, fresh object identities. The ended session must survive
    // unchanged — no fresh PTY, no destroyed ended state.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[{ ...projectA }]}
        tasksByProject={{ p1: [{ ...taskOne }, { ...taskTwo }] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={1}
      />,
    )
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1)
    expect(mockTerminalInstances).toHaveLength(1)
    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(TEST_ID.terminalSessionEnded)).toBeTruthy()

    // Only an explicit re-selection (selection nonce bump) spawns a fresh one.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[{ ...projectA }]}
        tasksByProject={{ p1: [{ ...taskOne }, { ...taskTwo }] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={2}
      />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.terminalSessionEnded)).toBeNull())
  })

  it('a projects/tasks reload never retries a failed spawn (explicit re-selection only)', async () => {
    const bundle = createAppMock()
    vi.mocked(bundle.app.terminals.create).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'not_found',
      message: 'The project directory does not exist.',
    })
    const view = renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await screen.findByTestId(TEST_ID.terminalSpawnError)

    // The spawn-error state survives the same refresh unaltered.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[{ ...projectA }]}
        tasksByProject={{ p1: [{ ...taskOne }, { ...taskTwo }] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={1}
      />,
    )
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(TEST_ID.terminalSpawnError)).toBeTruthy()

    // Explicit re-selection retries the spawn.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[{ ...projectA }]}
        tasksByProject={{ p1: [{ ...taskOne }, { ...taskTwo }] }}
        selectedProjectId="p1"
        selectedTaskId="t1"
        selectionNonce={2}
      />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
  })

  it('evicts session views for removed tasks and disposes their xterm instances', async () => {
    const bundle = createAppMock()
    const view = renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]

    // The task disappears from every project's task list (project deletion
    // cascade): its view must unmount and tear down the xterm + subscriptions.
    view.rerender(
      <TaskWorkspace
        app={bundle.app}
        projects={[]}
        tasksByProject={{}}
        selectedProjectId={null}
        selectedTaskId={null}
        selectionNonce={1}
      />,
    )
    expect(screen.queryByTestId(testIdFor.terminalView('t1'))).toBeNull()
    await waitFor(() => expect(firstTerminal.dispose).toHaveBeenCalledTimes(1))
    // Bridge subscriptions are torn down with the view (exit listeners gone).
    expect(bundle.exitListeners.size).toBe(0)
    act(() => {
      bundle.emitData('t1', 'after eviction')
    })
    expect(firstTerminal.written).not.toContain('after eviction')
  })

  it('surfaces the spawn-error state with a retry affordance', async () => {
    const bundle = createAppMock()
    vi.mocked(bundle.app.terminals.create)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'not_found',
        message: 'The project directory does not exist.',
      })
      .mockImplementation((taskId: string) => Promise.resolve(taskId))

    renderWorkspace(bundle, { taskId: 't1', selectionNonce: 1 })
    const errorState = await screen.findByTestId(TEST_ID.terminalSpawnError)
    expect(errorState.textContent).toContain('The project directory does not exist.')
    expect(screen.queryByTestId(TEST_ID.terminalSessionEnded)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.terminalRetry))
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.terminalSpawnError)).toBeNull())
  })
})
