import { AppError } from '../../../../shared/ipc-error'
import {
  type ConnectionTestResult,
  type DiscoveredModel,
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderManifest,
  type TranscriptionRequest,
  type TranscriptionResult,
} from './adapter-contract'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/whisper-large-v3-turbo'

export interface OpenRouterAdapterDeps {
  fetch?: typeof globalThis.fetch
}

export class OpenRouterAdapter implements SttProviderAdapter {
  readonly protocolVersion = STT_ADAPTER_PROTOCOL_VERSION
  readonly manifest: SttProviderManifest = {
    id: 'openrouter',
    name: 'OpenRouter STT',
    description: 'Batch audio transcription via OpenRouter audio transcriptions endpoint',
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
        key: 'apiKey',
        label: 'API Key',
        type: 'secret',
        required: true,
        placeholder: 'sk-or-v1-...',
        description: 'OpenRouter API key from openrouter.ai/keys',
      },
      {
        key: 'model',
        label: 'Transcription Model',
        type: 'text',
        required: false,
        defaultValue: DEFAULT_MODEL,
        placeholder: DEFAULT_MODEL,
        description: 'STT model identifier (e.g. openai/whisper-large-v3-turbo)',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        defaultValue: DEFAULT_BASE_URL,
        description: 'OpenRouter API base URL override (optional)',
      },
    ],
  }

  private readonly fetch: typeof globalThis.fetch

  constructor(deps?: OpenRouterAdapterDeps) {
    this.fetch = deps?.fetch ?? globalThis.fetch
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
    if (!apiKey) {
      return { ok: false, message: 'OpenRouter API key is required.' }
    }

    const baseUrl =
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL

    try {
      const response = await this.fetch(`${baseUrl}/auth/key`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })

      if (response.ok) {
        let label = 'valid'
        try {
          const json = (await response.json()) as Record<string, unknown>
          if (json?.data && typeof json.data === 'object') {
            const data = json.data as Record<string, unknown>
            if (typeof data.label === 'string') {
              label = data.label
            }
          }
        } catch {
          // Non-fatal
        }
        return { ok: true, message: `Connected to OpenRouter (${label})` }
      }

      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: 'Invalid or unauthorized OpenRouter API key.' }
      }

      let errMessage = `HTTP ${response.status}`
      try {
        const errJson = (await response.json()) as Record<string, unknown>
        if (errJson?.error && typeof errJson.error === 'object') {
          const err = errJson.error as Record<string, unknown>
          if (typeof err.message === 'string') {
            errMessage = err.message
          }
        }
      } catch {
        // Fall back
      }

      return { ok: false, message: `OpenRouter connection check failed: ${errMessage}` }
    } catch (error) {
      return {
        ok: false,
        message: `Network error connecting to OpenRouter: ${error instanceof Error ? error.message : 'unreachable'}`,
      }
    }
  }

  async discoverModels(config?: Record<string, unknown>): Promise<DiscoveredModel[]> {
    const baseUrl =
      typeof config?.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL

    const apiKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    try {
      const response = await this.fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        return [{ id: DEFAULT_MODEL, name: 'Whisper Large v3 Turbo (default)' }]
      }

      const json = (await response.json()) as Record<string, unknown>
      if (!Array.isArray(json?.data)) {
        return [{ id: DEFAULT_MODEL, name: 'Whisper Large v3 Turbo (default)' }]
      }

      const models: DiscoveredModel[] = []
      for (const item of json.data) {
        if (typeof item === 'object' && item !== null) {
          const m = item as Record<string, unknown>
          const id = typeof m.id === 'string' ? m.id : ''
          const name = typeof m.name === 'string' ? m.name : id
          const arch =
            typeof m.architecture === 'object' && m.architecture !== null
              ? (m.architecture as Record<string, unknown>)
              : null

          const isAudioInput =
            arch &&
            ((Array.isArray(arch.input_modalities) && arch.input_modalities.includes('audio')) ||
              (typeof arch.modality === 'string' && arch.modality.includes('audio')))

          const isWhisperOrStt =
            id.toLowerCase().includes('whisper') ||
            id.toLowerCase().includes('transcribe') ||
            id.toLowerCase().includes('transcription')

          if (isAudioInput || isWhisperOrStt) {
            models.push({ id, name })
          }
        }
      }

      return models.length > 0
        ? models
        : [{ id: DEFAULT_MODEL, name: 'Whisper Large v3 Turbo (default)' }]
    } catch {
      return [{ id: DEFAULT_MODEL, name: 'Whisper Large v3 Turbo (default)' }]
    }
  }

  async transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
    if (!apiKey) {
      throw new AppError('validation', 'OpenRouter API key is not configured.')
    }

    const baseUrl =
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL

    const model = request.model ?? (config.model as string) ?? DEFAULT_MODEL
    const base64Audio = Buffer.from(request.audioWav).toString('base64')

    const language =
      request.language ??
      (typeof config.language === 'string' && config.language.trim()
        ? config.language.trim()
        : undefined)

    const body: Record<string, unknown> = {
      model,
      input_audio: {
        data: base64Audio,
        format: 'wav',
      },
    }
    if (language && language !== 'auto' && language !== 'default') {
      body.language = language
    }

    let response: Response
    try {
      response = await this.fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AppError('timeout', 'Dictation transcription cancelled or timed out.')
      }
      throw new AppError(
        'adapter',
        `OpenRouter transcription request failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (!response.ok) {
      let message = `OpenRouter transcription failed with status ${response.status}`
      try {
        const errJson = (await response.json()) as Record<string, unknown>
        if (errJson?.error && typeof errJson.error === 'object') {
          const err = errJson.error as Record<string, unknown>
          if (typeof err.message === 'string') {
            message = err.message
          }
        }
      } catch {
        // Fall back
      }
      throw new AppError('adapter', message)
    }

    let data: Record<string, unknown>
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      throw new AppError('adapter', 'OpenRouter returned invalid JSON response.')
    }

    const text = typeof data.text === 'string' ? data.text : ''

    const result: TranscriptionResult = {
      text,
      rawText: text,
      providerId: 'openrouter',
      modelId: model,
    }
    if (language && language !== 'auto' && language !== 'default') {
      result.language = language
    }

    return result
  }
}
