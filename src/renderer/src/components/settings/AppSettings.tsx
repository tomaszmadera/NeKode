import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import type { AttentionSettings } from '../../lib/attention-settings'
import { Icon } from '../../lib/icons'
import type { TerminalFontFamilies } from '../../lib/terminal-font'
import { TEST_ID } from '../../lib/test-ids'
import { isThemeId, THEME_IDS, THEMES, type ThemeId } from '../../lib/theme'
import { DesktopDictationSettings } from './DesktopDictationSettings'
import { DictationDictionary } from './DictationDictionary'
import { FontsSettings } from './FontsSettings'
import { GlobalAgentProfilesSettings } from './GlobalAgentProfilesSettings'

interface AppSettingsProps {
  app: AppApi
  initialTab?: SettingsTab
  dictationApi: AppApi['dictation']
  desktopDictation: ReturnType<typeof import('../../hooks/useDesktopDictation').useDesktopDictation>
  theme: ThemeId
  quickThemeSwitch: boolean
  onQuickThemeSwitchChange: (next: boolean) => void
  chatSwitch: boolean
  projectNamesUppercase: boolean
  onProjectNamesUppercaseChange: (next: boolean) => void
  showProjectIcons: boolean
  onShowProjectIconsChange: (next: boolean) => void
  error: string | null
  onThemeChange: (theme: ThemeId) => void
  onChatSwitchChange: (next: boolean) => void
  /** Attention alert toggles (attention-alert-settings spec), all default on. */
  attentionSettings: AttentionSettings
  /** One handler for all four toggles; the key names the setting. */
  onAttentionSettingChange: (key: keyof AttentionSettings, next: boolean) => void
  terminalFontFamilies: TerminalFontFamilies
  onTerminalFontFamiliesChange: (families: TerminalFontFamilies) => void
  terminalFontSize: number
  onTerminalFontSizeChange: (size: number) => void
  terminalCtrlVPaste: boolean
  onTerminalCtrlVPasteChange: (next: boolean) => void
  onClose: () => void
}

type SettingsTab = 'general' | 'fonts' | 'shortcuts' | 'dictation' | 'agents'
const SETTINGS_TABS: SettingsTab[] = ['general', 'fonts', 'shortcuts', 'dictation', 'agents']
function tabId(tab: SettingsTab): string {
  return tab === 'agents' ? 'app-settings-tab-agents' : `settings-tab-${tab}`
}
function panelId(tab: SettingsTab): string {
  return tab === 'agents' ? 'app-settings-panel-agents' : `settings-panel-${tab}`
}

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
      ['Ctrl+V / Ctrl+Shift+V', 'Paste text (Ctrl+V in full-screen programs is configurable)'],
      ['Ctrl+D', 'Close the chat at an empty prompt, otherwise delete a character'],
      ['Ctrl+U', 'Clear the input line'],
    ],
  },
]

