import type {
  ConfigFieldSchema,
  ConfigFieldType,
  DictationError,
  SttProviderCapabilities,
  SttProviderManifest,
} from '@shared/contracts/dictation-contract'

export const STT_ADAPTER_PROTOCOL_VERSION = 1

export type { ConfigFieldSchema, ConfigFieldType, SttProviderCapabilities, SttProviderManifest }

export interface TranscriptionWord {
  word: string
  start: number
  end: number
}

export interface TranscriptionRequest {
  audioWav: ArrayBuffer
  audioPath?: string
  language?: string
  model?: string
  keyterms?: string[]
  nativeEditInstruction?: string
  signal?: AbortSignal
}

export interface TranscriptionResult {
  text: string
  rawText: string
  editedText?: string
  providerId: string
  modelId?: string
  language?: string
  durationMs?: number
  words?: TranscriptionWord[]
  warning?: string | null
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

export interface DiscoveredModel {
  id: string
  name: string
}

export interface SttProviderAdapter {
  readonly manifest: SttProviderManifest
  readonly protocolVersion?: number
  /** Validate a configuration patch before any persistence (never receives masked secrets). */
  validateConfig?(config: Record<string, unknown>): void
  /** Local eligibility only; never performs a network request. */
  readinessError?(config: Record<string, unknown>): DictationError | null
  testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult>
  discoverModels?(config: Record<string, unknown>): Promise<DiscoveredModel[]>
  transcribe(
    request: TranscriptionRequest,
    config: Record<string, unknown>,
  ): Promise<TranscriptionResult>
}
