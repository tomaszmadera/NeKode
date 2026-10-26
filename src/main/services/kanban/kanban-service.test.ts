import type { KanbanState, WorkItem } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterInvocation } from './adapter-host'
import { AdapterError, AdapterHostError, type AdapterRequest } from './adapter-host'
import type { DiscoveredAdapter } from './adapter-manifest'
import { discoverAdapters } from './adapter-manifest'
import {
  DEFAULT_KANBAN_STORED_CONFIG,
  KanbanService,
  type KanbanSetConfigInput,
  parseKanbanStoredConfig,
  type SafeStorageLike,
  serializeKanbanStoredConfig,
} from './kanban-service'

// KanbanService behavior (spec kanban-adapter-interface Business rules,
// Acceptance criteria 4–9, 12). The adapter host is a vi.fn standing in for
// the process transport; manifest/persistence rules are asserted through the
// service surface.

const DEMO_SCHEMA_ADAPTER: DiscoveredAdapter = {
  id: 'demo',
  dir: 'mock-demo-dir',
  info: {
    id: 'demo',
    name: 'Demo',
    configSchema: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    ],
  },
  invocation: { command: 'node', args: ['a.js'] },
}

const DEMO_EMPTY_SCHEMA_ADAPTER: DiscoveredAdapter = {
  id: 'demo',
  dir: 'mock-demo-dir',
  info: {
    id: 'demo',
    name: 'Demo',
    configSchema: [],
  },
  invocation: { command: 'node', args: ['a.js'] },
}

const DEMO_SECRET_ONLY_ADAPTER: DiscoveredAdapter = {
  id: 'demo',
  dir: 'mock-demo-dir',
  info: {
    id: 'demo',
    name: 'Demo',
    configSchema: [{ key: 'api_key', label: 'API Key', type: 'secret', required: true }],
  },
  invocation: { command: 'node', args: ['a.js'] },
}

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plain: string) => Buffer.from(`mock_enc:${plain}`, 'utf8')),
    decryptString: vi.fn((buf: Buffer) => {
      const str = buf.toString('utf8')
      if (str.startsWith('mock_enc:')) return str.slice('mock_enc:'.length)
      throw new Error('decryption failed')
    }),
  }
}

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
    safeStorage?: SafeStorageLike
    adapters?: DiscoveredAdapter[]
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
    safeStorage: options.safeStorage,
    ...(options.adapters !== undefined
      ? { discoverAdapters: () => ({ adapters: options.adapters ?? [], warnings: [] }) }
      : {}),
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

describe('parseKanbanStoredConfig and serializeKanbanStoredConfig', () => {
  it('returns default empty values for null, empty or whitespace', () => {
    expect(parseKanbanStoredConfig(null)).toEqual(DEFAULT_KANBAN_STORED_CONFIG)
    expect(parseKanbanStoredConfig('')).toEqual(DEFAULT_KANBAN_STORED_CONFIG)
    expect(parseKanbanStoredConfig('   ')).toEqual(DEFAULT_KANBAN_STORED_CONFIG)
  })

  it('gracefully returns empty values for corrupted or non-object JSON', () => {
    expect(parseKanbanStoredConfig('not-json')).toEqual({ values: {} })
    expect(parseKanbanStoredConfig('123')).toEqual({ values: {} })
    expect(parseKanbanStoredConfig('["array"]')).toEqual({ values: {} })
  })

  it('parses flat key-value records (legacy format) extracting string fields', () => {
    const raw = JSON.stringify({ base_url: 'https://example.com', api_key: 'tok', invalid: 42 })
    expect(parseKanbanStoredConfig(raw)).toEqual({
      values: { base_url: 'https://example.com', api_key: 'tok' },
    })
  })

  it('parses nested values envelopes extracting string fields', () => {
    const raw = JSON.stringify({ values: { base_url: 'https://nested.com', token: 'xyz' } })
    expect(parseKanbanStoredConfig(raw)).toEqual({
      values: { base_url: 'https://nested.com', token: 'xyz' },
    })
  })

  it('serializes stored config to json string', () => {
    const serialized = serializeKanbanStoredConfig({
      values: { base_url: 'https://example.com', api_key: 'tok' },
    })
    expect(JSON.parse(serialized)).toEqual({
      base_url: 'https://example.com',
      api_key: 'tok',
    })
  })
})

