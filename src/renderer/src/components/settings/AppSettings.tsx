import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import type { AttentionSettings } from '../../lib/attention-settings'
import { cn } from '../../lib/cn'
import { Icon, type LucideIcon } from '../../lib/icons'
import type { TerminalFontFamilies } from '../../lib/terminal-font'
import { TEST_ID } from '../../lib/test-ids'
import { isThemeId, THEME_IDS, THEMES, type ThemeId } from '../../lib/theme'
import { UsageSettings } from '../usage/UsageSettings'
import { AppUpdateBlock } from './AppUpdateBlock'
import { DictationDictionary } from './DictationDictionary'
import { DictationSettings } from './DictationSettings'
import { FontsSettings } from './FontsSettings'
import { GlobalAgentProfilesSettings } from './GlobalAgentProfilesSettings'
import {
  FieldRow,
  focusRing,
  GroupBox,
  NavIcon,
  PageIntro,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  SettingsSwitch,
  ShortcutKeys,
} from './settings-ui'

interface AppSettingsProps {
  onUsageSaved?: () => void
  app: AppApi
  initialTab?: SettingsTab
  /** When the version control opened settings, bring the update block into view. */
  scrollToUpdate?: boolean
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

type SettingsTab = 'general' | 'fonts' | 'shortcuts' | 'dictation' | 'agents' | 'usage'
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: Icon.sliders },
  { id: 'fonts', label: 'Fonts', icon: Icon.type },
  { id: 'shortcuts', label: 'Shortcuts', icon: Icon.keyboard },
  { id: 'dictation', label: 'Dictation', icon: Icon.dictation },
  { id: 'agents', label: 'Agents', icon: Icon.agent },
  { id: 'usage', label: 'Usage', icon: Icon.gauge },
]
function tabId(tab: SettingsTab): string {
  return tab === 'agents' ? 'app-settings-tab-agents' : `settings-tab-${tab}`
}
function panelId(tab: SettingsTab): string {
  return tab === 'agents' ? 'app-settings-panel-agents' : `settings-panel-${tab}`
}

