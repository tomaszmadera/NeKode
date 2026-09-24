import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL } from '../../shared/ipc-contract'
import { APP_ERROR_MARKER } from '../../shared/ipc-error'
import {
  type PtyFactory,
  type PtyProcessLike,
  type PtySpawnOptions,
  TerminalService,
} from '../services/terminal/terminal-service'
import { registerAppIpcHandlers } from './ipc-handlers'
import type { AppServices } from './service-registry'

// Registered-handler tests (plan carry-over: the previous stub tests never
// invoked the handlers, leaving sender guarding, payload slicing and the
// dialog flow uncovered). A fake IpcMain captures the registered callbacks.

/** Minimal fake PTY (no real processes): records kill() for teardown asserts. */
class FakePty implements PtyProcessLike {
  readonly pid: number
  readonly options: PtySpawnOptions
  killCount = 0

  constructor(pid: number, options: PtySpawnOptions) {
    this.pid = pid
    this.options = options
  }

  write(): void {}
  resize(): void {}
  kill(): void {
    this.killCount += 1
  }
  onData(): { dispose(): void } {
    return { dispose: () => undefined }
  }
  onExit(): { dispose(): void } {
    return { dispose: () => undefined }
  }
}

type Handler = (event: IpcMainInvokeEvent, ...payload: unknown[]) => unknown

function createFakeIpcMain(): {
  ipcMain: IpcMain
  invoke: (channel: string, payload: unknown[], url?: string) => unknown
} {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  } as unknown as IpcMain
  function invoke(channel: string, payload: unknown[], url = 'file:///renderer/index.html') {
    const handler = handlers.get(channel)
    if (handler === undefined) {
      throw new Error(`no handler registered for ${channel}`)
    }
    // The handler asserts senderFrame === sender.mainFrame (main-frame only).
    const frame = { url }
    const event = {
      senderFrame: frame,
      sender: { mainFrame: frame },
    } as unknown as IpcMainInvokeEvent
    return handler(event, ...payload)
  }
  return { ipcMain, invoke }
}

interface Harness {
  services: AppServices
  broadcasts: Array<{ channel: string; taskId: string; payload: string | number }>
  invoke: ReturnType<typeof createFakeIpcMain>['invoke']
  showOpenDialog: ReturnType<typeof vi.fn>
}

function createHarness(): Harness {
  const terminalListeners: {
    data: Array<(taskId: string, data: string) => void>
    exit: Array<(taskId: string, exitCode: number) => void>
  } = { data: [], exit: [] }

  const services: AppServices = {
    projects: {
      list: vi.fn(() => []),
      add: vi.fn((path: string) => ({
        id: 'p1',
        name: 'demo',
        path,
        runtimeLabel: null,
      })),
      remove: vi.fn(),
    },
    tasks: {
      list: vi.fn(() => []),
      create: vi.fn(() => ({ id: 't1', projectId: 'p1', name: 'n', status: 'idle' as const })),
    },
    state: { get: vi.fn(() => null), set: vi.fn() },
    terminals: {
      create: vi.fn(() => 't1'),
      write: vi.fn(),
      resize: vi.fn(),
      terminate: vi.fn(),
      terminateAll: vi.fn(),
      onData: (listener) => {
        terminalListeners.data.push(listener)
        return () => undefined
      },
      onExit: (listener) => {
        terminalListeners.exit.push(listener)
        return () => undefined
      },
    },
    git: {
      getStatus: vi.fn(() => Promise.resolve({ branch: 'main', dirty: false })),
    },
  }

  const broadcasts: Array<{ channel: string; taskId: string; payload: string | number }> = []
  const { ipcMain, invoke } = createFakeIpcMain()
  const showOpenDialog = vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] as string[] }))
  registerAppIpcHandlers(ipcMain, services, {
    showOpenDialog: showOpenDialog as never,
    trustedRendererUrls: ['file:///renderer/index.html'],
    broadcast: (channel, taskId, payload) => {
      broadcasts.push({ channel, taskId, payload })
    },
  })

  // Expose the listener arrays for event fan-out tests via the services mock.
  ;(services as unknown as { __listeners: typeof terminalListeners }).__listeners =
    terminalListeners

  return { services, broadcasts, invoke, showOpenDialog }
}

