import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  projectTaskProgressAdapterKey,
  projectTaskProgressConfigKey,
  type TaskProgressAdapterInfo,
  type TaskProgressChangedEvent,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import {
  TaskProgressAdapterError,
  TaskProgressCancelledError,
  type TaskProgressHost,
} from './adapter-host'
import type { TaskProgressDiscovery } from './adapter-manifest'
import { TaskProgressService } from './task-progress-service'

// TaskProgressService Stage 1 (spec task-progress-adapters Behaviour 1, 4, 7-10,
// 12 without watching, 14 for Test). Fake discovery and host; real in-memory
// state store.

const LOCAL_ONLY: TaskProgressAdapterInfo = {
  id: 'local-only',
  name: 'Local only',
  environments: ['local'],
  configSchema: [
    { key: 'path', label: 'Snapshot file', type: 'string', required: true },
    { key: 'mode', label: 'Mode', type: 'select', required: false, options: ['a', 'b'] },
    { key: 'verbose', label: 'Verbose', type: 'boolean', required: false },
  ],
}

const BOTH: TaskProgressAdapterInfo = {
  id: 'both',
  name: 'Both',
  environments: ['local', 'wsl'],
  configSchema: [],
}

function discovery(): TaskProgressDiscovery {
  return {
    adapters: [
      { info: LOCAL_ONLY, dir: 'D:/adapters/local', invocation: { command: 'node', args: ['a'] } },
      { info: BOTH, dir: 'D:/adapters/both', invocation: { command: 'node', args: ['b'] } },
    ],
    warnings: ['D:/adapters/bad/adapter.json: is not valid JSON'],
  }
}

function createService(paths: Record<string, string> = { p1: 'D:/code/demo' }) {
  const store = new Map<string, string>()
  const state = {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      store.set(key, value)
    },
    delete: (key: string) => {
      store.delete(key)
    },
  }
  const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ summary: '3 records' }))
  const discover = vi.fn(discovery)
  const log = vi.fn()
  const watchers: { path: string; closed: boolean; change: () => void }[] = []
  const watch = vi.fn((path: string, _recursive: boolean, onChange: () => void) => {
    const watcher = { path, closed: false, change: onChange }
    watchers.push(watcher)
    return {
      close: () => {
        watcher.closed = true
      },
    }
  })
  const service = new TaskProgressService({
    projects: { get: (id) => (paths[id] === undefined ? null : { path: paths[id] }) },
    state,
    adaptersDir: 'D:/userData/task-progress-adapters',
    host: { invoke } as unknown as TaskProgressHost,
    discover,
    watch,
    log,
  })
  const events: TaskProgressChangedEvent[] = []
  service.onChanged((event) => events.push(event))
  service.setVisible(true)
  return { service, store, invoke, discover, log, watch, watchers, events }
}

describe('TaskProgressService.adaptersList', () => {
  it('scans the fixed directory on every call and logs warnings', () => {
    const { service, discover, log } = createService()
    expect(service.adaptersList()).toEqual({
      adapters: [LOCAL_ONLY, BOTH],
      warnings: ['D:/adapters/bad/adapter.json: is not valid JSON'],
    })
    service.adaptersList()
    expect(discover).toHaveBeenCalledTimes(2)
    expect(discover).toHaveBeenCalledWith('D:/userData/task-progress-adapters')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('is not valid JSON'))
  })
})

