import type { DictationError } from '@shared/contracts/dictation-contract'
import { AppError } from '@shared/ipc-error'
import {
  type ConnectionTestResult,
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderManifest,
  type TranscriptionRequest,
  type TranscriptionResult,
} from './adapter-contract'
import { DictationProviderError } from './dictation-provider-error'

const BASE_URL = 'https://api.openwhispr.com/api/v1'
export const OPENWHISPR_CLOUD_MAX_BYTES = 4_000_000
function isPersonalKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value === value.trim() && /^owk_live_[A-Za-z0-9_-]+$/.test(value)
  )
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function httpError(status: number, body: unknown): DictationError {
  if (status === 401) return 'auth-failed'
  if (status === 413) return 'audio-too-large'
  const code = object(body) && object(body.error) ? body.error.code : undefined
  if (status === 403 && code === 'plan_required') return 'plan-required'
  if (status === 403 && code === 'forbidden') return 'forbidden'
  if (status === 400 && code === 'validation_error') return 'audio-rejected'
  if (status === 409 && code === 'concurrency_limit') return 'concurrency-limit'
  if (status === 429 && code === 'quota_exceeded') return 'quota-exceeded'
  if (status === 429 && code === 'rate_limited') return 'rate-limited'
  if (status === 503 && code === 'service_unavailable') return 'service-unavailable'
  return 'provider-failure'
}

export class OpenWhisprCloudAdapter implements SttProviderAdapter {
  readonly protocolVersion = STT_ADAPTER_PROTOCOL_VERSION
  readonly manifest: SttProviderManifest = {
    id: 'openwhispr-cloud',
    name: 'OpenWhispr Cloud (beta)',
    description:
      'Sends audio and vocabulary hints to OpenWhispr Cloud. Requires Pro or Business and a personal key with transcriptions:write. Beta limits: 4 MB per file (about two minutes), 600 minutes per calendar month, one transcription at a time per key.',
    version: '1.0.0',
    protocolVersion: STT_ADAPTER_PROTOCOL_VERSION,
    capabilities: {
      keyterms: true,
      nativeEditing: false,
      languageSelection: true,
      modelDiscovery: false,
      timestamps: false,
    },
    configSchema: [
      {
        key: 'apiKey',
        label: 'Personal API key',
        type: 'secret',
        required: true,
        placeholder: 'owk_live_...',
        description: 'Personal key with transcriptions:write; workspace keys are unsupported.',
      },
      {
        key: 'language',
        label: 'Language',
        type: 'select',
        required: false,
        defaultValue: 'pl',
        options: [
          { label: 'Polish', value: 'pl' },
          { label: 'Automatic', value: 'auto' },
        ],
      },
      {
        key: 'cloudUploadEnabled',
        label: 'Allow sending recordings and vocabulary hints to OpenWhispr Cloud',
        type: 'boolean',
        required: true,
        defaultValue: false,
        description:
          'Saving a key does not grant upload permission. Revoke this permission to block uploads.',
      },
    ],
  }

  private readonly fetch: typeof globalThis.fetch

  constructor(deps?: { fetch?: typeof globalThis.fetch }) {
    this.fetch = deps?.fetch ?? globalThis.fetch
  }

  validateConfig(config: Record<string, unknown>): void {
    if (
      Object.keys(config).some(
        (key) => !['apiKey', 'language', 'cloudUploadEnabled'].includes(key),
      ) ||
      (config.apiKey !== undefined &&
        config.apiKey !== null &&
        config.apiKey !== '' &&
        !isPersonalKey(config.apiKey)) ||
      (config.language !== undefined && !['pl', 'auto'].includes(config.language as string)) ||
      (config.cloudUploadEnabled !== undefined && typeof config.cloudUploadEnabled !== 'boolean')
    )
      throw new AppError(
        'validation',
        'Invalid OpenWhispr Cloud configuration. Use a personal owk_live_ key, Polish or automatic language, and explicit upload permission.',
      )
  }

