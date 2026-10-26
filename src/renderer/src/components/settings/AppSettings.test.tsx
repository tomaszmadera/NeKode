import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATTENTION_SETTINGS } from '../../lib/attention-settings'
import { DEFAULT_TERMINAL_FONT_FAMILIES, DEFAULT_TERMINAL_FONT_SIZE } from '../../lib/terminal-font'
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
  render(
    <AppSettings
      app={app}
      dictationApi={app.dictation}
      desktopDictation={desktopDictation(SAVE_ERROR)}
      initialTab={initialTab}
      theme="nekode-float"
      quickThemeSwitch={false}
      onQuickThemeSwitchChange={vi.fn()}
      chatSwitch={false}
      projectNamesUppercase={false}
      onProjectNamesUppercaseChange={vi.fn()}
      showProjectIcons={false}
      onShowProjectIconsChange={vi.fn()}
      error={null}
      onThemeChange={vi.fn()}
      onChatSwitchChange={vi.fn()}
      attentionSettings={DEFAULT_ATTENTION_SETTINGS}
      onAttentionSettingChange={vi.fn()}
      terminalFontFamilies={DEFAULT_TERMINAL_FONT_FAMILIES}
      onTerminalFontFamiliesChange={vi.fn()}
      terminalFontSize={DEFAULT_TERMINAL_FONT_SIZE}
      onTerminalFontSizeChange={vi.fn()}
      terminalCtrlVPaste={true}
      onTerminalCtrlVPasteChange={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('AppSettings dictation shortcut error', () => {
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
})
