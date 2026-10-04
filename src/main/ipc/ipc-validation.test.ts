import { describe, expect, it, vi } from 'vitest'
import { emptyGitWorktree } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { buildValidatedChannels, ValidationError } from './ipc-validation'
import type { AppServices } from './service-registry'

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
    ]) {
      expect(channels.has(channel)).toBe(true)
    }
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
})
