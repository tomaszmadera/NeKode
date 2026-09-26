import { describe, expect, it, vi } from 'vitest'
import { emptyGitWorktree } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { buildValidatedChannels, ValidationError } from './ipc-validation'
import type { AppServices } from './service-registry'

function fakeServices(): AppServices {
  return {
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
    state: { get: vi.fn(() => null), set: vi.fn() },
    terminals: {
      create: vi.fn(() => 't1'),
      write: vi.fn(),
      resize: vi.fn(),
      terminate: vi.fn(),
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
      'git:status',
      'files:list',
      'files:read',
      'files:openExternal',
    ]) {
      expect(channels.has(channel)).toBe(true)
    }
    // terminals:terminate is not part of the renderer contract (A8 decision):
    // app-quit teardown runs in main via terminateAll.
    expect(channels.has('terminals:terminate')).toBe(false)
  })
})