describe('TaskProgressService bindings', () => {
  it('returns no binding and empty config by default', () => {
    const { service } = createService()
    expect(service.getBinding('p1')).toEqual({ adapterId: null, config: {} })
  })

  it('saves the adapter id and values under the spec keys', () => {
    const { service, store } = createService()
    service.saveBinding('p1', 'local-only', { path: 'tasks.json', mode: 'b', verbose: 'true' })
    expect(store.get(projectTaskProgressAdapterKey('p1'))).toBe('local-only')
    expect(JSON.parse(store.get(projectTaskProgressConfigKey('p1')) ?? '')).toEqual({
      path: 'tasks.json',
      mode: 'b',
      verbose: 'true',
    })
    expect(service.getBinding('p1')).toEqual({
      adapterId: 'local-only',
      config: { path: 'tasks.json', mode: 'b', verbose: 'true' },
    })
  })

  it('None removes the binding and keeps the stored values', () => {
    const { service, store } = createService()
    service.saveBinding('p1', 'local-only', { path: 'tasks.json' })
    service.saveBinding('p1', null, { path: 'ignored.json' })
    expect(store.has(projectTaskProgressAdapterKey('p1'))).toBe(false)
    expect(service.getBinding('p1')).toEqual({ adapterId: null, config: { path: 'tasks.json' } })
  })

  it('rejects a save for an adapter that is not installed', () => {
    const { service, store } = createService()
    expect(() => service.saveBinding('p1', 'ghost', {})).toThrow(/"ghost" is not installed/)
    expect(store.size).toBe(0)
  })

  it.each([
    [{}, /"Snapshot file" is required/],
    [{ path: '  ' }, /"Snapshot file" is required/],
    [{ path: 'x', mode: 'c' }, /"Mode" must be one of a\|b/],
    [{ path: 'x', verbose: 'yes' }, /"Verbose" must be "true" or "false"/],
    [{ path: 'x', other: 'y' }, /Unknown field "other"/],
  ])('rejects invalid values %j without writing', (config, message) => {
    const { service, store } = createService()
    const error = (() => {
      try {
        service.saveBinding('p1', 'local-only', config as Record<string, string>)
      } catch (caught) {
        return caught
      }
      return null
    })()
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('validation')
    expect((error as AppError).message).toMatch(message)
    expect(store.size).toBe(0)
  })

  it('rejects unknown projects with not_found', () => {
    const { service } = createService()
    expect(() => service.getBinding('nope')).toThrow(/not found/)
    expect(() => service.saveBinding('nope', null, {})).toThrow(/not found/)
  })

  it('cleanupProject deletes both keys', () => {
    const { service, store } = createService()
    service.saveBinding('p1', 'local-only', { path: 'tasks.json' })
    service.cleanupProject('p1')
    expect(store.size).toBe(0)
  })

  it('reports a corrupt stored config instead of hiding it', () => {
    const { service, store } = createService()
    store.set(projectTaskProgressConfigKey('p1'), '{broken')
    expect(() => service.getBinding('p1')).toThrow(/corrupt/)
  })
})

describe('TaskProgressService.test', () => {
  it('runs the test action with unsaved values and saves nothing', async () => {
    const { service, store, invoke } = createService()
    const result = await service.test('p1', 'local-only', { path: 'draft.json' })
    expect(result).toEqual({ ok: true, summary: '3 records' })
    expect(store.size).toBe(0)
    expect(invoke).toHaveBeenCalledWith(
      { id: 'local-only', dir: 'D:/adapters/local', invocation: { command: 'node', args: ['a'] } },
      {
        protocolVersion: 1,
        action: 'test',
        config: { path: 'draft.json' },
        project: { root: 'D:/code/demo', environment: 'local' },
      },
      expect.any(AbortSignal),
    )
  })

  it('passes the WSL distribution and Linux root for a WSL project', async () => {
    const { service, invoke } = createService({ w1: '\\\\wsl.localhost\\Ubuntu\\home\\me\\demo' })
    await service.test('w1', 'both', {})
    expect(invoke).toHaveBeenCalledWith(
      expect.anything(),
      {
        protocolVersion: 1,
        action: 'test',
        config: {},
        project: {
          root: '\\\\wsl.localhost\\Ubuntu\\home\\me\\demo',
          environment: 'wsl',
          distribution: 'Ubuntu',
          linuxRoot: '/home/me/demo',
        },
      },
      expect.any(AbortSignal),
    )
  })

  it('returns environment_unsupported for a WSL project without spawning', async () => {
    const { service, invoke } = createService({ w1: '\\\\wsl.localhost\\Ubuntu\\home\\me\\demo' })
    const result = await service.test('w1', 'local-only', { path: 'x' })
    expect(result).toMatchObject({ ok: false, error: { code: 'environment_unsupported' } })
    expect(result.ok === false && result.error.message).toContain('local-only')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns adapter_missing naming the id without spawning', async () => {
    const { service, invoke } = createService()
    const result = await service.test('p1', 'ghost', {})
    expect(result).toMatchObject({ ok: false, error: { code: 'adapter_missing' } })
    expect(result.ok === false && result.error.message).toContain('ghost')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns a config error for invalid values without spawning', async () => {
    const { service, invoke } = createService()
    const result = await service.test('p1', 'local-only', {})
    expect(result).toMatchObject({ ok: false, error: { code: 'config' } })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns the typed host error', async () => {
    const { service, invoke } = createService()
    invoke.mockRejectedValueOnce(
      new TaskProgressAdapterError('runtime', 'Adapter "local-only" (test): python missing'),
    )
    expect(await service.test('p1', 'local-only', { path: 'x' })).toEqual({
      ok: false,
      error: { code: 'runtime', message: 'Adapter "local-only" (test): python missing' },
    })
  })

  it.each([[null], [{}], [{ summary: '' }], [{ summary: 42 }], [{ summary: 'x'.repeat(501) }]])(
    'returns a protocol error for a bad test payload %j',
    async (data) => {
      const { service, invoke } = createService()
      invoke.mockResolvedValueOnce(data)
      const result = await service.test('p1', 'local-only', { path: 'x' })
      expect(result).toMatchObject({ ok: false, error: { code: 'protocol' } })
      expect(result.ok === false && result.error.message).toContain('Adapter "local-only" (test)')
    },
  )

  it('rethrows unexpected failures instead of hiding them', async () => {
    const { service, invoke } = createService()
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(service.test('p1', 'local-only', { path: 'x' })).rejects.toThrow('boom')
  })

  it('rejects an unknown project with not_found', async () => {
    const { service } = createService()
    await expect(service.test('nope', 'local-only', {})).rejects.toThrow(/not found/)
  })
})

