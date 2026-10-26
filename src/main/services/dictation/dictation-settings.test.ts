import { APP_STATE_KEY } from '@shared/ipc-contract'
import { describe, expect, it, vi } from 'vitest'
import { DictationSettingsStore } from './dictation-settings'

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const state = {
    get: (key: string) => values.get(key) ?? null,
    set: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  return { settings: new DictationSettingsStore(state), values, state }
}

describe('dictation settings persistence', () => {
  it('defaults to disabled, OpenWhispr language/model, and 30 seconds', () => {
    expect(store().settings.get()).toEqual({
      enabled: false,
      language: 'default',
      model: 'default',
      timeoutSeconds: 30,
    })
  })
  it('round-trips non-secret settings under the exact shared keys', () => {
    const { settings, values } = store()
    const input = {
      enabled: true,
      language: 'pl',
      model: { provider: 'custom', model: 'model' },
      timeoutSeconds: 5,
    }
    expect(settings.set(input)).toEqual(input)
    expect([...values]).toEqual([
      [APP_STATE_KEY.dictationEnabled, 'true'],
      [APP_STATE_KEY.dictationLanguage, 'pl'],
      [APP_STATE_KEY.dictationModel, JSON.stringify(input.model)],
      [APP_STATE_KEY.dictationTimeoutSeconds, '5'],
    ])
    expect(settings.set({ ...input, model: 'default', timeoutSeconds: 300 }).model).toBe('default')
  })
  it.each([4, 301, 5.5, NaN, Infinity, '30'])(
    'rejects invalid timeout %s before any write',
    (timeoutSeconds) => {
      const { settings, state } = store()
      expect(() => settings.set({ ...settings.get(), timeoutSeconds } as never)).toThrow(
        'Dictation settings are invalid.',
      )
      expect(state.set).not.toHaveBeenCalled()
    },
  )
  it('does not silently hide invalid stored values or expose their contents', () => {
    const { settings } = store({ [APP_STATE_KEY.dictationModel]: 'private-corrupt-value' })
    expect(() => settings.get()).toThrow('Stored dictation settings are invalid.')
  })
  it('persists only state and timestamp for last check', () => {
    const { settings, values } = store()
    settings.saveCheck('operational', '2026-10-10T15:00:00Z')
    expect(settings.lastCheck()).toEqual({
      state: 'operational',
      checkedAt: '2026-10-10T15:00:00Z',
    })
    expect([...values.keys()]).toEqual([APP_STATE_KEY.dictationStatus])
  })
})
