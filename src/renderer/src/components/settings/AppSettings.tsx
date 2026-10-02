import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AttentionSettings } from '../../lib/attention-settings'
import { Icon } from '../../lib/icons'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  isTerminalFontSize,
  TERMINAL_FONT_SIZES,
} from '../../lib/terminal-font'
import { TEST_ID } from '../../lib/test-ids'
import { isThemeId, THEMES, type ThemeId } from '../../lib/theme'

interface AppSettingsProps {
  theme: ThemeId
  chatSwitch: boolean
  error: string | null
  onThemeChange: (theme: ThemeId) => void
  onChatSwitchChange: (next: boolean) => void
  /** Attention alert toggles (attention-alert-settings spec), all default on. */
  attentionSettings: AttentionSettings
  /** One handler for all four toggles; the key names the setting. */
  onAttentionSettingChange: (key: keyof AttentionSettings, next: boolean) => void
  terminalFontSize: number
  onTerminalFontSizeChange: (size: number) => void
  onClose: () => void
}

type SettingsTab = 'general' | 'shortcuts'

// One row per app shortcut. Keys render in <kbd>-style cells; keep each
// description in sync with the behavior actually implemented (App-level chords,
// terminal chords) — this table is the product's shortcut documentation.
const SHORTCUT_SECTIONS: Array<{ heading: string; rows: Array<[string, string]> }> = [
  {
    heading: 'Global',
    rows: [
      ['Ctrl+N', 'Start a new chat in the active project'],
      ['Ctrl+Tab', 'Switch to the next chat (across projects)'],
      ['Ctrl+Shift+Tab', 'Switch to the previous chat (across projects)'],
      ['Ctrl+`', 'Show or hide the bottom terminal panel'],
      ['Escape', 'Close dialogs and menus'],
    ],
  },
  {
    heading: 'Terminal',
    rows: [
      ['Ctrl+C', 'Copy the selection, or abort the input line'],
      ['Ctrl+Shift+C', 'Copy the selection'],
      ['Ctrl+V / Ctrl+Shift+V', 'Paste into the terminal'],
      ['Ctrl+D', 'Close the chat at an empty prompt, otherwise delete a character'],
      ['Ctrl+U', 'Clear the input line'],
    ],
  },
]

