import type React from 'react'
import { useEffect, useState } from 'react'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
import { projectHandoffDirKey, relativeToProject } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { cn } from '../../lib/cn'
import {
  ACTION_ICON_NAMES,
  ACTION_NONE,
  actionIconGlyph,
  Icon,
  type LucideIcon,
} from '../../lib/icons'
import { getProjectInitials } from '../../lib/project-avatar'
import { TEST_ID } from '../../lib/test-ids'
import { AgentProfilesSettings } from '../settings/AgentProfilesSettings'
import { KanbanSettings } from '../settings/KanbanSettings'
import { type SettingsNavItem, SettingsShell } from '../settings/SettingsShell'
import { ShellTab } from '../settings/ShellTab'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  monoClass,
  PageIntro,
  primaryClass,
  quietClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  SettingsSwitch,
  StackedRow,
  secondaryClass,
  textClass,
} from '../settings/settings-ui'
import { TaskProgressSettings } from '../settings/TaskProgressSettings'

interface Props {
  app: AppApi
  actions: ActionControl[]
  projectId: string | null
  /** Project root (Browse fallback when no directory is set yet); null without a project. */
  projectPath: string | null
  /** Application-global Handoff/Resume auto-send (spec Behaviour 6). */
  autoSend: boolean
  onAutoSendChange: (next: boolean) => void
  onRefresh: () => Promise<void>
  /**
   * Tab selected when the dialog opens (default `shell`). Only a caller that
   * must land on a specific section passes it (e.g. the board's Configure
   * button opening the Kanban tab); every other opener keeps the default.
   */
  initialTab?: SettingsTabId
  onClose: () => void
  onKanbanInvalidate?: (projectId: string | null) => void
  onManageAgents?: () => void
  onProjectColorChange?: (projectId: string, color: string | null) => void
  /** Shown in the header so the open project stays obvious. */
  projectName?: string | null
  /** Resolved avatar colour (custom or the automatic palette colour). */
  projectColor?: string | null
  libraryRefreshKey?: number
  suspended?: boolean
}

export type SettingsTabId = 'shell' | 'actions' | 'kanban' | 'taskProgress' | 'agents'

const PROJECT_TABS: Array<{ id: SettingsTabId; label: string; icon: LucideIcon }> = [
  { id: 'shell', label: 'Shell', icon: Icon.terminal },
  { id: 'actions', label: 'Actions', icon: Icon.run },
  { id: 'kanban', label: 'Tasks', icon: Icon.kanban },
  { id: 'taskProgress', label: 'Task progress', icon: Icon.activity },
  { id: 'agents', label: 'Agents', icon: Icon.agent },
]

const TAB_TEST_ID: Record<SettingsTabId, string> = {
  shell: TEST_ID.settingsShellTab,
  actions: TEST_ID.settingsActionsTab,
  kanban: TEST_ID.settingsKanbanTab,
  taskProgress: TEST_ID.settingsTaskProgressTab,
  agents: TEST_ID.settingsAgentsTab,
}

const POWERSHELL_PREFIX = 'powershell -NoProfile -ExecutionPolicy Bypass -File '

function powerShellCommand(command: string): string {
  return POWERSHELL_PREFIX + command
}

function actionCommand(command: string): { command: string; powerShell: boolean } {
  if (command.startsWith(POWERSHELL_PREFIX)) {
    return { command: command.slice(POWERSHELL_PREFIX.length), powerShell: true }
  }
  return { command, powerShell: false }
}

function nextSortOrder(actions: ActionControl[]): number {
  let max = -1
  for (const action of actions) {
    if (action.sortOrder > max) max = action.sortOrder
  }
  return max + 1
}

/** Absolute path shape for the picker defaultPath (the channel takes null or
    absolute only): drive-rooted Windows and POSIX forms, no relative input. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

function emptyInput(projectId: string | null, sortOrder: number): ActionInput {
  return {
    scope: projectId === null ? 'global' : 'project',
    projectId,
    title: '',
    icon: null,
    command: '',
    cwd: null,
    runMode: 'background',
    confirm: false,
    sortOrder,
  }
}

/** Icon picker mode derived from the stored value: a palette name selects
    that preset, any other text is a custom emoji, null is "none". */
