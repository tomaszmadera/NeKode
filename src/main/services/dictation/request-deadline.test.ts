import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElevenLabsAdapter } from './adapters/elevenlabs-adapter'
import { LocalOpenAiAdapter } from './adapters/local-openai-adapter'
import { OpenRouterAdapter } from './adapters/openrouter-adapter'
import { PostProcessor } from './post-processing/post-processor'

afterEach(() => vi.useRealTimers())

describe('dictation request deadlines', () => {
  it.each([ElevenLabsAdapter, OpenRouterAdapter, LocalOpenAiAdapter])(
    'aborts and settles a stalled connection for %s',
    async (Adapter) => {
      vi.useFakeTimers()
      let signal: AbortSignal | null | undefined
      const fetch = vi.fn((_url: unknown, init?: RequestInit) => {
        signal = init?.signal
        return new Promise<Response>(() => {})
      }) as unknown as typeof globalThis.fetch
      const adapter = new Adapter({ fetch })
      const pending = adapter.testConnection({ apiKey: 'test' })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(signal?.aborted).toBe(true)
      expect((await pending).ok).toBe(false)
    },
  )

  it.each([ElevenLabsAdapter, OpenRouterAdapter, LocalOpenAiAdapter])(
    'times out a stalled transcription body and permits a later request for %s',
    async (Adapter) => {
      vi.useFakeTimers()
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'recovered' }) })
      const adapter = new Adapter({ fetch })
      const request = { audioWav: new ArrayBuffer(1) }
      const pending = adapter.transcribe(request, { apiKey: 'test' })
      const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(120_000)
      await rejection
      expect((await adapter.transcribe(request, { apiKey: 'test' })).text).toBe('recovered')
    },
  )

  it.each([OpenRouterAdapter, LocalOpenAiAdapter])(
    'bounds stalled model discovery for %s',
    async (Adapter) => {
      vi.useFakeTimers()
      const fetch = vi.fn(async () => ({
        ok: true,
        json: () => new Promise(() => {}),
      })) as unknown as typeof globalThis.fetch
      const pending = new Adapter({ fetch }).discoverModels({ apiKey: 'test' })
      const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(120_000)
      await rejection
    },
  )

  it('settles a transcription when its caller cancels', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch
    const controller = new AbortController()
    const pending = new LocalOpenAiAdapter({ fetch }).transcribe(
      { audioWav: new ArrayBuffer(1), signal: controller.signal },
      {},
    )
    const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    controller.abort()
    await rejection
  })

  it('falls back after a stalled post-processing response body', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => ({
      ok: true,
      json: () => new Promise(() => {}),
    })) as unknown as typeof globalThis.fetch
    const processor = new PostProcessor({ fetch })
    const pending = processor.process({ rawText: 'hello', mode: 'external_llm', apiKey: 'test' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await pending).toMatchObject({ text: 'hello', warning: 'post-processing-failed' })
  })
})