describe('registered ipc handlers', () => {
  it('invokes services through validation and slices payloads', async () => {
    const { services, invoke } = createHarness()
    await invoke(IPC_CHANNEL.terminalsCreate, ['t1', 'D:/code/demo'])
    expect(services.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo')

    await invoke(IPC_CHANNEL.terminalsResize, ['t1', 120, 40])
    expect(services.terminals.resize).toHaveBeenCalledWith('t1', 120, 40)

    await invoke(IPC_CHANNEL.stateSet, ['k', 'v'])
    expect(services.state.set).toHaveBeenCalledWith('k', 'v')
  })

  it('rejects invalid payloads with a typed serialized error', () => {
    const { invoke } = createHarness()
    try {
      invoke(IPC_CHANNEL.terminalsResize, ['t1', Number.NaN, 40])
      expect.unreachable('validation must reject')
    } catch (error) {
      expect((error as Error).message).toContain(APP_ERROR_MARKER)
      expect((error as Error).message).toContain('validation')
    }
  })

  it('rejects untrusted senders before touching services', () => {
    const { services, invoke } = createHarness()
    expect(() => invoke(IPC_CHANNEL.tasksList, ['p1'], 'file:///untrusted/index.html')).toThrow(
      /untrusted/,
    )
    expect(services.tasks.list).not.toHaveBeenCalled()
  })

  it('projects:add routes the dialog result and cancels to null', async () => {
    const harness = createHarness()
    harness.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(harness.invoke(IPC_CHANNEL.projectsAdd, [])).resolves.toBeNull()
    expect(harness.services.projects.add).not.toHaveBeenCalled()

    harness.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['D:/code/demo'],
    })
    await expect(harness.invoke(IPC_CHANNEL.projectsAdd, [])).resolves.toEqual({
      id: 'p1',
      name: 'demo',
      path: 'D:/code/demo',
      runtimeLabel: null,
    })
    expect(harness.services.projects.add).toHaveBeenCalledWith('D:/code/demo')
  })

  it('projects:remove terminates the removed project’s orphaned PTYs (fake PTY)', () => {
    const ptys: FakePty[] = []
    const createPty: PtyFactory = (options) => {
      const pty = new FakePty(1000 + ptys.length, options)
      ptys.push(pty)
      return pty
    }
    const terminals = new TerminalService({ createPty, isDirectory: () => true })
    const tasks = [
      { id: 't1', projectId: 'p1', name: 'a', status: 'idle' as const },
      { id: 't2', projectId: 'p1', name: 'b', status: 'idle' as const },
      { id: 't3', projectId: 'p2', name: 'c', status: 'idle' as const },
    ]
    const services: AppServices = {
      projects: {
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      tasks: {
        list: vi.fn((projectId: string) => tasks.filter((task) => task.projectId === projectId)),
        create: vi.fn(() => tasks[0]),
      },
      state: { get: vi.fn(() => null), set: vi.fn() },
      terminals,
      git: { getStatus: vi.fn(() => Promise.resolve({ branch: null, dirty: false })) },
    }
    const { ipcMain, invoke } = createFakeIpcMain()
    registerAppIpcHandlers(ipcMain, services, {
      showOpenDialog: vi.fn() as never,
      trustedRendererUrls: ['file:///renderer/index.html'],
    })

    // Live sessions: two tasks of p1 and one task of another project.
    terminals.create('t1', 'D:/a')
    terminals.create('t2', 'D:/a')
    terminals.create('t3', 'D:/b')
    expect(ptys.map((pty) => pty.killCount)).toEqual([0, 0, 0])

    invoke(IPC_CHANNEL.projectsRemove, ['p1'])

    expect(services.projects.remove).toHaveBeenCalledWith('p1')
    // Only the removed project's orphaned PTYs are terminated; the other
    // project's session survives (terminateAll stays reserved for app quit).
    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 1, 0])
    expect(terminals.hasRunningSession('t1')).toBe(false)
    expect(terminals.hasRunningSession('t2')).toBe(false)
    expect(terminals.hasRunningSession('t3')).toBe(true)
    expect(terminals.hasRunningSession('ghost')).toBe(false)
  })

  it('forwards terminal data/exit events to the renderer broadcast by taskId', () => {
    const harness = createHarness()
    const listeners = (
      harness.services as unknown as {
        __listeners: {
          data: Array<(taskId: string, data: string) => void>
          exit: Array<(taskId: string, exitCode: number) => void>
        }
      }
    ).__listeners

    for (const listener of listeners.data) {
      listener('t1', 'hello')
    }
    for (const listener of listeners.exit) {
      listener('t1', 7)
    }

    expect(harness.broadcasts).toEqual([
      { channel: IPC_CHANNEL.terminalsData, taskId: 't1', payload: 'hello' },
      { channel: IPC_CHANNEL.terminalsExit, taskId: 't1', payload: 7 },
    ])
  })

  it('transports service failures as typed errors', () => {
    const harness = createHarness()
    vi.mocked(harness.services.tasks.list).mockImplementation(() => {
      throw new Error('db exploded')
    })
    try {
      harness.invoke(IPC_CHANNEL.tasksList, ['p1'])
      expect.unreachable('service failure must reject')
    } catch (error) {
      // Raw error details are sanitized to the generic typed payload.
      expect((error as Error).message).toContain(APP_ERROR_MARKER)
      expect((error as Error).message).not.toContain('db exploded')
    }
  })
})