  readinessError(config: Record<string, unknown>): DictationError | null {
    if (!isPersonalKey(config.apiKey)) return 'auth-failed'
    if (config.cloudUploadEnabled !== true) return 'cloud-consent-required'
    if (config.language !== undefined && config.language !== 'pl' && config.language !== 'auto')
      return 'audio-rejected'
    return null
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10_000)
    try {
      this.validateConfig(config)
      if (!isPersonalKey(config.apiKey)) throw new DictationProviderError('auth-failed')
      // Metadata requests do not require upload permission and never carry audio.
      const me = await this.request('/me', config.apiKey, { method: 'GET' }, 10_000, abort.signal)
      if (
        !object(me) ||
        !object(me.data) ||
        !Array.isArray(me.data.scopes) ||
        !me.data.scopes.every((scope) => typeof scope === 'string')
      )
        throw new DictationProviderError('malformed-response')
      if (!me.data.scopes.includes('transcriptions:write'))
        throw new DictationProviderError('forbidden')
      const usage = await this.request(
        '/usage',
        config.apiKey,
        { method: 'GET' },
        10_000,
        abort.signal,
      )
      if (!object(usage) || !object(usage.data) || typeof usage.data.plan !== 'string')
        throw new DictationProviderError('malformed-response')
      if (!['pro', 'business'].includes(usage.data.plan))
        throw new DictationProviderError('plan-required')
      return {
        ok: true,
        message:
          'OpenWhispr Cloud key scope and paid plan verified. No audio uploaded; remaining minutes were not verified.',
      }
    } catch (error) {
      const code = error instanceof DictationProviderError ? error.error : 'auth-failed'
      return {
        ok: false,
        message: `OpenWhispr Cloud connection check failed (${code}). Check your personal key, transcriptions:write scope and Pro or Business plan in Settings.`,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    const readiness = this.readinessError(config)
    if (readiness) throw new DictationProviderError(readiness)
    if (request.signal?.aborted) throw new DictationProviderError('timeout')
    if (request.audioWav.byteLength > OPENWHISPR_CLOUD_MAX_BYTES)
      throw new DictationProviderError('audio-too-large')
    const form = new FormData()
    form.append('file', new Blob([request.audioWav], { type: 'audio/wav' }), 'audio.wav')
    const language = request.language ?? config.language ?? 'pl'
    if (language !== 'pl' && language !== 'auto') throw new DictationProviderError('audio-rejected')
    if (language !== 'auto') form.append('language', language)
    const hints = [...new Set((request.keyterms ?? []).map((term) => term.trim()).filter(Boolean))]
    if (hints.length) form.append('prompt', hints.join(', '))
    const body = await this.request(
      '/transcribe',
      config.apiKey as string,
      { method: 'POST', body: form },
      30_000,
      request.signal,
    )
    if (!object(body) || !object(body.data) || typeof body.data.text !== 'string')
      throw new DictationProviderError('malformed-response')
    const data = body.data
    return {
      text: data.text as string,
      rawText: data.text as string,
      providerId: this.manifest.id,
      language: typeof data.language === 'string' ? data.language : undefined,
      durationMs:
        typeof data.duration_ms === 'number' &&
        Number.isFinite(data.duration_ms) &&
        data.duration_ms >= 0
          ? data.duration_ms
          : undefined,
      modelId: typeof data.model === 'string' ? data.model : undefined,
    }
  }

  private async request(
    path: string,
    apiKey: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const abort = new AbortController()
    const cancel = () => abort.abort()
    const timer = setTimeout(cancel, timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try {
      if (abort.signal.aborted) throw new DictationProviderError('timeout')
      const response = await this.fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        redirect: 'error',
        signal: abort.signal,
      })
      let body: unknown
      try {
        body = await response.json()
      } catch {
        if (abort.signal.aborted) throw new DictationProviderError('timeout')
        if (!response.ok) throw new DictationProviderError(httpError(response.status, null))
        throw new DictationProviderError('malformed-response')
      }
      if (abort.signal.aborted) throw new DictationProviderError('timeout')
      if (!response.ok) throw new DictationProviderError(httpError(response.status, body))
      return body
    } catch (error) {
      if (abort.signal.aborted) throw new DictationProviderError('timeout')
      if (error instanceof DictationProviderError) throw error
      throw new DictationProviderError('unreachable')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
}
