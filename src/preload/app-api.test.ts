import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL } from '../shared/ipc-contract'
import { createAppApi } from './app-api'

function createIpcMock() {
  const invocations: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    invocations,
    listeners,
    invoke: (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args })
      return Promise.resolve(null)
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
    },
    off: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(listener)
    },
  }
}

describe('preload app api', () => {
  it('routes action CRUD, execution, and state queries through typed channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const input = {
      scope: 'project' as const,
      projectId: 'p1',
      title: 'Build',
      icon: null,
      command: 'pnpm build',
      cwd: null,
      runMode: 'background' as const,
      confirm: true,
      sortOrder: 0,
    }
    await api.actions.list()
    await api.actions.create(input)
    await api.actions.update('a1', input)
    await api.actions.delete('a1')
    await api.actions.execute('a1', 'p1', true)
    await api.actions.status('a1')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.actionsList, args: [] },
      { channel: IPC_CHANNEL.actionsCreate, args: [input] },
      { channel: IPC_CHANNEL.actionsUpdate, args: ['a1', input] },
      { channel: IPC_CHANNEL.actionsDelete, args: ['a1'] },
      { channel: IPC_CHANNEL.actionsExecute, args: ['a1', 'p1', true] },
      { channel: IPC_CHANNEL.actionsStatus, args: ['a1'] },
    ])
  })
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes project and chat calls to explicit channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.projects.list()
    await api.projects.add()
    await api.projects.remove('p1')
    await api.chats.list('p1')
    await api.chats.create('p1')
    await api.chats.remove('t1')
    expect(ipc.invocations.map((i) => i.channel)).toEqual([
      IPC_CHANNEL.projectsList,
      IPC_CHANNEL.projectsAdd,
      IPC_CHANNEL.projectsRemove,
      IPC_CHANNEL.chatsList,
      IPC_CHANNEL.chatsCreate,
      IPC_CHANNEL.chatsRemove,
    ])
    // The create payload is the project id only — no name travels over IPC.
    expect(ipc.invocations[4].args).toEqual(['p1'])
  })

  it('routes state, terminal and git calls to explicit channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.state.get('k')
    await api.state.set('k', 'v')
    await api.terminals.create('t1', 'D:/code/demo')
    await api.terminals.write('t1', 'ls')
    await api.terminals.resize('t1', 80, 24)
    await api.terminals.shellName()
    await api.terminals.terminate('bottom:p1:tab-a')
    await api.git.getStatus('D:/code/demo')
    expect(ipc.invocations.map((i) => i.channel)).toEqual([
      IPC_CHANNEL.stateGet,
      IPC_CHANNEL.stateSet,
      IPC_CHANNEL.terminalsCreate,
      IPC_CHANNEL.terminalsWrite,
      IPC_CHANNEL.terminalsResize,
      IPC_CHANNEL.terminalsShellName,
      IPC_CHANNEL.terminalsTerminate,
      IPC_CHANNEL.gitStatus,
    ])
    expect(ipc.invocations[6]?.args).toEqual(['bottom:p1:tab-a'])
  })

  it('delivers terminal data events only for the matching chat', () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const seen: string[] = []
    api.terminals.onData('t1', (data) => seen.push(data))

    const dataListeners = ipc.listeners.get(IPC_CHANNEL.terminalsData)
    expect(dataListeners).toBeDefined()
    if (!dataListeners) {
      return
    }
    const listener = [...dataListeners][0]
    listener({}, 't1', 'hello')
    listener({}, 'other', 'nope')
    listener({}, 't1', 42)
    expect(seen).toEqual(['hello'])
  })

  it('unsubscribes terminal listeners', () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const seen: number[] = []
    function emit(channel: string, ...args: unknown[]): void {
      for (const listener of ipc.listeners.get(channel) ?? []) {
        listener({}, ...args)
      }
    }
    const unsubscribe = api.terminals.onExit('t1', (code) => seen.push(code))
    emit(IPC_CHANNEL.terminalsExit, 't1', 0)
    emit(IPC_CHANNEL.terminalsExit, 'other', 7)
    expect(seen).toEqual([0])
    unsubscribe()
    emit(IPC_CHANNEL.terminalsExit, 't1', 3)
    expect(seen).toEqual([0])
    const exitListeners = ipc.listeners.get(IPC_CHANNEL.terminalsExit)
    expect(exitListeners?.size ?? 0).toBe(0)
  })
})
