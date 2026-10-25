import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL, LOCAL_TASK_FILE_MISSING } from '../shared/ipc-contract'
import { AppError, serializeAppError } from '../shared/ipc-error'
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
  it('exposes the host platform the preload passes in (no IPC round trip)', () => {
    const ipc = createIpcMock()
    expect(createAppApi(ipc, 'linux').platform).toBe('linux')
    expect(createAppApi(ipc, 'win32').platform).toBe('win32')
    expect(ipc.invocations).toEqual([])
  })

  it('exposes the home directory the preload passes in (display-only ~ paths)', () => {
    const ipc = createIpcMock()
    expect(createAppApi(ipc, 'linux', '/home/demo').homeDir).toBe('/home/demo')
    expect(createAppApi(ipc, 'win32').homeDir).toBeUndefined()
    expect(ipc.invocations).toEqual([])
  })

  it('routes the typed global usage API with no project scope', async () => {
    const ipc = createIpcMock(),
      api = createAppApi(ipc).usage
    const settings = {
      connections: [],
      pin: null,
      export: { enabled: false, path: null },
    }
    const connection = {
      id: 'fixture',
      label: 'Fixture',
      providerId: 'test',
      adapterId: 'fixture',
      enabled: false,
      config: {},
    }
    await api.listAdapters()
    await api.getSettings()
    await api.saveSettings(settings)
    await api.read()
    await api.refresh()
    await api.test(connection)
    await api.pickFile(false)
    await api.getEnabled()
    await api.setEnabled(true)
    await api.openAdaptersFolder()
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.usageListAdapters, args: [] },
      { channel: IPC_CHANNEL.usageGetSettings, args: [] },
      { channel: IPC_CHANNEL.usageSaveSettings, args: [settings] },
      { channel: IPC_CHANNEL.usageRead, args: [] },
      { channel: IPC_CHANNEL.usageRefresh, args: [] },
      { channel: IPC_CHANNEL.usageTest, args: [connection] },
      { channel: IPC_CHANNEL.usagePickFile, args: [false] },
      { channel: IPC_CHANNEL.usageGetEnabled, args: [] },
      { channel: IPC_CHANNEL.usageSetEnabled, args: [true] },
      { channel: IPC_CHANNEL.usageOpenAdaptersFolder, args: [] },
    ])
  })

  it('requests a read-only dictionary without transport or paging arguments', async () => {
    const ipc = createIpcMock()
    await createAppApi(ipc).dictation.dictionaryList()
    expect(ipc.invocations).toEqual([{ channel: IPC_CHANNEL.dictationDictionaryList, args: [] }])
  })
  it('decodes a rejected invoke in the wire error shape into the typed payload', async () => {
    // Regression: main transports typed errors as a serialized payload inside
    // the rejection message; the bridge must decode that wire shape to the
    // structured AppErrorPayload the renderer contract promises (a silent
    // mis-decode would surface as a generic failure).
    const ipc = createIpcMock()
    ipc.invoke = () =>
      Promise.reject(
        new Error(
          serializeAppError(new AppError('not_found', 'No such project.', 'projects:remove')),
        ),
      )
    await expect(createAppApi(ipc).projects.remove('p1')).rejects.toEqual({
      nekodeAppError: true,
      code: 'not_found',
      kind: 'not_found',
      message: 'No such project.',
      channel: 'projects:remove',
    })
  })
  it('keeps the error detail the renderer uses to offer Use a local task list', async () => {
    const ipc = createIpcMock()
    ipc.invoke = () =>
      Promise.reject(
        new Error(
          serializeAppError(
            new AppError(
              'not_found',
              'The task file .nekode/tasks.json was not found.',
              'kanban:listBoard',
              undefined,
              LOCAL_TASK_FILE_MISSING,
            ),
          ),
        ),
      )
    await expect(createAppApi(ipc).kanban.listBoard('p1')).rejects.toMatchObject({
      code: 'not_found',
      detail: LOCAL_TASK_FILE_MISSING,
    })
  })
  it('routes desktop activation with no keys, window or command arguments', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.dictation.desktopSetup()
    await api.dictation.desktopConfigure({ enabled: true, confirmed: false })
    await api.dictation.desktopActivate()
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.dictationDesktopSetup, args: [] },
      {
        channel: IPC_CHANNEL.dictationDesktopConfigure,
        args: [{ enabled: true, confirmed: false }],
      },
      { channel: IPC_CHANNEL.dictationDesktopActivate, args: [] },
    ])
  })
  it('routes session audio and cancel, validates result events and removes subscriptions', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const wav = new ArrayBuffer(44)
    await api.dictation.start('chat', null)
    await api.dictation.audio('session', wav)
    await api.dictation.cancel('session')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.dictationStart, args: ['chat', null] },
      { channel: IPC_CHANNEL.dictationAudio, args: ['session', wav] },
      { channel: IPC_CHANNEL.dictationCancel, args: ['session'] },
    ])
    const callback = vi.fn()
    const unsubscribe = api.dictation.onResult(callback)
    const listener = [...(ipc.listeners.get(IPC_CHANNEL.dictationResult) ?? [])][0]
    listener({}, { text: 'malformed' })
    expect(callback).not.toHaveBeenCalled()
    const result = {
      sessionId: 'session',
      chatId: 'chat',
      outcome: 'success',
      text: 'hello',
      warning: 'hint',
      error: null,
      retryable: false,
    }
    listener({}, result)
    expect(callback).toHaveBeenCalledExactlyOnceWith(result)
    unsubscribe()
    expect(ipc.listeners.get(IPC_CHANNEL.dictationResult)?.size).toBe(0)
  })
  it('routes taskProgress observe/get and filters malformed changed events', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.taskProgress.observe(['p1', 'p2'])
    await api.taskProgress.get('p1')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.taskProgressObserve, args: [['p1', 'p2']] },
      { channel: IPC_CHANNEL.taskProgressGet, args: ['p1'] },
    ])
    const callback = vi.fn()
    const unsubscribe = api.taskProgress.onChanged(callback)
    const listener = [...(ipc.listeners.get(IPC_CHANNEL.taskProgressChanged) ?? [])][0]
    listener({}, { projectId: 'p1' })
    listener({}, { projectId: 7, cleared: true })
    expect(callback).not.toHaveBeenCalled()
    const snapshot = {
      projectId: 'p1',
      adapterId: 'demo',
      status: 'ok',
      tasks: [],
      receivedAt: '2026-10-23T10:00:00.000Z',
    }
    listener({}, snapshot)
    listener({}, { projectId: 'p1', cleared: true })
    expect(callback.mock.calls).toEqual([[snapshot], [{ projectId: 'p1', cleared: true }]])
    unsubscribe()
    expect(ipc.listeners.get(IPC_CHANNEL.taskProgressChanged)?.size).toBe(0)
  })
  it('routes the five dictation methods without exposing transport controls', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const settings = {
      enabled: true,
      language: 'pl',
      model: 'default' as const,
      timeoutSeconds: 30,
    }
    await api.dictation.status()
    await api.dictation.testConnection()
    await api.dictation.refreshModels()
    await api.dictation.getSettings()
    await api.dictation.setSettings(settings)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.dictationStatus, args: [] },
      { channel: IPC_CHANNEL.dictationTestConnection, args: [] },
      { channel: IPC_CHANNEL.dictationRefreshModels, args: [] },
      { channel: IPC_CHANNEL.dictationGetSettings, args: [] },
      { channel: IPC_CHANNEL.dictationSetSettings, args: [settings] },
    ])
  })
  it('routes the provider, dictionary and post-processing dictation methods', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.dictation.providersList()
    await api.dictation.providersTestConnection('elevenlabs', { apiKey: 'xi-123' })
    await api.dictation.providersDiscoverModels('openrouter')
    await api.dictation.providersGetConfig('openrouter')
    await api.dictation.providersSetConfig('openrouter', { model: 'm1' })
    await api.dictation.getActiveProvider()
    await api.dictation.setActiveProvider('elevenlabs')
    await api.dictation.dictionaryList('p1')
    await api.dictation.dictionaryAdd({ term: 'Vitest', scope: 'global' })
    await api.dictation.dictionaryUpdate('d1', { term: 'Vitest 2' })
    await api.dictation.dictionaryDelete('d1')
    await api.dictation.dictionaryToggle('d1', false)
    await api.dictation.postProcessingGetSettings()
    await api.dictation.postProcessingSetSettings({ mode: 'disabled', level: 'light' })

    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.dictationProvidersList, args: [] },
      {
        channel: IPC_CHANNEL.dictationProvidersTestConnection,
        args: ['elevenlabs', { apiKey: 'xi-123' }],
      },
      { channel: IPC_CHANNEL.dictationProvidersDiscoverModels, args: ['openrouter'] },
      { channel: IPC_CHANNEL.dictationProvidersGetConfig, args: ['openrouter'] },
      {
        channel: IPC_CHANNEL.dictationProvidersSetConfig,
        args: ['openrouter', { model: 'm1' }],
      },
      { channel: IPC_CHANNEL.dictationGetActiveProvider, args: [] },
      { channel: IPC_CHANNEL.dictationSetActiveProvider, args: ['elevenlabs'] },
      { channel: IPC_CHANNEL.dictationDictionaryList, args: ['p1'] },
      {
        channel: IPC_CHANNEL.dictationDictionaryAdd,
        args: [{ term: 'Vitest', scope: 'global' }],
      },
      {
        channel: IPC_CHANNEL.dictationDictionaryUpdate,
        args: ['d1', { term: 'Vitest 2' }],
      },
      { channel: IPC_CHANNEL.dictationDictionaryDelete, args: ['d1'] },
      { channel: IPC_CHANNEL.dictationDictionaryToggle, args: ['d1', false] },
      { channel: IPC_CHANNEL.dictationPostProcessingGetSettings, args: [] },
      {
        channel: IPC_CHANNEL.dictationPostProcessingSetSettings,
        args: [{ mode: 'disabled', level: 'light' }],
      },
    ])
  })
  it('forwards WSL registration data and project shell context unchanged', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.projects.wslDistributions()
    await api.projects.wslDirectories('Ubuntu-24.04', '/home/user/My $ Project/')
    await api.projects.addWsl('Ubuntu-24.04', '/home/user/My Project')
    await api.terminals.shellList('p1')
    await api.terminals.shellDetect('p1')
    await api.terminals.shellAddCustom('/bin/fish', 'p1')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.projectsWslDistributions, args: [] },
      {
        channel: IPC_CHANNEL.projectsWslDirectories,
        args: ['Ubuntu-24.04', '/home/user/My $ Project/'],
      },
      { channel: IPC_CHANNEL.projectsAddWsl, args: ['Ubuntu-24.04', '/home/user/My Project'] },
      { channel: IPC_CHANNEL.terminalsShellList, args: ['p1'] },
      { channel: IPC_CHANNEL.terminalsShellDetect, args: ['p1'] },
      { channel: IPC_CHANNEL.terminalsShellAddCustom, args: ['/bin/fish', 'p1'] },
    ])
  })
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
    await api.chats.createWithAgent('p1', 'prof-1')
    await api.chats.remove('t1')
    expect(ipc.invocations.map((i) => i.channel)).toEqual([
      IPC_CHANNEL.projectsList,
      IPC_CHANNEL.projectsAdd,
      IPC_CHANNEL.projectsRemove,
      IPC_CHANNEL.chatsList,
      IPC_CHANNEL.chatsCreate,
      IPC_CHANNEL.chatsCreateWithAgent,
      IPC_CHANNEL.chatsRemove,
    ])
    // The create payload is the project id only — no name travels over IPC.
    expect(ipc.invocations[4].args).toEqual(['p1'])
    // The agent launch carries the project and the profile choice only.
    expect(ipc.invocations[5].args).toEqual(['p1', 'prof-1'])
  })

  it('routes state, terminal and git calls to explicit channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.state.get('k')
    await api.state.set('k', 'v')
    await api.terminals.create('t1', 'D:/code/demo')
    await api.terminals.write('t1', 'ls')
    await api.terminals.resize('t1', 80, 24)
    await api.terminals.shellName('p1')
    await api.terminals.shellList()
    await api.terminals.shellDetect()
    await api.terminals.shellAddCustom('D:/tools/nu.exe')
    await api.terminals.terminate('bottom:p1:tab-a')
    await api.git.getStatus('proj-1')
    await api.git.fileStatuses('proj-1')
    expect(ipc.invocations.map((i) => i.channel)).toEqual([
      IPC_CHANNEL.stateGet,
      IPC_CHANNEL.stateSet,
      IPC_CHANNEL.terminalsCreate,
      IPC_CHANNEL.terminalsWrite,
      IPC_CHANNEL.terminalsResize,
      IPC_CHANNEL.terminalsShellName,
      IPC_CHANNEL.terminalsShellList,
      IPC_CHANNEL.terminalsShellDetect,
      IPC_CHANNEL.terminalsShellAddCustom,
      IPC_CHANNEL.terminalsTerminate,
      IPC_CHANNEL.gitStatus,
      IPC_CHANNEL.gitFileStatuses,
    ])
    expect(ipc.invocations[5]?.args).toEqual(['p1'])
    expect(ipc.invocations[8]?.args).toEqual(['D:/tools/nu.exe'])
    expect(ipc.invocations[9]?.args).toEqual(['bottom:p1:tab-a'])
    expect(ipc.invocations[10]?.args).toEqual(['proj-1'])
    expect(ipc.invocations[11]?.args).toEqual(['proj-1'])
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

  it('routes handoff listing and the directory picker through typed channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.handoffs.list('p1')
    await api.handoffs.resumePrompt('p1', 'D:/handoffs/a.md')
    await api.dialogs.pickDirectory('D:/code')
    await api.dialogs.pickDirectory(null)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.handoffsList, args: ['p1'] },
      { channel: IPC_CHANNEL.handoffsResumePrompt, args: ['p1', 'D:/handoffs/a.md'] },
      { channel: IPC_CHANNEL.dialogsPickDirectory, args: ['D:/code'] },
      { channel: IPC_CHANNEL.dialogsPickDirectory, args: [null] },
    ])
  })

  it('routes agent profile calls through typed channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const input = {
      id: null,
      name: 'Claude',
      command: 'claude "{prompt}"',
      interactiveArgs: ['--model', 'my model', ''],
    }
    await api.agentProfiles.get('p1')
    await api.agentProfiles.libraryGet()
    await api.agentProfiles.templatesGet()
    await api.agentProfiles.put(input)
    await api.agentProfiles.delete('id-1')
    await api.agentProfiles.selectionGet('p1')
    const selection = { selectedIds: ['id-1'], defaultId: null }
    await api.agentProfiles.selectionSet('p1', selection)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.agentProfilesGet, args: ['p1'] },
      { channel: IPC_CHANNEL.agentProfilesLibraryGet, args: [] },
      { channel: IPC_CHANNEL.agentProfilesTemplatesGet, args: [] },
      { channel: IPC_CHANNEL.agentProfilesPut, args: [input] },
      { channel: IPC_CHANNEL.agentProfilesDelete, args: ['id-1'] },
      { channel: IPC_CHANNEL.agentProfilesSelectionGet, args: ['p1'] },
      { channel: IPC_CHANNEL.agentProfilesSelectionSet, args: ['p1', selection] },
    ])
  })

  it('routes kanban getItem, getComments, and launchTask through typed channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const launchInput = {
      projectId: 'p1',
      itemId: 'native-1',
      ref: 'DEMO-1',
      profileId: 'prof-1',
      attemptId: 'attempt-1',
      mode: 'start' as const,
    }
    await api.kanban.getItem('p1', 'DEMO-1')
    await api.kanban.getComments('p1', 'DEMO-1')
    await api.kanban.launchTask(launchInput)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.kanbanGetItem, args: ['p1', 'DEMO-1'] },
      { channel: IPC_CHANNEL.kanbanGetComments, args: ['p1', 'DEMO-1'] },
      { channel: IPC_CHANNEL.kanbanLaunchTask, args: [launchInput] },
    ])
  })

  it('routes kanban writes with the local-file revision only when one is given, and bindLocalFile', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.kanban.createItem('p1', { title: 'Plane' })
    await api.kanban.createItem('p1', { title: 'Local' }, 2)
    await api.kanban.updateItem('p1', 'DEMO-1', { stateRef: 'done' })
    await api.kanban.updateItem('p1', 'T-1', { stateRef: 'Done' }, 3)
    await api.kanban.bindLocalFile('p1')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.kanbanCreateItem, args: ['p1', { title: 'Plane' }] },
      { channel: IPC_CHANNEL.kanbanCreateItem, args: ['p1', { title: 'Local' }, 2] },
      { channel: IPC_CHANNEL.kanbanUpdateItem, args: ['p1', 'DEMO-1', { stateRef: 'done' }] },
      { channel: IPC_CHANNEL.kanbanUpdateItem, args: ['p1', 'T-1', { stateRef: 'Done' }, 3] },
      { channel: IPC_CHANNEL.kanbanBindLocalFile, args: ['p1'] },
    ])
  })

  it('routes Teach agents with the project id only', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.kanban.skillStatus('p1')
    await api.kanban.writeSkill('p1')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.kanbanSkillStatus, args: ['p1'] },
      { channel: IPC_CHANNEL.kanbanWriteSkill, args: ['p1'] },
    ])
  })

  it('routes kanban handoff candidates through its typed channel', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const identity = { projectId: 'p1', itemId: 'native-1', ref: 'DEMO-1' }
    await api.kanban.handoffCandidates(identity)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.kanbanHandoffCandidates, args: [identity] },
    ])
  })

  it('routes the batch handoff availability check through its typed channel', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    const availabilityInput = {
      projectId: 'p1',
      items: [
        { itemId: 'native-1', ref: 'DEMO-1' },
        { itemId: 'native-28', ref: 'DEMO-28' },
      ],
    }
    await api.kanban.handoffAvailability(availabilityInput)
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.kanbanHandoffAvailability, args: [availabilityInput] },
    ])
  })

  it('routes files:showInFolder and files:trash through their typed channels', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.files.showInFolder('p1', 'src/app.ts')
    await api.files.trash('p1', 'src')
    expect(ipc.invocations).toEqual([
      { channel: IPC_CHANNEL.filesShowInFolder, args: ['p1', 'src/app.ts'] },
      { channel: IPC_CHANNEL.filesTrash, args: ['p1', 'src'] },
    ])
  })

  it('routes files:openRoot through its typed channel', async () => {
    const ipc = createIpcMock()
    const api = createAppApi(ipc)
    await api.files.openRoot('p1')
    expect(ipc.invocations).toEqual([{ channel: IPC_CHANNEL.filesOpenRoot, args: ['p1'] }])
  })
})
