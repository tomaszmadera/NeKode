import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateDictionaryEntryInput,
  DictationDictionaryEntry,
  DictationError,
  DictationPostProcessingSettings,
  DictationResult,
  DictationSettings,
  DictationStart,
  SttProviderSummary,
  UpdateDictionaryEntryInput,
} from '@shared/contracts/dictation-contract'
import { isDictationWav } from '@shared/contracts/dictation-contract'
import { APP_STATE_KEY, dictationProviderConfigKey } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import type { AppStateService } from '../app-state-service'
import { DictationProviderError } from './adapters/dictation-provider-error'
import { OpenWhisprAdapter } from './adapters/openwhispr-adapter'
import type { DictationDictionaryService } from './dictionary/dictation-dictionary-service'
import type { OpenWhisprClient } from './openwhispr-client'
import { PostProcessor } from './post-processing/post-processor'
import { ProviderRegistry } from './registry/provider-registry'
import {
  decryptSecret,
  ENCRYPTED_SECRET_PREFIX,
  encryptSecret,
  maskSecretMetadata,
  type SafeStorageLike,
} from './security/dictation-secrets'

interface Session {
  id: string
  chatId: string
  providerId: string
  state: 'recording' | 'transcribing'
  settings: DictationSettings
  abort: AbortController
  wav: ArrayBuffer | null
  path: string | null
  retried: boolean
  warning: string | null
  warningKey: string | null
}

export interface DictationServiceDeps {
  client?: OpenWhisprClient
  registry?: ProviderRegistry
  dictionaryService?: DictationDictionaryService
  postProcessor?: PostProcessor
  state?: AppStateService
  safeStorage?: SafeStorageLike
  resolveChatProjectId?: (chatId: string) => string | null
  root?: string
  isOwnerExited?: (pid: number) => boolean
}

const generatedWav = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.wav$/

/** Only ESRCH proves absence. Access denied and reused PIDs retain their files. */
function ownerExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
  }
}

/** Owns dictation takes, provider selection, dictionary biasing, and post-processing. */
export class DictationService {
  private active: Session | null = null
  private retry: Session | null = null
  private readonly listeners = new Set<(result: DictationResult) => void>()
  private readonly warnedSelections = new Set<string>()
  private readonly directory: string
  private closed = false

  private readonly client?: OpenWhisprClient
  private readonly registry: ProviderRegistry
  private readonly dictionaryService: DictationDictionaryService
  private readonly postProcessor: PostProcessor
  private readonly state: AppStateService
  private readonly safeStorage?: SafeStorageLike
  private readonly resolveChatProjectId?: (chatId: string) => string | null

