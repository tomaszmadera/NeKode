import { AppError } from '../../../../shared/ipc-error'
import {
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderCapabilities,
  type SttProviderManifest,
} from '../adapters/adapter-contract'

export class ProviderRegistry {
  private readonly adapters = new Map<string, SttProviderAdapter>()

  register(adapter: SttProviderAdapter): void {
    const manifest = adapter.manifest
    if (!manifest?.id || typeof manifest.id !== 'string') {
      throw new AppError('validation', 'Adapter manifest must have a non-empty id.')
    }

    if (this.adapters.has(manifest.id)) {
      throw new AppError('conflict', `STT provider adapter '${manifest.id}' is already registered.`)
    }

    const version = adapter.protocolVersion ?? manifest.protocolVersion
    if (version !== undefined && version !== STT_ADAPTER_PROTOCOL_VERSION) {
      throw new AppError(
        'protocol',
        `STT provider adapter '${manifest.id}' uses unsupported protocol version ${version} (expected ${STT_ADAPTER_PROTOCOL_VERSION}).`,
      )
    }

    this.adapters.set(manifest.id, adapter)
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id)
  }

  get(id: string): SttProviderAdapter | undefined {
    return this.adapters.get(id)
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  listManifests(): SttProviderManifest[] {
    return Array.from(this.adapters.values()).map((adapter) => adapter.manifest)
  }

  listAdapters(): SttProviderAdapter[] {
    return Array.from(this.adapters.values())
  }

  hasCapability(id: string, capability: keyof SttProviderCapabilities): boolean {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      return false
    }
    return Boolean(adapter.manifest.capabilities[capability])
  }

  clear(): void {
    this.adapters.clear()
  }
}
