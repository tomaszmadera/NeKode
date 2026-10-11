export const DICTATION_CONNECTION_STATES = [
  'bridge-missing',
  'bridge-invalid',
  'unreachable',
  'auth-failed',
  'connected',
  'model-available',
  'operational',
] as const

export type DictationConnectionState = (typeof DICTATION_CONNECTION_STATES)[number]
export type DictationDictionaryError =
  | 'bridge-missing'
  | 'bridge-invalid'
  | 'unreachable'
  | 'auth-failed'
  | 'malformed-response'
  | 'unsupported-pagination'
  | 'dictionary-limit'

/** Raw terms only. Bridge authentication and transport details stay in main. */
export type DictationDictionary =
  | { state: 'ready'; terms: string[] }
  | { state: 'unavailable'; error: DictationDictionaryError }

export type DictationModelSelection = 'default' | { provider: string; model: string }

export type DictationError =
  | 'bridge-missing'
  | 'bridge-invalid'
  | 'unreachable'
  | 'auth-failed'
  | 'no-model'
  | 'timeout'
  | 'malformed-response'
  | 'recording-failure'
  | 'microphone-unavailable'
  | 'disabled'

export interface DictationResult {
  sessionId: string
  chatId: string
  outcome: 'success' | 'no-speech' | 'failed' | 'cancelled'
  text: string
  warning: string | null
  error: DictationError | null
  retryable: boolean
}

export interface DictationStart {
  sessionId: string | null
  error: DictationError | null
}

export function isDictationResult(value: unknown): value is DictationResult {
  if (!object(value)) return false
  return (
    typeof value.sessionId === 'string' &&
    typeof value.chatId === 'string' &&
    ['success', 'no-speech', 'failed', 'cancelled'].includes(value.outcome as string) &&
    typeof value.text === 'string' &&
    (value.warning === null || typeof value.warning === 'string') &&
    (value.error === null ||
      [
        'bridge-missing',
        'bridge-invalid',
        'unreachable',
        'auth-failed',
        'no-model',
        'timeout',
        'malformed-response',
        'recording-failure',
        'microphone-unavailable',
        'disabled',
      ].includes(value.error as string)) &&
    typeof value.retryable === 'boolean'
  )
}

// About 17 minutes of PCM, bounded before IPC allocation reaches filesystem work.
export const MAX_DICTATION_AUDIO_BYTES = 32 * 1024 * 1024

export function isDictationWav(value: unknown): value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    value.byteLength < 44 ||
    value.byteLength > MAX_DICTATION_AUDIO_BYTES
  )
    return false
  const bytes = new Uint8Array(value)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const view = new DataView(value)
  return (
    tag(0) === 'RIFF' &&
    tag(8) === 'WAVE' &&
    tag(12) === 'fmt ' &&
    tag(36) === 'data' &&
    view.getUint32(4, true) === value.byteLength - 8 &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === 16000 &&
    view.getUint32(28, true) === 32000 &&
    view.getUint16(32, true) === 2 &&
    view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) === value.byteLength - 44 &&
    (value.byteLength - 44) % 2 === 0
  )
}

export interface LocalTranscribeModel {
  provider: string
  model: string
  downloaded: boolean
  default: boolean
}

export interface DictationSettings {
  enabled: boolean
  language: string
  model: DictationModelSelection
  timeoutSeconds: number
}

/** No credentials, bridge paths or transport details cross this boundary. */
export interface DictationStatusSnapshot {
  state: DictationConnectionState
  checkedAt: string | null
  models: LocalTranscribeModel[]
  staleModelSelection: boolean
  error: 'malformed-response' | null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDictationModelSelection(value: unknown): value is DictationModelSelection {
  if (value === 'default') return true
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    typeof value.provider === 'string' &&
    value.provider.trim().length > 0 &&
    !value.provider.includes('\u0000') &&
    typeof value.model === 'string' &&
    value.model.trim().length > 0 &&
    !value.model.includes('\u0000')
  )
}

export function isDictationSettings(value: unknown): value is DictationSettings {
  return (
    object(value) &&
    Object.keys(value).length === 4 &&
    typeof value.enabled === 'boolean' &&
    typeof value.language === 'string' &&
    (value.language === 'default' || /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value.language)) &&
    isDictationModelSelection(value.model) &&
    typeof value.timeoutSeconds === 'number' &&
    Number.isInteger(value.timeoutSeconds) &&
    value.timeoutSeconds >= 5 &&
    value.timeoutSeconds <= 300
  )
}
