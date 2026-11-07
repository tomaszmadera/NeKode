import { AppError } from '@shared/ipc-error'
import { describe, expect, it } from 'vitest'
import {
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderManifest,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '../adapters/adapter-contract'
import { ProviderRegistry } from './provider-registry'

function createMockAdapter(
  id: string,
  overrides?: Partial<SttProviderManifest>,
  protocolVersion = STT_ADAPTER_PROTOCOL_VERSION,
): SttProviderAdapter {
  const manifest: SttProviderManifest = {
    id,
    name: `Mock Provider ${id}`,
    description: `Mock provider for ${id}`,
    version: '1.0.0',
    capabilities: {
      keyterms: true,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: false,
      timestamps: true,
    },
    configSchema: [],
    ...overrides,
  }

  return {
    manifest,
    protocolVersion,
    async testConnection() {
      return { ok: true, message: 'Connected' }
    },
    async transcribe(_request: TranscriptionRequest): Promise<TranscriptionResult> {
      return {
        text: 'mock transcribed text',
        rawText: 'mock transcribed text',
        providerId: id,
      }
    },
  }
}

describe('ProviderRegistry', () => {
  it('registers and retrieves an adapter by id', () => {
    const registry = new ProviderRegistry()
    const adapter = createMockAdapter('test-provider')

    registry.register(adapter)
    expect(registry.has('test-provider')).toBe(true)
    expect(registry.get('test-provider')).toBe(adapter)
  })

  it('rejects registration with duplicate id', () => {
    const registry = new ProviderRegistry()
    const adapter1 = createMockAdapter('elevenlabs')
    const adapter2 = createMockAdapter('elevenlabs')

    registry.register(adapter1)
    expect(() => registry.register(adapter2)).toThrowError(AppError)
    expect(() => registry.register(adapter2)).toThrowError(/already registered/i)
  })

  it('rejects registration with incompatible protocol version', () => {
    const registry = new ProviderRegistry()
    const incompatibleAdapter = createMockAdapter('future-provider', {}, 99)

    expect(() => registry.register(incompatibleAdapter)).toThrowError(AppError)
    expect(() => registry.register(incompatibleAdapter)).toThrowError(/protocol version/i)
  })

  it('lists manifests in registration order', () => {
    const registry = new ProviderRegistry()
    const adapter1 = createMockAdapter('prov-1')
    const adapter2 = createMockAdapter('prov-2')

    registry.register(adapter1)
    registry.register(adapter2)

    const manifests = registry.listManifests()
    expect(manifests).toHaveLength(2)
    expect(manifests[0].id).toBe('prov-1')
    expect(manifests[1].id).toBe('prov-2')
  })
})