// Stage 2 (spec Behaviour 11-21): snapshot reads through the scheduler.

const SNAPSHOT = {
  schemaVersion: 1,
  generatedAt: '2026-10-23T09:00:00Z',
  watch: [{ path: 'records', recursive: true }],
  tasks: [
    {
      id: 'demo-1',
      state: 'active',
      location: 'live',
      recordState: 'valid',
      phases: [{ name: 'A', steps: [{ id: '1', label: 'one', done: false }] }],
    },
  ],
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function hangingUntilAbort(onSignal: (signal: AbortSignal) => void) {
  return (...args: unknown[]) =>
    new Promise<unknown>((_resolve, reject) => {
      const signal = args[2] as AbortSignal
      onSignal(signal)
      signal.addEventListener('abort', () => reject(new TaskProgressCancelledError('cancelled')))
    })
}

describe('TaskProgressService snapshots', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function bound(paths?: Record<string, string>) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
    const harness = createService(paths)
    harness.store.set(projectTaskProgressAdapterKey('p1'), 'local-only')
    harness.store.set(projectTaskProgressConfigKey('p1'), JSON.stringify({ path: 'tasks.json' }))
    harness.invoke.mockImplementation(async () => SNAPSHOT)
    return harness
  }

  it('observes a bound project: snapshot action with the stored config, event, get', async () => {
    const h = bound()
    h.service.observe(['p1'])
    await flush()
    expect(h.invoke).toHaveBeenCalledWith(
      { id: 'local-only', dir: 'D:/adapters/local', invocation: { command: 'node', args: ['a'] } },
      {
        protocolVersion: 1,
        action: 'snapshot',
        config: { path: 'tasks.json' },
        project: { root: 'D:/code/demo', environment: 'local' },
      },
      expect.any(AbortSignal),
    )
    const snapshot = h.service.get('p1')
    expect(snapshot).toMatchObject({
      projectId: 'p1',
      adapterId: 'local-only',
      status: 'ok',
      receivedAt: '2026-10-23T10:00:00.000Z',
      tasks: [{ id: 'demo-1', ref: null, corrections: 0 }],
    })
    expect(h.events).toEqual([snapshot])
    expect(h.watch).toHaveBeenCalledWith(
      expect.stringMatching(/demo[\\/]records$/),
      true,
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('never runs an adapter or watches for an unbound project', async () => {
    const h = bound()
    h.store.delete(projectTaskProgressAdapterKey('p1'))
    h.service.observe(['p1'])
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.service.get('p1')).toBeNull()
  })

  it('get rejects an unknown project with not_found', () => {
    const h = bound()
    expect(() => h.service.get('nope')).toThrow(/not found/)
  })

  it('an invalid snapshot is a protocol error and is retried', async () => {
    const h = bound()
    h.invoke.mockImplementation(async () => ({ ...SNAPSHOT, tasks: [{ id: 'x' }] }))
    h.service.observe(['p1'])
    await flush()
    expect(h.service.get('p1')).toMatchObject({ status: 'ok', error: { code: 'protocol' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.invoke).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000 + 4000)
    expect(h.service.get('p1')).toMatchObject({
      status: 'stale',
      error: {
        code: 'protocol',
        message: expect.stringContaining('Adapter "local-only" (snapshot)'),
      },
    })
  })

  it('a WSL project with a local-only adapter fails environment_unsupported without a process', async () => {
    const h = bound({ p1: '\\\\wsl.localhost\\Ubuntu\\home\\me\\demo' })
    h.service.observe(['p1'])
    await flush()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.service.get('p1')).toMatchObject({
      status: 'stale',
      error: { code: 'environment_unsupported' },
    })
  })

  it('a bound adapter missing from the directory is adapter_missing naming its id', async () => {
    const h = bound()
    h.store.set(projectTaskProgressAdapterKey('p1'), 'ghost')
    h.service.observe(['p1'])
    await flush()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.service.get('p1')).toMatchObject({
      status: 'stale',
      adapterId: 'ghost',
      error: { code: 'adapter_missing', message: expect.stringContaining('"ghost"') },
    })
  })

  it('a corrupt stored config is a visible config error', async () => {
    const h = bound()
    h.store.set(projectTaskProgressConfigKey('p1'), '{broken')
    h.service.observe(['p1'])
    await flush()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.service.get('p1')).toMatchObject({
      status: 'stale',
      error: { code: 'config', message: expect.stringContaining('corrupt') },
    })
  })

  it('saving the binding drops the snapshot and reads again with the new config', async () => {
    const h = bound()
    h.service.observe(['p1'])
    await flush()
    h.service.saveBinding('p1', 'local-only', { path: 'other.json' })
    expect(h.events.at(-1)).toEqual({ projectId: 'p1', cleared: true })
    expect(h.watchers.every((watcher) => watcher.closed)).toBe(true)
    await flush()
    expect(h.invoke).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'snapshot', config: { path: 'other.json' } }),
      expect.any(AbortSignal),
    )
    expect(h.service.get('p1')?.status).toBe('ok')
  })

  it('None stops observation and clears the snapshot', async () => {
    const h = bound()
    h.service.observe(['p1'])
    await flush()
    h.service.saveBinding('p1', null, {})
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.service.get('p1')).toBeNull()
    expect(h.events.at(-1)).toEqual({ projectId: 'p1', cleared: true })
  })

  it('a failed save keeps the current observation', async () => {
    const h = bound()
    h.service.observe(['p1'])
    await flush()
    expect(() => h.service.saveBinding('p1', 'ghost', {})).toThrow()
    expect(h.service.get('p1')?.status).toBe('ok')
  })

  it('cleanupProject kills the running read and emits nothing for the project', async () => {
    const h = bound()
    let signal: AbortSignal | undefined
    h.invoke.mockImplementation(
      hangingUntilAbort((value) => {
        signal = value
      }),
    )
    h.service.observe(['p1'])
    await flush()
    h.service.cleanupProject('p1')
    await flush()
    expect(signal?.aborted).toBe(true)
    expect(h.events).toEqual([])
    expect(h.store.size).toBe(0)
  })

  it('a manual Test resumes reads paused by a config error', async () => {
    const h = bound()
    h.invoke.mockImplementationOnce(async () => {
      throw new TaskProgressAdapterError('config', 'Adapter "local-only" (snapshot): bad path')
    })
    h.service.observe(['p1'])
    await flush()
    expect(h.service.get('p1')).toMatchObject({ status: 'stale', error: { code: 'config' } })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    h.invoke.mockImplementationOnce(async () => ({ summary: 'ok' }))
    await h.service.test('p1', 'local-only', { path: 'tasks.json' })
    await flush()
    expect(h.invoke).toHaveBeenCalledTimes(3)
    expect(h.service.get('p1')?.status).toBe('ok')
  })

  it('shutdown aborts a running Test and stops observations', async () => {
    const h = bound()
    let signal: AbortSignal | undefined
    h.invoke.mockImplementationOnce(
      hangingUntilAbort((value) => {
        signal = value
      }),
    )
    const pending = h.service.test('p1', 'local-only', { path: 'x' })
    h.service.shutdown()
    expect(signal?.aborted).toBe(true)
    await expect(pending).rejects.toBeInstanceOf(TaskProgressCancelledError)
    h.service.observe(['p1'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.invoke).toHaveBeenCalledTimes(1)
  })
})
