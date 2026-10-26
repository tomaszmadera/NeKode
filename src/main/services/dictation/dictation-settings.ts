import {
  DICTATION_CONNECTION_STATES,
  type DictationConnectionState,
  type DictationSettings,
  isDictationSettings,
} from '@shared/contracts/dictation-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'

export interface DictationStateStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError('validation', 'Stored dictation settings are invalid.')
  }
}

export class DictationSettingsStore {
  constructor(private readonly state: DictationStateStore) {}

  get(): DictationSettings {
    const enabled = this.state.get(APP_STATE_KEY.dictationEnabled)
    const language = this.state.get(APP_STATE_KEY.dictationLanguage)
    const model = this.state.get(APP_STATE_KEY.dictationModel)
    const timeout = this.state.get(APP_STATE_KEY.dictationTimeoutSeconds)
    const settings = {
      enabled: enabled === null ? false : parseStored(enabled),
      language: language ?? 'default',
      model: model === null ? 'default' : parseStored(model),
      timeoutSeconds: timeout === null ? 30 : parseStored(timeout),
    }
    if (!isDictationSettings(settings))
      throw new AppError('validation', 'Stored dictation settings are invalid.')
    return settings
  }

  set(settings: DictationSettings): DictationSettings {
    if (!isDictationSettings(settings))
      throw new AppError('validation', 'Dictation settings are invalid.')
    this.state.set(APP_STATE_KEY.dictationEnabled, JSON.stringify(settings.enabled))
    this.state.set(APP_STATE_KEY.dictationLanguage, settings.language)
    this.state.set(APP_STATE_KEY.dictationModel, JSON.stringify(settings.model))
    this.state.set(APP_STATE_KEY.dictationTimeoutSeconds, JSON.stringify(settings.timeoutSeconds))
    return this.get()
  }

  lastCheck(): { state: DictationConnectionState; checkedAt: string } | null {
    const raw = this.state.get(APP_STATE_KEY.dictationStatus)
    if (raw === null) return null
    const parsed = parseStored(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new AppError('validation', 'Stored dictation status is invalid.')
    const value = parsed as Record<string, unknown>
    if (
      Object.keys(value).length !== 2 ||
      !DICTATION_CONNECTION_STATES.includes(value.state as DictationConnectionState) ||
      typeof value.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.checkedAt))
    )
      throw new AppError('validation', 'Stored dictation status is invalid.')
    return { state: value.state as DictationConnectionState, checkedAt: value.checkedAt }
  }

  saveCheck(state: DictationConnectionState, checkedAt: string): void {
    this.state.set(APP_STATE_KEY.dictationStatus, JSON.stringify({ state, checkedAt }))
  }
}