export function AppSettings({
  app,
  initialTab = 'general',
  dictationApi,
  desktopDictation,
  theme,
  quickThemeSwitch,
  onQuickThemeSwitchChange,
  chatSwitch,
  projectNamesUppercase,
  onProjectNamesUppercaseChange,
  showProjectIcons,
  onShowProjectIconsChange,
  error,
  onThemeChange,
  onChatSwitchChange,
  attentionSettings,
  onAttentionSettingChange,
  terminalFontFamilies,
  onTerminalFontFamiliesChange,
  terminalFontSize,
  onTerminalFontSizeChange,
  terminalCtrlVPaste,
  onTerminalCtrlVPasteChange,
  onClose,
}: AppSettingsProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const selectRef = useRef<HTMLSelectElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    if (selectRef.current !== null) selectRef.current.focus()
    else
      dialogRef.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus()
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
      event.preventDefault()
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((control) => control.tabIndex >= 0)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const next =
        index < 0
          ? event.shiftKey
            ? controls.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      controls[next]?.focus()
    }
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts the dismiss gesture (mouse down outside the dialog); the dialog's controls are real buttons and inputs and it closes on Escape. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        role="presentation"
        onMouseDown={(event) => {
          // Backdrop dismiss: only a pointer-down on the dimmed area itself
          // closes. mousedown (not click) survives a text-selection drag that
          // releases outside the dialog; the target check keeps pointer-downs
          // inside the dialog from closing it.
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
      >
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-settings-title"
          onKeyDown={handleKeyDown}
          className="flex h-[min(42rem,90dvh)] w-[min(56rem,94vw)] flex-col overflow-hidden rounded-lg border border-edge bg-panel p-4 shadow-xl sm:p-5"
        >
          <div className="flex items-center justify-between">
            <h2 id="app-settings-title" className="text-base font-semibold">
              App Settings
            </h2>
            <button
              type="button"
              aria-label="Close app settings"
              title="Close app settings"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info"
              onClick={onClose}
            >
              <Icon.close size={16} aria-hidden />
            </button>
          </div>
          <div className="mt-4 flex min-h-0 flex-1 gap-3 sm:gap-5">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex w-24 shrink-0 flex-col gap-1 border-r border-edge pr-3 sm:w-36"
            >
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={tabId(tab)}
                  aria-controls={panelId(tab)}
                  aria-selected={activeTab === tab}
                  tabIndex={activeTab === tab ? 0 : -1}
                  data-testid={
                    tab === 'general'
                      ? TEST_ID.settingsGeneralTab
                      : tab === 'shortcuts'
                        ? TEST_ID.settingsShortcutsTab
                        : undefined
                  }
                  className={`rounded-md border border-edge px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-info ${activeTab === tab ? 'bg-highlight text-ink' : 'text-ink-secondary'}`}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => {
                    const tabs = SETTINGS_TABS
                    const index = tabs.indexOf(tab)
                    const { key } = event
                    const next =
                      key === 'ArrowDown'
                        ? tabs[(index + 1) % tabs.length]
                        : key === 'ArrowUp'
                          ? tabs[(index + tabs.length - 1) % tabs.length]
                          : key === 'Home'
                            ? tabs[0]
                            : key === 'End'
                              ? tabs[tabs.length - 1]
                              : null
                    if (next !== null) {
                      event.preventDefault()
                      setActiveTab(next)
                      document.getElementById(tabId(next))?.focus()
                    }
                  }}
                >
                  {tab === 'general'
                    ? 'General'
                    : tab === 'fonts'
                      ? 'Fonts'
                      : tab === 'dictation'
                        ? 'Dictation'
                        : tab === 'agents'
                          ? 'Agents'
                          : 'Shortcuts'}
                </button>
              ))}
            </div>
            {SETTINGS_TABS.filter((tab) => tab !== activeTab).map((tab) => (
              <div
                key={tab}
                role="tabpanel"
                id={panelId(tab)}
                aria-labelledby={tabId(tab)}
                hidden
              />
            ))}
            <div
              role="tabpanel"
              id={panelId(activeTab)}
              aria-labelledby={tabId(activeTab)}
              className="min-w-0 flex-1 overflow-y-auto pr-1"
            >
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
                    {THEME_IDS.map((id) => (
                      <option key={id} value={id}>
                        {THEMES[id].label}
                      </option>
                    ))}
                  </select>
                  <label
                    htmlFor="app-quick-theme-switch"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
                      id="app-quick-theme-switch"
                      type="checkbox"
                      checked={quickThemeSwitch}
                      data-testid={TEST_ID.settingsQuickThemeSwitch}
                      onChange={(event) => onQuickThemeSwitchChange(event.target.checked)}
                    />
                    Show quick theme switcher in status bar
                  </label>
                  <label
                    htmlFor="app-project-names-uppercase"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
                      id="app-project-names-uppercase"
                      type="checkbox"
                      checked={projectNamesUppercase}
                      onChange={(event) => onProjectNamesUppercaseChange(event.target.checked)}
                    />
                    Uppercase project names in the tree
                  </label>
                  <label
                    htmlFor="app-show-project-icons"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
                      id="app-show-project-icons"
                      type="checkbox"
                      checked={showProjectIcons}
                      data-testid={TEST_ID.settingsShowProjectIcons}
                      onChange={(event) => onShowProjectIconsChange(event.target.checked)}
                    />
                    Show project icons
                  </label>
                  <label
                    htmlFor="app-chat-switch"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
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
                    htmlFor="app-terminal-ctrl-v-paste"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
                      id="app-terminal-ctrl-v-paste"
                      type="checkbox"
                      checked={terminalCtrlVPaste}
                      onChange={(event) => onTerminalCtrlVPasteChange(event.target.checked)}
                      aria-describedby="app-terminal-ctrl-v-paste-help"
                    />
                    Use Ctrl+V to paste text in terminals
                  </label>
                  <p id="app-terminal-ctrl-v-paste-help" className="mt-1 text-xs text-ink-muted">
                    When off, full-screen programs handle Ctrl+V. Ctrl+Shift+V always pastes text.
                  </p>
                  <label
                    htmlFor="app-attention-badge"
                    className="mt-3 flex items-center gap-2 text-sm text-ink-secondary"
                  >
                    <input
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
              ) : activeTab === 'agents' ? (
                <GlobalAgentProfilesSettings app={app} />
              ) : activeTab === 'fonts' ? (
                <FontsSettings
                  families={terminalFontFamilies}
                  size={terminalFontSize}
                  onFamiliesChange={onTerminalFontFamiliesChange}
                  onSizeChange={onTerminalFontSizeChange}
                />
              ) : activeTab === 'dictation' ? (
                <>
                  <DesktopDictationSettings
                    setup={desktopDictation.setup}
                    saving={desktopDictation.saving || desktopDictation.control.busy}
                    onChange={desktopDictation.configure}
                  />
                  <DictationDictionary api={dictationApi} />
                </>
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
            </div>
          </div>
          {(error ?? desktopDictation.control.error) ? (
            <p role="alert" className="mt-3 text-xs text-error">
              {error ?? desktopDictation.control.error}
            </p>
          ) : null}
        </section>
      </div>
    </>
  )
}