  constructor(
    depsOrClient: DictationServiceDeps | OpenWhisprClient,
    root = join(tmpdir(), 'nekode-dictation'),
    isOwnerExited: (pid: number) => boolean = ownerExited,
  ) {
    const isDeps =
      typeof depsOrClient === 'object' &&
      depsOrClient !== null &&
      ('registry' in depsOrClient ||
        'dictionaryService' in depsOrClient ||
        'postProcessor' in depsOrClient ||
        'state' in depsOrClient)

    const deps: DictationServiceDeps = isDeps
      ? (depsOrClient as DictationServiceDeps)
      : { client: depsOrClient as OpenWhisprClient }

    this.client = deps.client
    this.safeStorage = deps.safeStorage
    this.resolveChatProjectId = deps.resolveChatProjectId

    if (deps.state) {
      this.state = deps.state
    } else {
      const mem = new Map<string, string>()
      this.state = {
        get: (k: string) => mem.get(k) ?? null,
        set: (k: string, v: string) => {
          mem.set(k, v)
        },
        delete: (k: string) => {
          mem.delete(k)
        },
      } as unknown as AppStateService
    }

    if (deps.registry) {
      this.registry = deps.registry
    } else {
      this.registry = new ProviderRegistry()
      if (this.client) {
        this.registry.register(new OpenWhisprAdapter(this.client))
      }
    }

    if (deps.dictionaryService) {
      this.dictionaryService = deps.dictionaryService
    } else {
      const dummyEntry: DictationDictionaryEntry = {
        id: '',
        term: '',
        aliases: [],
        description: null,
        scope: 'global',
        projectId: null,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      }
      this.dictionaryService = {
        getEffectiveDictionary: () => ({ terms: [], aliases: [] }),
        list: () => [],
        add: () => dummyEntry,
        update: () => dummyEntry,
        delete: () => {},
        toggle: () => dummyEntry,
      } as unknown as DictationDictionaryService
    }

    this.postProcessor = deps.postProcessor ?? new PostProcessor()

    const targetRoot = deps.root ?? root
    const checker = deps.isOwnerExited ?? isOwnerExited

    this.directory = join(targetRoot, `${process.pid}-${randomUUID()}`)
    try {
      mkdirSync(targetRoot, { recursive: true })
      const stats = lstatSync(targetRoot)
      if (!stats.isDirectory() || stats.isSymbolicLink())
        throw new Error('Invalid temporary directory')
      for (const owner of readdirSync(targetRoot)) {
        const match = /^([1-9]\d*)-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.exec(
          owner,
        )
        if (!match || !Number.isSafeInteger(Number(match[1])) || !checker(Number(match[1])))
          continue
        const directory = join(targetRoot, owner)
        try {
          const ownerStats = lstatSync(directory)
          if (!ownerStats.isDirectory() || ownerStats.isSymbolicLink()) continue
          for (const file of readdirSync(directory)) {
            const path = join(directory, file)
            if (generatedWav.test(file) && lstatSync(path).isFile()) unlinkSync(path)
          }
          if (readdirSync(directory).length === 0) rmdirSync(directory)
        } catch {
          // Stale owner directory cleanup is best-effort. Failures (e.g. concurrent ENOENT, EACCES) skip that entry.
        }
      }
      mkdirSync(this.directory)
    } catch {
      throw new AppError('unknown', 'Dictation temporary storage is unavailable.')
    }
  }

  onResult(listener: (result: DictationResult) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getActiveProvider(): string {
    const saved = this.state.get(APP_STATE_KEY.dictationActiveProvider)
    if (saved && this.registry.has(saved)) {
      return saved
    }
    if (this.registry.has('openwhispr')) {
      return 'openwhispr'
    }
    const manifests = this.registry.listManifests()
    return manifests[0]?.id ?? ''
  }

  setActiveProvider(providerId: string): void {
    if (!this.registry.has(providerId)) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    this.state.set(APP_STATE_KEY.dictationActiveProvider, providerId)
  }

  providersList(): SttProviderSummary[] {
    const manifests = this.registry.listManifests()
    return manifests.map((manifest) => {
      const raw = this.state.get(dictationProviderConfigKey(manifest.id))
      const stored: Record<string, unknown> = raw ? JSON.parse(raw) : {}
      let configured = true
      for (const field of manifest.configSchema) {
        if (field.required) {
          const val = stored[field.key]
          if (
            val === undefined ||
            val === null ||
            val === '' ||
            (field.type === 'boolean' && val !== true)
          ) {
            configured = false
            break
          }
          if (field.type === 'secret') {
            const meta = maskSecretMetadata(val as string, this.safeStorage)
            if (!meta.configured || !meta.valid) {
              configured = false
              break
            }
          }
        }
      }
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        capabilities: manifest.capabilities,
        configSchema: manifest.configSchema,
        configured,
      }
    })
  }

  providersGetConfig(providerId: string): Record<string, unknown> {
    const adapter = this.registry.get(providerId)
    if (!adapter) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    const raw = this.state.get(dictationProviderConfigKey(providerId))
    const rawConfig: Record<string, unknown> = raw ? JSON.parse(raw) : {}
    const config: Record<string, unknown> = {}
    for (const field of adapter.manifest.configSchema) {
      let val = rawConfig[field.key]
      if (val === undefined && field.defaultValue !== undefined) {
        val = field.defaultValue
      }
      if (field.type === 'secret') {
        val = maskSecretMetadata(val as string, this.safeStorage)
      }
      if (val !== undefined) {
        config[field.key] = val
      }
    }
    return config
  }

