import { describe, expect, it } from 'vitest'
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
    tasks: {
      list: () => [],
      create: () => ({ id: 't1', projectId: 'p1', name: 'n', status: 'idle' }),
    },
    state: { get: () => null, set: () => {} },
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
    const entry = channelMap().get('tasks:create')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    expect(() => entry.parse([])).toThrow(ValidationError)
    expect(() => entry.parse(['p1', 'name', 'extra'])).toThrow(/expected 2 argument/)
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
    expect(entry.parse(['D:/code/demo'])).toEqual([])
    expect(entry.parse(['C:\\code\\demo'])).toEqual([])
    expect(() => entry.parse(['code/demo'])).toThrow(/absolute path/)
    expect(() => entry.parse(['D:/code/../secrets'])).toThrow(/"\.\." segments/)
    expect(() => entry.parse(['..\\..\\windows'])).toThrow(ValidationError)
    expect(() => entry.parse(['D:/code/de\u0000mo'])).toThrow(/NUL/)
  })

  it('validates the terminal cwd as a safe path', () => {
    const entry = channelMap().get('terminals:create')
    expect(() => entry?.parse(['t1', 'relative/cwd'])).toThrow(ValidationError)
    expect(entry?.parse(['t1', 'D:/code/demo'])).toEqual([])
  })

  it('ValidationError transports as a typed validation AppError', () => {
    const error = new ValidationError('bad payload')
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('validation')
  })

  it('stub channels keep fixed values after validation', () => {
    const channels = channelMap()
    const create = channels.get('terminals:create')
    expect(create?.invoke([])).toBe('stub-terminal-id')
    expect(channels.get('git:status')?.invoke([])).toEqual({ branch: null, dirty: false })
  })
})
