import { APP_STATE_KEY } from '@shared/ipc-contract'
import { describe, expect, it, vi } from 'vitest'
import { OpenWhisprClient, parseBridgeConfig } from './openwhispr-client'

const TOKEN = 'private-test-token'
const config = JSON.stringify({ version: 1, port: 43210, token: TOKEN })
const model = {
  provider: 'unknown-provider',
  model: 'custom-model',
  downloaded: true,
  default: true,
}

function harness(responses: Array<Response | Error>, initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const state = {
    get: (key: string) => values.get(key) ?? null,
    set: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  const readBridgeFile = vi.fn(async () => config)
  const fetch = vi.fn(async (_url?: unknown, _options?: RequestInit) => {
    const response = responses.shift()
    if (response instanceof Error) throw response
    if (!response) throw new Error('Unexpected request')
    return response
  })
  const client = new OpenWhisprClient({
    state,
    fetch,
    readBridgeFile,
    now: () => new Date('2026-10-10T15:00:00Z'),
  })
  return { client, fetch, readBridgeFile, state, values }
}

describe('bridge config parser', () => {
  it('accepts v1 without exposing extra bridge fields', () => {
    expect(parseBridgeConfig(config)).toEqual({
      state: 'ready',
      config: { port: 43210, token: TOKEN },
    })
  })
  it.each([
    'bad json',
    '{}',
    'null',
    '[]',
    ...[0, 65536, 1.5, '8200', null].map((port) =>
      JSON.stringify({ version: 1, port, token: TOKEN }),
    ),
    ...['', ' ', 42, null].map((token) => JSON.stringify({ version: 1, port: 80, token })),
    JSON.stringify({ version: 2, port: 80, token: TOKEN }),
  ])('rejects invalid configuration: %s', (raw) => {
    expect(parseBridgeConfig(raw)).toEqual({ state: 'bridge-invalid' })
  })
})

describe('OpenWhispr bridge foundation', () => {
  it('reads raw dictionary strings without health, models or persistence writes', async () => {
    const terms = [' NeKode ', '<b>raw</b>', ' NeKode ']
    const h = harness([Response.json({ data: terms, has_more: false, next_cursor: null })])
    const before = h.client.status()
    expect(await h.client.dictionaryList()).toEqual({
      state: 'ready',
      terms,
    })
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:43210/v1/dictionary/list',
      expect.objectContaining({ redirect: 'error', headers: { Authorization: `Bearer ${TOKEN}` } }),
    )
    expect(h.client.status()).toEqual(before)
    expect(h.state.set).not.toHaveBeenCalled()
  })
  it('distinguishes an empty dictionary from an unavailable response', async () => {
    const h = harness([Response.json({ data: [], has_more: false, next_cursor: null })])
    expect(await h.client.dictionaryList()).toEqual({ state: 'ready', terms: [] })
  })
  it.each([
    null,
    [],
    {},
    { data: [] },
    { data: [{}], has_more: false, next_cursor: null },
    { data: ['first'], has_more: 'false', next_cursor: null },
    { data: ['first'], has_more: false },
    { data: ['first'], has_more: false, next_cursor: 'unexpected' },
    { data: ['first'], has_more: true, next_cursor: null },
    { data: ['first'], has_more: true, next_cursor: '' },
    { data: ['first'], has_more: true, next_cursor: 1 },
  ])('fails closed on a malformed dictionary envelope: %j', async (page) => {
    const h = harness([Response.json(page)])
    expect(await h.client.dictionaryList()).toEqual({
      state: 'unavailable',
      error: 'malformed-response',
    })
    expect(h.fetch).toHaveBeenCalledOnce()
  })
  it('rejects invalid JSON rather than presenting an empty dictionary', async () => {
    const h = harness([new Response('{')])
    expect(await h.client.dictionaryList()).toEqual({
      state: 'unavailable',
      error: 'malformed-response',
    })
  })
  it('never treats an unsupported additional page as a complete or empty dictionary', async () => {
    for (const data of [['first'], []]) {
      const h = harness([Response.json({ data, has_more: true, next_cursor: 'cursor-with-/?&' })])
      expect(await h.client.dictionaryList()).toEqual({
        state: 'unavailable',
        error: 'unsupported-pagination',
      })
      expect(h.fetch).toHaveBeenCalledOnce()
    }
  })
  it('reports excessive dictionary size without a partial-success result', async () => {
    const h = harness([
      Response.json({ data: Array(10_001).fill('term'), has_more: false, next_cursor: null }),
    ])
    expect(await h.client.dictionaryList()).toEqual({
      state: 'unavailable',
      error: 'dictionary-limit',
    })
  })
  it('accepts exactly 10,000 dictionary entries without truncating or deduplicating', async () => {
    const terms = Array.from({ length: 10_000 }, (_, index) => `term ${index % 500}`)
    const h = harness([Response.json({ data: terms, has_more: false, next_cursor: null })])
    expect(await h.client.dictionaryList()).toEqual({ state: 'ready', terms })
    expect(h.fetch).toHaveBeenCalledOnce()
  })
  it('bounds dictionary timeouts to two attempts and leaves status and settings unchanged', async () => {
    vi.useFakeTimers()
    try {
      const h = harness([])
      const before = h.client.status()
      h.fetch.mockImplementation(
        async (_url?: unknown, options?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            options?.signal?.addEventListener('abort', () => reject(new Error(TOKEN))),
          ),
      )
      const result = h.client.dictionaryList()
      await vi.advanceTimersByTimeAsync(3000)
      expect(await result).toEqual({ state: 'unavailable', error: 'unreachable' })
      expect(h.fetch).toHaveBeenCalledTimes(2)
      expect(h.readBridgeFile).toHaveBeenCalledTimes(2)
      expect(h.client.status()).toEqual(before)
      expect(h.state.set).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it.each(['missing', 'invalid'] as const)(
    'reports %s bridge discovery without network or settings writes',
    async (kind) => {
      const h = harness([])
      if (kind === 'missing')
        h.readBridgeFile.mockRejectedValue(
          Object.assign(new Error('private path'), { code: 'ENOENT' }),
        )
      else h.readBridgeFile.mockResolvedValue('invalid')
      expect(await h.client.dictionaryList()).toEqual({
        state: 'unavailable',
        error: kind === 'missing' ? 'bridge-missing' : 'bridge-invalid',
      })
      expect(h.fetch).not.toHaveBeenCalled()
      expect(h.state.set).not.toHaveBeenCalled()
    },
  )
  it.each([401, 403, 500, 'network'] as const)(
    'reports dictionary transport failure %s without leaking detail',
    async (status) => {
      const response = () =>
        status === 'network'
          ? new Error(`private ${TOKEN}`)
          : new Response(`private ${TOKEN}`, { status })
      const h = harness([response(), response()])
      expect(await h.client.dictionaryList()).toEqual({
        state: 'unavailable',
        error: status === 401 || status === 403 ? 'auth-failed' : 'unreachable',
      })
      expect(h.fetch).toHaveBeenCalledTimes(2)
      expect(h.readBridgeFile).toHaveBeenCalledTimes(2)
      expect(h.state.set).not.toHaveBeenCalled()
    },
  )
  it('rediscovers a rotated bridge for one bounded retry', async () => {
    const h = harness([
      new Response(null, { status: 401 }),
      Response.json({ data: ['term'], has_more: false, next_cursor: null }),
    ])
    h.readBridgeFile
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(JSON.stringify({ version: 1, port: 43211, token: 'rotated' }))
    expect(await h.client.dictionaryList()).toEqual({ state: 'ready', terms: ['term'] })
    expect(h.fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:43211/v1/dictionary/list',
      expect.objectContaining({ headers: { Authorization: 'Bearer rotated' } }),
    )
  })
  it.each(['health', 'malformed catalog'])(
    'preserves the captured explicit model after a %s check',
    async (check) => {
      const explicit = { ...model, model: 'explicit-model', default: false }
      const h = harness([
        new Response(null),
        Response.json({ data: [model, explicit] }),
        new Response(null),
        ...(check === 'malformed catalog' ? [Response.json({ data: [{}] })] : []),
        Response.json({
          data: { text: 'hello', provider: explicit.provider, model: explicit.model },
        }),
      ])
      await h.client.refreshModels()
      const captured = h.client.setSettings({
        ...h.client.getSettings(),
        model: { provider: explicit.provider, model: explicit.model },
      })
      h.client.setSettings({ ...captured, model: 'default' })
      const snapshot = await (check === 'health'
        ? h.client.testConnection()
        : h.client.refreshModels())
      expect(snapshot.state).toBe('connected')
      expect(snapshot.models).toEqual([])
      expect(
        await h.client.transcribe('C:\\temp\\take.wav', captured, new AbortController().signal),
      ).toMatchObject({ text: 'hello', error: null })
      expect(JSON.parse(h.fetch.mock.calls.at(-1)?.[1]?.body as string)).toEqual({
        path: 'C:\\temp\\take.wav',
        model: explicit.model,
      })
    },
  )
  it('resolves fallback from the take settings after the user changes the selection', async () => {
    const h = harness(
      [
        new Response(null),
        Response.json({ data: [model] }),
        Response.json({ data: { text: 'hello', provider: model.provider, model: model.model } }),
      ],
      {
        [APP_STATE_KEY.dictationModel]: JSON.stringify({ provider: 'removed', model: 'gone' }),
      },
    )
    await h.client.refreshModels()
    const takeSettings = h.client.getSettings()
    h.client.setSettings({ ...takeSettings, model: 'default' })
    expect(
      await h.client.transcribe('C:\\temp\\take.wav', takeSettings, new AbortController().signal),
    ).toMatchObject({ text: 'hello', error: null })
    expect(JSON.parse(h.fetch.mock.calls.at(-1)?.[1]?.body as string)).toEqual({
      path: 'C:\\temp\\take.wav',
    })
  })
  it.each(['hello', ''])(
    'validates transcription and preserves warning with text %s',
    async (text) => {
      const { client, fetch } = harness([
        Response.json({ data: { text, provider: 'whisper', model: 'tiny', warning: 'hint' } }),
      ])
      expect(
        await client.transcribe(
          'C:\\temp\\take.wav',
          client.getSettings(),
          new AbortController().signal,
        ),
      ).toEqual({ text, warning: 'hint', error: null })
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:43210/v1/transcribe',
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          body: JSON.stringify({ path: 'C:\\temp\\take.wav' }),
        }),
      )
    },
  )
  it.each([
    {},
    { data: {} },
    { data: { text: 1, provider: 'x', model: 'y' } },
    { data: { text: 'x', provider: 'x', model: 'y', warning: 1 } },
  ])('normalizes malformed transcription', async (data) => {
    const { client } = harness([Response.json(data)])
    expect(
      await client.transcribe(
        'C:\\temp\\take.wav',
        client.getSettings(),
        new AbortController().signal,
      ),
    ).toMatchObject({ error: 'malformed-response' })
  })
  it('uses bare model identity with language and rejects a provider collision', async () => {
    const { client, fetch } = harness([
      new Response(null),
      Response.json({ data: [model] }),
      Response.json({ data: { text: 'x', provider: model.provider, model: model.model } }),
    ])
    await client.refreshModels()
    const settings = client.setSettings({
      ...client.getSettings(),
      language: 'pl',
      model: { provider: model.provider, model: model.model },
    })
    await client.transcribe('C:\\temp\\take.wav', settings, new AbortController().signal)
    expect(JSON.parse(fetch.mock.calls.at(-1)?.[1]?.body as string)).toEqual({
      path: 'C:\\temp\\take.wav',
      language: 'pl',
      model: model.model,
    })
    const collision = harness(
      [new Response(null), Response.json({ data: [model, { ...model, provider: 'other' }] })],
      {
        [APP_STATE_KEY.dictationModel]: JSON.stringify({ provider: 'other', model: model.model }),
      },
    )
    expect((await collision.client.refreshModels()).state).toBe('model-available')
    expect(
      await collision.client.transcribe(
        'C:\\temp\\take.wav',
        collision.client.getSettings(),
        new AbortController().signal,
      ),
    ).toMatchObject({ error: 'no-model' })
    expect(collision.fetch).toHaveBeenCalledTimes(2)
  })
  it('rediscoveries transcription once on rotated auth, never after timeout or cancel', async () => {
    const h = harness([
      new Response(null, { status: 401 }),
      Response.json({ data: { text: 'x', provider: 'w', model: 't' } }),
    ])
    expect(
      await h.client.transcribe(
        'C:\\temp\\take.wav',
        h.client.getSettings(),
        new AbortController().signal,
      ),
    ).toMatchObject({ text: 'x' })
    expect(h.readBridgeFile).toHaveBeenCalledTimes(2)
    vi.useFakeTimers()
    try {
      const slow = harness([])
      slow.fetch.mockImplementation(() => new Promise(() => undefined))
      const result = slow.client.transcribe(
        'C:\\temp\\take.wav',
        { ...slow.client.getSettings(), timeoutSeconds: 5 },
        new AbortController().signal,
      )
      await vi.advanceTimersByTimeAsync(5000)
      expect(await result).toMatchObject({ error: 'timeout' })
      expect(slow.fetch).toHaveBeenCalledTimes(1)
      const aborted = new AbortController()
      const cancel = slow.client.transcribe(
        'C:\\temp\\take.wav',
        slow.client.getSettings(),
        aborted.signal,
      )
      aborted.abort()
      expect(await cancel).toMatchObject({ error: 'cancelled' })
    } finally {
      vi.useRealTimers()
    }
  })
  it('requires the bridge default to be downloaded for default and stale selections', async () => {
    for (const selection of ['default', { provider: 'removed', model: 'gone' }]) {
      const { client } = harness(
        [new Response(null), Response.json({ data: [{ ...model, default: false }] })],
        {
          [APP_STATE_KEY.dictationModel]: JSON.stringify(selection),
        },
      )
      expect((await client.refreshModels()).state).toBe('model-available')
    }
  })
  it('permits a downloaded explicit selection without an OpenWhispr default', async () => {
    const { client } = harness(
      [new Response(null), Response.json({ data: [{ ...model, default: false }] })],
      {
        [APP_STATE_KEY.dictationModel]: JSON.stringify({
          provider: model.provider,
          model: model.model,
        }),
      },
    )
    expect((await client.refreshModels()).state).toBe('operational')
  })
  it('health alone caps readiness at connected and confines auth to loopback', async () => {
    const { client, fetch, values } = harness([new Response(null, { status: 200 })])
    const snapshot = await client.testConnection()
    expect(snapshot).toMatchObject({
      state: 'connected',
      models: [],
      checkedAt: '2026-10-10T15:00:00.000Z',
      error: null,
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:43210/v1/health',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(JSON.stringify([snapshot, client.getSettings(), [...values]])).not.toContain(TOKEN)
    expect(JSON.parse(values.get(APP_STATE_KEY.dictationStatus) ?? '')).toEqual({
      state: 'connected',
      checkedAt: snapshot.checkedAt,
    })
  })
  it('reports missing and invalid bridge files without transport or raw errors', async () => {
    const { client, readBridgeFile, fetch } = harness([])
    readBridgeFile.mockRejectedValueOnce(Object.assign(new Error(TOKEN), { code: 'ENOENT' }))
    expect(await client.testConnection()).toMatchObject({ state: 'bridge-missing' })
    readBridgeFile.mockRejectedValueOnce(new Error(TOKEN))
    expect(await client.testConnection()).toMatchObject({ state: 'bridge-invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([401, 403])('rediscovers exactly once after auth failure %s', async (status) => {
    const { client, fetch, readBridgeFile } = harness([
      new Response(null, { status }),
      new Response(null, { status }),
    ])
    expect(await client.testConnection()).toMatchObject({ state: 'auth-failed' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(readBridgeFile).toHaveBeenCalledTimes(2)
  })
  it('uses the rotated port and token on the single retry', async () => {
    const { client, fetch, readBridgeFile } = harness([
      new Response(null, { status: 401 }),
      new Response(null, { status: 200 }),
    ])
    readBridgeFile
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(JSON.stringify({ version: 1, port: 49999, token: 'rotated-token' }))
    expect(await client.testConnection()).toMatchObject({ state: 'connected' })
    expect(fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:49999/v1/health',
      expect.objectContaining({ headers: { Authorization: 'Bearer rotated-token' } }),
    )
  })
  it('normalizes connection errors and HTTP errors with no raw details', async () => {
    const { client, readBridgeFile } = harness([
      new Error(TOKEN),
      new Response(null, { status: 500 }),
    ])
    const snapshot = await client.testConnection()
    expect(snapshot.state).toBe('unreachable')
    expect(readBridgeFile).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN)
  })
  it('bounds each health attempt to 1.5 seconds and stops after one retry', async () => {
    vi.useFakeTimers()
    try {
      const { client, fetch } = harness([])
      fetch.mockImplementation(
        async (_url?: unknown, options?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            options?.signal?.addEventListener('abort', () => reject(new Error(TOKEN))),
          ),
      )
      const result = client.testConnection()
      await vi.advanceTimersByTimeAsync(3000)
      expect(await result).toMatchObject({ state: 'unreachable' })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
  it('parses unknown downloaded models, projects out secrets, and enables the default selection', async () => {
    const { client } = harness([
      new Response(null),
      Response.json({
        data: [
          { ...model, token: TOKEN },
          { ...model, model: 'missing', downloaded: false },
        ],
      }),
    ])
    const snapshot = await client.refreshModels()
    expect(snapshot).toMatchObject({
      state: 'operational',
      models: [model, { ...model, model: 'missing', downloaded: false }],
      staleModelSelection: false,
    })
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN)
  })
  it('caps a catalog with zero downloaded models at connected', async () => {
    const { client } = harness([
      new Response(null),
      Response.json({ data: [{ ...model, downloaded: false }] }),
    ])
    expect(await client.refreshModels()).toMatchObject({ state: 'connected' })
  })
  it.each([{ data: [{}] }, { data: null }, {}, { data: [{ ...model, downloaded: 'yes' }] }])(
    'rejects malformed models without publishing partial catalog',
    async (payload) => {
      const { client, fetch } = harness([new Response(null), Response.json(payload)])
      expect(await client.refreshModels()).toMatchObject({
        state: 'connected',
        models: [],
        error: 'malformed-response',
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )
  it('marks stale selection operational through required default fallback', async () => {
    const { client } = harness([new Response(null), Response.json({ data: [model] })], {
      [APP_STATE_KEY.dictationModel]: JSON.stringify({ provider: 'removed', model: 'gone' }),
    })
    expect(await client.refreshModels()).toMatchObject({
      state: 'operational',
      staleModelSelection: true,
    })
    expect(client.getSettings().model).toEqual({ provider: 'removed', model: 'gone' })
  })
  it('health after a successful model refresh never reuses old readiness', async () => {
    const { client } = harness([
      new Response(null),
      Response.json({ data: [model] }),
      new Response(null),
    ])
    expect((await client.refreshModels()).state).toBe('operational')
    expect(await client.testConnection()).toMatchObject({ state: 'connected', models: [] })
  })
  it('retries a model request only once after rediscovery, preserving refreshed auth', async () => {
    const { client, readBridgeFile, fetch } = harness([
      new Response(null),
      new Response(null, { status: 401 }),
      new Response(null),
      Response.json({ data: [model] }),
    ])
    readBridgeFile
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(JSON.stringify({ version: 1, port: 48888, token: 'rotated' }))
    expect(await client.refreshModels()).toMatchObject({ state: 'operational' })
    expect(readBridgeFile).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:48888/v1/transcribe/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer rotated' } }),
    )
  })
  it('does not publish previous-process operational status as current readiness', () => {
    const { client } = harness([], {
      [APP_STATE_KEY.dictationStatus]: JSON.stringify({
        state: 'operational',
        checkedAt: '2026-10-09T12:00:00Z',
      }),
    })
    expect(client.status()).toMatchObject({
      state: 'unreachable',
      checkedAt: '2026-10-09T12:00:00Z',
      models: [],
    })
  })
  it('rejects new uninstalled model selections but lets other settings preserve a stale choice', async () => {
    const { client, state } = harness([new Response(null), Response.json({ data: [model] })], {
      [APP_STATE_KEY.dictationModel]: JSON.stringify({ provider: 'removed', model: 'gone' }),
    })
    await client.refreshModels()
    expect(
      client.setSettings({ ...client.getSettings(), enabled: true, language: 'pl' }).model,
    ).toEqual({ provider: 'removed', model: 'gone' })
    state.set.mockClear()
    expect(() =>
      client.setSettings({
        ...client.getSettings(),
        model: { provider: 'new', model: 'uninstalled' },
      }),
    ).toThrow('Choose a downloaded OpenWhispr model')
    expect(state.set).not.toHaveBeenCalled()
    expect(
      client.setSettings({
        ...client.getSettings(),
        model: { provider: model.provider, model: model.model },
      }).model,
    ).toEqual({ provider: model.provider, model: model.model })
    expect(client.status().staleModelSelection).toBe(false)
  })
  it('returns independent model snapshots instead of mutable client state', async () => {
    const { client } = harness([new Response(null), Response.json({ data: [model] })])
    const snapshot = await client.refreshModels()
    snapshot.models[0].downloaded = false
    snapshot.models.length = 0
    expect(client.status()).toMatchObject({ state: 'operational', models: [model] })
  })
})