  providersSetConfig(providerId: string, newConfig: Record<string, unknown>): void {
    const adapter = this.registry.get(providerId)
    if (!adapter) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    adapter.validateConfig?.(newConfig)
    const raw = this.state.get(dictationProviderConfigKey(providerId))
    const existing: Record<string, unknown> = raw ? JSON.parse(raw) : {}
    for (const field of adapter.manifest.configSchema) {
      const val = newConfig[field.key]
      if (field.type === 'secret') {
        if (typeof val === 'string' && val.trim().length > 0) {
          if (val.startsWith(ENCRYPTED_SECRET_PREFIX)) {
            existing[field.key] = val
          } else {
            existing[field.key] = encryptSecret(val, this.safeStorage)
          }
        } else if (val === '' || val === null) {
          delete existing[field.key]
        }
      } else if (val !== undefined) {
        existing[field.key] = val
      }
    }
    this.state.set(dictationProviderConfigKey(providerId), JSON.stringify(existing))
  }

  private getDecryptedConfig(providerId: string): Record<string, unknown> {
    const adapter = this.registry.get(providerId)
    if (!adapter) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    const raw = this.state.get(dictationProviderConfigKey(providerId))
    const config: Record<string, unknown> = raw ? JSON.parse(raw) : {}
    for (const field of adapter.manifest.configSchema) {
      if (config[field.key] === undefined && field.defaultValue !== undefined) {
        config[field.key] = field.defaultValue
      }
      if (field.type === 'secret' && typeof config[field.key] === 'string') {
        config[field.key] = decryptSecret(config[field.key] as string, this.safeStorage)
      }
    }
    return config
  }

  async providersTestConnection(
    providerId: string,
    overrideConfig?: Record<string, unknown>,
  ): Promise<{ ok: boolean; message: string }> {
    const adapter = this.registry.get(providerId)
    if (!adapter) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    const baseConfig = this.getDecryptedConfig(providerId)
    const merged = { ...baseConfig }
    if (overrideConfig) {
      for (const field of adapter.manifest.configSchema) {
        if (overrideConfig[field.key] !== undefined) {
          const val = overrideConfig[field.key]
          if (field.type === 'secret') {
            if (
              typeof val === 'string' &&
              val.trim().length > 0 &&
              !val.startsWith(ENCRYPTED_SECRET_PREFIX)
            ) {
              merged[field.key] = val
            } else if (typeof val === 'string' && val.startsWith(ENCRYPTED_SECRET_PREFIX)) {
              merged[field.key] = decryptSecret(val, this.safeStorage)
            }
          } else {
            merged[field.key] = val
          }
        }
      }
    }
    return adapter.testConnection(merged)
  }

  async providersDiscoverModels(
    providerId: string,
    overrideConfig?: Record<string, unknown>,
  ): Promise<Array<{ id: string; name: string }>> {
    const adapter = this.registry.get(providerId)
    if (!adapter) {
      throw new AppError('not_found', `STT provider '${providerId}' not found.`)
    }
    if (!adapter.discoverModels) return []
    const baseConfig = this.getDecryptedConfig(providerId)
    const merged = { ...baseConfig }
    if (overrideConfig) {
      for (const field of adapter.manifest.configSchema) {
        if (overrideConfig[field.key] !== undefined) {
          const val = overrideConfig[field.key]
          if (field.type === 'secret') {
            if (
              typeof val === 'string' &&
              val.trim().length > 0 &&
              !val.startsWith(ENCRYPTED_SECRET_PREFIX)
            ) {
              merged[field.key] = val
            } else if (typeof val === 'string' && val.startsWith(ENCRYPTED_SECRET_PREFIX)) {
              merged[field.key] = decryptSecret(val, this.safeStorage)
            }
          } else {
            merged[field.key] = val
          }
        }
      }
    }
    return adapter.discoverModels(merged)
  }

  dictionaryList(projectId?: string): DictationDictionaryEntry[] {
    return this.dictionaryService.list(projectId ? { projectId } : undefined)
  }

  dictionaryAdd(entry: CreateDictionaryEntryInput): DictationDictionaryEntry {
    return this.dictionaryService.add(entry)
  }