// One row per app shortcut. Keys render as chips; keep each description in
// sync with the behavior actually implemented (App-level chords, terminal
// chords). This list is the product's shortcut documentation.
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
  onUsageSaved,
  app,
  initialTab = 'general',
  scrollToUpdate = false,
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
  const pageLabel = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? 'General'

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

  useEffect(() => {
    if (!scrollToUpdate) return
    document.getElementById('app-update')?.scrollIntoView({ block: 'nearest' })
  }, [scrollToUpdate])

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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
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
          className="flex h-[min(660px,calc(100%-48px))] w-[min(920px,calc(100%-48px))] flex-col overflow-hidden rounded-[12px] border border-edge bg-dialog shadow-xl"
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-edge pr-2.5 pl-5">
            <Icon.settings size={16} aria-hidden className="shrink-0 text-ink-secondary" />
            <h2 id="app-settings-title" className="sr-only">
              App Settings
            </h2>
            <span className="text-[15px] font-semibold text-project-title">Settings</span>
            <Icon.chevronRight size={12} aria-hidden className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ink-secondary">
              {pageLabel}
            </span>
            <button
              type="button"
              aria-label="Close app settings"
              title="Close app settings"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-highlight hover:text-ink',
                focusRing,
              )}
              onClick={onClose}
            >
              <Icon.close size={16} aria-hidden />
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-edge bg-field px-2.5 py-3"
            >
              {SETTINGS_TABS.map((tab) => {
                const selected = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={tabId(tab.id)}
                    aria-controls={panelId(tab.id)}
                    aria-selected={selected}
                    aria-current={selected ? 'page' : undefined}
                    tabIndex={selected ? 0 : -1}
                    data-testid={
                      tab.id === 'general'
                        ? TEST_ID.settingsGeneralTab
                        : tab.id === 'shortcuts'
                          ? TEST_ID.settingsShortcutsTab
                          : undefined
                    }
                    className={cn(
                      'nk-settings-nav flex h-9 w-full items-center gap-2.5 rounded-[8px] border-0 px-2.5 text-left text-[13px]',
                      focusRing,
                      selected
                        ? 'bg-selected font-medium text-project-title'
                        : 'bg-transparent text-ink-secondary',
                    )}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(event) => {
                      const index = SETTINGS_TABS.findIndex((entry) => entry.id === tab.id)
                      const { key } = event
                      const nextIndex =
                        key === 'ArrowDown'
                          ? (index + 1) % SETTINGS_TABS.length
                          : key === 'ArrowUp'
                            ? (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length
                            : key === 'Home'
                              ? 0
                              : key === 'End'
                                ? SETTINGS_TABS.length - 1
                                : null
                      if (nextIndex !== null) {
                        event.preventDefault()
                        const next = SETTINGS_TABS[nextIndex].id
                        setActiveTab(next)
                        document.getElementById(tabId(next))?.focus()
                      }
                    }}
                  >
                    <NavIcon icon={tab.icon} />
                    {tab.label}
                  </button>
                )
              })}
            </div>
            {SETTINGS_TABS.filter((tab) => tab.id !== activeTab).map((tab) => (
              <div
                key={tab.id}
                role="tabpanel"
                id={panelId(tab.id)}
                aria-labelledby={tabId(tab.id)}
                hidden
              />
            ))}
            <div
              role="tabpanel"
              id={panelId(activeTab)}
              aria-labelledby={tabId(activeTab)}
              className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-8"
            >
              {activeTab === 'general' ? (
                <div className="flex max-w-[660px] flex-col gap-7">
                  <PageIntro title="General" description="Look and behaviour of the whole app." />
                  <SettingsGroup label="Appearance">
                    <SectionLabel title="Appearance" />
                    <GroupBox>
                      <FieldRow
                        label="Theme"
                        htmlFor="app-theme"
                        description="Colours for the whole app."
                      >
                        <SettingsSelect
                          id="app-theme"
                          value={theme}
                          selectRef={selectRef}
                          onChange={(value) => {
                            if (isThemeId(value)) onThemeChange(value)
                          }}
                        >
                          {THEME_IDS.map((id) => (
                            <option key={id} value={id}>
                              {THEMES[id].label}
                            </option>
                          ))}
                        </SettingsSelect>
                      </FieldRow>
                      <SettingsSwitch
                        id="app-quick-theme-switch"
                        label="Quick theme switcher in the status bar"
                        checked={quickThemeSwitch}
                        divided
                        testId={TEST_ID.settingsQuickThemeSwitch}
                        onChange={onQuickThemeSwitchChange}
                      />
                      <SettingsSwitch
                        id="app-project-names-uppercase"
                        label="Uppercase project names in the tree"
                        checked={projectNamesUppercase}
                        divided
                        onChange={onProjectNamesUppercaseChange}
                      />
                      <SettingsSwitch
                        id="app-show-project-icons"
                        label="Project icons"
                        checked={showProjectIcons}
                        divided
                        testId={TEST_ID.settingsShowProjectIcons}
                        onChange={onShowProjectIconsChange}
                      />
                    </GroupBox>
                  </SettingsGroup>
                  <SettingsGroup label="Keyboard">
                    <SectionLabel title="Keyboard" />
                    <GroupBox>
                      <SettingsSwitch
                        id="app-chat-switch"
                        label="Switch chats with Ctrl+Tab"
                        checked={chatSwitch}
                        testId={TEST_ID.settingsChatSwitch}
                        onChange={onChatSwitchChange}
                      />
                      <SettingsSwitch
                        id="app-terminal-ctrl-v-paste"
                        label="Paste with Ctrl+V in terminals"
                        description="When off, full-screen programs handle Ctrl+V. Ctrl+Shift+V always pastes text."
                        checked={terminalCtrlVPaste}
                        divided
                        onChange={onTerminalCtrlVPasteChange}
                      />
                    </GroupBox>
                  </SettingsGroup>
                  <SettingsGroup label="Attention">
                    <SectionLabel title="Attention" />
                    <GroupBox>
                      <SettingsSwitch
                        id="app-attention-badge"
                        label="Attention badges on chat rows"
                        checked={attentionSettings.badge}
                        testId={TEST_ID.settingsAttentionBadge}
                        onChange={(next) => onAttentionSettingChange('badge', next)}
                      />
                      <SettingsSwitch
                        id="app-attention-active-indicator"
                        label="Attention indicator on the active chat's row"
                        checked={attentionSettings.activeIndicator}
                        divided
                        testId={TEST_ID.settingsAttentionActiveIndicator}
                        onChange={(next) => onAttentionSettingChange('activeIndicator', next)}
                      />
                      <SettingsSwitch
                        id="app-attention-chime"
                        label="Chime when a background chat needs attention"
                        checked={attentionSettings.chime}
                        divided
                        testId={TEST_ID.settingsAttentionChime}
                        onChange={(next) => onAttentionSettingChange('chime', next)}
                      />
                      <SettingsSwitch
                        id="app-attention-active-chime"
                        label="Chime when the active chat needs attention"
                        checked={attentionSettings.activeChime}
                        divided
                        testId={TEST_ID.settingsAttentionActiveChime}
                        onChange={(next) => onAttentionSettingChange('activeChime', next)}
                      />
                    </GroupBox>
                  </SettingsGroup>
                  <AppUpdateBlock app={app} />
                </div>
              ) : activeTab === 'usage' ? (
                <UsageSettings app={app} onSaved={onUsageSaved} />
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
                <div className="flex max-w-[660px] flex-col gap-7">
                  <PageIntro
                    title="Dictation"
                    description="Speech-to-text for session input. Recordings go to the provider you choose below."
                  />
                  <DictationSettings api={dictationApi} desktopDictation={desktopDictation} />
                  <DictationDictionary api={dictationApi} app={app} />
                </div>
              ) : (
                <div
                  data-testid={TEST_ID.settingsShortcutsTable}
                  className="flex max-w-[660px] flex-col gap-7"
                >
                  <PageIntro
                    title="Shortcuts"
                    description="Built-in keyboard shortcuts. How Ctrl+V behaves in full-screen programs is set in General."
                  />
                  {SHORTCUT_SECTIONS.map((section) => (
                    <SettingsGroup key={section.heading} label={section.heading}>
                      <SectionLabel title={section.heading} />
                      <GroupBox>
                        {section.rows.map(([keys, description], index) => (
                          <div
                            key={keys}
                            className={cn(
                              'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-4 py-2',
                              index > 0 && 'border-t border-edge',
                            )}
                          >
                            <span className="text-[13px] text-ink">{description}</span>
                            <ShortcutKeys chord={keys} />
                          </div>
                        ))}
                      </GroupBox>
                    </SettingsGroup>
                  ))}
                </div>
              )}
            </div>
          </div>
          {(error ?? desktopDictation.control.error) ? (
            <p role="alert" className="shrink-0 border-t border-edge px-7 py-2 text-xs text-error">
              {error ?? desktopDictation.control.error}
            </p>
          ) : null}
        </section>
      </div>
    </>
  )
}
