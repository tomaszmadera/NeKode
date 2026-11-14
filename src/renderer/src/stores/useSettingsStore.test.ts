import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  DEFAULT_RESUME_INSTRUCTION,
  DEFAULT_START_INSTRUCTION,
} from '@shared/contracts/action-instructions-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATTENTION_SETTINGS } from '../lib/attention-settings'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILIES_STORAGE_KEY,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
} from '../lib/terminal-font'
import { TERMINAL_CTRL_V_PASTE_STORAGE_KEY } from '../lib/terminal-paste'
import { QUICK_THEME_SWITCH_STORAGE_KEY, THEME_STORAGE_KEY } from '../lib/theme'
import {
  createSettingsStore,
  MASCOT_VISIBLE_STORAGE_KEY,
  settingsError,
  TERMINAL_ACTIONS_VISIBLE_STORAGE_KEY,
} from './useSettingsStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeApp(values: Record<string, string | null> = {}) {
  const get = vi.fn(async (key: string) => values[key] ?? null)
  const set = vi.fn(async (_key: string, _value: string) => undefined)
  return { state: { get, set } }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('settings store: device-local settings', () => {
  it('starts from defaults and reads every localStorage key exactly once at creation', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const state = createSettingsStore({ app: fakeApp(), reportError: vi.fn() }).getState()
    // Order is unobservable (independent reads); the sorted comparison still
    // fails when a key is read twice or not at all.
    expect(getItem.mock.calls.map(([key]) => key).sort()).toEqual(
      [
        MASCOT_VISIBLE_STORAGE_KEY,
        THEME_STORAGE_KEY,
        QUICK_THEME_SWITCH_STORAGE_KEY,
        TERMINAL_FONT_SIZE_STORAGE_KEY,
        TERMINAL_FONT_FAMILIES_STORAGE_KEY,
        TERMINAL_CTRL_V_PASTE_STORAGE_KEY,
        TERMINAL_ACTIONS_VISIBLE_STORAGE_KEY,
      ].sort(),
    )
    expect(state).toMatchObject({
      theme: 'nekode-float',
      quickThemeSwitch: false,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      terminalFontFamilies: DEFAULT_TERMINAL_FONT_FAMILIES,
      terminalCtrlVPaste: true,
      terminalActionsVisible: true,
      mascotVisible: true,
      autoSendHandoff: false,
      chatSwitchEnabled: true,
      projectNamesUppercase: true,
      showProjectIcons: true,
      attentionSettings: DEFAULT_ATTENTION_SETTINGS,
    })
    expect(settingsError(state)).toBeNull()
  })

  it('writes each change synchronously in the stored format and a new store reads it back', () => {
    const app = fakeApp()
    const store = createSettingsStore({ app, reportError: vi.fn() })
    const actions = store.getState()
    actions.setTheme('nekode-flat')
    actions.setQuickThemeSwitch(true)
    actions.setTerminalFontSize(18)
    actions.setTerminalCtrlVPaste(false)
    actions.setTerminalActionsVisible(false)
    actions.toggleMascot()

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('nekode-flat')
    expect(localStorage.getItem(QUICK_THEME_SWITCH_STORAGE_KEY)).toBe('1')
    expect(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)).toBe('18')
    expect(localStorage.getItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY)).toBe('0')
    expect(localStorage.getItem(TERMINAL_ACTIONS_VISIBLE_STORAGE_KEY)).toBe('0')
    expect(localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY)).toBe('0')
    actions.setTerminalFontFamilies(DEFAULT_TERMINAL_FONT_FAMILIES)
    expect(localStorage.getItem(TERMINAL_FONT_FAMILIES_STORAGE_KEY)).toBe(
      JSON.stringify(DEFAULT_TERMINAL_FONT_FAMILIES),
    )
    // Device-local settings never go through app_state.
    expect(app.state.set).not.toHaveBeenCalled()

    const reloaded = createSettingsStore({ app, reportError: vi.fn() }).getState()
    expect(reloaded).toMatchObject({
      theme: 'nekode-flat',
      quickThemeSwitch: true,
      terminalFontSize: 18,
      terminalCtrlVPaste: false,
      terminalActionsVisible: false,
      mascotVisible: false,
    })
    reloaded.toggleMascot()
    expect(localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY)).toBe('1')
  })

  it('keeps defaults with load errors when localStorage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const state = createSettingsStore({ app: fakeApp(), reportError: vi.fn() }).getState()
    expect(state).toMatchObject({
      theme: 'nekode-float',
      themeError: 'Failed to load the saved theme.',
      quickThemeSwitch: false,
      quickThemeSwitchError: 'Failed to load the quick theme switch setting.',
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      terminalFontSizeError: null,
      terminalFontFamilies: DEFAULT_TERMINAL_FONT_FAMILIES,
      terminalFontError: 'Failed to load the saved terminal fonts.',
      terminalCtrlVPaste: true,
      terminalPasteError: 'Failed to load the saved terminal paste setting.',
      terminalActionsVisible: true,
      terminalActionsError: 'Failed to load the terminal actions setting.',
      mascotVisible: true,
      mascotError: 'Failed to load the mascot setting.',
    })
    // App Settings shows the first failure in this order.
    expect(settingsError(state)).toBe('Failed to load the saved theme.')
  })

  it.each(['1', 'junk'])('keeps terminal actions visible for stored value %s', (value) => {
    localStorage.setItem(TERMINAL_ACTIONS_VISIBLE_STORAGE_KEY, value)
    const store = createSettingsStore({ app: fakeApp(), reportError: vi.fn() })
    expect(store.getState().terminalActionsVisible).toBe(true)
  })

  it('applies action visibility despite a save failure and clears the error after retry', () => {
    const store = createSettingsStore({ app: fakeApp(), reportError: vi.fn() })
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    store.getState().setTerminalActionsVisible(false)
    expect(store.getState().terminalActionsVisible).toBe(false)
    expect(settingsError(store.getState())).toBe('Failed to save the terminal actions setting.')
    save.mockRestore()
    store.getState().setTerminalActionsVisible(true)
    expect(settingsError(store.getState())).toBeNull()
    expect(localStorage.getItem(TERMINAL_ACTIONS_VISIBLE_STORAGE_KEY)).toBe('1')
  })

  it('reports a failed save; theme, quick switch, fonts keep their value, paste and mascot apply', () => {
    const store = createSettingsStore({ app: fakeApp(), reportError: vi.fn() })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const actions = store.getState()
    actions.setTerminalFontSize(20)
    expect(store.getState().terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(settingsError(store.getState())).toBe('Failed to save the terminal font size.')
    actions.setTerminalFontFamilies({ ...DEFAULT_TERMINAL_FONT_FAMILIES, text: 'Other Mono' })
    expect(store.getState().terminalFontFamilies).toEqual(DEFAULT_TERMINAL_FONT_FAMILIES)
    expect(settingsError(store.getState())).toBe('Failed to save the terminal fonts.')
    actions.setTerminalCtrlVPaste(false)
    expect(store.getState().terminalCtrlVPaste).toBe(false)
    expect(settingsError(store.getState())).toBe('Failed to save the terminal paste setting.')
    actions.setQuickThemeSwitch(true)
    expect(store.getState().quickThemeSwitch).toBe(false)
    expect(settingsError(store.getState())).toBe('Failed to save the quick theme switch setting.')
    actions.setTheme('nekode-flat')
    expect(store.getState().theme).toBe('nekode-float')
    expect(settingsError(store.getState())).toBe('Failed to save the theme.')
    actions.toggleMascot()
    expect(store.getState()).toMatchObject({
      mascotVisible: false,
      mascotError: 'Failed to save the mascot setting.',
    })

    vi.mocked(Storage.prototype.setItem).mockRestore()
    actions.setTheme('nekode-flat')
    expect(store.getState().themeError).toBeNull()
  })
})

