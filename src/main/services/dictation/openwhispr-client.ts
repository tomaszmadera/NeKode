import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  DictationConnectionState,
  DictationDictionary,
  DictationError,
  DictationSettings,
  DictationStatusSnapshot,
  LocalTranscribeModel,
} from '@shared/dictation-contract'
import { isDictationSettings } from '@shared/dictation-contract'
import { AppError } from '@shared/ipc-error'
import { DictationSettingsStore, type DictationStateStore } from './dictation-settings'

interface BridgeConfig {
  port: number
  token: string
}
type Discovery =
  | { state: 'ready'; config: BridgeConfig }
  | { state: 'bridge-invalid' | 'bridge-missing' }
type RequestResult =
  | { state: 'connected'; data: unknown }
  | { state: 'unreachable' | 'auth-failed' }

export function parseBridgeConfig(raw: string): Discovery {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { state: 'bridge-invalid' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { state: 'bridge-invalid' }
  const config = value as Record<string, unknown>
  if (
    config.version !== 1 ||
    typeof config.port !== 'number' ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.token !== 'string' ||
    config.token.trim().length === 0 ||
    /[\r\n]/.test(config.token)
  )
    return { state: 'bridge-invalid' }
  return { state: 'ready', config: { port: config.port, token: config.token } }
}

function parseModels(value: unknown): LocalTranscribeModel[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const data = (value as Record<string, unknown>).data
  if (!Array.isArray(data)) return null
  const models: LocalTranscribeModel[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const model = entry as Record<string, unknown>
    if (
      typeof model.provider !== 'string' ||
      !model.provider.trim() ||
      typeof model.model !== 'string' ||
      !model.model.trim() ||
      typeof model.downloaded !== 'boolean' ||
      typeof model.default !== 'boolean'
    )
      return null
    models.push({
      provider: model.provider,
      model: model.model,
      downloaded: model.downloaded,
      default: model.default,
    })
  }
  return models
}

export interface OpenWhisprClientOptions {
  state: DictationStateStore
  fetch?: typeof globalThis.fetch
  readBridgeFile?: () => Promise<string>
  now?: () => Date
}

export type TranscriptionResponse =
  | { text: string; warning: string | null; error: null }
  | { text: ''; warning: null; error: DictationError | 'cancelled' }

/** All bridge credentials and authenticated transport remain in main. */
export class OpenWhisprClient {
  private config: BridgeConfig | null = null
  private readonly settings: DictationSettingsStore
  private readonly fetch: typeof globalThis.fetch
  private readonly readBridgeFile: () => Promise<string>
  private readonly now: () => Date
  private queue: Promise<unknown> = Promise.resolve()
  private snapshot: DictationStatusSnapshot
  // Health/status checks must not invalidate routing for a take already in progress.
  private catalog: LocalTranscribeModel[] = []

  constructor(options: OpenWhisprClientOptions) {
    this.settings = new DictationSettingsStore(options.state)
    this.fetch = options.fetch ?? globalThis.fetch
    this.readBridgeFile =
      options.readBridgeFile ??
      (() => readFile(join(homedir(), '.openwhispr', 'cli-bridge.json'), 'utf8'))
    this.now = options.now ?? (() => new Date())
    const lastCheck = this.settings.lastCheck()
    // A previous process's check is historical evidence, never current readiness.
    this.snapshot = {
      state: lastCheck ? 'unreachable' : 'bridge-missing',
      checkedAt: lastCheck?.checkedAt ?? null,
      models: [],
      staleModelSelection: false,
      error: null,
    }
  }

  status(): DictationStatusSnapshot {
    return { ...this.snapshot, models: this.snapshot.models.map((model) => ({ ...model })) }
  }

  getSettings(): DictationSettings {
    return this.settings.get()
  }

  setSettings(settings: DictationSettings): DictationSettings {
    if (!isDictationSettings(settings))
      throw new AppError('validation', 'Dictation settings are invalid.')
    const previous = this.settings.get().model
    const unchanged =
      settings.model !== 'default' &&
      previous !== 'default' &&
      settings.model.provider === previous.provider &&
      settings.model.model === previous.model
    if (
      !unchanged &&
      settings.model !== 'default' &&
      !this.catalog.some(
        (model) =>
          model.downloaded &&
          settings.model !== 'default' &&
          model.provider === settings.model.provider &&
          model.model === settings.model.model,
      )
    )
      throw new AppError('validation', 'Choose a downloaded OpenWhispr model or the default model.')
    const result = this.settings.set(settings)
    if (this.snapshot.models.length > 0) this.applyModels(this.snapshot.models)
    return result
  }

  testConnection(): Promise<DictationStatusSnapshot> {
    return this.enqueue(false)
  }

  refreshModels(): Promise<DictationStatusSnapshot> {
    return this.enqueue(true)
  }

  async dictionaryList(): Promise<DictationDictionary> {
    // Independent of dictation settings, health and the downloaded model catalog.
    // v1.10.2 returns the complete string array and does not implement cursor requests.
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.discover()
      if (discovery.state !== 'ready') return { state: 'unavailable', error: discovery.state }
      const response = await this.request('/v1/dictionary/list', discovery.config)
      if (response.state !== 'connected') {
        if (attempt === 0) continue
        return { state: 'unavailable', error: response.state }
      }
      const value = response.data
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { state: 'unavailable', error: 'malformed-response' }
      const page = value as Record<string, unknown>
      if (
        !Array.isArray(page.data) ||
        page.data.some((term) => typeof term !== 'string') ||
        typeof page.has_more !== 'boolean' ||
        (page.next_cursor !== null && typeof page.next_cursor !== 'string') ||
        (page.has_more && (typeof page.next_cursor !== 'string' || !page.next_cursor.trim())) ||
        (!page.has_more && page.next_cursor !== null)
      )
        return { state: 'unavailable', error: 'malformed-response' }
      if (page.has_more) return { state: 'unavailable', error: 'unsupported-pagination' }
      if (page.data.length > 10_000) return { state: 'unavailable', error: 'dictionary-limit' }
      return { state: 'ready', terms: page.data as string[] }
    }
    return { state: 'unavailable', error: 'unreachable' }
  }

  async transcribe(
    path: string,
    settings: DictationSettings,
    signal: AbortSignal,
  ): Promise<TranscriptionResponse> {
    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) controller.abort()
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, settings.timeoutSeconds * 1000)
    const failure = (error: DictationError | 'cancelled'): TranscriptionResponse => ({
      text: '',
      warning: null,
      error,
    })
    const aborted = () => failure(timedOut ? 'timeout' : 'cancelled')
    let onAbort: () => void = () => undefined
    const stopped = new Promise<TranscriptionResponse>((resolve) => {
      onAbort = () => resolve(aborted())
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) onAbort()
    })
    const run = async (): Promise<TranscriptionResponse> => {
      const stale =
        settings.model !== 'default' &&
        !this.catalog.some(
          (model) =>
            model.downloaded &&
            settings.model !== 'default' &&
            model.provider === settings.model.provider &&
            model.model === settings.model.model,
        )
      if (settings.model !== 'default' && !stale) {
        const selected = settings.model
        const routed = this.catalog.find((model) => model.model === selected.model)
        if (!routed?.downloaded || routed.provider !== selected.provider) return failure('no-model')
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted) return aborted()
        if (this.config === null || attempt === 1) {
          const discovery = await this.discover()
          if (controller.signal.aborted) return aborted()
          if (discovery.state !== 'ready') {
            this.config = null
            this.finish(discovery.state)
            return failure(discovery.state)
          }
          this.config = discovery.config
        }
        const body: { path: string; language?: string; model?: string } = { path }
        if (settings.language !== 'default') body.language = settings.language
        if (settings.model !== 'default' && !stale) body.model = settings.model.model
        try {
          const response = await this.fetch(`http://127.0.0.1:${this.config.port}/v1/transcribe`, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${this.config.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          })
          if (controller.signal.aborted) {
            await response.body?.cancel()
            return aborted()
          }
          if (response.status === 401 || response.status === 403) {
            await response.body?.cancel()
            if (attempt === 0) continue
            this.finish('auth-failed')
            return failure('auth-failed')
          }
          if (response.status !== 200) {
            await response.body?.cancel()
            const defaultMissing = settings.model === 'default' || stale
            return failure(
              !this.catalog.some((model) => model.downloaded) ||
                (defaultMissing && this.catalog.find((model) => model.default)?.downloaded !== true)
                ? 'no-model'
                : 'malformed-response',
            )
          }
          let value: unknown
          try {
            value = await response.json()
          } catch {
            return failure('malformed-response')
          }
          if (controller.signal.aborted) return aborted()
          if (
            typeof value !== 'object' ||
            value === null ||
            !('data' in value) ||
            typeof value.data !== 'object' ||
            value.data === null
          )
            return failure('malformed-response')
          const data = value.data as Record<string, unknown>
          if (
            typeof data.text !== 'string' ||
            typeof data.provider !== 'string' ||
            typeof data.model !== 'string' ||
            (data.warning !== undefined && typeof data.warning !== 'string')
          )
            return failure('malformed-response')
          return {
            text: data.text,
            warning: typeof data.warning === 'string' ? data.warning : null,
            error: null,
          }
        } catch {
          if (controller.signal.aborted) return aborted()
          if (attempt === 0) continue
          this.finish('unreachable')
          return failure('unreachable')
        }
      }
      return failure('unreachable')
    }
    try {
      return await Promise.race([run(), stopped])
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  private enqueue(models: boolean): Promise<DictationStatusSnapshot> {
    const action = this.queue.then(() => this.check(models))
    // Keep subsequent explicit actions available after a rejected store operation.
    this.queue = action.then(
      () => undefined,
      () => undefined,
    )
    return action
  }

  private async discover(): Promise<Discovery> {
    try {
      return parseBridgeConfig(await this.readBridgeFile())
    } catch (error) {
      const missing =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
      return { state: missing ? 'bridge-missing' : 'bridge-invalid' }
    }
  }

  private async request(
    endpoint: '/v1/health' | '/v1/transcribe/models' | '/v1/dictionary/list',
    config: BridgeConfig,
  ): Promise<RequestResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    try {
      const response = await this.fetch(`http://127.0.0.1:${config.port}${endpoint}`, {
        headers: { Authorization: `Bearer ${config.token}` },
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel()
        return { state: 'auth-failed' }
      }
      if (response.status !== 200) {
        await response.body?.cancel()
        return { state: 'unreachable' }
      }
      if (endpoint === '/v1/health') {
        await response.body?.cancel()
        return { state: 'connected', data: null }
      }
      // A malformed successful response is distinct from failed transport.
      try {
        return { state: 'connected', data: await response.json() }
      } catch {
        return controller.signal.aborted
          ? { state: 'unreachable' }
          : { state: 'connected', data: null }
      }
    } catch {
      // Fetch errors can contain auth headers: never log or transport originals.
      return { state: 'unreachable' }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async check(withModels: boolean): Promise<DictationStatusSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      state: 'unreachable',
      models: [],
      staleModelSelection: false,
      error: null,
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.config === null || attempt === 1) {
        const discovery = await this.discover()
        if (discovery.state !== 'ready') {
          this.config = null
          return this.finish(discovery.state)
        }
        this.config = discovery.config
      }
      const health = await this.request('/v1/health', this.config)
      if (health.state !== 'connected') {
        if (attempt === 0) continue
        return this.finish(health.state)
      }
      if (!withModels) return this.finish('connected')
      const result = await this.request('/v1/transcribe/models', this.config)
      if (result.state !== 'connected') {
        if (attempt === 0) continue
        return this.finish(result.state)
      }
      const catalog = parseModels(result.data)
      if (catalog === null) {
        this.snapshot.error = 'malformed-response'
        return this.finish('connected')
      }
      this.catalog = catalog
      this.applyModels(catalog)
      return this.finish(this.snapshot.state)
    }
    throw new AppError('unknown', 'OpenWhispr connection check failed.')
  }

  private applyModels(models: LocalTranscribeModel[]): void {
    const selection = this.settings.get().model
    const downloaded = models.filter((model) => model.downloaded)
    const stale =
      selection !== 'default' &&
      !downloaded.some(
        (model) => model.provider === selection.provider && model.model === selection.model,
      )
    const routed =
      selection !== 'default' && !stale
        ? models.find((model) => model.model === selection.model)
        : models.find((model) => model.default)
    const usable =
      routed?.downloaded === true &&
      (selection === 'default' || stale || routed.provider === selection.provider)
    // FR-008: stale explicit selections remain usable through default fallback.
    // The installed bridge routes bare names and otherwise requires its configured default.
    this.snapshot = {
      ...this.snapshot,
      models,
      staleModelSelection: stale,
      state: usable ? 'operational' : downloaded.length > 0 ? 'model-available' : 'connected',
    }
  }

  private finish(state: DictationConnectionState): DictationStatusSnapshot {
    const checkedAt = this.now().toISOString()
    this.snapshot = { ...this.snapshot, state, checkedAt }
    this.settings.saveCheck(state, checkedAt)
    return this.status()
  }
}
