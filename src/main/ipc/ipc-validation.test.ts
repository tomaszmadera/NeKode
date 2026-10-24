import { describe, expect, it, vi } from 'vitest'
import { emptyGitWorktree, IPC_CHANNEL } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { hostPath } from '../test-support/host-path'
import { buildValidatedChannels, ValidationError } from './ipc-validation'
import type { AppServices } from './service-registry'
import { usageTestStub } from './usage-test-stub'

/** A ready scan with no candidates; the handoff candidates channel returns it by default. */
const EMPTY_HANDOFF_CANDIDATES = {
  state: 'ready' as const,
  files: [],
  rejections: [],
}

/** A ready batch check with no available items. */
const EMPTY_HANDOFF_AVAILABILITY = {
  state: 'ready' as const,
  items: [],
  rejections: [],
}

function fakeServices(): AppServices {
  return {
    usage: usageTestStub(),
    dictation: {
      desktopSetup: vi.fn(),
      desktopConfigure: vi.fn(),
      desktopActivate: vi.fn(async () => {}),
      status: vi.fn(),
      testConnection: vi.fn(),
      refreshModels: vi.fn(),
      dictionaryList: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn(),
      start: vi.fn(),
      audio: vi.fn(),
      cancel: vi.fn(),
      onResult: vi.fn(() => () => undefined),
      shutdown: vi.fn(),
    },
    actions: {
      list: vi.fn(() => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
      stopForProject: vi.fn(),
      stopAll: vi.fn(),
    },
    projects: {
      wslDirectories: vi.fn(() => []),
      wslDistributions: vi.fn(() => []),
      addWsl: vi.fn(),
      list: () => [],
      add: () => ({ id: 'p1', name: 'demo', path: 'D:/code/demo', runtimeLabel: null }),
      remove: () => {},
    },
    chats: {
      list: () => [],
      create: () => ({ id: 't1', projectId: 'p1', name: 'n' }),
      createWithAgent: vi.fn(() => ({ id: 't1', projectId: 'p1', name: 'n' })),
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
      shutdown: vi.fn(async () => {}),
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
    git: {
      getStatus: vi.fn(() =>
        Promise.resolve({ branch: null, dirty: false, worktree: emptyGitWorktree() }),
      ),
      fileStatuses: vi.fn(() => Promise.resolve({ 'src/app.ts': 'modified' as const })),
      sync: vi.fn(() => Promise.resolve()),
    },
    files: {
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn(() => Promise.resolve({ kind: 'text' as const, content: '', language: null })),
      openExternal: vi.fn(() => Promise.resolve()),
      openRoot: vi.fn(() => Promise.resolve()),
      showInFolder: vi.fn(() => Promise.resolve()),
      trash: vi.fn(() => Promise.resolve()),
    },
    handoffs: {
      list: vi.fn(() => Promise.resolve([])),
      resumePrompt: vi.fn(async () => 'Resume prompt'),
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
      getComments: vi.fn(() => Promise.resolve([])),
      bindLocalFile: vi.fn(() => Promise.resolve()),
      skillStatus: vi.fn(() => Promise.resolve({ exists: false })),
      writeSkill: vi.fn(() => Promise.resolve()),
      launchTask: vi.fn(() => Promise.resolve({} as never)),
      handoffCandidates: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_CANDIDATES)),
      handoffAvailability: vi.fn(() => Promise.resolve(EMPTY_HANDOFF_AVAILABILITY)),
      cleanupProject: vi.fn(),
      dropLaunchProject: vi.fn(),
      blocksProjectShell: vi.fn(() => false),
    },
    taskProgress: {
      adaptersList: vi.fn(() => ({ adapters: [], warnings: [] })),
      getBinding: vi.fn(() => ({ adapterId: null, config: {} })),
      saveBinding: vi.fn(),
      test: vi.fn(() => Promise.resolve({ ok: true as const, summary: 'ok' })),
      observe: vi.fn(),
      get: vi.fn(() => null),
      onChanged: vi.fn(() => () => undefined),
      setVisible: vi.fn(),
      shutdown: vi.fn(),
      cleanupProject: vi.fn(),
    },
    agentProfiles: {
      get: vi.fn(() => ({ defaultId: null, profiles: [] })),
      libraryGet: vi.fn(() => ({ version: 1 as const, profiles: [] })),
      templatesGet: vi.fn(() => []),
      put: vi.fn(() => ({ version: 1 as const, profiles: [] })),
      delete: vi.fn(() => ({ version: 1 as const, profiles: [] })),
      selectionGet: vi.fn(() => ({ version: 1 as const, selectedIds: [], defaultId: null })),
      selectionSet: vi.fn(() => ({ version: 1 as const, selectedIds: [], defaultId: null })),
      cleanupProject: vi.fn(),
    },
    dialogs: {
      pickDirectory: vi.fn(() => Promise.resolve(null)),
    },
  }
}

function channelMap() {
  const map = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
  for (const entry of buildValidatedChannels(fakeServices())) {
    map.set(entry.channel, entry)
  }
  return map
}

