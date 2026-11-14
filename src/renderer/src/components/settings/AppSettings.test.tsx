import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATTENTION_SETTINGS } from '../../lib/attention-settings'
import { DEFAULT_TERMINAL_FONT_FAMILIES, DEFAULT_TERMINAL_FONT_SIZE } from '../../lib/terminal-font'
import { TEST_ID } from '../../lib/test-ids'
import {
  createSettingsStore,
  SettingsStoreContext,
  settingsError,
} from '../../stores/useSettingsStore'
import { createAppApiStub } from '../../test/app-api-stub'
import { AppSettings } from './AppSettings'

afterEach(cleanup)

const SAVE_ERROR = 'Desktop dictation settings could not save. Try again.'

function desktopDictation(error: string | null) {
  return {
    setup: { supported: true, settings: { enabled: true, confirmed: true } },
    saving: false,
    configure: vi.fn(async () => true),
    control: {
      selected: true,
      busy: false,
      disabledReason: null,
      error,
      activate: vi.fn(),
    },
  }
}

function renderSettings(initialTab: 'general' | 'dictation') {
  const app = createAppApiStub()
  const settingsStore = createSettingsStore({ app, reportError: vi.fn() })
  // The same settings fixture the props supplied before the settings store.
  settingsStore.setState({
    theme: 'nekode-float',
    quickThemeSwitch: false,
    chatSwitchEnabled: false,
    projectNamesUppercase: false,
    showProjectIcons: false,
    attentionSettings: DEFAULT_ATTENTION_SETTINGS,
    terminalFontFamilies: DEFAULT_TERMINAL_FONT_FAMILIES,
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    terminalCtrlVPaste: true,
  })
  expect(settingsError(settingsStore.getState())).toBeNull()
  render(
    <SettingsStoreContext.Provider value={settingsStore}>
      <AppSettings
        app={app}
        dictationApi={app.dictation}
        desktopDictation={desktopDictation(SAVE_ERROR)}
        initialTab={initialTab}
        onClose={vi.fn()}
      />
    </SettingsStoreContext.Provider>,
  )
}

describe('AppSettings dictation shortcut error', () => {
  it('opens the reusable Resume editor from the application settings navigation', async () => {
    renderSettings('general')
    fireEvent.click(screen.getByRole('tab', { name: 'Resume sources' }))
    expect(await screen.findByRole('button', { name: 'New source' })).not.toBeNull()
    expect(screen.getByLabelText('Test project')).not.toBeNull()
  })
  it('opens the Instructions tab with Start, Resume, Handoff, Continue and the Stop note', async () => {
    renderSettings('general')
    fireEvent.click(screen.getByTestId(TEST_ID.settingsInstructionsTab))

    expect(await screen.findByTestId(TEST_ID.instructionHandoffEditor)).not.toBeNull()
    expect(screen.getByTestId(TEST_ID.instructionContinueEditor)).not.toBeNull()
    expect(screen.getByTestId(TEST_ID.instructionStopNote).textContent).toContain('Ctrl+C')
    expect(screen.getByTestId(TEST_ID.instructionStartEditor)).not.toBeNull()
    expect(screen.getByTestId(TEST_ID.instructionResumeEditor)).not.toBeNull()
  })

  it('announces an OpenWhispr shortcut save error once on the Dictation tab', async () => {
    renderSettings('dictation')
    await screen.findByTestId('dictation-method-error')

    const alerts = screen
      .getAllByRole('alert')
      .filter((node) => node.textContent?.includes('could not save'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.getAttribute('data-testid')).toBe('dictation-method-error')
  })

  it('keeps the shortcut error in the settings footer on other tabs', () => {
    renderSettings('general')

    const alerts = screen
      .getAllByRole('alert')
      .filter((node) => node.textContent?.includes('could not save'))
    expect(alerts).toHaveLength(1)
    expect(screen.queryByTestId('dictation-method-error')).toBeNull()
  })

  it('does not offer a chat prompt display setting', () => {
    renderSettings('general')
    expect(screen.queryByRole('combobox', { name: 'Chat prompt' })).toBeNull()
  })
})