  dictionaryUpdate(id: string, updates: UpdateDictionaryEntryInput): DictationDictionaryEntry {
    return this.dictionaryService.update(id, updates)
  }

  dictionaryDelete(id: string): void {
    this.dictionaryService.delete(id)
  }

  dictionaryToggle(id: string, enabled: boolean): DictationDictionaryEntry {
    return this.dictionaryService.toggle(id, enabled)
  }

  postProcessingGetSettings(): DictationPostProcessingSettings {
    const mode =
      (this.state.get(
        APP_STATE_KEY.dictationPostProcessingMode,
      ) as DictationPostProcessingSettings['mode']) ?? 'disabled'
    const level =
      (this.state.get(
        APP_STATE_KEY.dictationPostProcessingLevel,
      ) as DictationPostProcessingSettings['level']) ?? 'light'
    const model = this.state.get(APP_STATE_KEY.dictationPostProcessingModel) ?? 'openai/gpt-4o-mini'
    const keyCipher = this.state.get(APP_STATE_KEY.dictationPostProcessingApiKey)
    const hasApiKey = Boolean(keyCipher && keyCipher.trim().length > 0)
    return { mode, level, model, hasApiKey }
  }

  postProcessingSetSettings(settings: {
    mode: string
    level: string
    model?: string
    apiKey?: string
  }): void {
    if (!['disabled', 'provider_native', 'external_llm'].includes(settings.mode)) {
      throw new AppError(
        'validation',
        "Post-processing mode must be 'disabled', 'provider_native', or 'external_llm'.",
      )
    }
    if (!['light', 'medium', 'full'].includes(settings.level)) {
      throw new AppError(
        'validation',
        "Post-processing level must be 'light', 'medium', or 'full'.",
      )
    }
    this.state.set(APP_STATE_KEY.dictationPostProcessingMode, settings.mode)
    this.state.set(APP_STATE_KEY.dictationPostProcessingLevel, settings.level)
    if (settings.model !== undefined) {
      this.state.set(APP_STATE_KEY.dictationPostProcessingModel, settings.model)
    }
    if (settings.apiKey !== undefined) {
      if (settings.apiKey.trim().length > 0) {
        const enc = settings.apiKey.startsWith(ENCRYPTED_SECRET_PREFIX)
          ? settings.apiKey
          : encryptSecret(settings.apiKey, this.safeStorage)
        this.state.set(APP_STATE_KEY.dictationPostProcessingApiKey, enc)
      } else {
        this.state.delete(APP_STATE_KEY.dictationPostProcessingApiKey)
      }
    }
  }

  start(chatId: string, retrySessionId: string | null): DictationStart {
    if (this.closed || this.active) return { sessionId: null, error: null }
    const previous =
      retrySessionId !== null &&
      this.retry?.id === retrySessionId &&
      this.retry.chatId === chatId &&
      !this.retry.retried
        ? this.retry
        : null
    if (retrySessionId !== null && !previous)
      throw new AppError('validation', 'This dictation take cannot be retried.')
    const activeProviderId = previous?.providerId ?? this.getActiveProvider()
    const adapter = this.registry.get(activeProviderId)
    if (!adapter) {
      return { sessionId: null, error: 'no-model' }
    }
    const settings: DictationSettings = (activeProviderId === 'openwhispr'
      ? this.client?.getSettings()
      : undefined) ?? {
      enabled: true,
      language: 'default',
      model: 'default',
      timeoutSeconds: 30,
    }
    if (activeProviderId === 'openwhispr' && !settings.enabled)
      return { sessionId: null, error: 'disabled' }

    if (adapter.readinessError) {
      let config: Record<string, unknown>
      try {
        config = this.getDecryptedConfig(activeProviderId)
      } catch (error) {
        if (error instanceof AppError && error.code === 'validation')
          return { sessionId: null, error: 'auth-failed' }
        throw error
      }
      const error = adapter.readinessError(config)
      if (error) return { sessionId: null, error }
    }

    if (activeProviderId === 'openwhispr' && this.client) {
      const state = this.client.status().state
      if (state !== 'operational')
        return {
          sessionId: null,
          error: state === 'connected' || state === 'model-available' ? 'no-model' : state,
        }
    }

    this.retry = null

    let warning: string | null = null
    let stale: string | null = null
    if (activeProviderId === 'openwhispr' && this.client) {
      stale =
        this.client.status().staleModelSelection && settings.model !== 'default'
          ? JSON.stringify(settings.model)
          : null
      warning =
        stale && !this.warnedSelections.has(stale)
          ? 'The selected OpenWhispr model is unavailable. Using the OpenWhispr default.'
          : null
    }

    const session: Session = {
      id: randomUUID(),
      chatId,
      providerId: activeProviderId,
      state: 'recording',
      settings: previous?.settings ?? settings,
      abort: new AbortController(),
      wav: previous?.wav ?? null,
      path: null,
      retried: previous !== null,
      warning,
      warningKey: stale,
    }
    this.active = session
    if (previous && session.wav)
      queueMicrotask(() => {
        void this.audio(session.id, session.wav as ArrayBuffer)
      })
    return { sessionId: session.id, error: null }
  }