describe('KanbanService adaptersList', () => {
  it('returns adapter infos from discovery (fresh scan each call)', () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'nekode-ksvc-list-'))
    const writeAdapter = (name: string, id: string): void => {
      const adapterDir = join(dir, name)
      mkdirSync(adapterDir)
      writeFileSync(
        join(adapterDir, 'adapter.json'),
        JSON.stringify({
          id,
          name: id,
          protocolVersion: 1,
          invocation: { command: 'node', args: ['a.js'] },
          configSchema: [{ key: 'base_url', label: 'Base URL', type: 'string', required: true }],
        }),
      )
    }
    try {
      writeAdapter('demo', 'demo')
      const { service } = makeService({ adaptersDir: dir })
      // The built-in local-file source always leads (project-home spec
      // Behaviour 6-7), labeled Local file, without config fields.
      expect(service.adaptersList()).toEqual([
        { id: 'local-file', name: 'Local file', configSchema: [] },
        expect.objectContaining({ id: 'demo' }),
      ])
      // Fresh scan each call: an adapter added after the first call shows up.
      writeAdapter('extra', 'extra')
      expect(
        service
          .adaptersList()
          .map((info) => info.id)
          .slice(1)
          .sort(),
      ).toEqual(['demo', 'extra'])
      // A discovered adapter cannot claim the built-in id.
      writeAdapter('impostor', 'local-file')
      expect(service.adaptersList().filter((info) => info.id === 'local-file')).toEqual([
        { id: 'local-file', name: 'Local file', configSchema: [] },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
      expect((error as AppError).message).toContain('ghost')
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
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({
        base_url: 'https://x',
        api_key: 'supersecret',
      }),
    }
    const { service } = makeService({ adapters: [DEMO_SCHEMA_ADAPTER], store: stored })
    const config = service.getConfig('p1')
    expect(config.values.base_url).toBe('https://x')
    expect(config.values.api_key).toBeNull()
    expect(config.secretKeys).toEqual(['api_key'])
    expect(JSON.stringify(config)).not.toContain('supersecret')
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
    const { service, state } = makeService({ adapters: [DEMO_SCHEMA_ADAPTER], store: stored })
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
  })

  it('setConfig with a required empty field rejects with validation', () => {
    const { service } = makeService({ adapters: [DEMO_SCHEMA_ADAPTER] })
    expect(() => service.setConfig('p1', { adapterId: 'demo', values: { base_url: '' } })).toThrow(
      /required/i,
    )
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

describe('KanbanService secret protection and safeStorage', () => {
  it('encrypts secret fields at rest with enc:v1: prefix when safeStorage is available', () => {
    const safeStorage = fakeSafeStorage(true)
    const { service, state } = makeService({ adapters: [DEMO_SCHEMA_ADAPTER], safeStorage })

    service.setConfig('p1', {
      adapterId: 'demo',
      values: { base_url: 'https://api.example.com', api_key: 'super-secret-pat' },
    })

    const rawConfig = state.dump()['project.kanbanConfig:p1'] as string
    // Plaintext secret must never appear on disk / in store
    expect(rawConfig).not.toContain('super-secret-pat')
    const parsed = JSON.parse(rawConfig) as Record<string, string>
    expect(parsed.base_url).toBe('https://api.example.com')
    expect(parsed.api_key).toMatch(/^enc:v1:/)

    // getConfig preserves masked contract
    const config = service.getConfig('p1')
    expect(config.values.base_url).toBe('https://api.example.com')
    expect(config.values.api_key).toBeNull()
    expect(config.secretKeys).toEqual(['api_key'])
    expect(JSON.stringify(config)).not.toContain('super-secret-pat')
  })

  it('effectiveConfig decrypts secrets for adapter host calls', async () => {
    const safeStorage = fakeSafeStorage(true)
    const encKey = `enc:v1:${Buffer.from('mock_enc:decrypted-secret-token').toString('base64')}`
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({
        base_url: 'https://api.example.com',
        api_key: encKey,
      }),
    }
    const { service, invoke } = makeService({
      adapters: [DEMO_SCHEMA_ADAPTER],
      store: stored,
      safeStorage,
    })
    invoke.mockResolvedValue(undefined)

    await service.test('p1')

    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.config).toEqual({
      base_url: 'https://api.example.com',
      api_key: 'decrypted-secret-token',
    })
  })

  it('migrates legacy plaintext secrets to safeStorage encryption at rest without value loss', async () => {
    const safeStorage = fakeSafeStorage(true)
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({
        base_url: 'https://api.example.com',
        api_key: 'legacy-plaintext-token',
      }),
    }
    const { service, state, invoke } = makeService({
      adapters: [DEMO_SCHEMA_ADAPTER],
      store: stored,
      safeStorage,
    })
    invoke.mockResolvedValue(undefined)

    // On read (getConfig), migration should run and encrypt the plaintext secret on disk
    const config = service.getConfig('p1')
    expect(config.values.api_key).toBeNull()
    expect(config.secretKeys).toEqual(['api_key'])

    // Persisted store must now contain encrypted secret instead of plaintext
    const migratedRaw = state.dump()['project.kanbanConfig:p1'] as string
    expect(migratedRaw).not.toContain('legacy-plaintext-token')
    const parsed = JSON.parse(migratedRaw) as Record<string, string>
    expect(parsed.api_key).toMatch(/^enc:v1:/)

    // Adapter invocation must still receive the decrypted secret without value loss
    await service.test('p1')
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.config.api_key).toBe('legacy-plaintext-token')
  })

  it('re-saving config with empty secret preserves stored encrypted secret', async () => {
    const safeStorage = fakeSafeStorage(true)
    const { service, state, invoke } = makeService({
      adapters: [DEMO_SCHEMA_ADAPTER],
      safeStorage,
    })
    invoke.mockResolvedValue(undefined)

    // Save initial config with secret
    service.setConfig('p1', {
      adapterId: 'demo',
      values: { base_url: 'https://initial.com', api_key: 'my-initial-secret' },
    })

    // Edit only base_url with empty secret (keeps stored secret)
    service.setConfig('p1', {
      adapterId: 'demo',
      values: { base_url: 'https://updated.com', api_key: '' },
    })

    const raw = state.dump()['project.kanbanConfig:p1'] as string
    expect(raw).not.toContain('my-initial-secret')
    const parsed = JSON.parse(raw) as Record<string, string>
    expect(parsed.base_url).toBe('https://updated.com')
    expect(parsed.api_key).toMatch(/^enc:v1:/)

    // Secret is still successfully decrypted and used
    await service.test('p1')
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.config.api_key).toBe('my-initial-secret')
    expect(request.config.base_url).toBe('https://updated.com')
  })

  it('corrupt encrypted secret degrades gracefully without throwing', () => {
    const safeStorage = fakeSafeStorage(true)
    // Invalid ciphertext that fakeSafeStorage cannot decrypt
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({
        api_key: `enc:v1:${Buffer.from('corrupt_not_mock_enc').toString('base64')}`,
      }),
    }
    const { service } = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      store: stored,
      safeStorage,
    })

    // getConfig degrades gracefully: does not throw, secretKeys is empty
    const config = service.getConfig('p1')
    expect(config.values.api_key).toBeNull()
    expect(config.secretKeys).toEqual([])
  })

  it('without a keyring keeps a new secret in memory only: never written to disk in plain text', async () => {
    const safeStorage = fakeSafeStorage(false)
    const { service, state, invoke } = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      safeStorage,
    })

    service.setConfig('p1', {
      adapterId: 'demo',
      values: { api_key: 'fallback-secret' },
    })

    expect(JSON.stringify(state.dump())).not.toContain('fallback-secret')
    const parsed = JSON.parse(state.dump()['project.kanbanConfig:p1'] as string)
    expect(parsed.api_key).toBeUndefined()

    // Still usable for this session, and the UI is told why it will not stick.
    const config = service.getConfig('p1')
    expect(config.values.api_key).toBeNull()
    expect(config.secretKeys).toEqual(['api_key'])
    expect(config.sessionOnlySecrets).toBe(true)
    await service.test('p1')
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.config.api_key).toBe('fallback-secret')

    // A later save that omits the secret keeps the session value (required field passes).
    expect(() => service.setConfig('p1', { adapterId: 'demo', values: {} })).not.toThrow()
  })

  it('without a keyring a fresh session (restart) has no secret: nothing was persisted', () => {
    const store: Record<string, string> = {}
    const first = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      safeStorage: fakeSafeStorage(false),
    })
    first.service.setConfig('p1', { adapterId: 'demo', values: { api_key: 'fallback-secret' } })
    Object.assign(store, first.state.dump())

    const restarted = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      store,
      safeStorage: fakeSafeStorage(false),
    })
    const config = restarted.service.getConfig('p1')
    expect(config.adapterId).toBe('demo')
    expect(config.secretKeys).toEqual([])
    expect(config.sessionOnlySecrets).toBe(true)
  })

  it('without a keyring a re-entered secret drops the older plain-text copy from disk', () => {
    const { service, state } = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      store: {
        'project.kanbanAdapter:p1': 'demo',
        'project.kanbanConfig:p1': JSON.stringify({ api_key: 'legacy-plain' }),
      },
      safeStorage: fakeSafeStorage(false),
    })
    service.setConfig('p1', { adapterId: 'demo', values: { api_key: 'new-secret' } })
    const dump = JSON.stringify(state.dump())
    expect(dump).not.toContain('legacy-plain')
    expect(dump).not.toContain('new-secret')
  })

  it('keeps a secret session-only when encryptString throws although the keyring reports available', async () => {
    const safeStorage = fakeSafeStorage(true)
    vi.mocked(safeStorage.encryptString).mockImplementation(() => {
      throw new Error('keyring locked')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { service, state, invoke } = makeService({
        adapters: [DEMO_SECRET_ONLY_ADAPTER],
        safeStorage,
      })
      service.setConfig('p1', { adapterId: 'demo', values: { api_key: 'throwing-secret' } })

      expect(JSON.stringify(state.dump())).not.toContain('throwing-secret')
      const config = service.getConfig('p1')
      expect(config.secretKeys).toEqual(['api_key'])
      expect(config.sessionOnlySecrets).toBe(true)
      await service.test('p1')
      const request = invoke.mock.calls[0]?.[1] as AdapterRequest
      expect(request.config.api_key).toBe('throwing-secret')
    } finally {
      warn.mockRestore()
    }
  })

  it('reports no session-only warning when the keyring encrypts', () => {
    const { service } = makeService({
      adapters: [DEMO_SECRET_ONLY_ADAPTER],
      safeStorage: fakeSafeStorage(true),
    })
    service.setConfig('p1', { adapterId: 'demo', values: { api_key: 'k' } })
    expect(service.getConfig('p1').sessionOnlySecrets).toBeUndefined()
  })
})

