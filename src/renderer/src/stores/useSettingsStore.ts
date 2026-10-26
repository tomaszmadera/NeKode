import type { AppApi } from '@shared/ipc-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { errorMessage } from '../lib/app-error-message'
import {
  ATTENTION_SETTING_KEYS,
  type AttentionSettings,
  DEFAULT_ATTENTION_SETTINGS,
  parseAttentionSettings,
} from '../lib/attention-settings'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  parseTerminalFontFamilies,
  parseTerminalFontSize,
  TERMINAL_FONT_FAMILIES_STORAGE_KEY,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  type TerminalFontFamilies,
} from '../lib/terminal-font'
import { TERMINAL_CTRL_V_PASTE_STORAGE_KEY } from '../lib/terminal-paste'
import {
  DEFAULT_THEME_ID,
  QUICK_THEME_SWITCH_STORAGE_KEY,
  resolveStoredThemeId,
  THEME_STORAGE_KEY,
  type ThemeId,
} from '../lib/theme'

export const MASCOT_VISIBLE_STORAGE_KEY = 'nekode.mascot-visible.v1'

interface SettingsState {
  // Device-local settings in localStorage: read once when the store is
  // created (the first App render) and written synchronously on change.
  theme: ThemeId
  themeError: string | null
  quickThemeSwitch: boolean
  quickThemeSwitchError: string | null
  terminalFontSize: number
  terminalFontSizeError: string | null
  terminalFontFamilies: TerminalFontFamilies
  terminalFontError: string | null
  terminalCtrlVPaste: boolean
  terminalPasteError: string | null
  mascotVisible: boolean
  mascotError: string | null
  // App-global settings in app_state: defaults until hydrate() resolves,
  // written best-effort on change (failures go to the shell notice).
  /** Handoff/Resume delivery (spec handoff-resume-flow): off pastes into the prompt input. */
  autoSendHandoff: boolean
  /** Ctrl+Tab chat switching (NEKODE-2): enabled unless explicitly turned off. */
  chatSwitchEnabled: boolean
  projectNamesUppercase: boolean
  showProjectIcons: boolean
  /** Attention alert settings (attention-alert-settings spec): all four default on. */
  attentionSettings: AttentionSettings
}

interface SettingsActions {
  setTheme: (theme: ThemeId) => void
  setQuickThemeSwitch: (enabled: boolean) => void
  setTerminalFontSize: (size: number) => void
  setTerminalFontFamilies: (families: TerminalFontFamilies) => void
  setTerminalCtrlVPaste: (enabled: boolean) => void
  toggleMascot: () => void
  setAutoSendHandoff: (next: boolean) => void
  setChatSwitchEnabled: (next: boolean) => void
  setProjectNamesUppercase: (next: boolean) => void
  setShowProjectIcons: (next: boolean) => void
  setAttentionSetting: (key: keyof AttentionSettings, next: boolean) => void
  /** Loads the app_state settings once; the returned function drops late results. */
  hydrate: () => () => void
}

export type SettingsStore = SettingsState & SettingsActions

export interface SettingsPersistence {
  app: Pick<AppApi, 'state'>
  /** Shows a load or save failure on the shell notice banner. */
  reportError: (message: string) => void
}

function readLocalSettings(): Omit<
  SettingsState,
  | 'autoSendHandoff'
  | 'chatSwitchEnabled'
  | 'projectNamesUppercase'
  | 'showProjectIcons'
  | 'attentionSettings'
