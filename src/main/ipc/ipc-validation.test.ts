import { describe, expect, it, vi } from 'vitest'
import { emptyGitWorktree } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { buildValidatedChannels, ValidationError } from './ipc-validation'
import type { AppServices } from './service-registry'

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
    actions: {
      list: vi.fn(() => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
      stopForProject: vi.fn(),
    },
    projects: {
      wslDistributions: vi.fn(() => []),
      addWsl: vi.fn(),
      list: () => [],
      add: () => ({ id: 'p1', name: 'demo', path: 'D:/code/demo', runtimeLabel: null }),
      remove: () => {},
    },
    chats: {
      list: () => [],
      create: () => ({ id: 't1', projectId: 'p1', name: 'n' }),
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
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
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
    agentProfiles: {
      get: vi.fn(() => ({ defaultId: null, profiles: [] })),
      put: vi.fn(() => ({ defaultId: null, profiles: [] })),
      delete: vi.fn(() => ({ defaultId: null, profiles: [] })),
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

  it('rejects non-string and non-finite arguments', () => {
    const channels = channelMap()
    expect(() => channels.get('state:set')?.parse(['k', 42])).toThrow(ValidationError)
    expect(() => channels.get('terminals:resize')?.parse(['t1', Number.NaN, 24])).toThrow(
      ValidationError,
    )
  })

  it('validates path arguments: absolute, no traversal, no NUL', () => {
    const entry = channelMap().get('git:status')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    expect(entry.parse(['D:/code/demo'])).toEqual(['D:/code/demo'])
    expect(entry.parse(['C:\\code\\demo'])).toEqual(['C:\\code\\demo'])
    expect(() => entry.parse(['code/demo'])).toThrow(/absolute path/)
    expect(() => entry.parse(['D:/code/../secrets'])).toThrow(/"\.\." segments/)
    expect(() => entry.parse(['..\\..\\windows'])).toThrow(ValidationError)
    expect(() => entry.parse(['D:/code/de\u0000mo'])).toThrow(/NUL/)
  })

  it('validates the terminal cwd as a safe path', () => {
    const entry = channelMap().get('terminals:create')
    expect(() => entry?.parse(['t1', 'relative/cwd'])).toThrow(ValidationError)
    expect(entry?.parse(['t1', 'D:/code/demo'])).toEqual(['t1', 'D:/code/demo'])
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
  })

  it('ValidationError transports as a typed validation AppError', () => {
    const error = new ValidationError('bad payload')
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('validation')
  })

  it('slices validated payloads and invokes the services with the declared args', () => {
    const services = fakeServices()
    const channels = new Map<string, ReturnType<typeof buildValidatedChannels>[number]>()
    for (const entry of buildValidatedChannels(services)) {
      channels.set(entry.channel, entry)
    }

    const create = channels.get('terminals:create')
    create?.invoke(create.parse(['t1', 'D:/code/demo']))
    expect(services.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo')

    const write = channels.get('terminals:write')
    write?.invoke(write.parse(['t1', 'ls\r']))
    expect(services.terminals.write).toHaveBeenCalledWith('t1', 'ls\r')

    const resize = channels.get('terminals:resize')
    resize?.invoke(resize.parse(['t1', 120, 40]))
    expect(services.terminals.resize).toHaveBeenCalledWith('t1', 120, 40)

    const gitStatus = channels.get('git:status')
    gitStatus?.invoke(gitStatus.parse(['D:/code/demo']))
    expect(services.git.getStatus).toHaveBeenCalledWith('D:/code/demo')

    const stateSet = channels.get('state:set')
    stateSet?.invoke(stateSet.parse(['k', 'v']))
    expect(services.state.set).toHaveBeenCalledWith('k', 'v')
  })

  it('every wire channel has a validated entry (no unvalidated invokes)', () => {
    const channels = channelMap()
    for (const channel of [
      'projects:list',
      'projects:add',
      'projects:remove',
      'chats:list',
      'chats:create',
      'chats:remove',
      'state:get',
      'state:set',
      'terminals:create',
      'terminals:write',
      'terminals:resize',
      'terminals:shellName',
      'terminals:terminate',
      'git:status',
      'files:list',
      'files:read',
      'files:openExternal',
      'files:openRoot',
      'handoffs:list',
      'dialogs:pickDirectory',
      'agentProfiles:get',
      'agentProfiles:put',
      'agentProfiles:delete',
      'kanban:handoffCandidates',
      'kanban:handoffAvailability',
    ]) {
      expect(channels.has(channel)).toBe(true)
    }
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
    expect(shellAddCustom?.parse(['D:\\sh.exe'])).toEqual(['D:\\sh.exe'])
    expect(shellAddCustom?.invoke(['D:\\sh.exe'])).toEqual({
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
    expect(pick?.parse(['D:/code'])).toEqual(['D:/code'])
    expect(() => pick?.parse(['relative/dir'])).toThrow(/absolute path/)
    expect(() => pick?.parse(['D:/code\u0000x'])).toThrow(/NUL/)
    pick?.invoke(pick.parse(['D:/code']))
    expect(services.dialogs.pickDirectory).toHaveBeenCalledWith('D:/code')
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
      executable: 'claude',
      args: ['{prompt}', 'a b', '"q"', 'line\nbreak'],
      isDefault: false,
    }
    const get = channels.get('agentProfiles:get')
    get?.invoke(get.parse(['p1']))
    expect(services.agentProfiles.get).toHaveBeenCalledWith('p1')

    const put = channels.get('agentProfiles:put')
    expect(put?.parse(['p1', input])).toEqual(['p1', input])
    put?.invoke(put.parse(['p1', input]))
    expect(services.agentProfiles.put).toHaveBeenCalledWith('p1', input)

    const remove = channels.get('agentProfiles:delete')
    remove?.invoke(remove.parse(['p1', 'id-1']))
    expect(services.agentProfiles.delete).toHaveBeenCalledWith('p1', 'id-1')

    const invalid: unknown[][] = [
      [],
      ['p1'],
      [1, input],
      ['p1', { ...input, name: '   ' }],
      ['p1', { ...input, executable: '' }],
      ['p1', { ...input, args: [] }],
      ['p1', { ...input, args: ['--flag'] }],
      ['p1', { ...input, args: ['{prompt}', '{prompt}'] }],
      ['p1', { ...input, args: ['pre{prompt}'] }],
      ['p1', { ...input, args: [' {prompt}'] }],
      ['p1', { ...input, args: ['{prompt}', 1] }],
      ['p1', { ...input, args: 'claude {prompt}' }],
      ['p1', { ...input, isDefault: 'true' }],
      ['p1', { ...input, id: 1 }],
      ['p1', { ...input, id: '' }],
      ['p1', { ...input, extra: true }],
      ['p1', { name: 'Claude' }],
    ]
    for (const payload of invalid) {
      expect(() => put?.parse(payload)).toThrow(ValidationError)
    }
    expect(() => put?.parse(['p1', { ...input, args: ['{prompt}', '{prompt}'] }])).toThrow(
      /exactly once/,
    )
    expect(() => get?.parse([])).toThrow(ValidationError)
    expect(() => get?.parse([1])).toThrow(ValidationError)
    expect(() => get?.parse(['p1', 'extra'])).toThrow(ValidationError)
    expect(() => remove?.parse(['p1'])).toThrow(ValidationError)
    expect(() => remove?.parse(['p1', ''])).toThrow(ValidationError)
    expect(() => remove?.parse([1, 'id'])).toThrow(ValidationError)
    expect(services.agentProfiles.get).toHaveBeenCalledTimes(1)
    expect(services.agentProfiles.put).toHaveBeenCalledTimes(1)
    expect(services.agentProfiles.delete).toHaveBeenCalledTimes(1)
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
    expect(services.kanban.getItem).toHaveBeenCalledTimes(1)
    expect(services.kanban.launchTask).toHaveBeenCalledTimes(2)
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
    expect(() => create?.invoke(create.parse(['t1', 'D:/code/demo']))).toThrow(
      /Failed to start the terminal process/,
    )
    expect(services.terminals.create).not.toHaveBeenCalled()
  })
})
