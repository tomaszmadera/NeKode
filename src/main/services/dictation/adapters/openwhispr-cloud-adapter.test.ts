import type { DictationError } from '@shared/dictation-contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationProviderError } from './dictation-provider-error'
import { OPENWHISPR_CLOUD_MAX_BYTES, OpenWhisprCloudAdapter } from './openwhispr-cloud-adapter'

const config = { apiKey: 'owk_live_test_personal_key', language: 'pl', cloudUploadEnabled: true }
const audioWav = new ArrayBuffer(44)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const transcript = {
  data: { text: 'NeKode nk', language: 'pl', duration_ms: 1200, model: 'engine' },
}
const harness = () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(transcript))
  return { fetch, adapter: new OpenWhisprCloudAdapter({ fetch }) }
}
afterEach(() => vi.useRealTimers())

describe('OpenWhispr Cloud adapter', () => {
  it('advertises explicit permission, supported language choices and the beta limits', () => {
    const { adapter } = harness()
    expect(adapter.manifest.capabilities).toEqual({
      keyterms: true,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: false,
      timestamps: false,
    })
    expect(adapter.manifest.configSchema.map((field) => field.key)).toEqual([
      'apiKey',
      'language',
      'cloudUploadEnabled',
    ])
    expect(
      adapter.manifest.configSchema.find((field) => field.key === 'cloudUploadEnabled'),
    ).toMatchObject({ defaultValue: false, required: true })
    expect(adapter.manifest.description).toContain('600 minutes')
  })

  it.each(['pl', 'auto'])(
    'uploads only documented fields for %s and preserves the raw transcript',
    async (language) => {
      const { fetch, adapter } = harness()
      const result = await adapter.transcribe(
        { audioWav, keyterms: ['NeKode', 'nk', '', ' NeKode ', 'nk'] },
        { ...config, language },
      )
      expect(fetch).toHaveBeenCalledOnce()
      const [url, init] = fetch.mock.calls[0]
      expect(url).toBe('https://api.openwhispr.com/api/v1/transcribe')
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      expect(init?.headers).not.toHaveProperty('Content-Type')
      const form = init?.body as FormData
      expect([...form.keys()]).toEqual(
        language === 'auto' ? ['file', 'prompt'] : ['file', 'language', 'prompt'],
      )
      expect(form.get('language')).toBe(language === 'auto' ? null : 'pl')
      expect(form.get('prompt')).toBe('NeKode, nk')
      const file = form.get('file') as File
      expect(file.type).toBe('audio/wav')
      expect(file.name).toBe('audio.wav')
      expect(await file.arrayBuffer()).toEqual(audioWav)
      expect(result).toEqual({
        text: 'NeKode nk',
        rawText: 'NeKode nk',
        providerId: 'openwhispr-cloud',
        modelId: 'engine',
        language: 'pl',
        durationMs: 1200,
      })
    },
  )

  it.each([
    [{ ...config, cloudUploadEnabled: false }, 'cloud-consent-required'],
    [{ ...config, cloudUploadEnabled: undefined }, 'cloud-consent-required'],
    [{ ...config, apiKey: '' }, 'auth-failed'],
    [{ ...config, apiKey: 'workspace_key' }, 'auth-failed'],
    [{ ...config, apiKey: 'owk_live_key\r\ninjected' }, 'auth-failed'],
    [{ ...config, language: 'invalid' }, 'audio-rejected'],
  ] as const)('blocks unready configuration without an upload', async (settings, error) => {
    const { fetch, adapter } = harness()
    await expect(adapter.transcribe({ audioWav }, settings)).rejects.toMatchObject({ error })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the exact byte boundary and rejects oversize locally', async () => {
    const { fetch, adapter } = harness()
    await expect(
      adapter.transcribe({ audioWav: new ArrayBuffer(OPENWHISPR_CLOUD_MAX_BYTES + 1) }, config),
    ).rejects.toMatchObject({ error: 'audio-too-large' })
    expect(fetch).not.toHaveBeenCalled()
    await adapter.transcribe({ audioWav: new ArrayBuffer(OPENWHISPR_CLOUD_MAX_BYTES) }, config)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    [401, 'unauthorized', 'auth-failed'],
    [403, 'plan_required', 'plan-required'],
    [403, 'forbidden', 'forbidden'],
    [400, 'validation_error', 'audio-rejected'],
    [413, 'payload_too_large', 'audio-too-large'],
    [409, 'concurrency_limit', 'concurrency-limit'],
    [429, 'quota_exceeded', 'quota-exceeded'],
    [429, 'rate_limited', 'rate-limited'],
    [503, 'service_unavailable', 'service-unavailable'],
    [500, 'unknown', 'provider-failure'],
    [200, 'quota_exceeded', 'malformed-response'],
    [500, 'plan_required', 'provider-failure'],
  ] satisfies Array<[number, string, DictationError]>)(
    'normalizes HTTP %s %s without forwarding remote messages',
    async (status, code, error) => {
      const { fetch, adapter } = harness()
      fetch.mockResolvedValue(
        json({ error: { code, message: `private ${config.apiKey}` } }, status),
      )
      await expect(adapter.transcribe({ audioWav }, config)).rejects.toEqual(
        new DictationProviderError(error),
      )
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

  it.each([null, [], {}, { data: [] }, { data: {} }, { data: { text: 3 } }])(
    'rejects malformed successful envelopes',
    async (body) => {
      const { fetch, adapter } = harness()
      fetch.mockResolvedValue(json(body))
      await expect(adapter.transcribe({ audioWav }, config)).rejects.toMatchObject({
        error: 'malformed-response',
      })
    },
  )

  it('preserves an explicitly empty transcript and ignores invalid optional metadata', async () => {
    const { fetch, adapter } = harness()
    fetch.mockResolvedValue(
      json({ data: { text: '', model: {}, language: null, duration_ms: -1, words: 123 } }),
    )
    expect(await adapter.transcribe({ audioWav }, config)).toMatchObject({
      text: '',
      rawText: '',
      language: undefined,
      durationMs: undefined,
      modelId: undefined,
    })
  })

  it('handles invalid JSON and thrown transport errors without leaking their text', async () => {
    const { fetch, adapter } = harness()
    fetch.mockResolvedValueOnce(new Response('private invalid body'))
    await expect(adapter.transcribe({ audioWav }, config)).rejects.toEqual(
      new DictationProviderError('malformed-response'),
    )
    fetch.mockRejectedValueOnce(new Error(`private ${config.apiKey}`))
    await expect(adapter.transcribe({ audioWav }, config)).rejects.toEqual(
      new DictationProviderError('unreachable'),
    )
  })

  it('checks only scope and paid plan via metadata even without upload permission', async () => {
    const { fetch, adapter } = harness()
    fetch
      .mockResolvedValueOnce(
        json({ data: { scopes: ['transcriptions:write'], user_id: 'private-account' } }),
      )
      .mockResolvedValueOnce(json({ data: { plan: 'business', monthly_minutes: 'private-usage' } }))
    const result = await adapter.testConnection({ ...config, cloudUploadEnabled: false })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/private/)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openwhispr.com/api/v1/me',
      'https://api.openwhispr.com/api/v1/usage',
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
      expect(init?.body).toBeUndefined()
    }
  })

  it.each([
    [{ data: { scopes: [] } }, { data: { plan: 'pro' } }, 'forbidden', 1],
    [{ data: { scopes: 'transcriptions:write' } }, {}, 'malformed-response', 1],
    [
      { data: { scopes: ['transcriptions:write'] } },
      { data: { plan: 'free' } },
      'plan-required',
      2,
    ],
    [{ data: { scopes: ['transcriptions:write'] } }, { plan: 'pro' }, 'malformed-response', 2],
  ])('rejects insufficient or malformed metadata safely', async (me, usage, error, count) => {
    const { fetch, adapter } = harness()
    fetch.mockResolvedValueOnce(json(me)).mockResolvedValueOnce(json(usage))
    expect(await adapter.testConnection(config)).toMatchObject({
      ok: false,
      message: expect.stringContaining(error as string),
    })
    expect(fetch).toHaveBeenCalledTimes(count as number)
  })

  it.each([
    '',
    'owk_workspace_example',
    'owk_live_key\nsecret',
    'owk_live_key\n',
    'owk_live_key\r',
    'enc:v1:injected',
  ])('rejects invalid personal keys locally', async (apiKey) => {
    const { fetch, adapter } = harness()
    expect((await adapter.testConnection({ apiKey })).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not call fetch when already aborted', async () => {
    const { fetch, adapter } = harness()
    const abort = new AbortController()
    abort.abort()
    await expect(
      adapter.transcribe({ audioWav, signal: abort.signal }, config),
    ).rejects.toMatchObject({ error: 'timeout' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['caller', 'timeout', 'body'] as const)(
    'aborts and cleans up during %s',
    async (mode) => {
      vi.useFakeTimers()
      const { fetch, adapter } = harness()
      const abort = new AbortController()
      if (mode === 'body') {
        fetch.mockImplementation(
          async (_url, init) =>
            ({
              ok: true,
              json: () =>
                new Promise((_resolve, reject) =>
                  init?.signal?.addEventListener('abort', () =>
                    reject(new Error('private body failure')),
                  ),
                ),
            }) as Response,
        )
      } else {
        fetch.mockImplementation(
          (_url, init) =>
            new Promise((_resolve, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('private fetch failure')),
              ),
            ),
        )
      }
      const pending = adapter.transcribe({ audioWav, signal: abort.signal }, config)
      const assertion = expect(pending).rejects.toMatchObject({ error: 'timeout' })
      await Promise.resolve()
      if (mode === 'timeout') await vi.advanceTimersByTimeAsync(30_000)
      else abort.abort()
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('bounds the entire metadata check to ten seconds and clears its timers', async () => {
    vi.useFakeTimers()
    const { fetch, adapter } = harness()
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('private timeout'))),
        ),
    )
    const pending = adapter.testConnection(config)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('timeout') })
    expect(vi.getTimerCount()).toBe(0)
  })
})
