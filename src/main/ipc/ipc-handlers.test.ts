import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { emptyGitWorktree, IPC_CHANNEL } from '../../shared/ipc-contract'
import { APP_ERROR_MARKER, AppError } from '../../shared/ipc-error'
import {
  type PtyFactory,
  type PtyProcessLike,
  type PtySpawnOptions,
  TerminalService,
} from '../services/terminal/terminal-service'
import { registerAppIpcHandlers } from './ipc-handlers'
import type { AppServices } from './service-registry'

function fakeActions(): AppServices['actions'] {
  return {
    list: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    status: vi.fn(),
    stopForProject: vi.fn(),
  }
}

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
  broadcasts: Array<{ channel: string; chatId: string; payload: string | number }>
  invoke: ReturnType<typeof createFakeIpcMain>['invoke']
  showOpenDialog: ReturnType<typeof vi.fn>
}

function createHarness(): Harness {
  const terminalListeners: {
    data: Array<(chatId: string, data: string) => void>
    exit: Array<(chatId: string, exitCode: number) => void>
  } = { data: [], exit: [] }

  const services: AppServices = {
    actions: fakeActions(),
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
    chats: {
      list: vi.fn(() => []),
      create: vi.fn(() => ({ id: 't1', projectId: 'p1', name: 'n' })),
      remove: vi.fn(),
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
      getStatus: vi.fn(() =>
        Promise.resolve({ branch: 'main', dirty: false, worktree: emptyGitWorktree() }),
      ),
    },
    files: {
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn(() => Promise.resolve({ kind: 'text' as const, content: '', language: null })),
      openExternal: vi.fn(() => Promise.resolve()),
    },
  }

  const broadcasts: Array<{ channel: string; chatId: string; payload: string | number }> = []
  const { ipcMain, invoke } = createFakeIpcMain()
  const showOpenDialog = vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] as string[] }))
  registerAppIpcHandlers(ipcMain, services, {
    showOpenDialog: showOpenDialog as never,
    trustedRendererUrls: ['file:///renderer/index.html'],
    broadcast: (channel, chatId, payload) => {
      broadcasts.push({ channel, chatId, payload })
    },
  })

  // Expose the listener arrays for event fan-out tests via the services mock.
  ;(services as unknown as { __listeners: typeof terminalListeners }).__listeners =
    terminalListeners

  return { services, broadcasts, invoke, showOpenDialog }
}

