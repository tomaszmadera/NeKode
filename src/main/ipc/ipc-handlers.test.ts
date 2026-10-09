import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createBottomTabId } from '../../shared/bottom-tab-id'
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

function fakeAgentProfiles(): AppServices['agentProfiles'] {
  return {
    get: vi.fn(() => ({ defaultId: null, profiles: [] })),
    put: vi.fn(() => ({ defaultId: null, profiles: [] })),
    delete: vi.fn(() => ({ defaultId: null, profiles: [] })),
    cleanupProject: vi.fn(),
  }
}

/** A ready scan with no candidates; the handoff candidates channel returns it by default. */
const EMPTY_HANDOFF_CANDIDATES = {
  state: 'ready' as const,
  files: [],
  rejections: [],
}

/** A ready batch check with no available items; the default availability result. */
const EMPTY_HANDOFF_AVAILABILITY = {
  state: 'ready' as const,
  items: [],
  rejections: [],
}

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
      wslDirectories: vi.fn(() => []),
      wslDistributions: vi.fn(() => []),
      addWsl: vi.fn(),
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
    state: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() },
    terminals: {
      create: vi.fn(() => 't1'),
      write: vi.fn(),
      resize: vi.fn(),
      shellName: vi.fn(() => 'PowerShell'),
      shellList: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellDetect: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellAddCustom: vi.fn(() => ({ id: 'custom:D:\\sh.exe' as const, label: 'sh.exe' })),
      terminate: vi.fn(),
      terminateProjectBottom: vi.fn(),
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
      openRoot: vi.fn(() => Promise.resolve()),
    },
    handoffs: {
      list: vi.fn(() => Promise.resolve([])),
    },
    kanban: {
      adaptersList: vi.fn(() => []),
      getConfig: vi.fn(() => ({ adapterId: null, values: {}, secretKeys: [] })),
      setConfig: vi.fn(),
      test: vi.fn(() => Promise.resolve()),
      listBoard: vi.fn(() =>
        Promise.resolve({
          states: [],
          items: [],
        }),
      ),
      createItem: vi.fn(() => Promise.resolve({} as never)),
      updateItem: vi.fn(() => Promise.resolve({} as never)),
      getItem: vi.fn(() => Promise.resolve({} as never)),
      launchTask: vi.fn(() => Promise.resolve({} as never)),
      handoffCandidates: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_CANDIDATES)),
      handoffAvailability: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_AVAILABILITY)),
      cleanupProject: vi.fn(),
      dropLaunchProject: vi.fn(),
      blocksProjectShell: vi.fn(() => false),
    },
    agentProfiles: fakeAgentProfiles(),
    dialogs: {
      pickDirectory: vi.fn(() => Promise.resolve(null)),
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
  it('routes directory suggestions only for trusted senders and transports listing errors', () => {
    const { invoke, services, showOpenDialog } = createHarness()
    invoke(IPC_CHANNEL.projectsWslDirectories, ['Ubuntu', '/home/'])
    expect(services.projects.wslDirectories).toHaveBeenCalledExactlyOnceWith('Ubuntu', '/home/')
    expect(() =>
      invoke(IPC_CHANNEL.projectsWslDirectories, ['Ubuntu', '/home/'], 'https://untrusted.example'),
    ).toThrow(/untrusted/)
    expect(() => invoke(IPC_CHANNEL.projectsWslDirectories, ['Ubuntu', 42])).toThrow(/validation/)
    expect(services.projects.wslDirectories).toHaveBeenCalledOnce()
    vi.mocked(services.projects.wslDirectories).mockImplementation(() => {
      throw new AppError('unknown', 'Directory listing unavailable.')
    })
    expect(() => invoke(IPC_CHANNEL.projectsWslDirectories, ['Ubuntu', '/missing/'])).toThrow(
      /Directory listing unavailable/,
    )
    expect(services.projects.addWsl).not.toHaveBeenCalled()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
  it('routes WSL registration and project shell context only for trusted senders', () => {
    const { invoke, services, showOpenDialog } = createHarness()
    invoke(IPC_CHANNEL.projectsWslDistributions, [])
    invoke(IPC_CHANNEL.projectsAddWsl, ['Ubuntu', '/home/user/My Project'])
    invoke(IPC_CHANNEL.terminalsShellDetect, ['p1'])
    expect(services.projects.wslDistributions).toHaveBeenCalledOnce()
    expect(services.projects.addWsl).toHaveBeenCalledWith('Ubuntu', '/home/user/My Project')
    expect(services.terminals.shellDetect).toHaveBeenCalledWith('p1')
    expect(showOpenDialog).not.toHaveBeenCalled()
    expect(() =>
      invoke(IPC_CHANNEL.projectsAddWsl, ['Ubuntu', '/home/user'], 'https://untrusted.example'),
    ).toThrow(/untrusted/)
    expect(() =>
      invoke(IPC_CHANNEL.projectsWslDistributions, [], 'https://untrusted.example'),
    ).toThrow(/untrusted/)
    expect(services.projects.wslDistributions).toHaveBeenCalledOnce()
    expect(services.projects.addWsl).toHaveBeenCalledOnce()
  })
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

  it('rejects untrusted senders on the handoff and dialog channels before services', () => {
    const { services, invoke } = createHarness()
    expect(() => invoke(IPC_CHANNEL.handoffsList, ['p1'], 'file:///untrusted/index.html')).toThrow(
      /untrusted/,
    )
    expect(() =>
      invoke(IPC_CHANNEL.dialogsPickDirectory, [null], 'file:///untrusted/index.html'),
    ).toThrow(/untrusted/)
    expect(services.handoffs.list).not.toHaveBeenCalled()
    expect(services.dialogs.pickDirectory).not.toHaveBeenCalled()
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

  it('projects:add resumes the dialog from the last confirmed directory and persists the choice', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.state.get).mockReturnValue('D:/code/previous')
    harness.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(harness.invoke(IPC_CHANNEL.projectsAdd, [])).resolves.toBeNull()
    expect(harness.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'D:/code/previous' }),
    )
    // A cancel chooses nothing: the stored path must survive untouched.
    expect(harness.services.state.set).not.toHaveBeenCalled()

    harness.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['D:/code/demo'],
    })
    await harness.invoke(IPC_CHANNEL.projectsAdd, [])
    // The confirmed directory persists before the add attempt (spec
    // handoff-resume-flow Behaviour 1): a failed add still remembers it.
    expect(harness.services.state.set).toHaveBeenCalledWith(
      'projects.lastDirectory',
      'D:/code/demo',
    )
    expect(harness.services.projects.add).toHaveBeenCalledWith('D:/code/demo')
  })

  it('projects:add opens the dialog without a default when nothing is stored', async () => {
    const harness = createHarness()
    harness.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await harness.invoke(IPC_CHANNEL.projectsAdd, [])
    expect(harness.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Add Project', defaultPath: undefined }),
    )
  })

  it('projects:add remembers the confirmed directory even when the add fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.projects.add).mockImplementation(() => {
      throw new AppError('unknown', 'boom', 'projects:add')
    })
    harness.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['D:/x'] })
    await expect(harness.invoke(IPC_CHANNEL.projectsAdd, [])).rejects.toThrow(/boom/)
    expect(harness.services.state.set).toHaveBeenCalledWith('projects.lastDirectory', 'D:/x')
  })

  it('projects:remove deletes the removed project handoff-directory setting', () => {
    const harness = createHarness()
    harness.invoke(IPC_CHANNEL.projectsRemove, ['p1'])
    expect(harness.services.state.delete).toHaveBeenCalledWith('project.handoffDir:p1')
  })

  it('projects:remove keeps the setting when the removal fails', () => {
    const harness = createHarness()
    vi.mocked(harness.services.projects.remove).mockImplementation(() => {
      throw new AppError('not_found', 'Project not found.', 'projects:remove')
    })
    expect(() => harness.invoke(IPC_CHANNEL.projectsRemove, ['missing'])).toThrow(
      /Project not found/,
    )
    expect(harness.services.state.delete).not.toHaveBeenCalled()
  })

  it('dialogs:pickDirectory routes through the injected picker; cancel resolves null', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.dialogs.pickDirectory).mockResolvedValue('D:/picked')
    await expect(harness.invoke(IPC_CHANNEL.dialogsPickDirectory, ['D:/start'])).resolves.toBe(
      'D:/picked',
    )
    expect(harness.services.dialogs.pickDirectory).toHaveBeenCalledWith('D:/start')
    vi.mocked(harness.services.dialogs.pickDirectory).mockResolvedValue(null)
    await expect(harness.invoke(IPC_CHANNEL.dialogsPickDirectory, [null])).resolves.toBeNull()
  })

  it('projects:remove terminates the removed project’s orphaned PTYs (fake PTY)', () => {
    const ptys: FakePty[] = []
    const createPty: PtyFactory = (options) => {
      const pty = new FakePty(1000 + ptys.length, options)
      ptys.push(pty)
      return pty
    }
    // The registry surface needs the shell-selection methods (spec
    // project-shell-selection); Object.assign adds them as own properties on
    // top of the real TerminalService prototype methods.
    const terminals = Object.assign(new TerminalService({ createPty, isDirectory: () => true }), {
      shellName: vi.fn(() => 'PowerShell'),
      shellList: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellDetect: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellAddCustom: vi.fn(() => ({ id: 'custom:D:\\sh.exe' as const, label: 'sh.exe' })),
    })
    const chats = [
      { id: 't1', projectId: 'p1', name: 'a' },
      { id: 't2', projectId: 'p1', name: 'b' },
      { id: 't3', projectId: 'p2', name: 'c' },
    ]
    const services: AppServices = {
      actions: fakeActions(),
      projects: {
        wslDirectories: vi.fn(() => []),
        wslDistributions: vi.fn(() => []),
        addWsl: vi.fn(),
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      chats: {
        list: vi.fn((projectId: string) => chats.filter((chat) => chat.projectId === projectId)),
        create: vi.fn(() => chats[0]),
        remove: vi.fn(),
      },
      state: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() },
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
        openRoot: vi.fn(() => Promise.resolve()),
      },
      handoffs: {
        list: vi.fn(() => Promise.resolve([])),
      },
      kanban: {
        adaptersList: vi.fn(() => []),
        getConfig: vi.fn(() => ({ adapterId: null, values: {}, secretKeys: [] })),
        setConfig: vi.fn(),
        test: vi.fn(() => Promise.resolve()),
        listBoard: vi.fn(() => Promise.resolve({ states: [], items: [] })),
        createItem: vi.fn(() => Promise.resolve({} as never)),
        updateItem: vi.fn(() => Promise.resolve({} as never)),
        getItem: vi.fn(() => Promise.resolve({} as never)),
        launchTask: vi.fn(() => Promise.resolve({} as never)),
        handoffCandidates: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_CANDIDATES)),
        handoffAvailability: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_AVAILABILITY)),
        cleanupProject: vi.fn(),
        dropLaunchProject: vi.fn(),
        blocksProjectShell: vi.fn(() => false),
      },
      agentProfiles: fakeAgentProfiles(),
      dialogs: {
        pickDirectory: vi.fn(() => Promise.resolve(null)),
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

  it('projects:remove terminates that project bottom PTYs only, and does not remove chats', () => {
    const ptys: FakePty[] = []
    const createPty: PtyFactory = (options) => {
      const pty = new FakePty(1000 + ptys.length, options)
      ptys.push(pty)
      return pty
    }
    // The registry surface needs the shell-selection methods (spec
    // project-shell-selection); Object.assign adds them as own properties on
    // top of the real TerminalService prototype methods.
    const terminals = Object.assign(new TerminalService({ createPty, isDirectory: () => true }), {
      shellName: vi.fn(() => 'PowerShell'),
      shellList: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellDetect: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellAddCustom: vi.fn(() => ({ id: 'custom:D:\\sh.exe' as const, label: 'sh.exe' })),
    })
    const bottomP1 = createBottomTabId('p1')
    const bottomP2 = createBottomTabId('p2')
    const chats = [
      { id: 't1', projectId: 'p1', name: 'a' },
      { id: 't3', projectId: 'p2', name: 'c' },
    ]
    const services: AppServices = {
      actions: fakeActions(),
      projects: {
        wslDirectories: vi.fn(() => []),
        wslDistributions: vi.fn(() => []),
        addWsl: vi.fn(),
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      chats: {
        list: vi.fn((projectId: string) => chats.filter((chat) => chat.projectId === projectId)),
        create: vi.fn(() => chats[0]),
        remove: vi.fn(),
      },
      state: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() },
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
        openRoot: vi.fn(() => Promise.resolve()),
      },
      handoffs: {
        list: vi.fn(() => Promise.resolve([])),
      },
      kanban: {
        adaptersList: vi.fn(() => []),
        getConfig: vi.fn(() => ({ adapterId: null, values: {}, secretKeys: [] })),
        setConfig: vi.fn(),
        test: vi.fn(() => Promise.resolve()),
        listBoard: vi.fn(() => Promise.resolve({ states: [], items: [] })),
        createItem: vi.fn(() => Promise.resolve({} as never)),
        updateItem: vi.fn(() => Promise.resolve({} as never)),
        getItem: vi.fn(() => Promise.resolve({} as never)),
        launchTask: vi.fn(() => Promise.resolve({} as never)),
        handoffCandidates: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_CANDIDATES)),
        handoffAvailability: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_AVAILABILITY)),
        cleanupProject: vi.fn(),
        dropLaunchProject: vi.fn(),
        blocksProjectShell: vi.fn(() => false),
      },
      agentProfiles: fakeAgentProfiles(),
      dialogs: {
        pickDirectory: vi.fn(() => Promise.resolve(null)),
      },
    }
    const { ipcMain, invoke } = createFakeIpcMain()
    registerAppIpcHandlers(ipcMain, services, {
      showOpenDialog: vi.fn() as never,
      trustedRendererUrls: ['file:///renderer/index.html'],
    })

    terminals.create('t1', 'D:/a')
    terminals.create(bottomP1, 'D:/a')
    terminals.create('t3', 'D:/b')
    terminals.create(bottomP2, 'D:/b')

    invoke(IPC_CHANNEL.projectsRemove, ['p1'])

    expect(services.chats.remove).not.toHaveBeenCalled()
    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 1, 0, 0])
    expect(terminals.hasRunningSession('t1')).toBe(false)
    expect(terminals.hasRunningSession(bottomP1)).toBe(false)
    expect(terminals.hasRunningSession('t3')).toBe(true)
    expect(terminals.hasRunningSession(bottomP2)).toBe(true)

    // Quit is terminateAll in main, not a chat-close. Exit events stay suppressed
    // so the renderer cannot delete chats. Bottom PTYs die with the rest.
    const exits: Array<[string, number]> = []
    terminals.onExit((sessionId, code) => exits.push([sessionId, code]))
    terminals.terminateAll()
    expect(exits).toEqual([])
    expect(services.chats.remove).not.toHaveBeenCalled()
    expect(terminals.hasRunningSession('t3')).toBe(false)
    expect(terminals.hasRunningSession(bottomP2)).toBe(false)
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
    // The registry surface needs the shell-selection methods (spec
    // project-shell-selection); Object.assign adds them as own properties on
    // top of the real TerminalService prototype methods.
    const terminals = Object.assign(new TerminalService({ createPty, isDirectory: () => true }), {
      shellName: vi.fn(() => 'PowerShell'),
      shellList: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellDetect: vi.fn(() => [{ id: 'default' as const, label: 'PowerShell' }]),
      shellAddCustom: vi.fn(() => ({ id: 'custom:D:\\sh.exe' as const, label: 'sh.exe' })),
    })
    const services: AppServices = {
      actions: fakeActions(),
      projects: {
        wslDirectories: vi.fn(() => []),
        wslDistributions: vi.fn(() => []),
        addWsl: vi.fn(),
        list: vi.fn(() => []),
        add: vi.fn(() => ({ id: 'p1', name: 'demo', path: 'D:/a', runtimeLabel: null })),
        remove: vi.fn(),
      },
      chats: {
        list: vi.fn(() => []),
        create: vi.fn(() => ({ id: 't1', projectId: 'p1', name: 'a' })),
        remove: vi.fn(),
      },
      state: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() },
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
        openRoot: vi.fn(() => Promise.resolve()),
      },
      handoffs: {
        list: vi.fn(() => Promise.resolve([])),
      },
      kanban: {
        adaptersList: vi.fn(() => []),
        getConfig: vi.fn(() => ({ adapterId: null, values: {}, secretKeys: [] })),
        setConfig: vi.fn(),
        test: vi.fn(() => Promise.resolve()),
        listBoard: vi.fn(() => Promise.resolve({ states: [], items: [] })),
        createItem: vi.fn(() => Promise.resolve({} as never)),
        updateItem: vi.fn(() => Promise.resolve({} as never)),
        getItem: vi.fn(() => Promise.resolve({} as never)),
        launchTask: vi.fn(() => Promise.resolve({} as never)),
        handoffCandidates: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_CANDIDATES)),
        handoffAvailability: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_AVAILABILITY)),
        cleanupProject: vi.fn(),
        dropLaunchProject: vi.fn(),
        blocksProjectShell: vi.fn(() => false),
      },
      agentProfiles: fakeAgentProfiles(),
      dialogs: {
        pickDirectory: vi.fn(() => Promise.resolve(null)),
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

describe('kanban:* channels (adapter integration)', () => {
  it('routes validated payloads to the kanban service', async () => {
    const { services, invoke } = createHarness()
    await invoke(IPC_CHANNEL.kanbanAdaptersList, [])
    expect(services.kanban.adaptersList).toHaveBeenCalled()

    await invoke(IPC_CHANNEL.kanbanGetConfig, ['p1'])
    expect(services.kanban.getConfig).toHaveBeenCalledWith('p1')

    const config = { adapterId: 'demo', values: { base_url: 'https://x', api_key: 'tok' } }
    await invoke(IPC_CHANNEL.kanbanSetConfig, ['p1', config])
    expect(services.kanban.setConfig).toHaveBeenCalledWith('p1', config)

    await invoke(IPC_CHANNEL.kanbanTest, ['p1', { base_url: 'edited' }])
    expect(services.kanban.test).toHaveBeenCalledWith('p1', { base_url: 'edited' })

    await invoke(IPC_CHANNEL.kanbanListBoard, ['p1'])
    expect(services.kanban.listBoard).toHaveBeenCalledWith('p1')

    await invoke(IPC_CHANNEL.kanbanCreateItem, ['p1', { title: 'New item' }])
    expect(services.kanban.createItem).toHaveBeenCalledWith('p1', { title: 'New item' })

    await invoke(IPC_CHANNEL.kanbanUpdateItem, ['p1', 'DEMO-1', { stateRef: 'done' }])
    expect(services.kanban.updateItem).toHaveBeenCalledWith('p1', 'DEMO-1', { stateRef: 'done' })

    await invoke(IPC_CHANNEL.kanbanGetItem, ['p1', 'DEMO-1'])
    expect(services.kanban.getItem).toHaveBeenCalledWith('p1', 'DEMO-1')
    const launchInput = {
      projectId: 'p1',
      itemId: 'native-1',
      ref: 'DEMO-1',
      profileId: 'prof-1',
      attemptId: 'attempt-1',
      mode: 'start' as const,
    }
    await invoke(IPC_CHANNEL.kanbanLaunchTask, [launchInput])
    expect(services.kanban.launchTask).toHaveBeenCalledWith(launchInput)

    const candidates = { projectId: 'p1', itemId: 'native-1', ref: 'DEMO-1' }
    await invoke(IPC_CHANNEL.kanbanHandoffCandidates, [candidates])
    expect(services.kanban.handoffCandidates).toHaveBeenCalledWith(candidates)

    const availabilityInput = {
      projectId: 'p1',
      items: [{ itemId: 'native-1', ref: 'DEMO-1' }],
    }
    await invoke(IPC_CHANNEL.kanbanHandoffAvailability, [availabilityInput])
    expect(services.kanban.handoffAvailability).toHaveBeenCalledWith(availabilityInput)
  })

  it('projects:remove cleans the per-project kanban keys', () => {
    const { services, invoke } = createHarness()
    invoke(IPC_CHANNEL.projectsRemove, ['p1'])
    expect(services.kanban.cleanupProject).toHaveBeenCalledWith('p1')
    expect(services.kanban.dropLaunchProject).toHaveBeenCalledWith('p1')
    expect(vi.mocked(services.projects.remove).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(services.kanban.dropLaunchProject).mock.invocationCallOrder[0],
    )
  })

  it('does not drop task launches when project removal fails', () => {
    const { services, invoke } = createHarness()
    vi.mocked(services.projects.remove).mockImplementation(() => {
      throw new AppError('not_found', 'Project not found.', 'projects:remove')
    })
    expect(() => invoke(IPC_CHANNEL.projectsRemove, ['missing'])).toThrow(/Project not found/)
    expect(services.kanban.dropLaunchProject).not.toHaveBeenCalled()
  })

  it('rejects invalid payloads before the service', () => {
    const { services, invoke } = createHarness()
    const cases: Array<[string, unknown[]]> = [
      [IPC_CHANNEL.kanbanGetConfig, []],
      [IPC_CHANNEL.kanbanGetConfig, [42]],
      [IPC_CHANNEL.kanbanSetConfig, ['p1']],
      [IPC_CHANNEL.kanbanSetConfig, ['p1', { adapterId: 7, values: {} }]],
      [IPC_CHANNEL.kanbanSetConfig, ['p1', { adapterId: 'demo', values: { k: 1 } }]],
      [IPC_CHANNEL.kanbanTest, ['p1', { k: 1 }]],
      [IPC_CHANNEL.kanbanListBoard, []],
      [IPC_CHANNEL.kanbanCreateItem, ['p1', { title: '' }]],
      [IPC_CHANNEL.kanbanCreateItem, ['p1', { title: 'x', priority: 'highest' }]],
      [IPC_CHANNEL.kanbanUpdateItem, ['p1', 'DEMO-1', {}]],
      [IPC_CHANNEL.kanbanUpdateItem, ['p1', 'DEMO-1', { bogus: 1 }]],
      [IPC_CHANNEL.kanbanUpdateItem, ['p1', 'DEMO-1', 'stateRef']],
      [IPC_CHANNEL.kanbanGetItem, ['p1']],
      [IPC_CHANNEL.kanbanGetItem, ['', 'DEMO-1']],
      [IPC_CHANNEL.kanbanLaunchTask, [{ projectId: 'p1', mode: 'resume' }]],
      [
        IPC_CHANNEL.kanbanLaunchTask,
        [
          {
            projectId: 'p1',
            itemId: 'native-1',
            ref: 'DEMO-1',
            profileId: 'prof-1',
            attemptId: 'attempt-1',
            mode: 'start',
            name: 'Codex',
          },
        ],
      ],
      [IPC_CHANNEL.kanbanHandoffCandidates, [{ projectId: 'p1', itemId: '', ref: 'DEMO-1' }]],
      [
        IPC_CHANNEL.kanbanHandoffCandidates,
        [{ projectId: 'p1', itemId: 'native-1', ref: 'DEMO-1', extra: 1 }],
      ],
      [IPC_CHANNEL.kanbanHandoffAvailability, [{ projectId: 'p1' }]],
      [IPC_CHANNEL.kanbanHandoffAvailability, [{ projectId: '', items: [] }]],
      [IPC_CHANNEL.kanbanHandoffAvailability, ['p1']],
      [
        IPC_CHANNEL.kanbanHandoffAvailability,
        [{ projectId: 'p1', items: [{ itemId: '', ref: 'DEMO-1' }] }],
      ],
      [
        IPC_CHANNEL.kanbanHandoffAvailability,
        [{ projectId: 'p1', items: [{ itemId: 'native-1', ref: 'DEMO-1', extra: 1 }] }],
      ],
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
    expect(services.kanban.setConfig).not.toHaveBeenCalled()
    expect(services.kanban.listBoard).not.toHaveBeenCalled()
    expect(services.kanban.handoffCandidates).not.toHaveBeenCalled()
    expect(services.kanban.handoffAvailability).not.toHaveBeenCalled()
  })

  it('transports adapter failures with their typed codes and messages', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.kanban.listBoard).mockRejectedValue(
      // Real adapter failures carry the adapter's own code (spec Errors).
      new AppError('auth', 'Plane rejected the token.', 'kanban:listItems'),
    )
    try {
      await harness.invoke(IPC_CHANNEL.kanbanListBoard, ['p1'])
      expect.unreachable('adapter failure must reject')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain(APP_ERROR_MARKER)
      expect(message).toContain('auth')
      expect(message).toContain('Plane rejected the token.')
    }
  })
})

