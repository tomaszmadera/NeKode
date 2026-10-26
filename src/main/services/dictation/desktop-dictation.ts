import type {
  DesktopDictationSettings,
  DesktopDictationSetup,
} from '@shared/contracts/desktop-dictation-contract'
import { isDesktopDictationSettings } from '@shared/contracts/desktop-dictation-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import type { DictationStateStore } from './dictation-settings'

export class DesktopDictation {
  private pending = false

  constructor(
    private readonly state: DictationStateStore,
    private readonly send: (handle: string) => Promise<void>,
    private readonly platform = process.platform,
  ) {}

  get(): DesktopDictationSetup {
    const raw = this.state.get(APP_STATE_KEY.dictationDesktop)
    let settings: unknown = { enabled: false, confirmed: false }
    if (raw !== null) {
      try {
        settings = JSON.parse(raw)
      } catch {
        throw new AppError('validation', 'Stored desktop dictation settings are invalid.')
      }
    }
    if (!isDesktopDictationSettings(settings))
      throw new AppError('validation', 'Stored desktop dictation settings are invalid.')
    return { settings, supported: this.platform === 'win32' }
  }

  set(settings: DesktopDictationSettings): DesktopDictationSetup {
    if (!isDesktopDictationSettings(settings))
      throw new AppError('validation', 'Desktop dictation settings are invalid.')
    const previous = this.get().settings
    // Changing enablement always requires a fresh, separate confirmation.
    const confirmed = settings.enabled === previous.enabled ? settings.confirmed : false
    this.state.set(
      APP_STATE_KEY.dictationDesktop,
      JSON.stringify({ enabled: settings.enabled, confirmed }),
    )
    return this.get()
  }

  async activate(handle: string): Promise<void> {
    const setup = this.get()
    if (!setup.supported) throw new AppError('validation', 'Desktop dictation requires Windows.')
    if (!setup.settings.enabled || !setup.settings.confirmed)
      throw new AppError(
        'validation',
        'Enable desktop dictation and confirm OpenWhispr Ctrl + Super / Tap in Settings.',
      )
    if (this.pending) return
    this.pending = true
    try {
      await this.send(handle)
    } finally {
      this.pending = false
    }
  }
}
