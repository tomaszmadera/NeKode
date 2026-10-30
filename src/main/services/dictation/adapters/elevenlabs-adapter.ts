import { AppError } from '@shared/ipc-error'
import { DictationDeadlineError, withDictationDeadline } from '../request-deadline'
import {
  type ConnectionTestResult,
  STT_ADAPTER_PROTOCOL_VERSION,
  type SttProviderAdapter,
  type SttProviderManifest,
  type TranscriptionRequest,
  type TranscriptionResult,
  type TranscriptionWord,
} from './adapter-contract'

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io'
const DEFAULT_MODEL = 'scribe_v2'
const DEFAULT_LANGUAGE = 'pl'

const MAX_KEYTERMS = 100
const MAX_KEYTERM_LENGTH = 50
const MAX_KEYTERM_WORDS = 5
const MAX_TRANSCRIPT_EDIT_LENGTH = 2000

// ElevenLabs Scribe v2 disallows < > { } [ ] \ in keyterms
const INVALID_KEYTERM_CHARS = /[<>{}[\]\\]/

export interface ElevenLabsAdapterDeps {
  fetch?: typeof globalThis.fetch
}

export class ElevenLabsAdapter implements SttProviderAdapter {
  readonly protocolVersion = STT_ADAPTER_PROTOCOL_VERSION
  readonly manifest: SttProviderManifest = {
    id: 'elevenlabs',
    name: 'ElevenLabs Scribe v2',
    description:
      'Batch audio transcription with Scribe v2, keyterm prompting, and native transcript editing',
    version: '1.0.0',
    protocolVersion: STT_ADAPTER_PROTOCOL_VERSION,
    capabilities: {
      keyterms: true,
      nativeEditing: true,
      languageSelection: true,
      modelDiscovery: false,
      timestamps: true,
    },
    configSchema: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'secret',
        required: true,
        placeholder: 'xi-...',
        description: 'ElevenLabs API key from your profile dashboard',
      },
      {
        key: 'language',
        label: 'Default Language',
        type: 'text',
        required: false,
        defaultValue: 'pl',
        placeholder: 'pl (or empty for auto-detect)',
        description: 'Language code (e.g. pl, eng) or empty/auto for automatic language detection',
      },
      {
        key: 'enableNativeEdit',
        label: 'Enable Transcript Editing (+30% surcharge)',
        type: 'boolean',
        required: false,
        defaultValue: false,
        description:
          'Format, punctuate, and clean up transcripts natively on ElevenLabs servers (+30% API cost)',
      },
      {
        key: 'nativeEditPrompt',
        label: 'Native Edit Instructions',
        type: 'text',
        required: false,
        defaultValue: '',
        placeholder: 'Format technical jargon and spell out symbols as words',
        description: 'Instructions for Scribe v2 native editing (max 2,000 characters)',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        defaultValue: DEFAULT_BASE_URL,
        description: 'API endpoint base URL override (optional)',
      },
    ],
  }

  private readonly fetch: typeof globalThis.fetch

  constructor(deps?: ElevenLabsAdapterDeps) {
    this.fetch = deps?.fetch ?? globalThis.fetch
  }

  async testConnection(config?: Record<string, unknown>): Promise<ConnectionTestResult> {
    try {
      return await withDictationDeadline((signal) =>
        this.testConnectionRequest(config ?? {}, signal),
      )
    } catch (error) {
      if (!(error instanceof DictationDeadlineError)) throw error
      return { ok: false, message: 'Dictation connection request timed out or was cancelled.' }
    }
  }

  async transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    try {
      return await withDictationDeadline(
        (signal) => this.transcribeRequest({ ...request, signal }, config),
        request.signal,
      )
    } catch (error) {
      if (error instanceof DictationDeadlineError)
        throw new AppError(
          'timeout',
          request.signal?.aborted
            ? 'Dictation transcription cancelled.'
            : 'Dictation transcription timeout.',
        )
      throw error
    }
  }

  private async testConnectionRequest(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ConnectionTestResult> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
    if (!apiKey) {
      return { ok: false, message: 'ElevenLabs API key is required.' }
    }

    const baseUrl =
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL

    try {
      const response = await this.fetch(`${baseUrl}/v1/user/subscription`, {
        method: 'GET',
        signal,
        headers: {
          'xi-api-key': apiKey,
          Accept: 'application/json',
        },
      })

      if (response.ok) {
        let details = 'active'
        try {
          const data = (await response.json()) as Record<string, unknown>
          if (data && typeof data.tier === 'string') {
            details = data.tier
          }
        } catch {
          // JSON parsing failure is non-fatal for 200 OK
        }
        return { ok: true, message: `Connected to ElevenLabs (subscription: ${details})` }
      }

      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: 'Invalid or expired ElevenLabs API key.' }
      }

      let errMessage = `HTTP ${response.status}`
      try {
        const errJson = (await response.json()) as Record<string, unknown>
        if (typeof errJson?.detail === 'string') {
          errMessage = errJson.detail
        } else if (errJson?.detail && typeof errJson.detail === 'object') {
          const detail = errJson.detail as Record<string, unknown>
          if (typeof detail.message === 'string') {
            errMessage = detail.message
          }
        }
      } catch {
        // Fall back to HTTP status
      }

      return { ok: false, message: `ElevenLabs connection check failed: ${errMessage}` }
    } catch (error) {
      return {
        ok: false,
        message: `Network error connecting to ElevenLabs: ${error instanceof Error ? error.message : 'unreachable'}`,
      }
    }
  }

  private async transcribeRequest(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
    if (!apiKey) {
      throw new AppError('validation', 'ElevenLabs API key is not configured.')
    }

    const baseUrl =
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL

    const formData = new FormData()
    const audioBlob = new Blob([request.audioWav], { type: 'audio/wav' })
    formData.append('file', audioBlob, 'audio.wav')
    formData.append('model_id', DEFAULT_MODEL)

    // Language handling
    const resolvedLanguage = (
      request.language ??
      (config.language as string) ??
      DEFAULT_LANGUAGE
    ).trim()
    if (resolvedLanguage && resolvedLanguage !== 'auto') {
      formData.append('language_code', resolvedLanguage)
    }

    // Keyterms processing & limits enforcement
    let keytermsWarning: string | null = null
    if (request.keyterms && Array.isArray(request.keyterms) && request.keyterms.length > 0) {
      let excludedCount = 0
      let addedCount = 0

      for (const rawTerm of request.keyterms) {
        if (typeof rawTerm !== 'string') {
          excludedCount++
          continue
        }

        const trimmed = rawTerm.trim()
        if (!trimmed) {
          continue
        }

        if (addedCount >= MAX_KEYTERMS) {
          excludedCount++
          continue
        }

        if (trimmed.length > MAX_KEYTERM_LENGTH) {
          excludedCount++
          continue
        }

        if (trimmed.split(/\s+/).length > MAX_KEYTERM_WORDS) {
          excludedCount++
          continue
        }

        if (INVALID_KEYTERM_CHARS.test(trimmed)) {
          excludedCount++
          continue
        }

        formData.append('keyterms', trimmed)
        addedCount++
      }

      if (excludedCount > 0) {
        keytermsWarning = `${excludedCount} keyterms excluded (exceeded API limits or invalid characters)`
      }
    }

    // Native transcript editing instruction
    let nativeEditRequested = false
    const nativeInstruction =
      request.nativeEditInstruction ??
      (config.enableNativeEdit ? (config.nativeEditPrompt as string) : undefined)

    if (nativeInstruction && nativeInstruction.trim().length > 0) {
      nativeEditRequested = true
      formData.append(
        'transcript_edit',
        nativeInstruction.trim().slice(0, MAX_TRANSCRIPT_EDIT_LENGTH),
      )
    }

    let response: Response
    try {
      response = await this.fetch(`${baseUrl}/v1/speech-to-text`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
        },
        body: formData,
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AppError('timeout', 'Dictation transcription cancelled or timed out.')
      }
      throw new AppError(
        'adapter',
        `ElevenLabs transcription request failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (!response.ok) {
      let message = `ElevenLabs transcription failed with status ${response.status}`
      try {
        const errJson = (await response.json()) as Record<string, unknown>
        if (typeof errJson?.detail === 'string') {
          message = errJson.detail
        } else if (errJson?.detail && typeof errJson.detail === 'object') {
          const detail = errJson.detail as Record<string, unknown>
          if (typeof detail.message === 'string') {
            message = detail.message
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
      throw new AppError('adapter', 'ElevenLabs returned invalid JSON response.')
    }

    const rawText = typeof data.text === 'string' ? data.text : ''
    let editedText: string | undefined
    let activeText = rawText
    let warning: string | null = keytermsWarning

    if (nativeEditRequested) {
      if (typeof data.edited_transcript === 'string' && data.edited_transcript.trim().length > 0) {
        editedText = data.edited_transcript
        activeText = data.edited_transcript
      } else {
        // Fallback to raw transcript when transcript_edit fails or is missing
        const editWarning = 'transcript_edit-failed'
        warning = warning ? `${warning}; ${editWarning}` : editWarning
      }
    }

    // Word timestamps & duration
    let words: TranscriptionWord[] | undefined
    let durationMs: number | undefined

    if (Array.isArray(data.words)) {
      words = []
      for (const w of data.words) {
        if (typeof w === 'object' && w !== null) {
          const wordObj = w as Record<string, unknown>
          const wordText =
            typeof wordObj.text === 'string'
              ? wordObj.text
              : typeof wordObj.word === 'string'
                ? wordObj.word
                : ''
          const start = typeof wordObj.start === 'number' ? wordObj.start : 0
          const end = typeof wordObj.end === 'number' ? wordObj.end : 0
          words.push({ word: wordText, start, end })
        }
      }

      if (words.length > 0) {
        const lastWord = words[words.length - 1]
        durationMs = Math.round(lastWord.end * 1000)
      }
    }

    return {
      text: activeText,
      rawText,
      editedText,
      providerId: 'elevenlabs',
      modelId: DEFAULT_MODEL,
      language: typeof data.language_code === 'string' ? data.language_code : resolvedLanguage,
      durationMs,
      words,
      warning,
    }
  }
}