describe('KanbanService actions', () => {
  it('unconfigured project rejects listBoard with validation naming the project', async () => {
    const { service } = makeService()
    await expect(service.listBoard('p1')).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('adapter'),
    })
    // Behaviour 9 / AC9: the rejection names the project.
    await expect(service.listBoard('p1')).rejects.toMatchObject({
      message: expect.stringContaining('"p1"'),
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
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: stored,
    })
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
  })

  it('sends protocolVersion, action, config and params on each request', async () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({ api_key: 'tok' }),
    }
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: stored,
    })
    invoke.mockResolvedValue(undefined)
    await service.test('p1')
    const [adapter, request] = invoke.mock.calls[0] as unknown as [{ dir: string }, AdapterRequest]
    expect(request).toEqual({
      protocolVersion: 1,
      action: 'test',
      config: { api_key: 'tok' },
      params: {},
    })
    expect(adapter.dir).toContain('demo')
  })

  it('test with unsaved values merges stored config under the override', async () => {
    const stored = {
      'project.kanbanAdapter:p1': 'demo',
      'project.kanbanConfig:p1': JSON.stringify({ base_url: 'stored', api_key: 'stored-tok' }),
    }
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: stored,
    })
    invoke.mockResolvedValue(undefined)
    await service.test('p1', { base_url: 'edited' })
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.config).toEqual({ base_url: 'edited', api_key: 'stored-tok' })
  })

  it('createItem forwards input as params and normalizes the returned item', async () => {
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
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
  })

  it('updateItem sends stateRef unresolved and rejects an empty patch', async () => {
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
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
    await service.updateItem('p1', 'DEMO-1', { priority: 'low' })
    const named = invoke.mock.calls[1]?.[1] as AdapterRequest
    expect(named.params).toEqual({ ref: 'DEMO-1', priority: 'low' })
    await service.updateItem('p1', 'DEMO-1', { priority: null })
    const cleared = invoke.mock.calls[2]?.[1] as AdapterRequest
    expect(cleared.params).toEqual({ ref: 'DEMO-1', priority: null })
    await expect(service.updateItem('p1', 'DEMO-1', {})).rejects.toMatchObject({
      code: 'validation',
    })
  })

  it('maps AdapterHostError timeout and protocol kinds onto typed codes', async () => {
    const timeout = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: { 'project.kanbanAdapter:p1': 'demo' },
      hostError: new AdapterHostError('timeout', 'boom'),
    })
    await expect(timeout.service.listBoard('p1')).rejects.toMatchObject({ code: 'timeout' })
    const protocol = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: { 'project.kanbanAdapter:p1': 'demo' },
      hostError: new AdapterHostError('protocol', 'bad framing'),
    })
    await expect(protocol.service.listBoard('p1')).rejects.toMatchObject({ code: 'protocol' })
    const adapter = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: { 'project.kanbanAdapter:p1': 'demo' },
      hostError: new AdapterError('network', 'dns failed'),
    })
    // The adapter's own code is surfaced verbatim (spec Errors), not
    // collapsed into the generic 'adapter' code.
    await expect(adapter.service.listBoard('p1')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('KanbanService getItem', () => {
  it('rejects an empty ref before the adapter host', async () => {
    const { service, invoke } = makeService()
    await expect(service.getItem('p1', '  ')).rejects.toMatchObject({ code: 'validation' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('calls adapter getItem with { ref } and returns the normalized item', async () => {
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: { 'project.kanbanAdapter:p1': 'demo' },
    })
    invoke.mockResolvedValue(item)
    await expect(service.getItem('p1', 'DEMO-1')).resolves.toEqual(item)
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.protocolVersion).toBe(1)
    expect(request.action).toBe('getItem')
    expect(request.params).toEqual({ ref: 'DEMO-1' })
  })
})

describe('KanbanService getComments', () => {
  it('rejects an empty ref before the adapter host', async () => {
    const { service, invoke } = makeService()
    await expect(service.getComments('p1', '  ')).rejects.toMatchObject({ code: 'validation' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('calls adapter listComments with { ref } and returns the normalized comments', async () => {
    const { service, invoke } = makeService({
      adapters: [DEMO_EMPTY_SCHEMA_ADAPTER],
      store: { 'project.kanbanAdapter:p1': 'demo' },
    })
    const comments = [
      { id: 'c1', text: 'Hello', author: 'Alice', createdAt: '2026-10-17T12:00:00Z' },
    ]
    invoke.mockResolvedValue(comments)
    await expect(service.getComments('p1', 'DEMO-1')).resolves.toEqual(comments)
    const request = invoke.mock.calls[0]?.[1] as AdapterRequest
    expect(request.protocolVersion).toBe(1)
    expect(request.action).toBe('listComments')
    expect(request.params).toEqual({ ref: 'DEMO-1' })
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
