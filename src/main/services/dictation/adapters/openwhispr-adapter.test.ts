import { existsSync } from 'node:fs'
import type {
  DictationSettings,
  DictationStatusSnapshot,
} from '@shared/contracts/dictation-contract'
import { AppError } from '@shared/ipc-error'
import { describe, expect, it, vi } from 'vitest'
import type { OpenWhisprClient } from '../openwhispr-client'
import { OpenWhisprAdapter } from './openwhispr-adapter'

function createFakeAudioWav(): ArrayBuffer {
  return new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]).buffer
}

describe('OpenWhisprAdapter', () => {
  it('exposes manifest with local bridge capabilities', () => {
    const adapter = new OpenWhisprAdapter({} as OpenWhisprClient)
    expect(adapter.manifest.id).toBe('openwhispr')
    expect(adapter.manifest.capabilities).toEqual({
      keyterms: false,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: true,
      timestamps: false,
    })
  })

  describe('testConnection', () => {
    it('returns ok: true when client reports operational or connected state', async () => {
      const mockClient = {
        testConnection: vi.fn().mockResolvedValue({
          state: 'operational',
          checkedAt: '2026-10-25T10:00:00Z',
          models: [],
          staleModelSelection: false,
          error: null,
        } as DictationStatusSnapshot),
        status: vi.fn().mockReturnValue({ state: 'operational' }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const result = await adapter.testConnection({})

      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/OpenWhispr daemon.*operational/i)
      expect(mockClient.testConnection).toHaveBeenCalled()
    })

    it('returns ok: false when client reports bridge-missing or unreachable', async () => {
      const mockClient = {
        testConnection: vi.fn().mockResolvedValue({
          state: 'bridge-missing',
          checkedAt: null,
          models: [],
          staleModelSelection: false,
          error: null,
        } as DictationStatusSnapshot),
        status: vi.fn().mockReturnValue({ state: 'bridge-missing' }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const result = await adapter.testConnection({})

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/bridge-missing/i)
    })
  })

  describe('discoverModels', () => {
    it('calls refreshModels and maps downloaded models', async () => {
      const mockClient = {
        refreshModels: vi.fn().mockResolvedValue({
          state: 'operational',
          models: [
            { provider: 'whisper-cpp', model: 'ggml-medium.bin', downloaded: true, default: true },
            { provider: 'sherpa-onnx', model: 'v1.onnx', downloaded: false, default: false },
          ],
        } as unknown as DictationStatusSnapshot),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const models = await adapter.discoverModels()

      expect(models).toEqual([
        { id: 'ggml-medium.bin', name: 'whisper-cpp/ggml-medium.bin' },
        { id: 'v1.onnx', name: 'sherpa-onnx/v1.onnx' },
      ])
    })
  })

  describe('transcribe', () => {
    it('delegates the owned audio path without removing it', async () => {
      let passedTempPath = ''
      const mockClient = {
        getSettings: vi.fn().mockReturnValue({
          enabled: true,
          model: 'default',
          language: 'default',
          timeoutSeconds: 30,
        }),
        transcribe: vi.fn().mockImplementation(async (filePath: string) => {
          passedTempPath = filePath
          expect(existsSync(filePath)).toBe(true)
          return {
            text: 'Rozpoznany tekst z OpenWhispr',
            warning: null,
            error: null,
          }
        }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const wav = createFakeAudioWav()

      const result = await adapter.transcribe({ audioWav: wav, audioPath: 'package.json' }, {})

      expect(result.text).toBe('Rozpoznany tekst z OpenWhispr')
      expect(result.rawText).toBe('Rozpoznany tekst z OpenWhispr')
      expect(result.providerId).toBe('openwhispr')
      expect(result.modelId).toBe('default')

      expect(passedTempPath).toBe('package.json')
      expect(existsSync(passedTempPath)).toBe(true)
    })

    it('resolves requested model against client catalog and includes modelId in result', async () => {
      let passedSettings: DictationSettings | null = null
      const mockClient = {
        getSettings: vi.fn().mockReturnValue({
          enabled: true,
          model: 'default',
          language: 'default',
          timeoutSeconds: 30,
        }),
        status: vi.fn().mockReturnValue({
          state: 'operational',
          models: [
            { provider: 'whisper-cpp', model: 'ggml-medium.bin', downloaded: true, default: false },
            { provider: 'sherpa-onnx', model: 'v1.onnx', downloaded: true, default: true },
          ],
        }),
        transcribe: vi
          .fn()
          .mockImplementation(async (_filePath: string, settings: DictationSettings) => {
            passedSettings = settings
            return {
              text: 'Rozpoznany tekst z wybranego modelu',
              warning: null,
              error: null,
            }
          }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const result = await adapter.transcribe(
        { audioWav: createFakeAudioWav(), audioPath: 'package.json', model: 'ggml-medium.bin' },
        {},
      )

      expect(result.modelId).toBe('ggml-medium.bin')
      expect(result.text).toBe('Rozpoznany tekst z wybranego modelu')
      expect((passedSettings as DictationSettings | null)?.model).toEqual({
        provider: 'whisper-cpp',
        model: 'ggml-medium.bin',
      })
    })

    it('resolves config model override and handles default model selection', async () => {
      let passedSettings: DictationSettings | null = null
      const mockClient = {
        getSettings: vi.fn().mockReturnValue({
          enabled: true,
          model: 'default',
          language: 'default',
          timeoutSeconds: 30,
        }),
        status: vi.fn().mockReturnValue({
          state: 'operational',
          models: [
            { provider: 'whisper-cpp', model: 'ggml-base.bin', downloaded: true, default: true },
          ],
        }),
        transcribe: vi
          .fn()
          .mockImplementation(async (_filePath: string, settings: DictationSettings) => {
            passedSettings = settings
            return {
              text: 'Rozpoznany tekst domyślny',
              warning: null,
              error: null,
            }
          }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      const result = await adapter.transcribe(
        { audioWav: createFakeAudioWav(), audioPath: 'package.json' },
        { model: 'default' },
      )

      expect(result.modelId).toBe('ggml-base.bin')
      expect((passedSettings as DictationSettings | null)?.model).toBe('default')
    })

    it('throws AppError when client transcription fails with error', async () => {
      const mockClient = {
        getSettings: vi.fn().mockReturnValue({
          enabled: true,
          model: 'default',
          language: 'default',
          timeoutSeconds: 30,
        }),
        transcribe: vi.fn().mockResolvedValue({
          text: '',
          warning: null,
          error: 'unreachable',
        }),
      } as unknown as OpenWhisprClient

      const adapter = new OpenWhisprAdapter(mockClient)
      await expect(
        adapter.transcribe({ audioWav: createFakeAudioWav(), audioPath: 'package.json' }, {}),
      ).rejects.toThrowError(AppError)
    })
  })
})
