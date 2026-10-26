import { AppError } from '@shared/ipc-error'
import { describe, expect, it, vi } from 'vitest'
import { OpenRouterAdapter } from './openrouter-adapter'

function createFakeAudioWav(): ArrayBuffer {
  return new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]).buffer
}

describe('OpenRouterAdapter', () => {
  it('exposes manifest with STT capabilities and model discovery', () => {
    const adapter = new OpenRouterAdapter()
    expect(adapter.manifest.id).toBe('openrouter')
    expect(adapter.manifest.capabilities).toEqual({
      keyterms: false,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: true,
      timestamps: false,
    })
    const keys = adapter.manifest.configSchema.map((f) => f.key)
    expect(keys).toContain('apiKey')
    expect(keys).toContain('model')
    expect(keys).toContain('baseUrl')
  })

  describe('testConnection', () => {
    it('returns ok: false when apiKey is missing', async () => {
      const adapter = new OpenRouterAdapter()
      const result = await adapter.testConnection({})
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/API key/i)
    })

    it('validates key against /auth/key endpoint without consuming audio', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { label: 'My OpenRouter Key', usage: 0.12, limit: 10.0, is_free_tier: false },
        }),
      } as unknown as Response)

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ apiKey: 'sk-or-test-key' })

      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/Connected to OpenRouter/i)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/auth/key',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-or-test-key',
          }),
        }),
      )
    })

    it('returns ok: false when auth check fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      } as unknown as Response)

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ apiKey: 'bad-key' })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Invalid.*API key/i)
    })
  })

  describe('discoverModels', () => {
    it('queries /models and filters audio transcription models', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'openai/whisper-large-v3-turbo',
              name: 'Whisper Large v3 Turbo',
              architecture: {
                modality: 'audio->text',
                input_modalities: ['audio'],
                output_modalities: ['text'],
              },
            },
            {
              id: 'openai/gpt-4o',
              name: 'GPT-4o',
              architecture: {
                modality: 'text+image->text',
                input_modalities: ['text', 'image'],
                output_modalities: ['text'],
              },
            },
            {
              id: 'meta-llama/llama-3-8b-instruct',
              name: 'Llama 3 8B',
              architecture: {
                modality: 'text->text',
                input_modalities: ['text'],
                output_modalities: ['text'],
              },
            },
          ],
        }),
      } as unknown as Response)

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const models = await adapter.discoverModels({ apiKey: 'sk-or-test-key' })

      expect(models).toHaveLength(1)
      expect(models[0]).toEqual({
        id: 'openai/whisper-large-v3-turbo',
        name: 'Whisper Large v3 Turbo',
      })
    })
  })

  describe('transcribe', () => {
    it('sends base64 WAV payload to /audio/transcriptions endpoint and parses result', async () => {
      let capturedBody: string | null = null
      let capturedHeaders: Record<string, string> | null = null

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        capturedHeaders = init.headers as Record<string, string>
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Witaj świecie z OpenRouter',
          }),
        } as unknown as Response
      })

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const wav = createFakeAudioWav()
      const expectedBase64 = Buffer.from(wav).toString('base64')

      const result = await adapter.transcribe({ audioWav: wav }, { apiKey: 'sk-or-test-key' })

      expect(result.text).toBe('Witaj świecie z OpenRouter')
      expect(result.rawText).toBe('Witaj świecie z OpenRouter')
      expect(result.providerId).toBe('openrouter')
      expect(result.modelId).toBe('openai/whisper-large-v3-turbo')

      const headers = capturedHeaders as Record<string, string> | null
      expect(headers?.Authorization).toBe('Bearer sk-or-test-key')
      expect(headers?.['Content-Type']).toBe('application/json')

      expect(capturedBody).not.toBeNull()
      const parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.model).toBe('openai/whisper-large-v3-turbo')
      expect(parsed.input_audio).toEqual({
        data: expectedBase64,
        format: 'wav',
      })
    })

    it('uses custom model if requested or configured', async () => {
      let capturedBody: string | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: 'Custom model transcription' }),
        } as unknown as Response
      })

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })
      await adapter.transcribe(
        { audioWav: createFakeAudioWav(), model: 'openai/whisper-large-v3' },
        { apiKey: 'sk-key' },
      )

      expect(capturedBody).not.toBeNull()
      const parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.model).toBe('openai/whisper-large-v3')
    })

    it('includes language in request payload when specified and not auto/default', async () => {
      let capturedBody: string | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: 'Tekst po polsku' }),
        } as unknown as Response
      })

      const adapter = new OpenRouterAdapter({ fetch: mockFetch as unknown as typeof fetch })

      // Case 1: language in request
      const res1 = await adapter.transcribe(
        { audioWav: createFakeAudioWav(), language: 'pl' },
        { apiKey: 'sk-key' },
      )
      expect(capturedBody).not.toBeNull()
      let parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.language).toBe('pl')
      expect(res1.language).toBe('pl')

      // Case 2: language in config
      const res2 = await adapter.transcribe(
        { audioWav: createFakeAudioWav() },
        { apiKey: 'sk-key', language: 'de' },
      )
      parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.language).toBe('de')
      expect(res2.language).toBe('de')

      // Case 3: language is auto or default -> omitted from payload
      const res3 = await adapter.transcribe(
        { audioWav: createFakeAudioWav(), language: 'auto' },
        { apiKey: 'sk-key' },
      )
      parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.language).toBeUndefined()
      expect(res3.language).toBeUndefined()

      await adapter.transcribe(
        { audioWav: createFakeAudioWav(), language: 'default' },
        { apiKey: 'sk-key' },
      )
      parsed = JSON.parse(capturedBody ?? '{}')
      expect(parsed.language).toBeUndefined()
    })

    it('throws AppError on missing API key or transcription failure', async () => {
      const adapter = new OpenRouterAdapter()
      await expect(adapter.transcribe({ audioWav: createFakeAudioWav() }, {})).rejects.toThrowError(
        AppError,
      )

      const errorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        json: async () => ({ error: { message: 'Insufficient credits' } }),
      } as unknown as Response)

      const errorAdapter = new OpenRouterAdapter({ fetch: errorFetch as unknown as typeof fetch })
      await expect(
        errorAdapter.transcribe({ audioWav: createFakeAudioWav() }, { apiKey: 'key' }),
      ).rejects.toThrowError(AppError)
    })
  })
})