describe('registered ipc handlers', () => {
  it('routes action CRUD and execution, rejecting malformed inputs before services', () => {
    const { services, invoke } = createHarness()
    const input = {
      scope: 'project',
      projectId: 'p1',
      title: 'Build',
      icon: null,
      command: 'pnpm build',
      cwd: null,
      runMode: 'background',
      confirm: true,
      sortOrder: 0,
    }
    invoke(IPC_CHANNEL.actionsCreate, [input])
    invoke(IPC_CHANNEL.actionsUpdate, ['a1', input])
    invoke(IPC_CHANNEL.actionsExecute, ['a1', 'p1', true])
    invoke(IPC_CHANNEL.actionsStatus, ['a1'])
    invoke(IPC_CHANNEL.actionsDelete, ['a1'])
    expect(services.actions.create).toHaveBeenCalledWith(input)
    expect(services.actions.update).toHaveBeenCalledWith('a1', input)
    expect(services.actions.execute).toHaveBeenCalledWith('a1', 'p1', true)
    expect(services.actions.status).toHaveBeenCalledWith('a1')
    expect(services.actions.delete).toHaveBeenCalledWith('a1')
    expect(() => invoke(IPC_CHANNEL.actionsCreate, [{ ...input, command: '' }])).toThrow(
      APP_ERROR_MARKER,
    )
    expect(() => invoke(IPC_CHANNEL.actionsExecute, ['a1', 'p1', 'true'])).toThrow(APP_ERROR_MARKER)
    expect(services.actions.create).toHaveBeenCalledTimes(1)
    expect(services.actions.execute).toHaveBeenCalledTimes(1)
  })
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
    expect(() => invoke(IPC_CHANNEL.chatsList, ['p1'], 'file:///untrusted/index.html')).toThrow(
      /untrusted/,
    )
    expect(services.chats.list).not.toHaveBeenCalled()
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
    const chats = [
      { id: 't1', projectId: 'p1', name: 'a' },
      { id: 't2', projectId: 'p1', name: 'b' },
      { id: 't3', projectId: 'p2', name: 'c' },
    ]
    const services: AppServices = {
      actions: fakeActions(),
      projects: {
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      chats: {
        list: vi.fn((projectId: string) => chats.filter((chat) => chat.projectId === projectId)),
        create: vi.fn(() => chats[0]),
        remove: vi.fn(),
      },
      state: { get: vi.fn(() => null), set: vi.fn() },
      terminals,
      git: {
        getStatus: vi.fn(() =>
          Promise.resolve({ branch: null, dirty: false, worktree: emptyGitWorktree() }),
        ),
      },
      files: {
        list: vi.fn(() => Promise.resolve([])),
        read: vi.fn(() => Promise.resolve({ kind: 'text' as const, content: '', language: null })),
        openExternal: vi.fn(() => Promise.resolve()),
      },
    }
    const { ipcMain, invoke } = createFakeIpcMain()
    registerAppIpcHandlers(ipcMain, services, {
      showOpenDialog: vi.fn() as never,
      trustedRendererUrls: ['file:///renderer/index.html'],
    })

    // Live sessions: two chats of p1 and one chat of another project.
    terminals.create('t1', 'D:/a')
    terminals.create('t2', 'D:/a')
    terminals.create('t3', 'D:/b')
    expect(ptys.map((pty) => pty.killCount)).toEqual([0, 0, 0])

    invoke(IPC_CHANNEL.projectsRemove, ['p1'])

    expect(services.projects.remove).toHaveBeenCalledWith('p1')
    expect(services.actions.stopForProject).toHaveBeenCalledWith('p1')
    expect(vi.mocked(services.projects.remove).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(services.actions.stopForProject).mock.invocationCallOrder[0],
    )
    // Only the removed project's orphaned PTYs are terminated; the other
    // project's session survives (terminateAll stays reserved for app quit).
    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 1, 0])
    expect(terminals.hasRunningSession('t1')).toBe(false)
    expect(terminals.hasRunningSession('t2')).toBe(false)
    expect(terminals.hasRunningSession('t3')).toBe(true)
    expect(terminals.hasRunningSession('ghost')).toBe(false)
  })

  it('does not stop action children when project removal fails', () => {
    const harness = createHarness()
    vi.mocked(harness.services.projects.remove).mockImplementation(() => {
      throw new AppError('not_found', 'Project not found.', 'projects:remove')
    })
    expect(() => harness.invoke(IPC_CHANNEL.projectsRemove, ['missing'])).toThrow(
      /Project not found/,
    )
    expect(harness.services.actions.stopForProject).not.toHaveBeenCalled()
  })

  it('chats:remove deletes the chat row and terminates exactly its session (fake PTY)', () => {
    const ptys: FakePty[] = []
    const createPty: PtyFactory = (options) => {
      const pty = new FakePty(1000 + ptys.length, options)
      ptys.push(pty)
      return pty
    }
    const terminals = new TerminalService({ createPty, isDirectory: () => true })
    const services: AppServices = {
      actions: fakeActions(),
      projects: {
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      chats: {
        list: vi.fn(() => []),
        create: vi.fn(() => ({ id: 't1', projectId: 'p1', name: 'a' })),
        remove: vi.fn(),
      },
      state: { get: vi.fn(() => null), set: vi.fn() },
      terminals,
      git: {
        getStatus: vi.fn(() =>
          Promise.resolve({ branch: null, dirty: false, worktree: emptyGitWorktree() }),
        ),
      },
      files: {
        list: vi.fn(() => Promise.resolve([])),
        read: vi.fn(() => Promise.resolve({ kind: 'text' as const, content: '', language: null })),
        openExternal: vi.fn(() => Promise.resolve()),
      },
    }
    const { ipcMain, invoke } = createFakeIpcMain()
    registerAppIpcHandlers(ipcMain, services, {
      showOpenDialog: vi.fn() as never,
      trustedRendererUrls: ['file:///renderer/index.html'],
    })

    terminals.create('t1', 'D:/a')
    terminals.create('t2', 'D:/b')
    expect(ptys.map((pty) => pty.killCount)).toEqual([0, 0])

    // The terminal-exit close flow (spec Behaviour 11): only the closed chat
    // is removed; other sessions keep running (session preservation).
    invoke(IPC_CHANNEL.chatsRemove, ['t1'])

    expect(services.chats.remove).toHaveBeenCalledWith('t1')
    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 0])
    expect(terminals.hasRunningSession('t1')).toBe(false)
    expect(terminals.hasRunningSession('t2')).toBe(true)
  })

  it('rejects a non-string chat id on chats:remove before touching services', () => {
    const harness = createHarness()
    try {
      harness.invoke(IPC_CHANNEL.chatsRemove, [42])
      expect.unreachable('validation must reject')
    } catch (error) {
      expect((error as Error).message).toContain(APP_ERROR_MARKER)
      expect((error as Error).message).toContain('validation')
    }
    expect(harness.services.chats.remove).not.toHaveBeenCalled()
  })

  it('forwards terminal data/exit events to the renderer broadcast by chatId', () => {
    const harness = createHarness()
    const listeners = (
      harness.services as unknown as {
        __listeners: {
          data: Array<(chatId: string, data: string) => void>
          exit: Array<(chatId: string, exitCode: number) => void>
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
      { channel: IPC_CHANNEL.terminalsData, chatId: 't1', payload: 'hello' },
      { channel: IPC_CHANNEL.terminalsExit, chatId: 't1', payload: 7 },
    ])
  })

  it('transports service failures as typed errors', () => {
    const harness = createHarness()
    vi.mocked(harness.services.chats.list).mockImplementation(() => {
      throw new Error('db exploded')
    })
    try {
      harness.invoke(IPC_CHANNEL.chatsList, ['p1'])
      expect.unreachable('service failure must reject')
    } catch (error) {
      // Raw error details are sanitized to the generic typed payload.
      expect((error as Error).message).toContain(APP_ERROR_MARKER)
      expect((error as Error).message).not.toContain('db exploded')
    }
  })
})

