import type React from 'react'
import { useEffect, useRef } from 'react'
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
  terminalFontSize: number
  onTerminalFontSizeChange: (size: number) => void
  onClose: () => void
}

export function AppSettings({
  theme,
  chatSwitch,
  error,
  onThemeChange,
  onChatSwitchChange,
  terminalFontSize,
  onTerminalFontSizeChange,
  onClose,
}: AppSettingsProps): React.JSX.Element {
  const selectRef = useRef<HTMLSelectElement>(null)
  const fontSizeRef = useRef<HTMLSelectElement>(null)
  const chatSwitchRef = useRef<HTMLInputElement>(null)
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
      // The dialog has four controls: keep keyboard focus inside it.
      event.preventDefault()
      const order: Array<HTMLSelectElement | HTMLInputElement | HTMLButtonElement | null> = [
        selectRef.current,
        fontSizeRef.current,
        chatSwitchRef.current,
        closeRef.current,
      ]
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
        <label htmlFor="app-theme" className="mt-5 block text-sm text-ink-secondary">
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
        <label htmlFor="app-terminal-font-size" className="mt-3 block text-sm text-ink-secondary">
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
        {error ? (
          <p role="alert" className="mt-3 text-xs text-error">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
