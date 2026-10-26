import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DictationResult } from '@shared/contracts/dictation-contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppStateService } from '../app-state-service'
import type { SttProviderAdapter } from './adapters/adapter-contract'
import { DictationProviderError } from './adapters/dictation-provider-error'
import { OpenRouterAdapter } from './adapters/openrouter-adapter'
import { OpenWhisprAdapter } from './adapters/openwhispr-adapter'
import { OpenWhisprCloudAdapter } from './adapters/openwhispr-cloud-adapter'
import { DictationService } from './dictation-service'
import type { DictationDictionaryService } from './dictionary/dictation-dictionary-service'
import { OpenWhisprClient, type TranscriptionResponse } from './openwhispr-client'
import { PostProcessor } from './post-processing/post-processor'
import { ProviderRegistry } from './registry/provider-registry'
import type { SafeStorageLike } from './security/dictation-secrets'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'nekode-dictation-test-')))
      throw new Error('Unexpected test cleanup target')
    rmSync(directory, { recursive: true, force: true })
  }
})
const recordings = (root: string) =>
  readdirSync(root).flatMap((owner) =>
    readdirSync(join(root, owner)).map((file) => join(root, owner, file)),
  )
const wav = () => {
  const buffer = new ArrayBuffer(16044)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  for (const [at, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    bytes.set(
      [...text].map((char) => char.charCodeAt(0)),
      at,
    )
  for (const [at, value] of [
    [4, 16036],
    [16, 16],
    [24, 16000],
    [28, 32000],
    [40, 16000],
  ])
    view.setUint32(at, value, true)
  for (const [at, value] of [
    [20, 1],
    [22, 1],
    [32, 2],
    [34, 16],
  ])
    view.setUint16(at, value, true)
  return buffer
}
function harness(
  transcribe: (
    path: string,
    settings: unknown,
    signal: AbortSignal,
  ) => Promise<TranscriptionResponse>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
  directories.push(directory)
  const client = {
    getSettings: () => ({
      enabled: true,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    }),
    status: () => ({ state: 'operational', staleModelSelection: false }),
    transcribe: vi.fn(transcribe),
  } as unknown as OpenWhisprClient
  const service = new DictationService(client, directory)
  const results: DictationResult[] = []
  service.onResult((result) => results.push(result))
  return { service, client, results, directory }
}

describe('dictation sessions', () => {
  it('starts when another service sweeps an exited owner between discovery and inspection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)
    const owner = join(directory, '101-12345678-1234-1234-1234-123456789abc')
    mkdirSync(owner)
    writeFileSync(join(owner, '12345678-1234-1234-1234-123456789abc.wav'), Buffer.from(wav()))
    const client = {
      getSettings: () => ({ enabled: true }),
      status: () => ({ state: 'operational' }),
    } as OpenWhisprClient
    const concurrentSweep = vi.fn(() => {
      new DictationService(client, directory, () => true).shutdown()
      return true
    })
    expect(() => new DictationService(client, directory, concurrentSweep).shutdown()).not.toThrow()
    expect(concurrentSweep).toHaveBeenCalledOnce()
    expect(existsSync(owner)).toBe(false)
  })
  it('skips a stale owner directory whose sweep fails with non-ENOENT error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)
    const owner = join(directory, '101-12345678-1234-1234-1234-123456789abc')
    mkdirSync(owner)
    writeFileSync(join(owner, '12345678-1234-1234-1234-123456789abc.wav'), Buffer.from(wav()))
    const client = {
      getSettings: () => ({ enabled: true }),
      status: () => ({ state: 'operational' }),
    } as OpenWhisprClient
    if (process.platform === 'win32') {
      execSync(`icacls "${owner}" /deny *S-1-1-0:(RD)`, { stdio: 'ignore' })
    } else {
      fs.chmodSync(owner, 0)
    }
    try {
      expect(() => new DictationService(client, directory, () => true).shutdown()).not.toThrow()
      expect(existsSync(owner)).toBe(true)
    } finally {
      if (process.platform === 'win32') {
        execSync(`icacls "${owner}" /remove:d *S-1-1-0`, { stdio: 'ignore' })
      } else {
        fs.chmodSync(owner, 0o755)
      }
    }
  })
  it('does not sweep a recording owned by another live service', async () => {
    let resolve!: (value: TranscriptionResponse) => void
    let recordedPath = ''
    const h = harness((path) => {
      recordedPath = path
      return new Promise((done) => {
        resolve = done
      })
    })
    const pending = h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(existsSync(recordedPath)).toBe(true)
    const other = new DictationService(h.client, h.directory)
    const preserved = existsSync(recordedPath)
    other.shutdown()
    resolve({ text: 'hello', warning: null, error: null })
    await pending
    expect(preserved).toBe(true)
  })
  it('gates disabled and unavailable sessions with normalized errors', () => {
    const h = harness(vi.fn())
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: false,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    })
    expect(h.service.start('chat', null)).toEqual({ sessionId: null, error: 'disabled' })
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: true,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    })
    vi.spyOn(h.client, 'status').mockReturnValue({
      state: 'model-available',
      models: [],
      checkedAt: null,
      error: null,
      staleModelSelection: false,
    })
    expect(h.service.start('chat', null)).toEqual({ sessionId: null, error: 'no-model' })
    expect(h.client.transcribe).not.toHaveBeenCalled()
  })
  it('warns once on the next transcription outcome, preserving it across a cancelled recording', async () => {
    const h = harness(async () => ({ text: 'hello', error: null, warning: 'provider warning' }))
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: true,
      language: 'default',
      model: { provider: 'removed', model: 'gone' },
      timeoutSeconds: 5,
    })
    vi.spyOn(h.client, 'status').mockReturnValue({
      state: 'operational',
      models: [],
      checkedAt: null,
      error: null,
      staleModelSelection: true,
    })
    h.service.cancel(h.service.start('chat', null).sessionId as string)
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[1].warning).toContain('Using the OpenWhispr default')
    expect(h.results[1].warning).toContain('provider warning')
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[2].warning).toBe('provider warning')
  })
  it('settles write failure without exposing a path or calling the bridge', async () => {
    const h = harness(vi.fn())
    rmSync(h.directory, { recursive: true })
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[0]).toMatchObject({ error: 'recording-failure', outcome: 'failed' })
    expect(JSON.stringify(h.results)).not.toContain(h.directory)
    expect(h.client.transcribe).not.toHaveBeenCalled()
    directories.splice(directories.indexOf(h.directory), 1)
  })
  it('owns one take, forwards a warning once and cleans successful audio', async () => {
    const h = harness(async (path) => {
      expect(existsSync(path)).toBe(true)
      return { text: 'hello', warning: 'language hint', error: null }
    })
    const id = h.service.start('chat-a', null).sessionId as string
    expect(h.service.start('chat-b', null).sessionId).toBeNull()
    await h.service.audio(id, wav())
    await h.service.audio(id, wav())
    expect(h.results).toEqual([
      expect.objectContaining({
        sessionId: id,
        chatId: 'chat-a',
        outcome: 'success',
        text: 'hello',
        warning: 'language hint',
      }),
    ])
    expect(recordings(h.directory)).toEqual([])
  })
  it('discards cancelled recording without a bridge call', () => {
    const h = harness(vi.fn())
    h.service.cancel(h.service.start('chat-a', null).sessionId as string)
    expect(h.results[0].outcome).toBe('cancelled')
    expect(h.client.transcribe).not.toHaveBeenCalled()
  })
  it('aborts transcription, cleans immediately, and discards late results after a new take', async () => {
    let resolve!: (value: TranscriptionResponse) => void
    let signal!: AbortSignal
    const h = harness((_path, _settings, input) => {
      signal = input
      return new Promise((done) => {
        resolve = done
      })
    })
    const id = h.service.start('chat-a', null).sessionId as string
    const pending = h.service.audio(id, wav())
    h.service.cancel(id)
    expect(signal.aborted).toBe(true)
    expect(recordings(h.directory)).toEqual([])
    expect(h.service.start('chat-b', null).sessionId).not.toBeNull()
    resolve({ text: 'stale', warning: null, error: null })
    await pending
    expect(h.results).toHaveLength(1)
    h.service.shutdown()
  })
  it('deletes timed-out files and allows a single explicit retry from retained bytes', async () => {
    const h = harness(async () => ({ text: '', warning: null, error: 'timeout' }))
    const id = h.service.start('chat-a', null).sessionId as string
    await h.service.audio(id, wav())
    expect(h.results[0]).toMatchObject({ error: 'timeout', retryable: true })
    expect(recordings(h.directory)).toEqual([])
    const retry = h.service.start('chat-a', id).sessionId as string
    expect(retry).not.toBe(id)
    await vi.waitFor(() => expect(h.results).toHaveLength(2))
    expect(h.results[1]).toMatchObject({ sessionId: retry, retryable: false })
    expect(() => h.service.start('chat-a', retry)).toThrow('cannot be retried')
    expect(recordings(h.directory)).toEqual([])
  })
  it.each(['malformed-response', 'unreachable'] as const)(
    'cleans failed audio: %s',
    async (error) => {
      const h = harness(async () => ({ text: '', warning: null, error }))
      await h.service.audio(h.service.start('chat-a', null).sessionId as string, wav())
      expect(h.results[0]).toMatchObject({ outcome: 'failed', error, retryable: false })
      expect(recordings(h.directory)).toEqual([])
    },
  )
  it('sweeps only proven-exited owners and leaves live, unknown and legacy recordings intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)
    const filename = '12345678-1234-1234-1234-123456789abc.wav'
    const owners = [101, 102, 103].map((pid) =>
      join(directory, `${pid}-12345678-1234-1234-1234-123456789abc`),
    )
    for (const owner of owners) {
      mkdirSync(owner)
      writeFileSync(join(owner, filename), Buffer.from(wav()))
    }
    writeFileSync(join(directory, filename), Buffer.from(wav()))
    const client = {
      getSettings: () => ({ enabled: true }),
      status: () => ({ state: 'operational' }),
    } as OpenWhisprClient
    const provenExited = vi.fn((pid: number) => pid === 101)
    const service = new DictationService(client, directory, provenExited)
    expect(existsSync(owners[0])).toBe(false)
    expect(existsSync(join(owners[1], filename))).toBe(true)
    expect(existsSync(join(owners[2], filename))).toBe(true)
    expect(existsSync(join(directory, filename))).toBe(true)
    expect(provenExited.mock.calls.map(([pid]) => pid)).toEqual([101, 102, 103])
    const result = vi.fn()
    service.onResult(result)
    service.start('chat', null)
    service.shutdown()
    expect(result).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'cancelled' }))
    expect(service.start('chat', null).sessionId).toBeNull()
  })
})