describe('files:* channels (project files view)', () => {
  it('routes validated payloads to the file service (root and nested)', async () => {
    const { services, invoke } = createHarness()
    await invoke(IPC_CHANNEL.filesList, ['p1', null])
    expect(services.files.list).toHaveBeenCalledWith('p1', null)

    await invoke(IPC_CHANNEL.filesList, ['p1', 'src/app'])
    expect(services.files.list).toHaveBeenCalledWith('p1', 'src/app')

    await invoke(IPC_CHANNEL.filesRead, ['p1', 'app/Services/Billing.php'])
    expect(services.files.read).toHaveBeenCalledWith('p1', 'app/Services/Billing.php')

    await invoke(IPC_CHANNEL.filesOpenExternal, ['p1', 'docs/readme.md'])
    expect(services.files.openExternal).toHaveBeenCalledWith('p1', 'docs/readme.md')
  })

  it('rejects invalid payloads with typed validation errors before the service', () => {
    const { services, invoke } = createHarness()
    const cases: Array<[string, unknown[]]> = [
      // Wrong arity (files:list takes exactly two arguments).
      [IPC_CHANNEL.filesList, ['p1']],
      [IPC_CHANNEL.filesList, ['p1', 'src', 'extra']],
      // Non-string project id.
      [IPC_CHANNEL.filesRead, [42, 'a.txt']],
      // files:list is the only channel accepting null (the project root).
      [IPC_CHANNEL.filesRead, ['p1', null]],
      // Relative path shape: non-empty string without NUL bytes.
      [IPC_CHANNEL.filesRead, ['p1', '']],
      [IPC_CHANNEL.filesOpenExternal, ['p1', 'a\u0000b.txt']],
      [IPC_CHANNEL.filesList, ['p1', 7]],
    ]
    for (const [channel, payload] of cases) {
      try {
        invoke(channel, payload)
        expect.unreachable(`validation must reject ${channel} ${JSON.stringify(payload)}`)
      } catch (error) {
        expect((error as Error).message).toContain(APP_ERROR_MARKER)
        expect((error as Error).message).toContain('validation')
      }
    }
    expect(services.files.list).not.toHaveBeenCalled()
    expect(services.files.read).not.toHaveBeenCalled()
    expect(services.files.openExternal).not.toHaveBeenCalled()
  })

  it('lets containment violations through validation and transports them as typed not_found', async () => {
    const harness = createHarness()
    // Shape validation must not swallow traversal: the service decides
    // containment and answers with the not-found error (spec AC7).
    vi.mocked(harness.services.files.read).mockRejectedValue(
      new AppError('not_found', 'File not found.', 'files:read'),
    )
    try {
      await harness.invoke(IPC_CHANNEL.filesRead, ['p1', '../outside/secret.txt'])
      expect.unreachable('containment rejection must reject')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain(APP_ERROR_MARKER)
      expect(message).toContain('not_found')
      expect(message).toContain('File not found.')
    }
  })

  it('transports a failed Open externally as a typed error (notice path)', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.files.openExternal).mockRejectedValue(
      new AppError('unknown', 'Failed to open the file externally.', 'files:openExternal'),
    )
    try {
      await harness.invoke(IPC_CHANNEL.filesOpenExternal, ['p1', 'doc.pdf'])
      expect.unreachable('open failure must reject')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain(APP_ERROR_MARKER)
      expect(message).toContain('Failed to open the file externally.')
    }
  })
})