> {
  let mascotVisible = true
  let mascotError: string | null = null
  try {
    mascotVisible = localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY) !== '0'
  } catch {
    mascotError = 'Failed to load the mascot setting.'
  }
  let theme: ThemeId = DEFAULT_THEME_ID
  let themeError: string | null = null
  try {
    theme = resolveStoredThemeId(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    themeError = 'Failed to load the saved theme.'
  }
  let quickThemeSwitch = false
  let quickThemeSwitchError: string | null = null
  try {
    quickThemeSwitch = localStorage.getItem(QUICK_THEME_SWITCH_STORAGE_KEY) === '1'
  } catch {
    quickThemeSwitchError = 'Failed to load the quick theme switch setting.'
  }
  let terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE
  try {
    terminalFontSize = parseTerminalFontSize(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY))
  } catch {
    // A failed read keeps the default size without an error (as before stores).
  }
  let terminalFontFamilies = DEFAULT_TERMINAL_FONT_FAMILIES
  let terminalFontError: string | null = null
  try {
    terminalFontFamilies = parseTerminalFontFamilies(
      localStorage.getItem(TERMINAL_FONT_FAMILIES_STORAGE_KEY),
    )
  } catch {
    terminalFontError = 'Failed to load the saved terminal fonts.'
  }
  let terminalCtrlVPaste = true
  let terminalPasteError: string | null = null
  try {
    terminalCtrlVPaste = localStorage.getItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY) !== '0'
  } catch {
    terminalPasteError = 'Failed to load the saved terminal paste setting.'
  }
  return {
    theme,
    themeError,
    quickThemeSwitch,
    quickThemeSwitchError,
    terminalFontSize,
    terminalFontSizeError: null,
    terminalFontFamilies,
    terminalFontError,
    terminalCtrlVPaste,
    terminalPasteError,
    mascotVisible,
    mascotError,
  }
}

/** The first failed device-local setting shown in App Settings. */
export function settingsError(state: SettingsState): string | null {
  return (
    state.themeError ??
    state.quickThemeSwitchError ??
    state.terminalPasteError ??
    state.terminalFontError ??
    state.terminalFontSizeError
  )
}