function iconModeOf(icon: string | null): string {
  if (icon === null) return ACTION_NONE
  if (actionIconGlyph(icon) !== null) return icon
  return 'custom'
}

/** Icon names rendered for the picker, ordered like the button palette. */
const ICON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: ACTION_NONE, label: 'None' },
  ...ACTION_ICON_NAMES.map((name) => ({ value: name, label: name })),
  { value: 'custom', label: 'Custom (emoji)' },
]

export function ActionSettings({
  app,
  actions,
  projectId,
  projectPath,
  autoSend,
  onAutoSendChange,
  onRefresh,
  initialTab,
  onClose,
  onKanbanInvalidate,
  onManageAgents,
  onProjectColorChange,
  projectName = null,
  projectColor = null,
  libraryRefreshKey,
  suspended = false,
}: Props): React.JSX.Element {
  // Tab state is renderer-local (spec project-shell-selection Stage 4): the
  // Shell tab is the default, each tab keeps its own unsaved edits, and an
  // explicit `initialTab` (the board's Configure button) overrides the default
  // for this mount only.
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab ?? 'shell')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ActionInput | null>(null)
  const [runWithPowerShell, setRunWithPowerShell] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = actions.filter(
    (action) => action.scope === 'global' || action.projectId === projectId,
  )

  // Configuration section state (spec handoff-resume-flow Behaviour 6): the
  // handoff directory loads once per bound project; Save persists the exact
  // input (empty clears the setting). Auto-send persists immediately.
  const [handoffDir, setHandoffDir] = useState('')
  const [handoffDirSaved, setHandoffDirSaved] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const guard = useMutationGuard()

  useEffect(() => {
    if (projectId === null) {
      setHandoffDir('')
      return
    }
    let alive = true
    setHandoffDirSaved(false)
    setConfigError(null)
    void app.state
      .get(projectHandoffDirKey(projectId))
      .then((value) => {
        if (alive) setHandoffDir(value ?? '')
      })
      .catch((cause: unknown) => {
        // A failed read must not masquerade as "unconfigured": an empty input
        // plus a visible error keeps a later Save from wiping the setting.
        if (alive) {
          setHandoffDir('')
          setConfigError(
            parseAppErrorPayload(cause)?.message ?? 'Failed to load the handoff directory setting.',
          )
        }
      })
    return () => {
      alive = false
    }
  }, [app, projectId])

  async function saveHandoffDir(): Promise<void> {
    if (projectId === null) return
    await guard.run(async () => {
      try {
        await app.state.set(projectHandoffDirKey(projectId), handoffDir.trim())
        setHandoffDirSaved(true)
        setConfigError(null)
        // A saved directory invalidates the previous availability result: the
        // board session is keyed by this version, so it re-scans (spec
        // Resume availability item 6).
        onKanbanInvalidate?.(projectId)
      } catch (cause) {
        setHandoffDirSaved(false)
        setConfigError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to save the handoff directory.',
        )
      }
    })
  }

  async function browseHandoffDir(): Promise<void> {
    await guard.run(async () => {
      // The picker's defaultPath must be null or absolute (validator rule): a
      // relative current value falls back to the project root, like the empty
      // case (spec Behaviour 6: current value or project root). The confirmed
      // directory stores relative to the project root when it lies inside it
      // (absolute otherwise): the relative form is the norm for this setting.
      const current = handoffDir.trim()
      const fallback = current.length > 0 && isAbsolutePath(current) ? current : projectPath
      try {
        const picked = await app.dialogs.pickDirectory(fallback)
        if (picked !== null) {
          // The root itself (relative form '') stores absolute: an empty stored
          // value means unconfigured, so Browse never produces one.
          const relative = projectPath !== null ? relativeToProject(projectPath, picked) : null
          setHandoffDir(relative !== null && relative.length > 0 ? relative : picked)
          setHandoffDirSaved(false)
        }
      } catch (cause) {
        setConfigError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to open the directory picker.',
        )
      }
    })
  }

  function edit(action: ActionControl): void {
    const decoded = actionCommand(action.command)
    setRunWithPowerShell(decoded.powerShell)
    setEditingId(action.id)
    setForm({
      scope: action.scope,
      projectId: action.projectId,
      title: action.title,
      icon: action.icon,
      command: decoded.command,
      cwd: action.cwd,
      runMode: action.runMode,
      confirm: action.confirm,
      sortOrder: action.sortOrder,
    })
    setError(null)
  }

  async function save(): Promise<void> {
    // The in-flight check stays before the validation error: while a save is
    // in flight a second activation must return silently, not re-report.
    if (!form || guard.inFlight()) return
    if (!form.title.trim() || !form.command.trim()) {
      setError('Title and command are required.')
      return
    }
    const input = {
      ...form,
      icon: form.icon?.trim() ? form.icon.trim() : null,
      command: runWithPowerShell ? powerShellCommand(form.command) : form.command,
    }
    await guard.run(async () => {
      try {
        if (editingId) await app.actions.update(editingId, input)
        else await app.actions.create(input)
      } catch (cause) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to save action.')
        return
      }

      setForm(null)
      setEditingId(null)
      setError(null)

      try {
        await onRefresh()
      } catch (cause) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to refresh actions.')
      }
    })
  }

  async function remove(id: string): Promise<void> {
    await guard.run(async () => {
      try {
        await app.actions.delete(id)
        await onRefresh()
        if (editingId === id) {
          setForm(null)
          setEditingId(null)
        }
        setError(null)
      } catch (cause) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to delete action.')
      }
    })
  }

  const navItems: SettingsNavItem[] = PROJECT_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    testId: TAB_TEST_ID[tab.id],
    tabDomId: `settings-tab-${tab.id}`,
    panelDomId: `settings-panel-${tab.id}`,
  }))
  const pageLabel = PROJECT_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Shell'
  const initials = projectName ? getProjectInitials(projectName) : ''

  return (
    <SettingsShell
      ariaLabel="Project Settings"
      leading={
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-button font-mono text-[10px] font-bold text-ink-secondary"
          style={
            projectColor ? { color: projectColor, backgroundColor: `${projectColor}2e` } : undefined
          }
        >
          {initials}
        </span>
      }
      title={projectName ?? 'Project'}
      titleNote="project settings"
      pageLabel={pageLabel}
      closeLabel="Close settings"
      items={navItems}
      activeId={activeTab}
      onSelect={(id) => setActiveTab(id as SettingsTabId)}
      onClose={onClose}
      suspended={suspended}
      keyboard="window"
    >
      {activeTab === 'shell' ? (
        <ShellTab app={app} projectId={projectId} onProjectColorChange={onProjectColorChange} />
      ) : activeTab === 'kanban' ? (
        <KanbanSettings app={app} projectId={projectId} onInvalidate={onKanbanInvalidate} />
      ) : activeTab === 'taskProgress' ? (
        <TaskProgressSettings app={app} projectId={projectId} />
      ) : activeTab === 'agents' ? (
        <AgentProfilesSettings
          app={app}
          projectId={projectId}
          onManageAgents={onManageAgents}
          libraryRefreshKey={libraryRefreshKey}
        />
      ) : (
        <div className="flex max-w-[660px] flex-col gap-7">
          <PageIntro
            title="Actions"
            description="Handoff settings and the command buttons in this project's toolbar."
          />
          {form === null ? (
            <>
              <SettingsGroup label="Handoff">
                <SectionLabel title="Handoff" />
                <GroupBox>
                  <div data-testid={TEST_ID.settingsConfigSection}>
                    <SettingsSwitch
                      id="settings-auto-send"
                      label="Auto-send after Handoff and Resume"
                      description="Sends the handoff prompt without waiting for Enter."
                      checked={autoSend}
                      testId={TEST_ID.settingsAutoSend}
                      onChange={onAutoSendChange}
                    />
                    {projectId !== null ? (
                      <StackedRow
                        label="Handoff directory"
                        htmlFor="settings-handoff-dir"
                        help="Relative to the project root, or absolute."
                        divided
                      >
                        <span className="flex gap-2">
                          <input
                            id="settings-handoff-dir"
                            className={cn(monoClass, 'min-w-0 flex-1')}
                            value={handoffDir}
                            placeholder=".agents/handoffs"
                            spellCheck={false}
                            data-testid={TEST_ID.settingsHandoffDir}
                            onChange={(event) => {
                              setHandoffDir(event.target.value)
                              setHandoffDirSaved(false)
                            }}
                          />
                          <button
                            type="button"
                            disabled={guard.busy}
                            className={secondaryClass}
                            data-testid={TEST_ID.settingsHandoffDirBrowse}
                            onClick={() => {
                              void browseHandoffDir()
                            }}
                          >
                            Browse
                          </button>
                        </span>
                      </StackedRow>
                    ) : null}
                    {configError ? (
                      <p role="alert" className="border-t border-edge px-4 py-2 text-xs text-error">
                        {configError}
                      </p>
                    ) : null}
                    {projectId !== null ? (
                      <GroupFooter
                        status={
                          handoffDirSaved ? (
                            <span
                              className="text-success"
                              data-testid={TEST_ID.settingsHandoffDirSaved}
                            >
                              Saved
                            </span>
                          ) : null
                        }
                      >
                        <button
                          type="button"
                          aria-label="Save handoff directory"
                          disabled={guard.busy}
                          className={primaryClass}
                          data-testid={TEST_ID.settingsHandoffDirSave}
                          onClick={() => {
                            void saveHandoffDir()
                          }}
                        >
                          Save
                        </button>
                      </GroupFooter>
                    ) : null}
                  </div>
                </GroupBox>
              </SettingsGroup>
              <SettingsGroup label="Toolbar actions">
                <SectionLabel
                  title={`Toolbar actions · ${visible.length}`}
                  action={
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => {
                        setEditingId(null)
                        setForm(emptyInput(projectId, nextSortOrder(actions)))
                        setRunWithPowerShell(false)
                        setError(null)
                      }}
                    >
                      <Icon.plus size={14} aria-hidden />
                      Add action
                    </button>
                  }
                />
                <GroupBox>
                  <ul>
                    {visible.map((action, index) => {
                      const decoded = actionCommand(action.command)
                      const Glyph = actionIconGlyph(action.icon)
                      const mode =
                        action.runMode === 'background'
                          ? 'Background'
                          : action.runMode === 'bottom-terminal'
                            ? 'Bottom terminal'
                            : 'New terminal'
                      return (
                        <li
                          key={action.id}
                          className={cn(
                            'flex items-center gap-3 px-4 py-3',
                            index > 0 && 'border-t border-edge',
                          )}
                        >
                          <span
                            aria-hidden
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-button text-ink-secondary"
                          >
                            {Glyph ? (
                              <Glyph size={14} />
                            ) : action.icon ? (
                              <span className="text-sm">{action.icon}</span>
                            ) : (
                              <Icon.run size={14} />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-[13px] font-semibold text-project-title">
                              {action.title}
                            </span>
                            <code
                              title={action.command}
                              className="truncate font-mono text-xs text-ink-secondary"
                            >
                              {decoded.command}
                            </code>
                            <span className="text-[11px] text-ink-muted">
                              {mode} · {action.scope}
                            </span>
                          </span>
                          <button type="button" className={quietClass} onClick={() => edit(action)}>
                            <Icon.edit size={13} aria-hidden />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={guard.busy}
                            className={cn(quietClass, 'text-error')}
                            onClick={() => {
                              void remove(action.id)
                            }}
                          >
                            <Icon.trash size={13} aria-hidden />
                            Delete
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </GroupBox>
              </SettingsGroup>
              {error ? (
                <p role="alert" className="text-xs text-error">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <SettingsGroup label={editingId ? 'Edit action' : 'New action'}>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Back to actions"
                  title="Back to actions"
                  className={quietClass}
                  onClick={() => {
                    setForm(null)
                    setError(null)
                  }}
                >
                  <Icon.back size={15} aria-hidden />
                </button>
                <h3 className="m-0 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
                  {editingId ? 'Edit action' : 'New action'}
                </h3>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <GroupBox>
                  <FieldRow
                    label="Title"
                    htmlFor="settings-action-title"
                    description="Label of the toolbar button."
                  >
                    <input
                      id="settings-action-title"
                      className={textClass}
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                    />
                  </FieldRow>
                  <FieldRow
                    label="Icon"
                    htmlFor="settings-action-icon"
                    description="A Lucide glyph, or Custom to paste any emoji."
                    divided
                  >
                    <SettingsSelect
                      id="settings-action-icon"
                      value={iconModeOf(form.icon)}
                      testId={TEST_ID.settingsActionIconSelect}
                      onChange={(value) => {
                        setForm({
                          ...form,
                          icon: value === ACTION_NONE ? null : value === 'custom' ? '' : value,
                        })
                      }}
                    >
                      {ICON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SettingsSelect>
                  </FieldRow>
                  {iconModeOf(form.icon) === 'custom' ? (
                    <FieldRow label="Icon emoji" htmlFor="settings-action-emoji" divided>
                      <input
                        id="settings-action-emoji"
                        className={textClass}
                        value={form.icon ?? ''}
                        placeholder="e.g. 🚀"
                        data-testid={TEST_ID.settingsActionIconEmoji}
                        onChange={(event) => setForm({ ...form, icon: event.target.value })}
                      />
                    </FieldRow>
                  ) : null}
                  <FieldRow
                    label="Scope"
                    htmlFor="settings-action-scope"
                    description="Where this action is available."
                    divided
                  >
                    <SettingsSelect
                      id="settings-action-scope"
                      value={form.scope}
                      onChange={(value) =>
                        setForm({
                          ...form,
                          scope: value as ActionInput['scope'],
                          projectId: value === 'global' ? null : projectId,
                        })
                      }
                    >
                      <option value="project" disabled={projectId === null}>
                        Project
                      </option>
                      <option value="global">Global</option>
                    </SettingsSelect>
                  </FieldRow>
                  <StackedRow label="Command" htmlFor="settings-action-command" divided>
                    <input
                      id="settings-action-command"
                      className={monoClass}
                      value={form.command}
                      spellCheck={false}
                      onChange={(event) => setForm({ ...form, command: event.target.value })}
                    />
                  </StackedRow>
                  <SettingsSwitch
                    id="action-powershell"
                    label="Run as a PowerShell script"
                    description={`Wraps the command in ${POWERSHELL_PREFIX.trim()}`}
                    checked={runWithPowerShell}
                    divided
                    onChange={setRunWithPowerShell}
                  />
                  <FieldRow
                    label="Working directory"
                    htmlFor="settings-action-cwd"
                    description="Project root when empty."
                    divided
                  >
                    <input
                      id="settings-action-cwd"
                      className={monoClass}
                      value={form.cwd ?? ''}
                      placeholder="Project root"
                      spellCheck={false}
                      onChange={(event) => setForm({ ...form, cwd: event.target.value || null })}
                    />
                  </FieldRow>
                  <FieldRow
                    label="Run in"
                    htmlFor="settings-action-run"
                    description="Background, a new terminal, or the bottom terminal."
                    divided
                  >
                    <SettingsSelect
                      id="settings-action-run"
                      value={form.runMode}
                      onChange={(value) =>
                        setForm({ ...form, runMode: value as ActionInput['runMode'] })
                      }
                    >
                      <option value="background">Background</option>
                      <option value="new-terminal">New terminal</option>
                      <option value="bottom-terminal">Bottom terminal</option>
                    </SettingsSelect>
                  </FieldRow>
                  <SettingsSwitch
                    id="action-confirm"
                    label="Ask for confirmation"
                    checked={form.confirm}
                    divided
                    onChange={(next) => setForm({ ...form, confirm: next })}
                  />
                  {error ? (
                    <p role="alert" className="border-t border-edge px-4 py-2 text-xs text-error">
                      {error}
                    </p>
                  ) : null}
                  <GroupFooter>
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => {
                        setForm(null)
                        setError(null)
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={guard.busy} className={primaryClass}>
                      Save action
                    </button>
                  </GroupFooter>
                </GroupBox>
              </form>
            </SettingsGroup>
          )}
        </div>
      )}
    </SettingsShell>
  )
}
