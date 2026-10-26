import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DictationModelSelection,
  DictationSettings,
} from '@shared/contracts/dictation-contract'
import { AppError } from '@shared/ipc-error'
import type { OpenWhisprClient } from '../openwhispr-client'
import {
  type ConnectionTestResult,
  type DiscoveredModel,
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderManifest,
  type TranscriptionRequest,
  type TranscriptionResult,
} from './adapter-contract'

export class OpenWhisprAdapter implements SttProviderAdapter {
  readonly protocolVersion = STT_ADAPTER_PROTOCOL_VERSION
  readonly manifest: SttProviderManifest = {
    id: 'openwhispr',
    name: 'OpenWhispr (Local)',
    description: 'Local bridge integration using OpenWhispr desktop daemon',
    version: '1.0.0',
    protocolVersion: STT_ADAPTER_PROTOCOL_VERSION,
    capabilities: {
      keyterms: false,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: true,
      timestamps: false,
    },
    configSchema: [
      {
        key: 'model',
        label: 'Model',
        type: 'text',
        required: false,
        defaultValue: 'default',
        placeholder: 'default',
        description: 'Selected OpenWhispr model or "default"',
      },
      {
        key: 'language',
        label: 'Language',
        type: 'text',
        required: false,
        defaultValue: 'default',
        placeholder: 'default (or pl, en)',
        description: 'Language code or "default" to follow OpenWhispr daemon setting',
      },
      {
        key: 'timeoutSeconds',
        label: 'Timeout (Seconds)',
        type: 'number',
        required: false,
        defaultValue: 30,
        description: 'Maximum waiting time for local transcription',
      },
    ],
  }

  constructor(private readonly client: OpenWhisprClient) {}

  async testConnection(_config?: Record<string, unknown>): Promise<ConnectionTestResult> {
    try {
      const snapshot = await this.client.testConnection()
      if (
        snapshot.state === 'operational' ||
        snapshot.state === 'connected' ||
        snapshot.state === 'model-available'
      ) {
        return {
          ok: true,
          message: `OpenWhispr daemon is connected (${snapshot.state})`,
        }
      }

      return {
        ok: false,
        message: `OpenWhispr daemon connection failed: ${snapshot.state}`,
      }
    } catch (error) {
      return {
        ok: false,
        message: `Failed to check OpenWhispr connection: ${error instanceof Error ? error.message : 'unreachable'}`,
      }
    }
  }

  async discoverModels(_config?: Record<string, unknown>): Promise<DiscoveredModel[]> {
    try {
      const snapshot = await this.client.refreshModels()
      if (!Array.isArray(snapshot.models)) {
        return []
      }
      return snapshot.models.map((m) => ({
        id: m.model,
        name: `${m.provider}/${m.model}`,
      }))
    } catch {
      return []
    }
  }

  async transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    const tempFile = join(tmpdir(), `nekode-openwhispr-${randomUUID()}.wav`)
    writeFileSync(tempFile, Buffer.from(request.audioWav))

    try {
      const baseSettings: DictationSettings =
        typeof this.client.getSettings === 'function'
          ? this.client.getSettings()
          : {
              enabled: true,
              language: 'default',
              model: 'default',
              timeoutSeconds: 30,
            }

      const language =
        request.language ??
        (typeof config.language === 'string' && config.language.trim()
          ? config.language.trim()
          : baseSettings.language)

      const timeoutSeconds =
        typeof config.timeoutSeconds === 'number'
          ? config.timeoutSeconds
          : baseSettings.timeoutSeconds

      const requestedModel =
        request.model ??
        (typeof config.model === 'string' && config.model.trim() ? config.model.trim() : undefined)

      const catalog =
        typeof this.client.status === 'function' ? (this.client.status()?.models ?? []) : []

      let resolvedModel: DictationModelSelection = baseSettings.model
      let modelId: string =
        typeof baseSettings.model === 'object' ? baseSettings.model.model : 'default'

      if (requestedModel) {
        if (requestedModel === 'default') {
          resolvedModel = 'default'
          modelId = catalog.find((m) => m.default)?.model ?? 'default'
        } else {
          const matched = catalog.find(
            (m) => m.model === requestedModel || `${m.provider}/${m.model}` === requestedModel,
          )
          if (matched) {
            resolvedModel = { provider: matched.provider, model: matched.model }
            modelId = matched.model
          } else if (requestedModel.includes('/')) {
            const slashIndex = requestedModel.indexOf('/')
            const provider = requestedModel.slice(0, slashIndex).trim()
            const model = requestedModel.slice(slashIndex + 1).trim()
            resolvedModel = { provider: provider || 'openwhispr', model: model || requestedModel }
            modelId = model || requestedModel
          } else {
            resolvedModel = { provider: 'openwhispr', model: requestedModel }
            modelId = requestedModel
          }
        }
      } else if (baseSettings.model === 'default') {
        const defaultInCatalog = catalog.find((m) => m.default)
        if (defaultInCatalog) {
          modelId = defaultInCatalog.model
        }
      }

      const settings: DictationSettings = {
        ...baseSettings,
        language,
        model: resolvedModel,
        timeoutSeconds,
      }

      const signal = request.signal ?? new AbortController().signal
      const response = await this.client.transcribe(tempFile, settings, signal)

      if (response.error) {
        if (response.error === 'cancelled' || response.error === 'timeout') {
          throw new AppError('timeout', `Dictation ${response.error}.`)
        }
        throw new AppError('adapter', `OpenWhispr transcription failed: ${response.error}`)
      }

      return {
        text: response.text,
        rawText: response.text,
        providerId: 'openwhispr',
        modelId,
        warning: response.warning,
      }
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // Cleanup best effort
      }
    }
  }
}