describe('ipc payload validation', () => {
  it('validates usage shapes and protects the encrypted settings key', () => {
    const entries = buildValidatedChannels(fakeServices()),
      channel = (name: string) => {
        const entry = entries.find((e) => e.channel === name)
        if (!entry) throw new Error(`Missing usage test channel: ${name}`)
        return entry
      }
    const valid = {
      connections: [],
      pin: null,
      export: { enabled: false, path: null },
    }
    expect(channel(IPC_CHANNEL.usageSaveSettings).parse([valid])).toEqual([valid])
    for (const bad of [
      [],
      [null],
      [{ ...valid, connections: 'wrong' }],
      [{ ...valid, export: { enabled: 'yes', path: null } }],
      // The adapters directory override was removed (usage-quota spec rule 20).
      [{ ...valid, adaptersDirectory: null }],
      [valid, 'extra'],
    ])
      expect(() => channel(IPC_CHANNEL.usageSaveSettings).parse(bad)).toThrow()
    for (const bad of [[], ['true'], [true, false]])
      expect(() => channel(IPC_CHANNEL.usagePickFile).parse(bad)).toThrow()
    expect(channel(IPC_CHANNEL.usageSetEnabled).parse([false])).toEqual([false])
    for (const bad of [[], ['true'], [1], [null], [true, false]])
      expect(() => channel(IPC_CHANNEL.usageSetEnabled).parse(bad)).toThrow()
    for (const name of [
      IPC_CHANNEL.usageRead,
      IPC_CHANNEL.usageRefresh,
      IPC_CHANNEL.usageGetSettings,
      IPC_CHANNEL.usageListAdapters,
      IPC_CHANNEL.usageGetEnabled,
      IPC_CHANNEL.usageOpenAdaptersFolder,
    ])
      expect(() => channel(name).parse(['extra'])).toThrow()
    expect(() => channel(IPC_CHANNEL.stateSet).parse(['usage.enabled', 'true'])).toThrow(
      'protected',
    )
    expect(() => channel(IPC_CHANNEL.stateGet).parse(['usage.settings'])).toThrow('protected')
    expect(() => channel(IPC_CHANNEL.stateSet).parse(['usage.settings', '{}'])).toThrow('protected')
  })
  it('accepts only argument-free desktop activation and strict boolean desktop settings', () => {
    const services = fakeServices()
    const channels = buildValidatedChannels(services)
    const activate = channels.find(
      (entry) => entry.channel === IPC_CHANNEL.dictationDesktopActivate,
    )
    const configure = channels.find(
      (entry) => entry.channel === IPC_CHANNEL.dictationDesktopConfigure,
    )
    if (!activate || !configure) throw new Error('Missing desktop channels')
    expect(activate.parse([])).toEqual([])
    for (const payload of [['Ctrl'], ['123'], [{ script: 'bad' }], [null]])
      expect(() => activate.parse(payload)).toThrow(ValidationError)
    for (const payload of [
      [],
      [null],
      [[]],
      [{ enabled: true, confirmed: 'true' }],
      [{ enabled: 'true', confirmed: false }],
      [{ enabled: true, confirmed: true, key: 'any' }],
      [{ enabled: false, confirmed: true }],
      [{ enabled: true, confirmed: false }, 'extra'],
    ])
      expect(() => configure.parse(payload)).toThrow(ValidationError)
    expect(services.dictation.desktopConfigure).not.toHaveBeenCalled()
    configure.invoke(configure.parse([{ enabled: true, confirmed: false }]))
    expect(services.dictation.desktopConfigure).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      confirmed: false,
    })
  })
  it('validates session start, binary WAV, cancel and exact arity before invoking services', () => {
    const services = fakeServices()
    const channels = new Map(
      buildValidatedChannels(services).map((entry) => [entry.channel, entry]),
    )
    const start = channels.get(IPC_CHANNEL.dictationStart)
    if (!start) throw new Error('Missing start channel')
    for (const payload of [[], ['chat'], ['chat', null, 1], [null, null], ['', null], ['chat', 1]])
      expect(() => start.parse(payload)).toThrow(ValidationError)
    start.invoke(start.parse(['chat', null]))
    expect(services.dictation.start).toHaveBeenCalledExactlyOnceWith('chat', null)
    const audio = channels.get(IPC_CHANNEL.dictationAudio)
    if (!audio) throw new Error('Missing audio channel')
    for (const payload of [
      [],
      ['session'],
      ['session', null],
      ['session', 'C:\\audio.wav'],
      ['session', new Uint8Array(44)],
      ['session', new ArrayBuffer(44)],
      [1, new ArrayBuffer(44)],
    ])
      expect(() => audio.parse(payload)).toThrow(ValidationError)
    expect(services.dictation.audio).not.toHaveBeenCalled()
    const wav = new Uint8Array([
      82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 128,
      62, 0, 0, 0, 125, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0,
    ]).buffer
    audio.invoke(audio.parse(['session', wav]))
    expect(services.dictation.audio).toHaveBeenCalledExactlyOnceWith('session', wav)
    const malformed = wav.slice(0)
    new DataView(malformed).setUint32(24, 44100, true)
    expect(() => audio.parse(['session', malformed])).toThrow(ValidationError)
    const cancel = channels.get(IPC_CHANNEL.dictationCancel)
    if (!cancel) throw new Error('Missing cancel channel')
    expect(() => cancel.parse([])).toThrow(ValidationError)
    expect(() => cancel.parse([1])).toThrow(ValidationError)
    expect(() => cancel.parse(['session', 'extra'])).toThrow(ValidationError)
    cancel.invoke(cancel.parse(['session']))
    expect(services.dictation.cancel).toHaveBeenCalledExactlyOnceWith('session')
  })
  it.each([
    IPC_CHANNEL.dictationStatus,
    IPC_CHANNEL.dictationTestConnection,
    IPC_CHANNEL.dictationRefreshModels,
    IPC_CHANNEL.dictationDictionaryList,
    IPC_CHANNEL.dictationGetSettings,
  ])('rejects all arguments to %s before service routing', (name) => {
    const services = fakeServices()
    const channel = buildValidatedChannels(services).find((entry) => entry.channel === name)
    if (!channel) throw new Error('Missing dictation channel')
    expect(() => channel.parse(['renderer-url-or-token'])).toThrow(ValidationError)
    channel.invoke(channel.parse([]))
    const method = name.slice('dictation:'.length) as
      | 'status'
      | 'testConnection'
      | 'refreshModels'
      | 'dictionaryList'
      | 'getSettings'
    expect(services.dictation[method]).toHaveBeenCalledExactlyOnceWith()
  })
  it('strictly validates settings and exact arity before routing', () => {
    const services = fakeServices()
    const channel = buildValidatedChannels(services).find(
      (entry) => entry.channel === IPC_CHANNEL.dictationSetSettings,
    )
    if (!channel) throw new Error('Missing dictation settings channel')
    const settings = { enabled: true, language: 'pl', model: 'default', timeoutSeconds: 30 }
    for (const payload of [
      [],
      [settings, 'extra'],
      [null],
      [[]],
      [{ ...settings, enabled: 'true' }],
      [{ ...settings, language: 'http://cloud' }],
      [{ ...settings, model: { provider: '', model: 'm' } }],
      [{ ...settings, model: { provider: 'p', model: 'm', token: 'secret' } }],
      [{ ...settings, model: { provider: 'p', model: '\u0000' } }],
      [{ ...settings, timeoutSeconds: 4 }],
      [{ ...settings, timeoutSeconds: 301 }],
      [{ ...settings, timeoutSeconds: 5.5 }],
      [{ ...settings, timeoutSeconds: Infinity }],
      [{ ...settings, token: 'secret' }],
    ]) {
      expect(() => channel.parse(payload)).toThrow(ValidationError)
    }
    expect(services.dictation.setSettings).not.toHaveBeenCalled()
    channel.invoke(channel.parse([settings]))
    expect(services.dictation.setSettings).toHaveBeenCalledExactlyOnceWith(settings)
  })
  it('validates both directory query arguments and exact arity before the service', () => {
    const services = fakeServices()
    const channel = buildValidatedChannels(services).find(
      (entry) => entry.channel === 'projects:wslDirectories',
    )
    if (!channel) throw new Error('Missing directory suggestions channel')
    for (const payload of [[], ['Ubuntu'], ['Ubuntu', '/', 'extra'], [null, '/'], ['Ubuntu', 42]]) {
      expect(() => channel.parse(payload)).toThrow(ValidationError)
    }
    expect(services.projects.wslDirectories).not.toHaveBeenCalled()
    for (const query of ['', 'relative', '/', '/home/user/']) {
      const args = channel.parse(['Ubuntu', query])
      channel.invoke(args)
      expect(services.projects.wslDirectories).toHaveBeenLastCalledWith('Ubuntu', query)
    }
  })
  it('validates WSL registration and optional project shell context', () => {
    const channels = channelMap()
    expect(channels.get('projects:addWsl')?.parse(['Ubuntu', '/home/user/My Project'])).toEqual([
      'Ubuntu',
      '/home/user/My Project',
    ])
    for (const payload of [
      ['Ubuntu'],
      ['', '/home/user'],
      ['Ubuntu', '/'],
      ['Ubuntu', '/home/../user'],
      ['Ubuntu', '/home/user\0'],
    ]) {
      expect(() => channels.get('projects:addWsl')?.parse(payload)).toThrow(ValidationError)
    }
    expect(channels.get('terminals:shellDetect')?.parse(['p1'])).toEqual(['p1'])
    expect(channels.get('terminals:shellList')?.parse([null])).toEqual([null])
    expect(channels.get('terminals:shellAddCustom')?.parse(['/bin/fish', 'p1'])).toEqual([
      '/bin/fish',
      'p1',
    ])
    expect(() => channels.get('terminals:shellDetect')?.parse([{}])).toThrow(ValidationError)
    expect(() =>
      channels.get('terminals:shellAddCustom')?.parse(['/bin/fish', 'p1', 'extra']),
    ).toThrow(ValidationError)
  })
  it('validates action inputs and confirmation before service calls', () => {
    const channels = channelMap()
    const input = {
      scope: 'project',
      projectId: 'p1',
      title: 'Build',
      icon: null,
      command: 'pnpm build',
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    }
    expect(channels.get('actions:create')?.parse([input])).toEqual([input])
    expect(() => channels.get('actions:create')?.parse([{ ...input, title: '' }])).toThrow(
      ValidationError,
    )
    // The bottom-terminal mode is a valid ActionInput (bottom-auxiliary-terminal
    // spec, Data/API): validation accepts it…
    const bottomInput = { ...input, runMode: 'bottom-terminal' }
    expect(channels.get('actions:create')?.parse([bottomInput])).toEqual([bottomInput])
    expect(channels.get('actions:update')?.parse(['a1', bottomInput])).toEqual(['a1', bottomInput])
    // …and still rejects an unknown mode.
    expect(() =>
      channels.get('actions:create')?.parse([{ ...input, runMode: 'detached' }]),
    ).toThrow(ValidationError)
    expect(() => channels.get('actions:create')?.parse([{ ...input, cwd: '../outside' }])).toThrow(
      ValidationError,
    )
    expect(() => channels.get('actions:execute')?.parse(['a1', 'p1', 'true'])).toThrow(
      ValidationError,
    )
    expect(channels.get('actions:execute')?.parse(['a1', 'p1', true])).toEqual(['a1', 'p1', true])
  })
  it('rejects wrong arity before touching services', () => {
    const entry = channelMap().get('chats:create')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    // chats:create carries no name (spec Behaviour 3): exactly one argument.
    expect(() => entry.parse([])).toThrow(ValidationError)
    expect(() => entry.parse(['p1', 'name', 'extra'])).toThrow(/expected 1 argument/)
    expect(() => entry.parse(['p1', 'name'])).toThrow(/expected 1 argument/)
    expect(entry.parse(['p1'])).toEqual(['p1'])
  })

  it('validates the agent chat launch payload before the service', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const launch = channels.get('chats:createWithAgent')
    expect(launch?.parse(['p1', 'prof-1'])).toEqual(['p1', 'prof-1'])
    launch?.invoke(launch.parse(['p1', 'prof-1']))
    expect(services.chats.createWithAgent).toHaveBeenCalledWith('p1', 'prof-1')

    // Malformed payloads never reach the launch: arity, types and the
    // non-empty ids the service looks up (spec Errors).
    const invalid: unknown[][] = [
      [],
      ['p1'],
      ['p1', 'prof-1', 'extra'],
      [1, 'prof-1'],
      ['p1', 1],
      ['', 'prof-1'],
      ['p1', ''],
    ]
    for (const payload of invalid) {
      expect(() => launch?.parse(payload)).toThrow(ValidationError)
    }
    expect(services.chats.createWithAgent).toHaveBeenCalledTimes(1)
  })

  it('rejects non-string and non-finite arguments', () => {
    const channels = channelMap()
    expect(() => channels.get('state:set')?.parse(['k', 42])).toThrow(ValidationError)
    expect(() => channels.get('terminals:resize')?.parse(['t1', Number.NaN, 24])).toThrow(
      ValidationError,
    )
  })

  it('validates git:status projectId argument', () => {
    const entry = channelMap().get('git:status')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    expect(entry.parse(['proj-1'])).toEqual(['proj-1'])
    expect(() => entry.parse([123])).toThrow(ValidationError)
    expect(() => entry.parse([])).toThrow(/expected 1 argument/)
    expect(() => entry.parse(['proj-1', 'extra'])).toThrow(/expected 1 argument/)
  })

  it('validates git:fileStatuses projectId argument', () => {
    const entry = channelMap().get('git:fileStatuses')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    expect(entry.parse(['proj-1'])).toEqual(['proj-1'])
    expect(() => entry.parse([123])).toThrow(ValidationError)
    expect(() => entry.parse([])).toThrow(/expected 1 argument/)
    expect(() => entry.parse(['proj-1', 'extra'])).toThrow(/expected 1 argument/)
  })

  it('validates git:sync projectId argument and delegates to service', () => {
    const services = fakeServices()
    const channels = new Map(
      buildValidatedChannels(services).map((entry) => [entry.channel, entry]),
    )
    const entry = channels.get('git:sync')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    expect(entry.parse(['proj-1'])).toEqual(['proj-1'])
    entry.invoke(entry.parse(['proj-1']))
    expect(services.git.sync).toHaveBeenCalledWith('proj-1')
    expect(() => entry.parse([123])).toThrow(ValidationError)
    expect(() => entry.parse([])).toThrow(/expected 1 argument/)
    expect(() => entry.parse(['proj-1', 'extra'])).toThrow(/expected 1 argument/)
  })

  it('validates the terminal cwd as a safe path', () => {
    const entry = channelMap().get('terminals:create')
    expect(() => entry?.parse(['t1', 'relative/cwd'])).toThrow(ValidationError)
    expect(entry?.parse(['t1', hostPath('D:/code/demo')])).toEqual(['t1', hostPath('D:/code/demo')])
  })

  it('validates files relative paths by shape only (containment is the service’s job)', () => {
    const channels = channelMap()
    const read = channels.get('files:read')
    expect(read?.parse(['p1', 'app/Services/Billing.php'])).toEqual([
      'p1',
      'app/Services/Billing.php',
    ])
    // Empty and NUL-carrying strings are shape violations…
    expect(() => read?.parse(['p1', ''])).toThrow(ValidationError)
    expect(() => read?.parse(['p1', 'a\u0000b'])).toThrow(/NUL/)
    expect(() => read?.parse(['p1', null])).toThrow(ValidationError)
    // …but traversal/absolute inputs pass validation untouched: they must be
    // rejected by the file service with the not-found error (spec AC7).
    expect(read?.parse(['p1', '../outside/secret.txt'])).toEqual(['p1', '../outside/secret.txt'])
    expect(read?.parse(['p1', 'D:/outside/secret.txt'])).toEqual(['p1', 'D:/outside/secret.txt'])

    const list = channels.get('files:list')
    expect(list?.parse(['p1', null])).toEqual(['p1', null])
    expect(() => list?.parse(['p1', ''])).toThrow(ValidationError)
  })

  it('validates files:openRoot payloads', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }

    const openRoot = channels.get('files:openRoot')
    openRoot?.invoke(openRoot.parse(['p1']))
    expect(services.files.openRoot).toHaveBeenCalledWith('p1')

    expect(() => openRoot?.parse([42])).toThrow(ValidationError)
    expect(() => openRoot?.parse([])).toThrow(/expected 1 argument/)
    expect(() => openRoot?.parse(['p1', 'extra'])).toThrow(/expected 1 argument/)
    expect(services.files.openRoot).toHaveBeenCalledTimes(1)

    const showInFolder = channels.get('files:showInFolder')
    showInFolder?.invoke(showInFolder.parse(['p1', 'src/app.ts']))
    expect(services.files.showInFolder).toHaveBeenCalledWith('p1', 'src/app.ts')
    expect(() => showInFolder?.parse(['p1'])).toThrow(/expected 2 argument/)
    expect(() => showInFolder?.parse(['p1', ''])).toThrow(ValidationError)

    const trash = channels.get('files:trash')
    trash?.invoke(trash.parse(['p1', 'src']))
    expect(services.files.trash).toHaveBeenCalledWith('p1', 'src')
    expect(() => trash?.parse([42, 'src'])).toThrow(ValidationError)
  })

  it('ValidationError transports as a typed validation AppError', () => {
    const error = new ValidationError('bad payload')
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('validation')
  })

  it('every wire channel has a validated entry (no unvalidated invokes)', () => {
    const services = fakeServices()
    const validatedEntries = buildValidatedChannels(services)
    const channels = channelMap()
    // Main-to-renderer push channels are broadcast (webContents.send), never
    // registered for invoke, so they carry no ValidatedChannel. Every other
    // channel in the wire contract must be validated: a newly added channel
    // fails here until it gets an entry (or is consciously listed as a push
    // channel).
    const pushChannels = new Set<string>([
      IPC_CHANNEL.dictationResult,
      IPC_CHANNEL.terminalsData,
      IPC_CHANNEL.terminalsExit,
      IPC_CHANNEL.taskProgressChanged,
    ])
    const expectedInvokeChannels = new Set(
      Object.values(IPC_CHANNEL).filter((channel) => !pushChannels.has(channel)),
    )
    const validatedChannels = new Set(channels.keys())

    // Set equality: the validated set equals the full invoke-channel set,
    // with no unvalidated invoke channels and no unregistered or misspelled channels.
    expect(validatedChannels).toEqual(expectedInvokeChannels)
    expect(validatedEntries.length).toBe(expectedInvokeChannels.size)

    // The push-channel classification must stay honest: every listed push
    // channel is still part of the wire contract, and none of them may gain a
    // validated invoke entry (it would mean an unvalidated invoke slipped in).
    for (const channel of pushChannels) {
      expect(Object.values(IPC_CHANNEL)).toContain(channel)
      expect(channels.has(channel)).toBe(false)
    }
  })

  it('projects:add parses argument-free payloads and forbids direct invoke without dialog', () => {
    const channels = channelMap()
    const entry = channels.get(IPC_CHANNEL.projectsAdd)
    if (!entry) throw new Error('Missing projects:add channel')

    expect(entry.parse([])).toEqual([])
    expect(() => entry.parse(['unexpected-path'])).toThrow(ValidationError)
    expect(() => entry.invoke([])).toThrow(AppError)
    expect(() => entry.invoke([])).toThrow(/must be routed through the folder dialog handler/)
  })

  it('does not expose the removed kanban:linkHandoff channel', () => {
    const channels = channelMap()
    expect(channels.has('kanban:linkHandoff')).toBe(false)
  })

  it('terminals:terminate accepts a bottom tab id and rejects a chat id', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const terminate = channels.get('terminals:terminate')
    const bottomId = 'bottom:p1:tab-a'
    expect(terminate?.parse([bottomId])).toEqual([bottomId])
    terminate?.invoke(terminate.parse([bottomId]))
    expect(services.terminals.terminate).toHaveBeenCalledWith(bottomId)

    expect(() => terminate?.parse(['t1'])).toThrow(ValidationError)
    expect(() => terminate?.parse([])).toThrow(ValidationError)
    expect(services.terminals.terminate).toHaveBeenCalledTimes(1)

    // Shell selection (spec project-shell-selection): shellName now takes the
    // project id; list/detect take none; addCustom takes an absolute path.
    const shellName = channels.get('terminals:shellName')
    expect(shellName?.parse(['p1'])).toEqual(['p1'])
    expect(shellName?.invoke(['p1'])).toBe('PowerShell')
    expect(services.terminals.shellName).toHaveBeenCalledWith('p1')
    expect(() => shellName?.parse([])).toThrow(ValidationError)
    const shellList = channels.get('terminals:shellList')
    expect(shellList?.parse([])).toEqual([])
    expect(shellList?.invoke([])).toEqual([{ id: 'default', label: 'PowerShell' }])
    const shellDetect = channels.get('terminals:shellDetect')
    expect(shellDetect?.parse([])).toEqual([])
    expect(shellDetect?.invoke([])).toEqual([{ id: 'default', label: 'PowerShell' }])
    const shellAddCustom = channels.get('terminals:shellAddCustom')
    expect(shellAddCustom?.parse([hostPath('D:\\sh.exe')])).toEqual([hostPath('D:\\sh.exe')])
    expect(shellAddCustom?.invoke([hostPath('D:\\sh.exe')])).toEqual({
      id: 'custom:D:\\sh.exe',
      label: 'sh.exe',
    })
    expect(() => shellAddCustom?.parse(['relative/sh.exe'])).toThrow(ValidationError)
    expect(() => shellName?.parse(['extra', 'extra2'])).toThrow(ValidationError)
  })

  it('validates handoffs:list and dialogs:pickDirectory payloads', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }

    const handoffs = channels.get('handoffs:list')
    expect(() => handoffs?.parse([42])).toThrow(ValidationError)
    expect(() => handoffs?.parse([])).toThrow(/expected 1 argument/)
    handoffs?.invoke(handoffs.parse(['p1']))
    expect(services.handoffs.list).toHaveBeenCalledWith('p1')

    const pick = channels.get('dialogs:pickDirectory')
    // Null (no default) and absolute defaults pass; relative/NUL shapes fail.
    expect(pick?.parse([null])).toEqual([null])
    expect(pick?.parse([hostPath('D:/code')])).toEqual([hostPath('D:/code')])
    expect(() => pick?.parse(['relative/dir'])).toThrow(/absolute path/)
    expect(() => pick?.parse([hostPath('D:/code\u0000x')])).toThrow(/NUL/)
    pick?.invoke(pick.parse([hostPath('D:/code')]))
    expect(services.dialogs.pickDirectory).toHaveBeenCalledWith(hostPath('D:/code'))
  })

  it('validates Resume formatting before service calls', async () => {
    const services = fakeServices()
    const channel = buildValidatedChannels(services).find(
      (entry) => entry.channel === IPC_CHANNEL.handoffsResumePrompt,
    )
    if (!channel) throw new Error('Resume prompt channel is missing')
    for (const payload of [
      [],
      ['p1'],
      ['p1', hostPath('D:/a.md'), 'extra'],
      [42, hostPath('D:/a.md')],
      ['p1', null],
      ['p1', 42],
      ['p1', ''],
      ['p1', 'relative.md'],
      ['p1', hostPath('D:/a\u0000.md')],
      ['p1', hostPath('D:/../a.md')],
    ]) {
      expect(() => channel.parse(payload)).toThrow(ValidationError)
    }
    expect(services.handoffs.resumePrompt).not.toHaveBeenCalled()
    await expect(channel.invoke(channel.parse(['p1', hostPath('D:/handoffs/a.md')]))).resolves.toBe(
      'Resume prompt',
    )
    expect(services.handoffs.resumePrompt).toHaveBeenCalledWith('p1', hostPath('D:/handoffs/a.md'))
  })

  it('validates agentProfiles payloads before the service', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const input = {
      id: null,
      name: 'Claude',
      command: 'claude "{prompt}" "a b"',
    }
    const get = channels.get('agentProfiles:get')
    get?.invoke(get.parse(['p1']))
    expect(services.agentProfiles.get).toHaveBeenCalledWith('p1')

    const put = channels.get('agentProfiles:put')
    expect(put?.parse([input])).toEqual([input])
    put?.invoke(put.parse([input]))
    expect(services.agentProfiles.put).toHaveBeenCalledWith(input)

    for (const interactiveArgs of [[], ['--model', 'my model', '']]) {
      const interactive = { ...input, interactiveArgs }
      expect(put?.parse([interactive])).toEqual([interactive])
    }

    const remove = channels.get('agentProfiles:delete')
    remove?.invoke(remove.parse(['id-1']))
    expect(services.agentProfiles.delete).toHaveBeenCalledWith('id-1')

    const invalid: unknown[][] = [
      [],
      [input, 'extra'],
      [1],
      [null],
      [{ ...input, name: '   ' }],
      [{ ...input, name: 1 }],
      [{ ...input, command: '' }],
      [{ ...input, command: 1 }],
      [{ ...input, command: 'claude' }],
      [{ ...input, command: 'claude {prompt} {prompt}' }],
      [{ ...input, command: 'claude pre{prompt}' }],
      [{ ...input, command: 'claude " {prompt}"' }],
      [{ ...input, command: 'claude | echo' }],
      [{ ...input, command: 'claude\n{prompt}' }],
      [{ ...input, command: 'claude "open' }],
      [{ ...input, command: 'claude\u0000 {prompt}' }],
      [{ ...input, id: 1 }],
      [{ ...input, id: '' }],
      [{ ...input, id: 'a\u0000' }],
      [{ ...input, extra: true }],
      ...[
        null,
        'args',
        {},
        [42],
        new Array<string>(1),
        ['\u0000'],
        ['{prompt}'],
        ['pre{prompt}'],
      ].map((interactiveArgs) => [{ ...input, interactiveArgs }]),
      [{ name: 'Claude' }],
    ]
    for (const payload of invalid) {
      expect(() => put?.parse(payload)).toThrow(ValidationError)
    }
    expect(() => put?.parse([{ ...input, command: 'claude {prompt} {prompt}' }])).toThrow(
      /exactly once/,
    )
    expect(() => get?.parse([])).toThrow(ValidationError)
    expect(() => get?.parse([1])).toThrow(ValidationError)
    expect(() => get?.parse(['p1', 'extra'])).toThrow(ValidationError)
    expect(() => remove?.parse([])).toThrow(ValidationError)
    expect(() => remove?.parse([''])).toThrow(ValidationError)
    expect(() => remove?.parse([1])).toThrow(ValidationError)
    expect(services.agentProfiles.get).toHaveBeenCalledTimes(1)
    expect(services.agentProfiles.put).toHaveBeenCalledTimes(1)
    expect(services.agentProfiles.delete).toHaveBeenCalledTimes(1)
  })

  it('validates library/template arity and project selection fields before service calls', () => {
    const services = fakeServices()
    const channels = new Map(
      buildValidatedChannels(services).map((entry) => [entry.channel, entry]),
    )
    for (const [channel, method] of [
      ['agentProfiles:libraryGet', 'libraryGet'],
      ['agentProfiles:templatesGet', 'templatesGet'],
    ] as const) {
      const entry = channels.get(channel)
      if (entry === undefined) throw new Error(`Missing channel: ${channel}`)
      entry.invoke(entry.parse([]))
      expect(services.agentProfiles[method]).toHaveBeenCalledOnce()
      expect(() => entry.parse(['extra'])).toThrow(ValidationError)
    }
    const read = channels.get('agentProfiles:selectionGet')
    if (read === undefined) throw new Error('Missing agentProfiles:selectionGet')
    read.invoke(read.parse(['p1']))
    expect(services.agentProfiles.selectionGet).toHaveBeenCalledWith('p1')
    for (const args of [[], [1], ['p1', 'extra'], ['p1\u0000']])
      expect(() => read.parse(args)).toThrow(ValidationError)
    const write = channels.get('agentProfiles:selectionSet')
    if (write === undefined) throw new Error('Missing agentProfiles:selectionSet')
    const selection = { selectedIds: ['a', 'b'], defaultId: 'a' }
    write.invoke(write.parse(['p1', selection]))
    expect(services.agentProfiles.selectionSet).toHaveBeenCalledWith('p1', selection)
    write.parse(['p1', { selectedIds: [], defaultId: null }])
    for (const args of [
      [],
      ['p1'],
      [1, selection],
      ['p1', null],
      ['p1', []],
      ['p1', { ...selection, extra: true }],
      ['p1', { selectedIds: 'a', defaultId: null }],
      ['p1', { selectedIds: [1], defaultId: null }],
      ['p1', { selectedIds: [''], defaultId: null }],
      ['p1', { selectedIds: ['a\u0000'], defaultId: null }],
      ['p1', { selectedIds: ['a', 'a'], defaultId: null }],
      ['p1', { selectedIds: ['a'], defaultId: 1 }],
      ['p1', { selectedIds: [], defaultId: 'a' }],
      ['p1', { selectedIds: [] }],
      ['p1', selection, 'extra'],
    ])
      expect(() => write.parse(args)).toThrow(ValidationError)
    expect(services.agentProfiles.selectionSet).toHaveBeenCalledOnce()
  })

  it('accepts a null priority on kanban:updateItem and rejects one on create', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const updateItem = channels.get('kanban:updateItem')
    updateItem?.invoke(updateItem.parse(['p1', 'DEMO-1', { priority: null }]))
    updateItem?.invoke(updateItem.parse(['p1', 'DEMO-1', { priority: 'low' }]))
    expect(services.kanban.updateItem).toHaveBeenNthCalledWith(1, 'p1', 'DEMO-1', {
      priority: null,
    })
    expect(services.kanban.updateItem).toHaveBeenNthCalledWith(2, 'p1', 'DEMO-1', {
      priority: 'low',
    })
    expect(() => updateItem?.parse(['p1', 'DEMO-1', { priority: 'highest' }])).toThrow(
      ValidationError,
    )
    expect(() => updateItem?.parse(['p1', 'DEMO-1', {}])).toThrow(ValidationError)
    const createItem = channels.get('kanban:createItem')
    expect(() => createItem?.parse(['p1', { title: 'Task', priority: null }])).toThrow(
      ValidationError,
    )
    expect(services.kanban.updateItem).toHaveBeenCalledTimes(2)
    expect(services.kanban.createItem).not.toHaveBeenCalled()
  })

  it('validates kanban:getItem and kanban:launchTask before the service', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const getItem = channels.get('kanban:getItem')
    getItem?.invoke(getItem.parse(['p1', 'DEMO-1']))
    expect(services.kanban.getItem).toHaveBeenCalledWith('p1', 'DEMO-1')
    expect(() => getItem?.parse(['p1'])).toThrow(ValidationError)
    expect(() => getItem?.parse(['', 'DEMO-1'])).toThrow(ValidationError)
    expect(() => getItem?.parse(['p1', ''])).toThrow(ValidationError)

    const getComments = channels.get('kanban:getComments')
    getComments?.invoke(getComments.parse(['p1', 'DEMO-1']))
    expect(services.kanban.getComments).toHaveBeenCalledWith('p1', 'DEMO-1')
    expect(() => getComments?.parse(['p1'])).toThrow(ValidationError)
    expect(() => getComments?.parse(['', 'DEMO-1'])).toThrow(ValidationError)
    expect(() => getComments?.parse(['p1', ''])).toThrow(ValidationError)

    const launchInput = {
      projectId: 'p1',
      itemId: 'native-1',
      ref: 'DEMO-1',
      profileId: 'prof-1',
      attemptId: 'attempt-1',
      mode: 'start' as const,
    }
    const launch = channels.get('kanban:launchTask')
    launch?.invoke(launch.parse([launchInput]))
    expect(services.kanban.launchTask).toHaveBeenCalledWith(launchInput)
    const resumeInput = {
      ...launchInput,
      mode: 'resume' as const,
      fileName: 'nekode-28-notes.md',
      stamp: '2026-10-08T00:00:00.000Z',
    }
    launch?.invoke(launch.parse([resumeInput]))
    expect(services.kanban.launchTask).toHaveBeenCalledWith(resumeInput)
    // Resume without the file name and stamp is not a valid confirmation.
    expect(() => launch?.parse([{ ...launchInput, mode: 'resume' }])).toThrow(
      /unexpected or missing/,
    )
    expect(() => launch?.parse([{ ...resumeInput, fileName: 'a/b.md' }])).toThrow(
      /file name, not a path/,
    )
    expect(() => launch?.parse([{ ...resumeInput, stamp: '' }])).toThrow(/stamp/)
    expect(() => launch?.parse([{ ...launchInput, name: 'Codex' }])).toThrow(
      /unexpected or missing/,
    )
    expect(() => launch?.parse([{ ...launchInput, description: 'secret' }])).toThrow(
      /unexpected or missing/,
    )
    expect(() => launch?.parse([{ ...launchInput, prompt: 'secret' }])).toThrow(
      /unexpected or missing/,
    )
    // Start without sending (NEKODE-99) carries exactly the Start fields.
    const draftInput = { ...launchInput, mode: 'draft' as const }
    launch?.invoke(launch.parse([draftInput]))
    expect(services.kanban.launchTask).toHaveBeenCalledWith(draftInput)
    expect(() => launch?.parse([{ ...draftInput, fileName: 'x.md' }])).toThrow(
      /unexpected or missing/,
    )
    expect(() => launch?.parse([{ ...draftInput, prompt: 'secret' }])).toThrow(
      /unexpected or missing/,
    )
    expect(() => launch?.parse([{ ...launchInput, mode: 'other' }])).toThrow(ValidationError)
    expect(services.kanban.getItem).toHaveBeenCalledTimes(1)
    expect(services.kanban.launchTask).toHaveBeenCalledTimes(3)
  })

  it('validates kanban:handoffCandidates before the service', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const identity = { projectId: 'p1', itemId: 'native-1', ref: 'DEMO-1' }
    const candidates = channels.get('kanban:handoffCandidates')
    candidates?.invoke(candidates.parse([identity]))
    expect(services.kanban.handoffCandidates).toHaveBeenCalledWith(identity)
    expect(() => candidates?.parse([{ ...identity, extra: 1 }])).toThrow(
      /unexpected or missing fields/,
    )
    expect(() => candidates?.parse([{ ...identity, itemId: '' }])).toThrow(ValidationError)
    expect(() => candidates?.parse([{ ...identity, ref: 1 }])).toThrow(ValidationError)
    expect(() => candidates?.parse([])).toThrow(/expected 1 argument/)
    expect(services.kanban.handoffCandidates).toHaveBeenCalledTimes(1)
  })

  it('validates kanban:handoffAvailability before the service', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const input = { projectId: 'p1', items: [{ itemId: 'native-1', ref: 'DEMO-1' }] }
    const availability = channels.get('kanban:handoffAvailability')
    availability?.invoke(availability.parse([input]))
    expect(services.kanban.handoffAvailability).toHaveBeenCalledWith(input)
    // An empty item set is a valid request (a loaded board may have no items).
    availability?.invoke(availability.parse([{ projectId: 'p1', items: [] }]))
    expect(services.kanban.handoffAvailability).toHaveBeenCalledTimes(2)
    expect(() => availability?.parse([{ projectId: 'p1' }])).toThrow(/unexpected or missing fields/)
    expect(() => availability?.parse([{ projectId: '', items: [] }])).toThrow(ValidationError)
    expect(() =>
      availability?.parse([{ projectId: 'p1', items: [{ itemId: '', ref: 'DEMO-1' }] }]),
    ).toThrow(ValidationError)
    expect(() =>
      availability?.parse([{ projectId: 'p1', items: [{ itemId: 'n', ref: 'DEMO-1', x: 1 }] }]),
    ).toThrow(/unexpected or missing fields/)
    expect(() => availability?.parse(['p1'])).toThrow(ValidationError)
    expect(() => availability?.parse([])).toThrow(/expected 1 argument/)
  })

  it('terminals:create does not start the project shell for an undelivered launch', () => {
    const services = fakeServices()
    vi.mocked(services.kanban.blocksProjectShell).mockReturnValue(true)
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }
    const create = channels.get('terminals:create')
    expect(() => create?.invoke(create.parse(['t1', hostPath('D:/code/demo')]))).toThrow(
      /Failed to start the terminal process/,
    )
    expect(services.terminals.create).not.toHaveBeenCalled()
  })

  it('state:get and state:set block access to secret-bearing keys', () => {
    const services = fakeServices()
    const channels = new Map(buildValidatedChannels(services).map((c) => [c.channel, c]))
    const stateGet = channels.get('state:get')
    const stateSet = channels.get('state:set')
    if (!stateGet || !stateSet) throw new Error('Missing state channels')

    // Protected secret keys throw ValidationError
    for (const key of [
      'project.kanbanConfig',
      'project.kanbanConfig:p1',
      'project.kanbanConfig:',
      // Written only through the validated taskProgress:* channels.
      'project.taskProgressAdapter:p1',
      'project.taskProgressConfig:p1',
    ]) {
      expect(() => stateGet.parse([key])).toThrow(/is a protected key/)
      expect(() => stateSet.parse([key, 'val'])).toThrow(/is a protected key/)
    }

    // Normal keys are accepted
    expect(stateGet.parse(['selection.projectId'])).toEqual(['selection.projectId'])
    expect(stateSet.parse(['selection.projectId', 'p1'])).toEqual(['selection.projectId', 'p1'])

    // Service is invoked for valid keys
    stateGet.invoke(stateGet.parse(['region.left.width']))
    expect(services.state.get).toHaveBeenCalledWith('region.left.width')

    stateSet.invoke(stateSet.parse(['region.left.width', '300']))
    expect(services.state.set).toHaveBeenCalledWith('region.left.width', '300')
  })
})
