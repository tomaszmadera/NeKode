import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../../shared/ipc-error'
import { ElevenLabsAdapter } from './elevenlabs-adapter'

function createFakeAudioWav(): ArrayBuffer {
  // 100 bytes dummy WAV buffer
  return new Uint8Array(100).buffer
}

describe('ElevenLabsAdapter', () => {
  it('exposes manifest with Scribe v2 capabilities and config schema', () => {
    const adapter = new ElevenLabsAdapter()
    expect(adapter.manifest.id).toBe('elevenlabs')
    expect(adapter.manifest.capabilities).toEqual({
      keyterms: true,
      nativeEditing: true,
      languageSelection: true,
      modelDiscovery: false,
      timestamps: true,
    })
    const keys = adapter.manifest.configSchema.map((field) => field.key)
    expect(keys).toContain('apiKey')
    expect(keys).toContain('language')
    expect(keys).toContain('enableNativeEdit')
    expect(keys).toContain('nativeEditPrompt')
  })

  describe('testConnection', () => {
    it('returns ok: false when apiKey is missing', async () => {
      const adapter = new ElevenLabsAdapter()
      const result = await adapter.testConnection({})
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/API key/i)
    })

    it('verifies connection against user/subscription endpoint without consuming audio', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tier: 'starter', status: 'active', character_count: 5000 }),
      } as unknown as Response)

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ apiKey: 'test-xi-key' })

      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/Connected to ElevenLabs/i)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/user/subscription',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'xi-api-key': 'test-xi-key',
          }),
        }),
      )
    })

    it('returns ok: false when API key is invalid or subscription call fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: { message: 'Invalid API key' } }),
      } as unknown as Response)

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ apiKey: 'invalid-key' })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Invalid.*API key/i)
    })

    it('extracts detail string when API returns error with string detail', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Account quota exceeded' }),
      } as unknown as Response)

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.testConnection({ apiKey: 'test-key' })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Account quota exceeded')
    })
  })

  describe('transcribe', () => {
    it('posts multipart audio to speech-to-text with default language pl', async () => {
      let capturedBody: FormData | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as FormData
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Dzień dobry świecie',
            language_code: 'pol',
            words: [
              { text: 'Dzień', start: 0.0, end: 0.4 },
              { text: 'dobry', start: 0.45, end: 0.8 },
              { text: 'świecie', start: 0.85, end: 1.3 },
            ],
          }),
        } as unknown as Response
      })

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const wav = createFakeAudioWav()

      const result = await adapter.transcribe({ audioWav: wav }, { apiKey: 'valid-key' })

      expect(result.text).toBe('Dzień dobry świecie')
      expect(result.rawText).toBe('Dzień dobry świecie')
      expect(result.providerId).toBe('elevenlabs')
      expect(result.language).toBe('pol')
      expect(result.durationMs).toBe(1300)
      expect(result.words).toHaveLength(3)
      expect(result.words?.[0]).toEqual({ word: 'Dzień', start: 0.0, end: 0.4 })

      expect(capturedBody).not.toBeNull()
      const body1 = capturedBody as unknown as FormData
      expect(body1.get('model_id')).toBe('scribe_v2')
      expect(body1.get('language_code')).toBe('pl')
    })

    it('omits language_code when language is auto or empty', async () => {
      let capturedBody: FormData | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as FormData
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: 'Auto detected language transcript' }),
        } as unknown as Response
      })

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      await adapter.transcribe(
        { audioWav: createFakeAudioWav(), language: 'auto' },
        { apiKey: 'valid-key' },
      )

      const body2 = capturedBody as unknown as FormData
      expect(body2.has('language_code')).toBe(false)
    })

    it('enforces keyterms constraints: max 100 terms, max 50 chars, max 5 words', async () => {
      let capturedBody: FormData | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as FormData
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: 'Transcript with terms' }),
        } as unknown as Response
      })

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })

      // Prepare keyterms: valid ones, one with > 50 chars, one with > 5 words, and exceeding 100 total
      const keyterms: string[] = []
      for (let i = 0; i < 105; i++) {
        keyterms.push(`term${i}`)
      }
      keyterms.push('a'.repeat(55)) // > 50 chars -> excluded
      keyterms.push('one two three four five six') // 6 words -> excluded
      keyterms.push('valid term with [bracket]') // contains invalid char -> filtered or excluded

      const result = await adapter.transcribe(
        { audioWav: createFakeAudioWav(), keyterms },
        { apiKey: 'valid-key' },
      )

      const body3 = capturedBody as unknown as FormData
      const submittedTerms = body3.getAll('keyterms') as string[]
      expect(submittedTerms.length).toBeLessThanOrEqual(100)
      expect(submittedTerms.every((t) => t.length <= 50)).toBe(true)
      expect(submittedTerms.every((t) => t.split(/\s+/).length <= 5)).toBe(true)
      expect(result.warning).toMatch(/keyterm.*excluded/i)
    })

    it('handles transcript_edit with native instruction and returns editedText', async () => {
      let capturedBody: FormData | null = null
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as FormData
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'raw unedited text',
            edited_transcript: 'Polished and formatted text.',
          }),
        } as unknown as Response
      })

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.transcribe(
        {
          audioWav: createFakeAudioWav(),
          nativeEditInstruction: 'Format as code sentences',
        },
        { apiKey: 'valid-key' },
      )

      const body4 = capturedBody as unknown as FormData
      expect(body4.get('transcript_edit')).toBe('Format as code sentences')
      expect(result.text).toBe('Polished and formatted text.')
      expect(result.rawText).toBe('raw unedited text')
      expect(result.editedText).toBe('Polished and formatted text.')
    })

    it('falls back to raw text with warning when transcript_edit was requested but missing in response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          text: 'raw unedited text',
          // edited_transcript is missing or null
        }),
      } as unknown as Response)

      const adapter = new ElevenLabsAdapter({ fetch: mockFetch as unknown as typeof fetch })
      const result = await adapter.transcribe(
        {
          audioWav: createFakeAudioWav(),
          nativeEditInstruction: 'Format text',
        },
        { apiKey: 'valid-key' },
      )

      expect(result.text).toBe('raw unedited text')
      expect(result.rawText).toBe('raw unedited text')
      expect(result.editedText).toBeUndefined()
      expect(result.warning).toMatch(/transcript_edit-failed/i)
    })

    it('throws AppError when API key is missing or request fails', async () => {
      const adapter = new ElevenLabsAdapter()
      await expect(adapter.transcribe({ audioWav: createFakeAudioWav() }, {})).rejects.toThrowError(
        AppError,
      )

      const errorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: { message: 'Audio format invalid' } }),
      } as unknown as Response)

      const errorAdapter = new ElevenLabsAdapter({ fetch: errorFetch as unknown as typeof fetch })
      await expect(
        errorAdapter.transcribe({ audioWav: createFakeAudioWav() }, { apiKey: 'key' }),
      ).rejects.toThrowError(AppError)

      const stringDetailFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Audio duration too short' }),
      } as unknown as Response)

      const stringDetailAdapter = new ElevenLabsAdapter({
        fetch: stringDetailFetch as unknown as typeof fetch,
      })
      await expect(
        stringDetailAdapter.transcribe({ audioWav: createFakeAudioWav() }, { apiKey: 'key' }),
      ).rejects.toThrowError(/Audio duration too short/)
    })
  })
})