  async audio(id: string, wav: ArrayBuffer): Promise<void> {
    const session = this.active
    if (!session || session.id !== id || session.state !== 'recording') return
    if (!isDictationWav(wav))
      throw new AppError('validation', 'Dictation audio must be mono 16 kHz PCM WAV.')
    session.state = 'transcribing'
    session.wav = wav.slice(0)
    let result: DictationResult = this.result(session, 'failed', 'recording-failure')
    const activeProviderId = session.providerId
    result.providerId = activeProviderId
    const adapter = this.registry.get(activeProviderId)

    if (!adapter) {
      result.error = 'no-model'
      this.finishSession(session, result)
      return
    }

    try {
      session.path = join(this.directory, `${randomUUID()}.wav`)
      writeFileSync(session.path, Buffer.from(wav), { flag: 'wx' })
    } catch {
      result.outcome = 'failed'
      result.error = 'recording-failure'
      this.finishSession(session, result)
      return
    }

    try {
      const config = this.getDecryptedConfig(activeProviderId)
      const chatProjectId = this.resolveChatProjectId?.(session.chatId) ?? null
      const effectiveDict = this.dictionaryService.getEffectiveDictionary(
        chatProjectId ?? undefined,
      )
      const keyterms = adapter.manifest.capabilities.keyterms
        ? activeProviderId === 'openwhispr-cloud'
          ? [...effectiveDict.terms, ...effectiveDict.aliases]
          : effectiveDict.terms
        : undefined

      const ppSettings = this.postProcessingGetSettings()
      let nativeEditInstruction: string | undefined
      if (adapter.manifest.capabilities.nativeEditing) {
        nativeEditInstruction =
          ppSettings.mode === 'provider_native'
            ? (config.nativeEditPrompt as string) || 'Format and punctuate transcript.'
            : ''
      }

      const transcription = await adapter.transcribe(
        {
          audioWav: wav,
          language:
            (config.language as string) ||
            (session.settings.language !== 'default' ? session.settings.language : undefined),
          model:
            (config.model as string) ||
            (typeof session.settings.model === 'object' ? session.settings.model.model : undefined),
          keyterms,
          nativeEditInstruction,
          signal: session.abort.signal,
        },
        config,
      )

      if (this.active !== session) return

      const rawText = transcription.rawText ?? transcription.text
      if (rawText.length === 0) {
        result = this.result(session, 'no-speech')
        result.text = ''
        result.rawText = ''
        result.providerId = activeProviderId
        result.modelId = transcription.modelId
        result.warning = [session.warning, transcription.warning].filter(Boolean).join('\n') || null
      } else {
        let finalText = transcription.text
        let finalEdited = transcription.editedText
        let finalWarning =
          [session.warning, transcription.warning].filter(Boolean).join('\n') || null

        if (ppSettings.mode !== 'disabled') {
          let ppApiKey: string | undefined
          if (ppSettings.hasApiKey) {
            const rawKey = this.state.get(APP_STATE_KEY.dictationPostProcessingApiKey)
            ppApiKey = rawKey ? decryptSecret(rawKey, this.safeStorage) : undefined
          }

          const ppResult = await this.postProcessor.process({
            rawText,
            nativeEditedText: transcription.editedText,
            mode: ppSettings.mode,
            level: ppSettings.level,
            model: ppSettings.model,
            apiKey: ppApiKey,
            glossary: effectiveDict.terms,
            signal: session.abort.signal,
          })

          if (this.active !== session) return

          finalText = ppResult.text
          finalEdited = ppResult.editedText
          if (ppResult.warning) {
            finalWarning = [finalWarning, ppResult.warning].filter(Boolean).join('\n') || null
          }
        }

        result = this.result(session, 'success')
        result.text = finalText
        result.rawText = rawText
        result.editedText = finalEdited
        result.providerId = activeProviderId
        result.modelId = transcription.modelId
        result.warning = finalWarning
      }
    } catch (error) {
      if (this.active !== session) return
      const errMessage = error instanceof Error ? error.message : String(error)
      const matchedError = [
        'bridge-missing',
        'bridge-invalid',
        'unreachable',
        'auth-failed',
        'no-model',
        'timeout',
        'malformed-response',
        'microphone-unavailable',
        'disabled',
      ].find((e) => errMessage.includes(e))

      const isAuthError =
        matchedError === 'auth-failed' ||
        /\b(401|403)\b/i.test(errMessage) ||
        /\bunauthorized\b/i.test(errMessage) ||
        errMessage.includes('auth-failed')

      if (session.abort.signal.aborted || errMessage.includes('cancelled')) {
        result = this.result(session, 'cancelled')
      } else if (error instanceof DictationProviderError) {
        result = this.result(session, 'failed', error.error)
        if (error.error === 'timeout' && !session.retried) {
          result.retryable = true
          this.retry = session
        }
      } else if (
        (error instanceof AppError && error.code === 'timeout') ||
        matchedError === 'timeout'
      ) {
        result = this.result(session, 'failed', 'timeout')
        if (!session.retried) {
          result.retryable = true
          this.retry = session
        }
      } else if (isAuthError) {
        result = this.result(session, 'failed', 'auth-failed')
      } else if (matchedError) {
        result = this.result(session, 'failed', matchedError as DictationError)
      } else {
        result = this.result(session, 'failed', 'recording-failure')
      }
      result.providerId = activeProviderId
    } finally {
      this.finishSession(session, result)
    }
  }