describe('dictation provider architecture orchestration', () => {
  const fakeSafeStorage: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`enc_${plainText}`),
    decryptString: (encrypted: Buffer) => {
      const str = encrypted.toString('utf-8')
      return str.startsWith('enc_') ? str.slice(4) : str
    },
  }

  function createTestHarness(customRoot?: string, localEnabled?: boolean) {
    const directory = customRoot ?? mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)

    const store = new Map<string, string>()
    const state: AppStateService = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => {
        store.set(k, v)
      },
      delete: (k: string) => {
        store.delete(k)
      },
    } as unknown as AppStateService

    const registry = new ProviderRegistry()
    if (localEnabled !== undefined) state.set('dictation.enabled', JSON.stringify(localEnabled))

    const mockAdapter: SttProviderAdapter = {
      manifest: {
        id: 'elevenlabs',
        name: 'ElevenLabs Scribe v2',
        description: 'Mock ElevenLabs adapter',
        version: '1.0.0',
        capabilities: {
          keyterms: true,
          nativeEditing: true,
          languageSelection: true,
          modelDiscovery: true,
          timestamps: false,
        },
        configSchema: [
          { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
          { key: 'language', label: 'Language', type: 'text', required: false, defaultValue: 'pl' },
          { key: 'nativeEditPrompt', label: 'Prompt', type: 'text', required: false },
        ],
      },
      testConnection: vi.fn(async () => ({ ok: true, message: 'Connected' })),
      discoverModels: vi.fn(async () => [{ id: 'scribe_v2', name: 'Scribe v2' }]),
      transcribe: vi.fn(async (_req) => ({
        text: 'hello world from scribe',
        rawText: 'hello world from scribe',
        providerId: 'elevenlabs',
        modelId: 'scribe_v2',
      })),
    }
    registry.register(mockAdapter)

    const dictService = {
      getEffectiveDictionary: vi.fn((projectId?: string) => ({
        terms: projectId === 'proj-alpha' ? ['NeKode', 'ElevenLabs'] : ['GlobalTerm'],
        aliases: ['nk'],
      })),
      list: vi.fn((_filter?: { projectId?: string }) => [
        {
          id: 'dict-1',
          term: 'NeKode',
          aliases: ['nk'],
          description: null,
          scope: 'global' as const,
          projectId: null,
          enabled: true,
          createdAt: '',
          updatedAt: '',
        },
      ]),
      add: vi.fn((entry) => ({
        id: 'new-id',
        ...entry,
        aliases: [],
        description: null,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      })),
      update: vi.fn((id, _updates) => ({
        id,
        term: 'updated',
        aliases: [],
        description: null,
        scope: 'global' as const,
        projectId: null,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      })),
      delete: vi.fn(),
      toggle: vi.fn((id, enabled) => ({
        id,
        term: 'NeKode',
        aliases: [],
        description: null,
        scope: 'global' as const,
        projectId: null,
        enabled,
        createdAt: '',
        updatedAt: '',
      })),
    } as unknown as DictationDictionaryService

    const postProcessor = new PostProcessor()

    const client = localEnabled === undefined ? undefined : new OpenWhisprClient({ state })
    const service = new DictationService({
      client,
      registry,
      dictionaryService: dictService,
      postProcessor,
      state,
      safeStorage: fakeSafeStorage,
      resolveChatProjectId: (chatId) => (chatId === 'chat-project' ? 'proj-alpha' : null),
      root: directory,
    })

    const results: DictationResult[] = []
    service.onResult((r) => results.push(r))

    return { service, registry, mockAdapter, dictService, state, store, results, directory, client }
  }

  it('starts configured ElevenLabs with an injected local client whose settings are disabled', async () => {
    const h = createTestHarness(undefined, false)
    h.service.providersSetConfig('elevenlabs', { apiKey: 'test-elevenlabs-key' })
    const started = h.service.start('chat-project', null)
    expect(started.error).toBeNull()
    expect(started.sessionId).toEqual(expect.any(String))
    await h.service.audio(started.sessionId as string, wav())
    expect(h.mockAdapter.transcribe).toHaveBeenCalledOnce()
    expect(h.results[0]).toMatchObject({ outcome: 'success', providerId: 'elevenlabs' })
  })

  function cloudHarness() {
    const h = createTestHarness(undefined, false)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: { text: 'NeKode nk' } })))
    const adapter = new OpenWhisprCloudAdapter({ fetch })
    h.registry.register(adapter)
    h.service.setActiveProvider('openwhispr-cloud')
    return { ...h, fetch, adapter }
  }

  const cloudConfig = { apiKey: 'owk_live_fixture_key', cloudUploadEnabled: true }

  it('starts Cloud with invalid retained local settings and sends effective terms and aliases to the original chat', async () => {
    const h = cloudHarness()
    h.store.set('dictation.model', 'invalid-local-json')
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    const start = h.service.start('chat-project', null)
    expect(start.error).toBeNull()
    await h.service.audio(start.sessionId as string, wav())
    const form = h.fetch.mock.calls[0][1]?.body as FormData
    expect(form.get('prompt')).toBe('NeKode, ElevenLabs, nk')
    expect(h.results).toHaveLength(1)
    expect(h.results[0]).toMatchObject({
      chatId: 'chat-project',
      outcome: 'success',
      text: 'NeKode nk',
      rawText: 'NeKode nk',
      providerId: 'openwhispr-cloud',
    })
  })

  it('starts OpenRouter without consulting invalid local settings', async () => {
    const h = createTestHarness(undefined, false)
    h.store.set('dictation.model', 'invalid-local-json')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'router text' })))
    h.registry.register(new OpenRouterAdapter({ fetch }))
    h.service.setActiveProvider('openrouter')
    h.service.providersSetConfig('openrouter', { apiKey: 'fixture-router-key' })
    const start = h.service.start('chat-project', null)
    expect(start.error).toBeNull()
    await h.service.audio(start.sessionId as string, wav())
    expect(fetch).toHaveBeenCalledOnce()
    expect(h.results[0]).toMatchObject({ outcome: 'success', providerId: 'openrouter' })
  })

  it('requires a key and permission before Cloud recording, and rechecks revocation before upload', async () => {
    const h = cloudHarness()
    expect(h.service.providersGetConfig('openwhispr-cloud').cloudUploadEnabled).toBe(false)
    expect(h.service.start('chat-project', null)).toMatchObject({
      sessionId: null,
      error: 'auth-failed',
    })
    h.service.providersSetConfig('openwhispr-cloud', { apiKey: cloudConfig.apiKey })
    expect(h.service.providersList().find((p) => p.id === 'openwhispr-cloud')?.configured).toBe(
      false,
    )
    expect(h.service.start('chat-project', null)).toMatchObject({
      sessionId: null,
      error: 'cloud-consent-required',
    })
    h.service.providersSetConfig('openwhispr-cloud', { cloudUploadEnabled: true })
    expect(h.service.providersList().find((p) => p.id === 'openwhispr-cloud')?.configured).toBe(
      true,
    )
    const start = h.service.start('chat-project', null)
    expect(start.error).toBeNull()
    h.service.providersSetConfig('openwhispr-cloud', { cloudUploadEnabled: false })
    await h.service.audio(start.sessionId as string, wav())
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.results[0]).toMatchObject({ outcome: 'failed', error: 'cloud-consent-required' })
    expect(recordings(h.directory)).toEqual([])
  })

  it.each([
    { apiKey: 'owk_workspace_key', cloudUploadEnabled: true },
    { apiKey: 'owk_live_fixture_key', language: 'invalid' },
    { apiKey: 'owk_live_fixture_key', cloudUploadEnabled: 'true' },
    { apiKey: 'owk_live_fixture_key', baseUrl: 'https://untrusted.example' },
    { apiKey: 'enc:v1:injected' },
  ])('rejects invalid Cloud patches without partially changing configuration', (patch) => {
    const h = cloudHarness()
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    const before = h.state.get('dictation.providerConfig:openwhispr-cloud')
    expect(() => h.service.providersSetConfig('openwhispr-cloud', patch)).toThrow(
      'Invalid OpenWhispr Cloud configuration',
    )
    expect(h.state.get('dictation.providerConfig:openwhispr-cloud')).toBe(before)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('keeps Cloud credentials encrypted, masks reads and rejects unavailable encryption before saving', () => {
    const h = cloudHarness()
    const available = vi.spyOn(fakeSafeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    try {
      expect(() => h.service.providersSetConfig('openwhispr-cloud', cloudConfig)).toThrow(
        'Cannot encrypt',
      )
      expect(h.state.get('dictation.providerConfig:openwhispr-cloud')).toBeNull()
    } finally {
      available.mockRestore()
    }
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    const stored = JSON.parse(h.state.get('dictation.providerConfig:openwhispr-cloud') as string)
    expect(stored.apiKey).toMatch(/^enc:v1:/)
    expect(stored.apiKey).not.toContain(cloudConfig.apiKey)
    expect(h.service.providersGetConfig('openwhispr-cloud').apiKey).toEqual({
      configured: true,
      valid: true,
      lastFour: '_key',
    })
    expect(JSON.stringify(h.service.providersList())).not.toContain(cloudConfig.apiKey)
  })

  it('never redirects a take to Cloud when Settings changes during recording', async () => {
    const h = cloudHarness()
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    h.service.setActiveProvider('elevenlabs')
    const start = h.service.start('chat-project', null)
    h.service.setActiveProvider('openwhispr-cloud')
    await h.service.audio(start.sessionId as string, wav())
    expect(h.mockAdapter.transcribe).toHaveBeenCalledOnce()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.results[0].providerId).toBe('elevenlabs')
  })

  it('keeps a local recording local after switching Settings to Cloud', async () => {
    const h = createTestHarness(undefined, true)
    const client = h.client as OpenWhisprClient
    vi.spyOn(client, 'status').mockReturnValue({
      state: 'operational',
      checkedAt: null,
      models: [],
      staleModelSelection: false,
      error: null,
    })
    const local = vi
      .spyOn(client, 'transcribe')
      .mockResolvedValue({ text: 'local text', warning: null, error: null })
    h.registry.register(new OpenWhisprAdapter(client))
    const fetch = vi.fn<typeof globalThis.fetch>()
    h.registry.register(new OpenWhisprCloudAdapter({ fetch }))
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    h.service.setActiveProvider('openwhispr')
    const first = h.service.start('chat-project', null)
    h.service.setActiveProvider('openwhispr-cloud')
    await h.service.audio(first.sessionId as string, wav())
    expect(local).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(h.results[0]).toMatchObject({
      outcome: 'success',
      text: 'local text',
      providerId: 'openwhispr',
    })
  })

  it('retries with the original Cloud provider and preserves at-most-once delivery', async () => {
    const h = cloudHarness()
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    const transcribe = vi
      .spyOn(h.adapter, 'transcribe')
      .mockRejectedValueOnce(new DictationProviderError('timeout'))
    const first = h.service.start('chat-project', null)
    await h.service.audio(first.sessionId as string, wav())
    expect(h.results[0]).toMatchObject({ error: 'timeout', retryable: true })
    h.service.setActiveProvider('elevenlabs')
    const retry = h.service.start('chat-project', first.sessionId)
    await vi.waitFor(() => expect(h.results).toHaveLength(2))
    await h.service.audio(retry.sessionId as string, wav())
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(h.mockAdapter.transcribe).not.toHaveBeenCalled()
    expect(h.results[1]).toMatchObject({
      outcome: 'success',
      chatId: 'chat-project',
      providerId: 'openwhispr-cloud',
    })
  })

  it('ignores cancelled late Cloud results and duplicate audio events without post-processing or redelivery', async () => {
    const h = cloudHarness()
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    h.service.postProcessingSetSettings({ mode: 'external_llm', level: 'light' })
    let resolve!: (value: Response) => void
    h.fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const first = h.service.start('chat-project', null)
    const pending = h.service.audio(first.sessionId as string, wav())
    await h.service.audio(first.sessionId as string, wav())
    expect(h.fetch).toHaveBeenCalledOnce()
    h.service.setActiveProvider('elevenlabs')
    h.service.cancel(first.sessionId as string)
    resolve(new Response(JSON.stringify({ data: { text: 'late private text' } })))
    await pending
    expect(h.results).toHaveLength(1)
    expect(h.results[0]).toMatchObject({
      outcome: 'cancelled',
      text: '',
      providerId: 'openwhispr-cloud',
      chatId: 'chat-project',
    })
    expect(recordings(h.directory)).toEqual([])
    expect(h.service.start('chat-next', null).sessionId).toEqual(expect.any(String))
  })

  it.each([
    ['plan_required', 403, 'plan-required'],
    ['forbidden', 403, 'forbidden'],
    ['validation_error', 400, 'audio-rejected'],
    ['payload_too_large', 413, 'audio-too-large'],
    ['concurrency_limit', 409, 'concurrency-limit'],
    ['quota_exceeded', 429, 'quota-exceeded'],
    ['rate_limited', 429, 'rate-limited'],
    ['service_unavailable', 503, 'service-unavailable'],
  ] as const)('settles %s with a typed safe result', async (code, status, error) => {
    const h = cloudHarness()
    h.service.providersSetConfig('openwhispr-cloud', cloudConfig)
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: `private ${cloudConfig.apiKey}` } }), {
        status,
      }),
    )
    await h.service.audio(h.service.start('chat-project', null).sessionId as string, wav())
    expect(h.results[0]).toMatchObject({
      outcome: 'failed',
      error,
      retryable: false,
      providerId: 'openwhispr-cloud',
    })
    expect(JSON.stringify(h.results)).not.toContain('private')
    expect(h.service.start('chat-project', null).sessionId).toEqual(expect.any(String))
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('manages provider configs with secret encryption at rest and masked metadata in renderer reads', async () => {
    const h = createTestHarness()

    // Initially not configured because apiKey is required
    const listInitial = h.service.providersList()
    expect(listInitial).toEqual([expect.objectContaining({ id: 'elevenlabs', configured: false })])

    // Save config with plaintext secret
    h.service.providersSetConfig('elevenlabs', { apiKey: 'xi-secret-key-42', language: 'en' })

    // Raw state in SQLite store must be encrypted with enc:v1:
    const rawState = h.state.get('dictation.providerConfig:elevenlabs')
    expect(rawState).toBeDefined()
    const parsed = JSON.parse(rawState as string)
    expect(parsed.apiKey).toMatch(/^enc:v1:/)
    expect(parsed.apiKey).not.toContain('xi-secret-key-42')
    expect(parsed.language).toBe('en')

    // providersGetConfig returns masked metadata for secret, never plaintext
    const configForRenderer = h.service.providersGetConfig('elevenlabs')
    expect(configForRenderer.apiKey).toEqual({
      configured: true,
      lastFour: 'y-42',
      valid: true,
    })
    expect(configForRenderer.language).toBe('en')

    // providersList now marks provider as configured
    const listConfigured = h.service.providersList()
    expect(listConfigured[0].configured).toBe(true)

    // Updating non-secret field preserves existing encrypted secret
    h.service.providersSetConfig('elevenlabs', { language: 'pl' })
    const configAfterUpdate = h.service.providersGetConfig('elevenlabs')
    expect(configAfterUpdate.language).toBe('pl')
    expect(configAfterUpdate.apiKey).toEqual({
      configured: true,
      lastFour: 'y-42',
      valid: true,
    })

    // Active provider management
    expect(h.service.getActiveProvider()).toBe('elevenlabs')
    h.service.setActiveProvider('elevenlabs')
    expect(() => h.service.setActiveProvider('non-existent')).toThrow('not found')
  })

  it('orchestrates transcription with active provider, passing decrypted secrets and dictionary keyterms', async () => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })

    const start = h.service.start('chat-project', null)
    expect(start.sessionId).toBeDefined()

    await h.service.audio(start.sessionId as string, wav())

    expect(h.mockAdapter.transcribe).toHaveBeenCalledOnce()
    const [request, config] = vi.mocked(h.mockAdapter.transcribe).mock.calls[0]
    expect(request.keyterms).toEqual(['NeKode', 'ElevenLabs'])
    expect(config.apiKey).toBe('my-api-key')

    expect(h.results).toHaveLength(1)
    expect(h.results[0]).toMatchObject({
      outcome: 'success',
      text: 'hello world from scribe',
      rawText: 'hello world from scribe',
      providerId: 'elevenlabs',
      modelId: 'scribe_v2',
    })
  })

  it('runs post-processing pipeline and diff validator fallback on violation', async () => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })

    // Enable native post-processing
    h.service.postProcessingSetSettings({ mode: 'provider_native', level: 'light' })

    // Adapter returns editedText that invalidly alters numbers (DiffValidator violation)
    vi.spyOn(h.mockAdapter, 'transcribe').mockResolvedValueOnce({
      text: 'Deploy 5 instances now',
      rawText: 'Deploy 3 instances now',
      editedText: 'Deploy 5 instances now',
      providerId: 'elevenlabs',
      modelId: 'scribe_v2',
    })

    const start = h.service.start('chat-alpha', null)
    await h.service.audio(start.sessionId as string, wav())

    expect(h.results).toHaveLength(1)
    // Diff validator must reject the edit and fall back to rawText with warning
    expect(h.results[0]).toMatchObject({
      outcome: 'success',
      text: 'Deploy 3 instances now',
      rawText: 'Deploy 3 instances now',
      warning: 'post-processing-rejected',
    })
  })

  it('aborts in-flight transcription signal on cancellation', async () => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })

    let abortObserved = false
    vi.spyOn(h.mockAdapter, 'transcribe').mockImplementation(async (req) => {
      req.signal?.addEventListener('abort', () => {
        abortObserved = true
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      return {
        text: 'done',
        rawText: 'done',
        providerId: 'elevenlabs',
      }
    })

    const start = h.service.start('chat-alpha', null)
    const audioPromise = h.service.audio(start.sessionId as string, wav())
    h.service.cancel(start.sessionId as string)
    await audioPromise

    expect(abortObserved).toBe(true)
    expect(h.results).toHaveLength(1)
    expect(h.results[0].outcome).toBe('cancelled')
  })

  it('delegates dictionary CRUD operations and post-processing settings', async () => {
    const h = createTestHarness()

    h.service.dictionaryList('p1')
    expect(h.dictService.list).toHaveBeenCalledWith({ projectId: 'p1' })

    h.service.dictionaryAdd({ term: 'Vitest', scope: 'global' })
    expect(h.dictService.add).toHaveBeenCalledWith({ term: 'Vitest', scope: 'global' })

    h.service.dictionaryUpdate('id-1', { term: 'Vitest2' })
    expect(h.dictService.update).toHaveBeenCalledWith('id-1', { term: 'Vitest2' })

    h.service.dictionaryDelete('id-1')
    expect(h.dictService.delete).toHaveBeenCalledWith('id-1')

    h.service.dictionaryToggle('id-1', false)
    expect(h.dictService.toggle).toHaveBeenCalledWith('id-1', false)

    // Post processing settings
    h.service.postProcessingSetSettings({
      mode: 'external_llm',
      level: 'medium',
      model: 'anthropic/claude-3.5-haiku',
      apiKey: 'sk-or-test-key',
    })
    const pp = h.service.postProcessingGetSettings()
    expect(pp).toEqual({
      mode: 'external_llm',
      level: 'medium',
      model: 'anthropic/claude-3.5-haiku',
      hasApiKey: true,
    })
  })

  it('controls nativeEditInstruction based on post-processing mode and provider capability', async () => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })

    // Case 1: mode is 'disabled' -> nativeEditInstruction must be empty string '' (suppressing fallback)
    h.service.postProcessingSetSettings({ mode: 'disabled', level: 'medium' })
    const start1 = h.service.start('chat-alpha', null)
    await h.service.audio(start1.sessionId as string, wav())
    expect(h.mockAdapter.transcribe).toHaveBeenCalled()
    expect(vi.mocked(h.mockAdapter.transcribe).mock.calls.at(-1)?.[0].nativeEditInstruction).toBe(
      '',
    )

    // Case 2: mode is 'provider_native' with no custom prompt -> defaults to 'Format and punctuate transcript.'
    h.service.postProcessingSetSettings({ mode: 'provider_native', level: 'medium' })
    const start2 = h.service.start('chat-alpha', null)
    await h.service.audio(start2.sessionId as string, wav())
    expect(vi.mocked(h.mockAdapter.transcribe).mock.calls.at(-1)?.[0].nativeEditInstruction).toBe(
      'Format and punctuate transcript.',
    )

    // Case 3: mode is 'provider_native' with custom prompt -> uses custom prompt
    h.service.providersSetConfig('elevenlabs', {
      apiKey: 'my-api-key',
      nativeEditPrompt: 'Custom prompt instructions.',
    })
    const start3 = h.service.start('chat-alpha', null)
    await h.service.audio(start3.sessionId as string, wav())
    expect(vi.mocked(h.mockAdapter.transcribe).mock.calls.at(-1)?.[0].nativeEditInstruction).toBe(
      'Custom prompt instructions.',
    )
  })

  it('providersGetConfig constructs a fresh object filtering out undeclared or obsolete stored state keys', () => {
    const h = createTestHarness()
    h.store.set(
      'dictation.providerConfig:elevenlabs',
      JSON.stringify({
        apiKey: 'enc:v1:fake_cipher',
        language: 'en',
        obsoleteField: 'old_value',
        undeclaredSecret: 'leak_candidate',
      }),
    )

    const result = h.service.providersGetConfig('elevenlabs')
    expect(result).toHaveProperty('apiKey')
    expect(result).toHaveProperty('language', 'en')
    expect(result).not.toHaveProperty('obsoleteField')
    expect(result).not.toHaveProperty('undeclaredSecret')
    expect(Object.keys(result)).toEqual(['apiKey', 'language'])
  })

  it.each([
    ['HTTP 401 Unauthorized', '401 Unauthorized'],
    ['403 Forbidden', 'Request failed with status code 403'],
    ['Unauthorized', 'Unauthorized API call'],
  ])('maps %s errors to auth-failed', async (_label, errorMsg) => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })
    vi.spyOn(h.mockAdapter, 'transcribe').mockRejectedValueOnce(new Error(errorMsg))

    const start = h.service.start('chat-alpha', null)
    await h.service.audio(start.sessionId as string, wav())

    expect(h.results).toHaveLength(1)
    expect(h.results[0]).toMatchObject({
      outcome: 'failed',
      error: 'auth-failed',
    })
  })

  it.each(['401', '403'])(
    'yields recording-failure and not auth-failed when filesystem write fails on path containing %s',
    async (code) => {
      const customRoot = mkdtempSync(join(tmpdir(), `nekode-dictation-test-${code}-`))
      const h = createTestHarness(customRoot)
      rmSync(h.directory, { recursive: true, force: true })

      const start = h.service.start('chat-alpha', null)
      await h.service.audio(start.sessionId as string, wav())

      expect(h.results).toHaveLength(1)
      expect(h.results[0]).toMatchObject({
        outcome: 'failed',
        error: 'recording-failure',
      })
      expect(h.results[0].error).not.toBe('auth-failed')
    },
  )

  it('does not map non-auth error messages containing 401 or 403 as substrings to auth-failed', async () => {
    const h = createTestHarness()
    h.service.providersSetConfig('elevenlabs', { apiKey: 'my-api-key' })
    vi.spyOn(h.mockAdapter, 'transcribe').mockRejectedValueOnce(
      new Error('Connection failed on port 4010 with error code 4030'),
    )

    const start = h.service.start('chat-alpha', null)
    await h.service.audio(start.sessionId as string, wav())

    expect(h.results).toHaveLength(1)
    expect(h.results[0].error).toBe('recording-failure')
    expect(h.results[0].error).not.toBe('auth-failed')
  })
})
