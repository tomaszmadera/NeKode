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

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1'
const DEFAULT_MODEL = 'whisper-1'

export interface LocalOpenAiAdapterDeps {
  fetch?: typeof globalThis.fetch
}

export class LocalOpenAiAdapter implements SttProviderAdapter {
  readonly protocolVersion = STT_ADAPTER_PROTOCOL_VERSION
  readonly manifest: SttProviderManifest = {
    id: 'local-openai',
    name: 'Local OpenAI-Compatible',
    description: 'Generic local endpoint for whisper.cpp, Ollama, or LocalAI',
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
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: true,
        defaultValue: DEFAULT_BASE_URL,
        placeholder: DEFAULT_BASE_URL,
        description: 'OpenAI-compatible server endpoint (e.g. http://127.0.0.1:8080/v1)',
      },
      {
        key: 'model',
        label: 'Model Name',
        type: 'text',
        required: false,
        defaultValue: DEFAULT_MODEL,
        placeholder: DEFAULT_MODEL,
        description: 'Target model name (e.g. whisper-1 or ggml-medium.bin)',
      },
      {
        key: 'apiKey',
        label: 'API Key (Optional)',
        type: 'secret',
        required: false,
        placeholder: 'Optional bearer token',
        description: 'Bearer token if the local server requires authentication',
      },
    ],
  }

  private readonly fetch: typeof globalThis.fetch

  constructor(deps?: LocalOpenAiAdapterDeps) {
    this.fetch = deps?.fetch ?? globalThis.fetch
  }

  private resolveBaseUrl(config?: Record<string, unknown>): string {
    const raw = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : ''
    return raw ? raw.replace(/\/+$/, '') : DEFAULT_BASE_URL
  }

  private buildHeaders(config?: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const apiKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    return headers
  }

  async testConnection(config?: Record<string, unknown>): Promise<ConnectionTestResult> {
    const baseUrl = this.resolveBaseUrl(config)
    const headers = this.buildHeaders(config)

    try {
      const response = await this.fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
      })

      if (response.ok) {
        return {
          ok: true,
          message: `Connected to local endpoint at ${baseUrl}`,
        }
      }

      return {
        ok: false,
        message: `Local endpoint responded with HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        ok: false,
        message: `Failed to connect to local endpoint: ${error instanceof Error ? error.message : 'unreachable'}`,
      }
    }
  }

  async discoverModels(config?: Record<string, unknown>): Promise<DiscoveredModel[]> {
    const baseUrl = this.resolveBaseUrl(config)
    const headers = this.buildHeaders(config)

    try {
      const response = await this.fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        return [{ id: DEFAULT_MODEL, name: DEFAULT_MODEL }]
      }

      const json = (await response.json()) as Record<string, unknown>
      if (!Array.isArray(json?.data)) {
        return [{ id: DEFAULT_MODEL, name: DEFAULT_MODEL }]
      }

      const models: DiscoveredModel[] = []
      for (const item of json.data) {
        if (typeof item === 'object' && item !== null) {
          const m = item as Record<string, unknown>
          const id = typeof m.id === 'string' ? m.id : ''
          if (id) {
            models.push({ id, name: id })
          }
        }
      }

      return models.length > 0 ? models : [{ id: DEFAULT_MODEL, name: DEFAULT_MODEL }]
    } catch {
      return [{ id: DEFAULT_MODEL, name: DEFAULT_MODEL }]
    }
  }

  async transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    const baseUrl = this.resolveBaseUrl(config)
    const model = request.model ?? (config.model as string) ?? DEFAULT_MODEL

    const formData = new FormData()
    const audioBlob = new Blob([request.audioWav], { type: 'audio/wav' })
    formData.append('file', audioBlob, 'audio.wav')
    formData.append('model', model)

    const language = request.language ?? (config.language as string)
    if (language && language !== 'auto' && language !== 'default') {
      formData.append('language', language)
    }

    const headers = this.buildHeaders(config)

    let response: Response
    try {
      response = await this.fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers,
        body: formData,
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AppError('timeout', 'Dictation transcription cancelled or timed out.')
      }
      throw new AppError(
        'adapter',
        `Local endpoint transcription request failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (!response.ok) {
      let message = `Local endpoint transcription failed with status ${response.status}`
      try {
        const errJson = (await response.json()) as Record<string, unknown>
        if (errJson?.error) {
          if (typeof errJson.error === 'string') {
            message = errJson.error
          } else if (
            typeof errJson.error === 'object' &&
            errJson.error !== null &&
            typeof (errJson.error as Record<string, unknown>).message === 'string'
          ) {
            message = (errJson.error as Record<string, unknown>).message as string
          } else {
            message = JSON.stringify(errJson.error)
          }
        }
      } catch {
        // Fall back to status
      }
      throw new AppError('adapter', message)
    }

    let data: Record<string, unknown>
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      throw new AppError('adapter', 'Local endpoint returned invalid JSON response.')
    }

    const text = typeof data.text === 'string' ? data.text : ''

    return {
      text,
      rawText: text,
      providerId: 'local-openai',
      modelId: model,
    }
  }
}