  cancel(id: string): void {
    if (this.retry?.id === id) {
      this.retry.wav = null
      this.retry = null
    }
    const session = this.active
    if (!session || session.id !== id) return
    this.active = null
    session.abort.abort()
    session.wav = null
    const cleaned = this.cleanup(session)
    const result = this.result(
      session,
      cleaned ? 'cancelled' : 'failed',
      cleaned ? null : 'recording-failure',
    )
    result.providerId = session.providerId
    this.emit(result)
  }

  shutdown(): void {
    this.closed = true
    this.discard()
  }

  discard(): void {
    if (this.active) this.cancel(this.active.id)
    if (this.retry) {
      this.retry.wav = null
      this.retry = null
    }
  }

  private finishSession(session: Session, result: DictationResult): void {
    if (!this.cleanup(session)) {
      result.outcome = 'failed'
      result.error = 'recording-failure'
      this.retry = null
    }
    if (this.active === session) {
      this.active = null
      if (this.retry !== session) session.wav = null
      if (session.warningKey && result.warning) this.warnedSelections.add(session.warningKey)
      this.emit(result)
    }
  }

  private cleanup(session: Session): boolean {
    if (session.path === null) return true
    try {
      unlinkSync(session.path)
      session.path = null
      return true
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        session.path = null
        return true
      }
      return false
    }
  }

  private result(
    session: Session,
    outcome: DictationResult['outcome'],
    error: DictationResult['error'] = null,
  ): DictationResult {
    return {
      sessionId: session.id,
      chatId: session.chatId,
      outcome,
      error,
      text: '',
      warning: outcome === 'cancelled' ? null : session.warning,
      retryable: false,
    }
  }

  private emit(result: DictationResult): void {
    for (const listener of this.listeners) listener(result)
  }
}