export function AppSettings({
  theme,
  chatSwitch,
  error,
  onThemeChange,
  onChatSwitchChange,
  attentionSettings,
  onAttentionSettingChange,
  terminalFontSize,
  onTerminalFontSizeChange,
  onClose,
}: AppSettingsProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const selectRef = useRef<HTMLSelectElement>(null)
  const fontSizeRef = useRef<HTMLSelectElement>(null)
  const chatSwitchRef = useRef<HTMLInputElement>(null)
  const attentionBadgeRef = useRef<HTMLInputElement>(null)
  const attentionActiveIndicatorRef = useRef<HTMLInputElement>(null)
  const attentionChimeRef = useRef<HTMLInputElement>(null)
  const attentionActiveChimeRef = useRef<HTMLInputElement>(null)
  const generalTabRef = useRef<HTMLButtonElement>(null)
  const shortcutsTabRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    selectRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const { key } = event
    if (key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (key === 'Tab') {
      // Keep keyboard focus inside the dialog. The cycle only visits the
      // active tab's controls: focus() on a hidden control is a silent
      // no-op and would trap the cycle on the hidden element.
      event.preventDefault()
      const order: Array<HTMLSelectElement | HTMLInputElement | HTMLButtonElement | null> =
        activeTab === 'general'
          ? [
              selectRef.current,
              fontSizeRef.current,
              chatSwitchRef.current,
              attentionBadgeRef.current,
              attentionActiveIndicatorRef.current,
              attentionChimeRef.current,
              attentionActiveChimeRef.current,
              generalTabRef.current,
              shortcutsTabRef.current,
              closeRef.current,
            ]
          : [generalTabRef.current, shortcutsTabRef.current, closeRef.current]
      const index = order.indexOf(document.activeElement as (typeof order)[number])
      order[(index + 1) % order.length]?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onKeyDown={handleKeyDown}
        className="w-[min(28rem,90vw)] rounded-lg border border-edge bg-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="app-settings-title" className="text-base font-semibold">
            App Settings
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close app settings"
            title="Close app settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info"
            onClick={onClose}
          >
            <Icon.close size={16} aria-hidden />
          </button>
        </div>
        <div role="tablist" aria-label="Settings sections" className="mt-3 flex gap-1">
          <button
            ref={generalTabRef}
            type="button"
            role="tab"
            aria-selected={activeTab === 'general'}
            data-testid={TEST_ID.settingsGeneralTab}
            className={
              activeTab === 'general'
                ? 'rounded-md bg-button px-3 py-1 text-sm text-ink focus-visible:outline focus-visible:outline-info'
                : 'rounded-md px-3 py-1 text-sm text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info'
            }
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            ref={shortcutsTabRef}
            type="button"
            role="tab"
            aria-selected={activeTab === 'shortcuts'}
            data-testid={TEST_ID.settingsShortcutsTab}
            className={
              activeTab === 'shortcuts'
                ? 'rounded-md bg-button px-3 py-1 text-sm text-ink focus-visible:outline focus-visible:outline-info'
                : 'rounded-md px-3 py-1 text-sm text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info'
            }
            onClick={() => setActiveTab('shortcuts')}
          >
            Shortcuts
          </button>
        </div>
        {activeTab === 'general' ? (
          <div>
            <label htmlFor="app-theme" className="mt-4 block text-sm text-ink-secondary">
              Theme
            </label>
            <select
              ref={selectRef}
              id="app-theme"
              value={theme}
              onChange={(event) => {
                if (isThemeId(event.target.value)) onThemeChange(event.target.value)
              }}
              className="mt-2 h-control w-full rounded-md border border-edge bg-app px-3 text-sm text-ink focus-visible:outline focus-visible:outline-info"
            >
              {THEMES.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <label
              htmlFor="app-terminal-font-size"
              className="mt-3 block text-sm text-ink-secondary"
            >
              Terminal font size
            </label>
            <select
              ref={fontSizeRef}
              id="app-terminal-font-size"
              value={String(terminalFontSize)}
              data-testid={TEST_ID.settingsTerminalFontSize}
              onChange={(event) => {
                const size = Number.parseInt(event.target.value, 10)
                if (isTerminalFontSize(size)) onTerminalFontSizeChange(size)
              }}
              className="mt-2 h-control w-full rounded-md border border-edge bg-app px-3 text-sm text-ink focus-visible:outline focus-visible:outline-info"
            >
              {TERMINAL_FONT_SIZES.map((size) => (
                <option key={size} value={String(size)}>
                  {size === DEFAULT_TERMINAL_FONT_SIZE ? `${size} (default)` : size}
                </option>
              ))}
            </select>
            <label
              htmlFor="app-chat-switch"
              className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
            >
              <input
                ref={chatSwitchRef}
                id="app-chat-switch"
                type="checkbox"
                checked={chatSwitch}
                data-testid={TEST_ID.settingsChatSwitch}
                onChange={(event) => {
                  onChatSwitchChange(event.target.checked)
                }}
              />
              Switch chats with Ctrl+Tab
            </label>
            <label
              htmlFor="app-attention-badge"
              className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
            >
              <input
                ref={attentionBadgeRef}
                id="app-attention-badge"
                type="checkbox"
                checked={attentionSettings.badge}
                data-testid={TEST_ID.settingsAttentionBadge}
                onChange={(event) => {
                  onAttentionSettingChange('badge', event.target.checked)
                }}
              />
              Show attention badges on chat rows
            </label>
            <label
              htmlFor="app-attention-active-indicator"
              className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
            >
              <input
                ref={attentionActiveIndicatorRef}
                id="app-attention-active-indicator"
                type="checkbox"
                checked={attentionSettings.activeIndicator}
                data-testid={TEST_ID.settingsAttentionActiveIndicator}
                onChange={(event) => {
                  onAttentionSettingChange('activeIndicator', event.target.checked)
                }}
              />
              Show an attention indicator on the active chat's row
            </label>
            <label
              htmlFor="app-attention-chime"
              className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
            >
              <input
                ref={attentionChimeRef}
                id="app-attention-chime"
                type="checkbox"
                checked={attentionSettings.chime}
                data-testid={TEST_ID.settingsAttentionChime}
                onChange={(event) => {
                  onAttentionSettingChange('chime', event.target.checked)
                }}
              />
              Play a chime when a background chat needs attention
            </label>
            <label
              htmlFor="app-attention-active-chime"
              className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
            >
              <input
                ref={attentionActiveChimeRef}
                id="app-attention-active-chime"
                type="checkbox"
                checked={attentionSettings.activeChime}
                data-testid={TEST_ID.settingsAttentionActiveChime}
                onChange={(event) => {
                  onAttentionSettingChange('activeChime', event.target.checked)
                }}
              />
              Play a chime when the active chat needs attention
            </label>
          </div>
        ) : (
          <div data-testid={TEST_ID.settingsShortcutsTable} className="mt-4 space-y-4">
            {SHORTCUT_SECTIONS.map((section) => (
              <div key={section.heading}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {section.heading}
                </h3>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {section.rows.map(([keys, description]) => (
                      <tr key={keys} className="align-baseline">
                        <td className="w-2/5 whitespace-nowrap pr-3 font-mono text-xs text-ink">
                          {keys}
                        </td>
                        <td className="text-ink-secondary">{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-xs text-error">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