describe('agentProfiles:* channels', () => {
  const input = {
    id: null,
    name: 'Claude',
    executable: 'claude',
    args: ['{prompt}'],
    isDefault: true,
  }

  it('routes get, put, and delete to the service', () => {
    const { services, invoke } = createHarness()
    invoke(IPC_CHANNEL.agentProfilesGet, ['p1'])
    expect(services.agentProfiles.get).toHaveBeenCalledWith('p1')
    invoke(IPC_CHANNEL.agentProfilesPut, ['p1', input])
    expect(services.agentProfiles.put).toHaveBeenCalledWith('p1', input)
    invoke(IPC_CHANNEL.agentProfilesDelete, ['p1', 'id-1'])
    expect(services.agentProfiles.delete).toHaveBeenCalledWith('p1', 'id-1')
  })

  it('projects:remove deletes that project’s agent profiles after the project row is removed', () => {
    const { services, invoke } = createHarness()
    invoke(IPC_CHANNEL.projectsRemove, ['p1'])
    expect(services.projects.remove).toHaveBeenCalledWith('p1')
    expect(services.agentProfiles.cleanupProject).toHaveBeenCalledWith('p1')
    expect(vi.mocked(services.projects.remove).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(services.agentProfiles.cleanupProject).mock.invocationCallOrder[0],
    )
  })

  it('does not delete agent profiles when project removal fails', () => {
    const { services, invoke } = createHarness()
    vi.mocked(services.projects.remove).mockImplementation(() => {
      throw new AppError('not_found', 'Project not found.', 'projects:remove')
    })
    expect(() => invoke(IPC_CHANNEL.projectsRemove, ['missing'])).toThrow(/Project not found/)
    expect(services.agentProfiles.cleanupProject).not.toHaveBeenCalled()
  })

  it('rejects an invalid profile before the service', () => {
    const { services, invoke } = createHarness()
    expect(() => invoke(IPC_CHANNEL.agentProfilesPut, ['p1', { ...input, name: '  ' }])).toThrow(
      APP_ERROR_MARKER,
    )
    expect(() => invoke(IPC_CHANNEL.agentProfilesPut, ['p1', { ...input, args: [] }])).toThrow(
      /exactly once/,
    )
    expect(services.agentProfiles.put).not.toHaveBeenCalled()
  })
})