describe('settings store: app_state settings', () => {
  it('hydrates the stored keys once each and parses missing, "1" and "0" values', async () => {
    const app = fakeApp({
      [APP_STATE_KEY.autoSendHandoffResume]: '1',
      [APP_STATE_KEY.chatSwitchEnabled]: '0',
      [APP_STATE_KEY.projectNamesUppercase]: '0',
      [APP_STATE_KEY.showProjectIcons]: null,
      [APP_STATE_KEY.attentionBadgeEnabled]: '0',
      [APP_STATE_KEY.attentionChimeEnabled]: '1',
      [APP_STATE_KEY.attentionActiveChimeEnabled]: null,
      [APP_STATE_KEY.attentionActiveIndicatorEnabled]: '0',
      [APP_STATE_KEY.handoffInstruction]: 'Record {state}\nand stop',
      [APP_STATE_KEY.continueInstruction]: null,
    })
    const store = createSettingsStore({ app, reportError: vi.fn() })
    store.getState().hydrate()
    // The reads are issued in parallel, so only the set of keys is observable.
    expect(app.state.get.mock.calls.map(([key]) => key).sort()).toEqual(
      [
        APP_STATE_KEY.autoSendHandoffResume,
        APP_STATE_KEY.chatSwitchEnabled,
        APP_STATE_KEY.projectNamesUppercase,
        APP_STATE_KEY.showProjectIcons,
        APP_STATE_KEY.attentionBadgeEnabled,
        APP_STATE_KEY.attentionChimeEnabled,
        APP_STATE_KEY.attentionActiveChimeEnabled,
        APP_STATE_KEY.attentionActiveIndicatorEnabled,
        APP_STATE_KEY.handoffInstruction,
        APP_STATE_KEY.continueInstruction,
        APP_STATE_KEY.startInstruction,
        APP_STATE_KEY.resumeInstruction,
        APP_STATE_KEY.resumeMigration,
      ].sort(),
    )
    await flush()
    expect(store.getState()).toMatchObject({
      autoSendHandoff: true,
      chatSwitchEnabled: false,
      projectNamesUppercase: false,
      showProjectIcons: true,
      attentionSettings: { badge: false, chime: true, activeChime: true, activeIndicator: false },
      handoffInstruction: 'Record {state}\nand stop',
      handoffInstructionError: null,
      continueInstruction: 'Continue',
      continueInstructionError: null,
    })
  })

  it('writes a change immediately as "1"/"0" and reports a failed save on the notice', async () => {
    const app = fakeApp()
    const reportError = vi.fn()
    const store = createSettingsStore({ app, reportError })
    const actions = store.getState()
    actions.setAutoSendHandoff(true)
    actions.setChatSwitchEnabled(false)
    actions.setProjectNamesUppercase(false)
    actions.setAttentionSetting('chime', false)
    app.state.set.mockRejectedValueOnce(new Error('disk'))
    actions.setShowProjectIcons(false)
    // State and the write happen in the same call, before any await.
    expect(app.state.set.mock.calls).toEqual([
      [APP_STATE_KEY.autoSendHandoffResume, '1'],
      [APP_STATE_KEY.chatSwitchEnabled, '0'],
      [APP_STATE_KEY.projectNamesUppercase, '0'],
      [APP_STATE_KEY.attentionChimeEnabled, '0'],
      [APP_STATE_KEY.showProjectIcons, '0'],
    ])
    expect(store.getState()).toMatchObject({
      autoSendHandoff: true,
      chatSwitchEnabled: false,
      projectNamesUppercase: false,
      showProjectIcons: false,
      attentionSettings: { ...DEFAULT_ATTENTION_SETTINGS, chime: false },
    })
    await flush()
    expect(reportError).toHaveBeenCalledWith('Failed to save show project icons setting.')
  })

  it('lets a change made before hydration win and drops results after cancel', async () => {
    const uppercase = deferred<string | null>()
    const autoSend = deferred<string | null>()
    const app = fakeApp()
    app.state.get.mockImplementation(async (key: string) => {
      if (key === APP_STATE_KEY.projectNamesUppercase) return uppercase.promise
      if (key === APP_STATE_KEY.autoSendHandoffResume) return autoSend.promise
      return null
    })
    const reportError = vi.fn()
    const store = createSettingsStore({ app, reportError })
    const cancel = store.getState().hydrate()
    store.getState().setProjectNamesUppercase(false)
    uppercase.resolve('1')
    await flush()
    expect(store.getState().projectNamesUppercase).toBe(false)

    cancel()
    autoSend.reject(new Error('late'))
    await flush()
    expect(store.getState().autoSendHandoff).toBe(false)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('saves and resets Handoff and Continue instructions exactly', () => {
    const app = fakeApp()
    const store = createSettingsStore({ app, reportError: vi.fn() })
    const actions = store.getState()

    expect(actions.setHandoffInstruction('Record {state}\nand stop')).toBeNull()
    expect(actions.setContinueInstruction('Go\non')).toBeNull()
    expect(app.state.set.mock.calls).toEqual([
      [APP_STATE_KEY.handoffInstruction, 'Record {state}\nand stop'],
      [APP_STATE_KEY.continueInstruction, 'Go\non'],
    ])
    expect(store.getState()).toMatchObject({
      handoffInstruction: 'Record {state}\nand stop',
      continueInstruction: 'Go\non',
    })

    actions.resetHandoffInstruction()
    expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.handoffInstruction, '')
    expect(store.getState().handoffInstruction).toBe(DEFAULT_HANDOFF_INSTRUCTION)
    actions.resetContinueInstruction()
    expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.continueInstruction, '')
    expect(store.getState().continueInstruction).toBe(DEFAULT_CONTINUE_INSTRUCTION)
  })

  it('rejects blank instructions without writing state', () => {
    const app = fakeApp()
    const store = createSettingsStore({ app, reportError: vi.fn() })

    expect(store.getState().setHandoffInstruction('  \n ')).toBe(
      'Instruction cannot be empty. Use Reset to default.',
    )
    expect(store.getState().setContinueInstruction('a\u0000b')).toBe(
      'Instruction cannot contain a null character.',
    )
    expect(app.state.set).not.toHaveBeenCalled()
    expect(store.getState().handoffInstruction).toBe(DEFAULT_HANDOFF_INSTRUCTION)
    expect(store.getState().continueInstruction).toBe(DEFAULT_CONTINUE_INSTRUCTION)
  })

  it('restores the previous text when an instruction save fails', async () => {
    const app = fakeApp()
    const reportError = vi.fn()
    const store = createSettingsStore({ app, reportError })
    app.state.set.mockRejectedValueOnce(new Error('disk'))

    expect(store.getState().setHandoffInstruction('New handoff')).toBeNull()
    expect(store.getState().handoffInstruction).toBe('New handoff')
    await flush()

    expect(store.getState().handoffInstruction).toBe(DEFAULT_HANDOFF_INSTRUCTION)
    expect(reportError).toHaveBeenCalledWith('Failed to save the Handoff instruction.')
  })

  it('falls back visibly for an invalid stored instruction', async () => {
    const app = fakeApp({
      [APP_STATE_KEY.handoffInstruction]: 'bad\u0000text',
      [APP_STATE_KEY.continueInstruction]: '   ',
    })
    const store = createSettingsStore({ app, reportError: vi.fn() })
    store.getState().hydrate()
    await flush()

    expect(store.getState().handoffInstruction).toBe(DEFAULT_HANDOFF_INSTRUCTION)
    expect(store.getState().handoffInstructionError).toContain('invalid')
    expect(store.getState().continueInstruction).toBe(DEFAULT_CONTINUE_INSTRUCTION)
    expect(store.getState().continueInstructionError).toBeNull()
  })

  it('hydrates Start, Resume and the migration notice with visible fallbacks', async () => {
    const notice = { prompts: [{ prompt: 'Old {taskPath}', templates: ['A'] }] }
    const app = fakeApp({
      [APP_STATE_KEY.startInstruction]: 'Take {ref}\n\n{url}',
      [APP_STATE_KEY.resumeInstruction]: 'No path here',
      [APP_STATE_KEY.resumeMigration]: JSON.stringify(notice),
    })
    const store = createSettingsStore({ app, reportError: vi.fn() })
    store.getState().hydrate()
    await flush()

    expect(store.getState()).toMatchObject({
      startInstruction: 'Take {ref}\n\n{url}',
      startInstructionError: null,
      resumeInstruction: DEFAULT_RESUME_INSTRUCTION,
      resumeMigrationNotice: notice,
    })
    expect(store.getState().resumeInstructionError).toContain(
      'The saved Resume instruction is invalid.',
    )
  })

  it('validates, saves and resets Start and Resume instructions', () => {
    const app = fakeApp()
    const store = createSettingsStore({ app, reportError: vi.fn() })
    const actions = store.getState()

    expect(actions.setStartInstruction('No ref')).toBe('Start instruction must contain {ref}.')
    expect(actions.setResumeInstruction('No path')).toBe(
      'Resume instruction must contain {taskPath}.',
    )
    expect(app.state.set).not.toHaveBeenCalled()

    expect(actions.setStartInstruction('Take {ref}\n{title}')).toBeNull()
    expect(actions.setResumeInstruction('Go {taskPath}\nnow')).toBeNull()
    expect(app.state.set.mock.calls).toEqual([
      [APP_STATE_KEY.startInstruction, 'Take {ref}\n{title}'],
      [APP_STATE_KEY.resumeInstruction, 'Go {taskPath}\nnow'],
    ])

    actions.resetStartInstruction()
    expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.startInstruction, '')
    expect(store.getState().startInstruction).toBe(DEFAULT_START_INSTRUCTION)
    actions.resetResumeInstruction()
    expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.resumeInstruction, '')
    expect(store.getState().resumeInstruction).toBe(DEFAULT_RESUME_INSTRUCTION)
  })

  it('dismisses the migration notice and restores it when the write fails', async () => {
    const notice = { prompts: [{ prompt: 'Old {taskPath}', templates: ['A'] }] }
    const app = fakeApp({ [APP_STATE_KEY.resumeMigration]: JSON.stringify(notice) })
    const reportError = vi.fn()
    const store = createSettingsStore({ app, reportError })
    store.getState().hydrate()
    await flush()

    app.state.set.mockRejectedValueOnce(new Error('disk'))
    store.getState().dismissResumeMigrationNotice()
    expect(store.getState().resumeMigrationNotice).toBeNull()
    await flush()
    expect(store.getState().resumeMigrationNotice).toEqual(notice)
    expect(reportError).toHaveBeenCalledWith('Failed to dismiss the previous Resume prompts.')

    store.getState().dismissResumeMigrationNotice()
    await flush()
    expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.resumeMigration, '')
    expect(store.getState().resumeMigrationNotice).toBeNull()
  })

  it('reports a failed load, except the silent show-icons read', async () => {
    const app = fakeApp()
    app.state.get.mockImplementation(async (key: string) => {
      if (key === APP_STATE_KEY.showProjectIcons || key === APP_STATE_KEY.chatSwitchEnabled) {
        throw new Error('read failed')
      }
      return null
    })
    const reportError = vi.fn()
    const store = createSettingsStore({ app, reportError })
    store.getState().hydrate()
    await flush()
    expect(reportError.mock.calls).toEqual([['Failed to load settings.']])
    expect(store.getState().chatSwitchEnabled).toBe(true)
    expect(store.getState().showProjectIcons).toBe(true)
  })
})
