import { describe, expect, it, vi } from 'vitest'
import type { KanbanState, WorkItem } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import type { AdapterInvocation } from './adapter-host'
import { AdapterError, AdapterHostError, type AdapterRequest } from './adapter-host'
import { discoverAdapters } from './adapter-manifest'
import { KanbanService, type KanbanSetConfigInput } from './kanban-service'

// KanbanService behavior (spec kanban-adapter-interface Business rules,
// Acceptance criteria 4–9, 12). The adapter host is a vi.fn standing in for
// the process transport; manifest/persistence rules are asserted through the
// service surface.

function stateStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    get: vi.fn((key: string) => store.get(key) ?? null),
    set: vi.fn((key: string, value: string) => void store.set(key, value)),
    delete: vi.fn((key: string) => void store.delete(key)),
    dump: () => Object.fromEntries(store.entries()),
  }
}

function makeService(
  options: {
    adaptersDir?: string
    store?: Record<string, string>
    hostResult?: unknown
    hostError?: Error
  } = {},
) {
  const state = stateStore(options.store)
  const invoke = vi.fn(async (_adapter: AdapterInvocation, _request: AdapterRequest) => {
    if (options.hostError !== undefined) {
      throw options.hostError
    }
    return options.hostResult
  })
  const service = new KanbanService({
    projects: {
      get: (projectId: string) => (projectId === 'p1' ? { path: 'D:/code/demo' } : null),
    },
    state,
    adaptersDir: () => options.adaptersDir ?? 'unused-dir',
    host: { invoke } as unknown as ConstructorParameters<typeof KanbanService>[0]['host'],
  })
  return { service, state, invoke }
}

const state: KanbanState = {
  id: 'st1',
  name: 'In Progress',
  group: 'started',
  order: 2,
}

const item: WorkItem = {
  ref: 'DEMO-1',
  id: 'native-1',
  title: 'First item',
  description: null,
  stateId: 'st1',
  stateName: 'In Progress',
  stateGroup: 'started',
  priority: 'high',
  assignee: null,
  url: null,
  updatedAt: null,
}

const CONFIG_INPUT: KanbanSetConfigInput = {
  adapterId: 'demo',
  values: { base_url: 'https://api.example.com', api_key: 'tok' },
}

describe('KanbanService adaptersList', () => {
  it('returns adapter infos from discovery (fresh scan each call)', () => {
    const { service } = makeService()
    // No real dir on disk: discovery of 'unused-dir' yields [] without error.
    expect(service.adaptersList()).toEqual([])
  })
})

