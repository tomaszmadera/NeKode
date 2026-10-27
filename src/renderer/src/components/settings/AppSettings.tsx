import type { AppApi } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/cn'
import { Icon, type LucideIcon } from '../../lib/icons'
import { isPromptChrome } from '../../lib/prompt-chrome'
import { TEST_ID } from '../../lib/test-ids'
import { isThemeId, THEME_IDS, THEMES } from '../../lib/theme'
import { settingsError, useSettingsStore } from '../../stores/useSettingsStore'
import { UsageSettings } from '../usage/UsageSettings'
import { AppUpdateBlock } from './AppUpdateBlock'
import { DictationDictionary } from './DictationDictionary'
import { DictationSettings } from './DictationSettings'
import { FontsSettings } from './FontsSettings'
import { GlobalAgentProfilesSettings } from './GlobalAgentProfilesSettings'
import { SettingsShell } from './SettingsShell'
import {
  FieldRow,
  GroupBox,
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
  onClose,
}: AppSettingsProps): React.JSX.Element {
  // Domain state comes from the settings store, which persists each change.
  const {
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
    promptChrome,
    onPromptChromeChange,
  } = useSettingsStore(
    useShallow((state) => ({
      theme: state.theme,
      quickThemeSwitch: state.quickThemeSwitch,
      onQuickThemeSwitchChange: state.setQuickThemeSwitch,
      chatSwitch: state.chatSwitchEnabled,
      projectNamesUppercase: state.projectNamesUppercase,
      onProjectNamesUppercaseChange: state.setProjectNamesUppercase,
      showProjectIcons: state.showProjectIcons,
      onShowProjectIconsChange: state.setShowProjectIcons,
      error: settingsError(state),
      onThemeChange: state.setTheme,
      onChatSwitchChange: state.setChatSwitchEnabled,
      attentionSettings: state.attentionSettings,
      onAttentionSettingChange: state.setAttentionSetting,
      terminalFontFamilies: state.terminalFontFamilies,
      onTerminalFontFamiliesChange: state.setTerminalFontFamilies,
      terminalFontSize: state.terminalFontSize,
      onTerminalFontSizeChange: state.setTerminalFontSize,
      terminalCtrlVPaste: state.terminalCtrlVPaste,
      onTerminalCtrlVPasteChange: state.setTerminalCtrlVPaste,
      promptChrome: state.promptChrome,
      onPromptChromeChange: state.setPromptChrome,
    })),
  )
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

  return (
    <SettingsShell
      labelledBy="app-settings-title"
      screenReaderTitle="App Settings"
      leading={<Icon.settings size={16} aria-hidden className="shrink-0 text-ink-secondary" />}
      title="Settings"
      pageLabel={pageLabel}
      closeLabel="Close app settings"
      items={SETTINGS_TABS.map((tab) => ({
        id: tab.id,
        label: tab.label,
        icon: tab.icon,
        tabDomId: tabId(tab.id),
        panelDomId: panelId(tab.id),
        testId:
          tab.id === 'general'
            ? TEST_ID.settingsGeneralTab
            : tab.id === 'shortcuts'
              ? TEST_ID.settingsShortcutsTab
              : undefined,
      }))}
      activeId={activeTab}
      onSelect={(id) => setActiveTab(id as SettingsTab)}
      onClose={onClose}
      keyboard="dialog"
      dialogRef={dialogRef}
      error={error ?? (activeTab === 'dictation' ? null : desktopDictation.control.error)}
    >
      {activeTab === 'general' ? (
        <div className="flex max-w-[660px] flex-col gap-7">
          <PageIntro title="General" description="Look and behaviour of the whole app." />
          <SettingsGroup label="Appearance">
            <SectionLabel title="Appearance" />
            <GroupBox>
              <FieldRow label="Theme" htmlFor="app-theme" description="Colours for the whole app.">
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
              <FieldRow
                label="Chat prompt"
                htmlFor="app-prompt-chrome"
                description="Dictation and Send is the default, with Send on the right. An empty draft presses Enter."
                divided
              >
                <SettingsSelect
                  id="app-prompt-chrome"
                  value={promptChrome}
                  testId={TEST_ID.settingsPromptChrome}
                  onChange={(value) => {
                    if (isPromptChrome(value)) onPromptChromeChange(value)
                  }}
                >
                  <option value="buttons">Dictation and Send</option>
                  <option value="input">Text field with buttons</option>
                  <option value="hidden">Hidden</option>
                </SettingsSelect>
              </FieldRow>
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
    </SettingsShell>
  )
}
