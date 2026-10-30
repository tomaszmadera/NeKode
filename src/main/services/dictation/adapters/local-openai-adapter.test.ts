import { AppError } from '@shared/ipc-error'
import { describe, expect, it, vi } from 'vitest'
import { DICTATION_REQUEST_TIMEOUT_MS } from '../request-deadline'
import { LocalOpenAiAdapter } from './local-openai-adapter'

function createFakeAudioWav(): ArrayBuffer {
  return new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]).buffer
}

describe('LocalOpenAiAdapter', () => {
  it('exposes manifest with generic local endpoint configuration', () => {
    const adapter = new LocalOpenAiAdapter()
    expect(adapter.manifest.id).toBe('local-openai')
    expect(adapter.manifest.capabilities).toEqual({
      keyterms: false,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: true,
      timestamps: false,
    })
    const keys = adapter.manifest.configSchema.map((f) => f.key)
    expect(keys).toContain('baseUrl')
    expect(keys).toContain('model')
    expect(keys).toContain('apiKey')
  })

  describe('testConnection', () => {
    it('queries /models on the configured baseUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'whisper-1' }] }),
      } as unknown as Response)

      const adapter = new LocalOpenAiAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ baseUrl: 'http://localhost:8080/v1' })

      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/Connected.*localhost:8080/i)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/models',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('returns ok: false when endpoint is unreachable', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8080'))

      const adapter = new LocalOpenAiAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ baseUrl: 'http://127.0.0.1:8080/v1' })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/ECONNREFUSED/i)
    })
  })

  describe('discoverModels', () => {
    it('rejects when discovery times out and retains the fallback for other errors', async () => {
      vi.useFakeTimers()
      try {
        const fetch = vi
          .fn()
          .mockImplementationOnce(() => new Promise(() => {}))
          .mockRejectedValueOnce(new Error('offline'))
        const adapter = new LocalOpenAiAdapter({
          fetch: fetch as unknown as typeof globalThis.fetch,
        })
        const pending = adapter.discoverModels()
        const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })
        await vi.advanceTimersByTimeAsync(DICTATION_REQUEST_TIMEOUT_MS)
        await assertion
        expect(await adapter.discoverModels()).toEqual([{ id: 'whisper-1', name: 'whisper-1' }])
      } finally {
        vi.useRealTimers()
      }
    })
    it('returns models list from /models endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'whisper-1' }, { id: 'whisper-base' }, { id: 'whisper-medium' }],
        }),
      } as unknown as Response)

      const adapter = new LocalOpenAiAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const models = await adapter.discoverModels({ baseUrl: 'http://127.0.0.1:8080/v1' })

      expect(models).toEqual([
        { id: 'whisper-1', name: 'whisper-1' },
        { id: 'whisper-base', name: 'whisper-base' },
        { id: 'whisper-medium', name: 'whisper-medium' },
      ])
    })
  })

  describe('transcribe', () => {
    it('submits multipart form to /audio/transcriptions and parses response', async () => {
      let capturedBody: FormData | null = null
      let capturedUrl = ''

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url
        capturedBody = init.body as FormData
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Transkrypcja z lokalnego endpointu',
          }),
        } as unknown as Response
      })

      const adapter = new LocalOpenAiAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const wav = createFakeAudioWav()

      const result = await adapter.transcribe(
        { audioWav: wav, language: 'pl' },
        { baseUrl: 'http://127.0.0.1:9000/v1', model: 'whisper-medium' },
      )

      expect(result.text).toBe('Transkrypcja z lokalnego endpointu')
      expect(result.rawText).toBe('Transkrypcja z lokalnego endpointu')
      expect(result.providerId).toBe('local-openai')
      expect(result.modelId).toBe('whisper-medium')

      expect(capturedUrl).toBe('http://127.0.0.1:9000/v1/audio/transcriptions')
      expect(capturedBody).not.toBeNull()
      const body = capturedBody as unknown as FormData
      expect(body.get('model')).toBe('whisper-medium')
      expect(body.get('language')).toBe('pl')
      expect(body.get('file')).toBeInstanceOf(Blob)
    })

    it('throws AppError when request fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Model failed' }),
      } as unknown as Response)

      const adapter = new LocalOpenAiAdapter({ fetch: mockFetch as unknown as typeof fetch })
      await expect(adapter.transcribe({ audioWav: createFakeAudioWav() }, {})).rejects.toThrowError(
        AppError,
      )

      const objectErrorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: { message: 'Audio format not supported', type: 'invalid_request' },
        }),
      } as unknown as Response)

      const objectAdapter = new LocalOpenAiAdapter({
        fetch: objectErrorFetch as unknown as typeof fetch,
      })
      await expect(
        objectAdapter.transcribe({ audioWav: createFakeAudioWav() }, {}),
      ).rejects.toThrowError('Audio format not supported')
    })
  })
})