describe('KanbanService config', () => {
  it('getConfig on an unknown project throws not_found', () => {
    const { service } = makeService()
    try {
      service.getConfig('ghost')
      expect.unreachable('getConfig should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('not_found')
    }
  })

  it('getConfig with no binding returns null adapterId and empty values', () => {
    const { service } = makeService()
    expect(service.getConfig('p1')).toEqual({ adapterId: null, values: {}, secretKeys: [] })
  })

  it('masks secret values in getConfig and lists them in secretKeys', () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({ base_url: 'https://x', api_key: 'tok' }),
    }
    // schemaFor consults discovery; simulate by stubbing discovery through
    // the public surface instead: unknown adapter -> values still surface.
    const withStore = makeService({ store: stored })
    const config = withStore.service.getConfig('p1')
    // The adapter is not installed in 'unused-dir', so no schema: values all
    // null but the binding is intact (settings surface marks it missing).
    expect(config.adapterId).toBe('demo')
    expect(Object.values(config.values).every((value) => value === null)).toBe(true)
  })

  it('never returns a secret value through getConfig even with a schema', () => {
    // Direct schema path: point adaptersDir at a real fixture manifest.
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [
            { key: 'base_url', label: 'Base URL', type: 'string', required: true },
            { key: 'api_key', label: 'API Key', type: 'secret', required: true },
          ],
        }),
      )
      const stored = {
        'project.kanbanAdapter:p1': 'demo',
        'project.kanbanConfig:p1': JSON.stringify({
          base_url: 'https://x',
          api_key: 'supersecret',
        }),
      }
      const { service } = makeService({ adaptersDir: dir, store: stored })
      const config = service.getConfig('p1')
      expect(config.values.base_url).toBe('https://x')
      expect(config.values.api_key).toBeNull()
      expect(config.secretKeys).toEqual(['api_key'])
      expect(JSON.stringify(config)).not.toContain('supersecret')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setConfig persists binding and values', () => {
    const { service, state } = makeService()
    service.setConfig('p1', CONFIG_INPUT)
    expect(state.dump()['project.kanbanAdapter:p1']).toBe('demo')
    // Unknown adapter schema (not installed): values stored as-is.
    expect(JSON.parse(state.dump()['project.kanbanConfig:p1'] as string)).toEqual({
      base_url: 'https://api.example.com',
      api_key: 'tok',
    })
  })

  it('setConfig with an empty secret string keeps the stored secret; empty non-secret clears', () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({ base_url: 'https://old', api_key: 'old-tok' }),
    }
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc2-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [
            { key: 'base_url', label: 'Base URL', type: 'string', required: true },
            { key: 'api_key', label: 'API Key', type: 'secret', required: true },
          ],
        }),
      )
      const { service, state } = makeService({ adaptersDir: dir, store: stored })
      // Left-empty secret keeps the stored secret; untouched non-secret
      // keys are not submitted and stay as stored (Behaviour 7).
      service.setConfig('p1', { adapterId: 'demo', values: { api_key: '' } })
      expect(JSON.parse(state.dump()['project.kanbanConfig:p1'] as string)).toEqual({
        base_url: 'https://old',
        api_key: 'old-tok',
      })
      // A re-typed secret replaces the stored one.
      service.setConfig('p1', {
        adapterId: 'demo',
        values: { base_url: 'https://new', api_key: 'new-tok' },
      })
      expect(JSON.parse(state.dump()['project.kanbanConfig:p1'] as string)).toEqual({
        base_url: 'https://new',
        api_key: 'new-tok',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setConfig with a required empty field rejects with validation', () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc3-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [{ key: 'base_url', label: 'Base URL', type: 'string', required: true }],
        }),
      )
      const { service } = makeService({ adaptersDir: dir })
      expect(() =>
        service.setConfig('p1', { adapterId: 'demo', values: { base_url: '' } }),
      ).toThrow(/required/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setConfig null adapterId keeps stored values and clears the binding', () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({ base_url: 'https://x' }),
    }
    const { service, state } = makeService({ store: stored })
    service.setConfig('p1', { adapterId: null, values: {} })
    expect(state.dump()['project.kanbanAdapter:p1']).toBe('')
    expect(JSON.parse(state.dump()['project.kanbanConfig:p1'] as string)).toEqual({
      base_url: 'https://x',
    })
  })

  it('setConfig rejects non-string values', () => {
    const { service } = makeService()
    expect(() =>
      service.setConfig('p1', {
        adapterId: 'demo',
        values: { base_url: 42 as unknown as string },
      }),
    ).toThrow(AppError)
  })
})

