export type PostProcessingMode = 'disabled' | 'provider_native' | 'external_llm'
export type PostProcessingLevel = 'light' | 'medium' | 'full'

export interface DiffValidationResult {
  valid: boolean
  reason?: string
}

export interface GlossaryEntry {
  term: string
  aliases?: string[]
  description?: string | null
}

export interface PostProcessOptions {
  mode: PostProcessingMode
  level?: PostProcessingLevel
  apiKey?: string
  model?: string
  baseUrl?: string
  glossary?: GlossaryEntry[] | string[]
  signal?: AbortSignal
}

export interface PostProcessRequest {
  rawText: string
  nativeEditedText?: string
  options?: PostProcessOptions
  mode?: PostProcessingMode
  level?: PostProcessingLevel
  apiKey?: string
  model?: string
  baseUrl?: string
  glossary?: GlossaryEntry[] | string[]
  signal?: AbortSignal
}

export interface PostProcessResult {
  text: string
  rawText: string
  editedText?: string
  warning?: string | null
}