export function createSettingsStore({ app, reportError }: SettingsPersistence) {
  // A change made before hydration resolves wins over the stored value.
  let projectNamesUppercaseTouched = false
  let showProjectIconsTouched = false

  function save(key: string, next: boolean, failure: string): void {
    void app.state.set(key, next ? '1' : '0').catch((error: unknown) => {
      reportError(errorMessage(error, failure))
    })
  }

  return createStore<SettingsStore>()((set) => ({
    ...readLocalSettings(),
    autoSendHandoff: false,
    chatSwitchEnabled: true,
    projectNamesUppercase: true,
    showProjectIcons: true,
    attentionSettings: DEFAULT_ATTENTION_SETTINGS,

    setTheme: (theme) => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme)
        set({ theme, themeError: null })
      } catch {
        set({ themeError: 'Failed to save the theme.' })
      }
    },
    setQuickThemeSwitch: (enabled) => {
      try {
        localStorage.setItem(QUICK_THEME_SWITCH_STORAGE_KEY, enabled ? '1' : '0')
        set({ quickThemeSwitch: enabled, quickThemeSwitchError: null })
      } catch {
        set({ quickThemeSwitchError: 'Failed to save the quick theme switch setting.' })
      }
    },
    setTerminalFontSize: (size) => {
      try {
        localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, String(size))
        set({ terminalFontSize: size, terminalFontSizeError: null })
      } catch {
        set({ terminalFontSizeError: 'Failed to save the terminal font size.' })
      }
    },
    setTerminalFontFamilies: (families) => {
      try {
        localStorage.setItem(TERMINAL_FONT_FAMILIES_STORAGE_KEY, JSON.stringify(families))
        set({ terminalFontFamilies: families, terminalFontError: null })
      } catch {
        set({ terminalFontError: 'Failed to save the terminal fonts.' })
      }
    },
    setTerminalCtrlVPaste: (enabled) => {
      try {
        localStorage.setItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY, enabled ? '1' : '0')
        set({ terminalCtrlVPaste: enabled, terminalPasteError: null })
      } catch {
        // The switch still applies for this run; only the save failed.
        set({
          terminalCtrlVPaste: enabled,
          terminalPasteError: 'Failed to save the terminal paste setting.',
        })
      }
    },
    toggleMascot: () =>
      set((state) => {
        const visible = !state.mascotVisible
        try {
          localStorage.setItem(MASCOT_VISIBLE_STORAGE_KEY, visible ? '1' : '0')
          return { mascotVisible: visible, mascotError: null }
        } catch {
          return { mascotVisible: visible, mascotError: 'Failed to save the mascot setting.' }
        }
      }),

    setAutoSendHandoff: (next) => {
      set({ autoSendHandoff: next })
      save(APP_STATE_KEY.autoSendHandoffResume, next, 'Failed to save the setting.')
    },
    setChatSwitchEnabled: (next) => {
      set({ chatSwitchEnabled: next })
      save(APP_STATE_KEY.chatSwitchEnabled, next, 'Failed to save the setting.')
    },
    setProjectNamesUppercase: (next) => {
      projectNamesUppercaseTouched = true
      set({ projectNamesUppercase: next })
      save(APP_STATE_KEY.projectNamesUppercase, next, 'Failed to save the setting.')
    },
    setShowProjectIcons: (next) => {
      showProjectIconsTouched = true
      set({ showProjectIcons: next })
      save(APP_STATE_KEY.showProjectIcons, next, 'Failed to save show project icons setting.')
    },
    setAttentionSetting: (key, next) => {
      set((state) => ({ attentionSettings: { ...state.attentionSettings, [key]: next } }))
      save(ATTENTION_SETTING_KEYS[key], next, 'Failed to save the setting.')
    },

    hydrate: () => {
      let alive = true
      const loadFailed = (error: unknown): void => {
        if (alive) reportError(errorMessage(error, 'Failed to load settings.'))
      }
      void app.state
        .get(APP_STATE_KEY.autoSendHandoffResume)
        .then((value) => {
          if (alive) set({ autoSendHandoff: value === '1' })
        })
        .catch(loadFailed)
      // Missing or '1' means enabled (NEKODE-2).
      void app.state
        .get(APP_STATE_KEY.chatSwitchEnabled)
        .then((value) => {
          if (alive) set({ chatSwitchEnabled: value !== '0' })
        })
        .catch(loadFailed)
      void app.state
        .get(APP_STATE_KEY.projectNamesUppercase)
        .then((value) => {
          if (alive && !projectNamesUppercaseTouched) set({ projectNamesUppercase: value !== '0' })
        })
        .catch(loadFailed)
      void app.state
        .get(APP_STATE_KEY.showProjectIcons)
        .then((value) => {
          if (alive && !showProjectIconsTouched) set({ showProjectIcons: value !== '0' })
        })
        .catch(() => undefined)
      // The four attention off-switches ('0' = off, missing or anything else
      // = on). A failed read keeps the defaults (all on).
      const keys = ATTENTION_SETTING_KEYS
      void Promise.all([
        app.state.get(keys.badge),
        app.state.get(keys.chime),
        app.state.get(keys.activeChime),
        app.state.get(keys.activeIndicator),
      ])
        .then(([badge, chime, activeChime, activeIndicator]) => {
          if (alive)
            set({
              attentionSettings: parseAttentionSettings({
                badge,
                chime,
                activeChime,
                activeIndicator,
              }),
            })
        })
        .catch(loadFailed)
      return () => {
        alive = false
      }
    },
  }))
}

export type SettingsStoreApi = ReturnType<typeof createSettingsStore>
export const SettingsStoreContext = createContext<SettingsStoreApi | null>(null)

export function useSettingsStoreApi(): SettingsStoreApi {
  const store = useContext(SettingsStoreContext)
  if (store === null) throw new Error('useSettingsStore requires AppStoresProvider.')
  return store
}

export function useSettingsStore<T>(selector: (state: SettingsStore) => T): T {
  return useStore(useSettingsStoreApi(), selector)
}