describe('KanbanService actions', () => {
  it('unconfigured project rejects listBoard with validation naming the project', async () => {
    const { service } = makeService()
    await expect(service.listBoard('p1')).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('adapter'),
    })
  })

  it('bound-but-missing adapter rejects with not_found naming the adapter id', async () => {
    const stored = { 'project.kanbanAdapter:p1': 'vanished' }
    const { service } = makeService({ store: stored })
    await expect(service.listBoard('p1')).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('vanished'),
    })
  })

  it('listBoard composes states and items through one host call per action', async () => {
    const stored = { 'project.kanbanAdapter:p1': 'demo' }
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc4-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const { service, invoke } = makeService({ adaptersDir: dir, store: stored })
      invoke.mockImplementationOnce(async (_adapter: unknown, request: AdapterRequest) => {
        expect((request as AdapterRequest).action).toBe('listStates')
        return [state]
      })
      invoke.mockImplementationOnce(async (_adapter: unknown, request: AdapterRequest) => {
        expect((request as AdapterRequest).action).toBe('listItems')
        return [item]
      })
      const board = await service.listBoard('p1')
      expect(board).toEqual({ states: [state], items: [item] })
      expect(invoke).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sends protocolVersion, action, config and params on each request', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc5-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const stored = {
        'project.kanbanAdapter:p1': 'demo',
        'project.kanbanConfig:p1': JSON.stringify({ api_key: 'tok' }),
      }
      const { service, invoke } = makeService({ adaptersDir: dir, store: stored })
      invoke.mockResolvedValue(undefined)
      await service.test('p1')
      const [adapter, request] = invoke.mock.calls[0] as unknown as [
        { dir: string },
        AdapterRequest,
      ]
      expect(request).toEqual({
        protocolVersion: 1,
        action: 'test',
        config: { api_key: 'tok' },
        params: {},
      })
      expect(adapter.dir).toContain('demo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test with unsaved values merges stored config under the override', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc6-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const stored = {
        'project.kanbanAdapter:p1': 'demo',
        'project.kanbanConfig:p1': JSON.stringify({ base_url: 'stored', api_key: 'stored-tok' }),
      }
      const { service, invoke } = makeService({ adaptersDir: dir, store: stored })
      invoke.mockResolvedValue(undefined)
      await service.test('p1', { base_url: 'edited' })
      const request = invoke.mock.calls[0]?.[1] as AdapterRequest
      expect(request.config).toEqual({ base_url: 'edited', api_key: 'stored-tok' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('createItem forwards input as params and normalizes the returned item', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc7-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const { service, invoke } = makeService({
        adaptersDir: dir,
        store: { 'project.kanbanAdapter:p1': 'demo' },
      })
      invoke.mockResolvedValue(item)
      const created = await service.createItem('p1', {
        title: 'First item',
        stateRef: 'done',
        priority: 'high',
      })
      expect(created).toEqual(item)
      const request = invoke.mock.calls[0]?.[1] as AdapterRequest
      expect(request.action).toBe('createItem')
      expect(request.params).toEqual({ title: 'First item', stateRef: 'done', priority: 'high' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('updateItem sends stateRef unresolved and rejects an empty patch', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc8-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const { service, invoke } = makeService({
        adaptersDir: dir,
        store: { 'project.kanbanAdapter:p1': 'demo' },
      })
      invoke.mockResolvedValue({
        ...item,
        stateId: 'st-done',
        stateName: 'Done',
        stateGroup: 'completed',
      })
      const updated = await service.updateItem('p1', 'DEMO-1', { stateRef: 'done' })
      const request = invoke.mock.calls[0]?.[1] as AdapterRequest
      expect(request.params).toEqual({ ref: 'DEMO-1', stateRef: 'done' })
      expect(updated.stateGroup).toBe('completed')
      await expect(service.updateItem('p1', 'DEMO-1', {})).rejects.toMatchObject({
        code: 'validation',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps AdapterHostError timeout and protocol kinds onto typed codes', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc9-'))
    try {
      const adapterDir = join(dir, 'demo')
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id: 'demo',
          name: 'Demo',
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [],
        }),
      )
      const timeout = makeService({
        adaptersDir: dir,
        store: { 'project.kanbanAdapter:p1': 'demo' },
        hostError: new AdapterHostError('timeout', 'boom'),
      })
      await expect(timeout.service.listBoard('p1')).rejects.toMatchObject({ code: 'timeout' })
      const protocol = makeService({
        adaptersDir: dir,
        store: { 'project.kanbanAdapter:p1': 'demo' },
        hostError: new AdapterHostError('protocol', 'bad framing'),
      })
      await expect(protocol.service.listBoard('p1')).rejects.toMatchObject({ code: 'protocol' })
      const adapter = makeService({
        adaptersDir: dir,
        store: { 'project.kanbanAdapter:p1': 'demo' },
        hostError: new AdapterError('network', 'dns failed'),
      })
      await expect(adapter.service.listBoard('p1')).rejects.toMatchObject({ code: 'adapter' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('KanbanService cleanup', () => {
  it('cleanupProject removes both keys', () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': '{"base_url":"x"}',
      'project.kanbanAdapter:p2': 'other',
    }
    const { service, state } = makeService({ store: stored })
    service.cleanupProject('p1')
    expect(state.dump()).toEqual({ 'project.kanbanAdapter:p2': 'other' })
  })
})

// Silence the unused-import guard: discoverAdapters is exercised through
// real directories above; keep the reference for future direct assertions.
void discoverAdapters
