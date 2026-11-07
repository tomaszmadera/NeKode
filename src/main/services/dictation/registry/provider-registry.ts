import { AppError } from '@shared/ipc-error'
import {
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
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

  get(id: string): SttProviderAdapter | undefined {
    return this.adapters.get(id)
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  listManifests(): SttProviderManifest[] {
    return Array.from(this.adapters.values()).map((adapter) => adapter.manifest)
  }
}
