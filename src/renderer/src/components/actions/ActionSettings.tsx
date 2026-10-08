import type React from 'react'
import { useEffect, useState } from 'react'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
import { projectHandoffDirKey, relativeToProject } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { ACTION_ICON_NAMES, ACTION_NONE, actionIconGlyph } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { AgentProfilesSettings } from '../settings/AgentProfilesSettings'
import { KanbanSettings } from '../settings/KanbanSettings'
import { ShellTab } from '../settings/ShellTab'

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
}

export type SettingsTabId = 'shell' | 'actions' | 'kanban' | 'agents'

const SETTINGS_TABS = ['shell', 'actions', 'kanban', 'agents'] as const

const TAB_LABEL: Record<SettingsTabId, string> = {
  shell: 'Shell',
  actions: 'Actions & Configuration',
  kanban: 'Kanban',
  agents: 'Agents',
}

const TAB_TEST_ID: Record<SettingsTabId, string> = {
  shell: TEST_ID.settingsShellTab,
  actions: TEST_ID.settingsActionsTab,
  kanban: TEST_ID.settingsKanbanTab,
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
    try {
      await app.state.set(projectHandoffDirKey(projectId), handoffDir.trim())
      setHandoffDirSaved(true)
      setConfigError(null)
    } catch (cause) {
      setHandoffDirSaved(false)
      setConfigError(
        parseAppErrorPayload(cause)?.message ?? 'Failed to save the handoff directory.',
      )
    }
  }

  async function browseHandoffDir(): Promise<void> {
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
      setConfigError(parseAppErrorPayload(cause)?.message ?? 'Failed to open the directory picker.')
    }
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
    if (!form) return
    if (!form.title.trim() || !form.command.trim()) {
      setError('Title and command are required.')
      return
    }
    try {
      const input = {
        ...form,
        command: runWithPowerShell ? powerShellCommand(form.command) : form.command,
      }
      if (editingId) await app.actions.update(editingId, input)
      else await app.actions.create(input)
      await onRefresh()
      setForm(null)
      setEditingId(null)
      setError(null)
    } catch (cause) {
      setError(parseAppErrorPayload(cause)?.message ?? 'Failed to save action.')
    }
  }

  async function remove(id: string): Promise<void> {
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
  }

  // Escape closes the dialog from anywhere: the trigger button keeps focus
  // when the dialog opens, so a dialog-level onKeyDown would never see the
  // key (same window-level idiom as the context menus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

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
          role="dialog"
          aria-modal="true"
          aria-label="Project Settings"
          className="flex h-[min(42rem,90dvh)] w-[min(56rem,94vw)] flex-col overflow-hidden rounded-lg border border-edge bg-panel p-4 shadow-xl sm:p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Project Settings</h2>
            <button
              type="button"
              aria-label="Close settings"
              className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          {/* Same shell as App Settings (user decision 2026-10-04): fixed dialog
              size, vertical tab column on the left, only the content pane
              scrolls. Tab test IDs stay on the tab buttons. */}
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
                  id={`settings-tab-${tab}`}
                  aria-controls={`settings-panel-${tab}`}
                  aria-selected={activeTab === tab}
                  data-testid={TAB_TEST_ID[tab]}
                  className={`rounded-md border border-edge px-3 py-2 text-left text-sm ${activeTab === tab ? 'bg-button text-ink' : 'text-ink-secondary'}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {TAB_LABEL[tab]}
                </button>
              ))}
            </div>
            {SETTINGS_TABS.filter((tab) => tab !== activeTab).map((tab) => (
              <div
                key={tab}
                role="tabpanel"
                id={`settings-panel-${tab}`}
                aria-labelledby={`settings-tab-${tab}`}
                hidden
              />
            ))}
            <div
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              className="min-w-0 flex-1 overflow-y-auto pr-1"
            >
              {activeTab === 'shell' ? (
                <ShellTab app={app} projectId={projectId} />
              ) : activeTab === 'kanban' ? (
                <KanbanSettings app={app} projectId={projectId} onInvalidate={onKanbanInvalidate} />
              ) : activeTab === 'agents' ? (
                <AgentProfilesSettings app={app} projectId={projectId} />
              ) : (
                <>
                  {/* Configuration (spec handoff-resume-flow Behaviour 6): auto-send is
            application-global; the handoff directory is per project. */}
                  <div className="mt-4 text-xs" data-testid={TEST_ID.settingsConfigSection}>
                    <h3 className="border-b border-edge pb-2 text-sm font-semibold">
                      Configuration
                    </h3>
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={autoSend}
                        data-testid={TEST_ID.settingsAutoSend}
                        onChange={(event) => {
                          onAutoSendChange(event.target.checked)
                        }}
                      />
                      Auto-send after Handoff/Resume
                    </label>
                    {projectId !== null ? (
                      <div className="mt-2">
                        <label>
                          Handoff directory (relative to the project root, or absolute)
                          <div className="mt-1 flex gap-2">
                            <input
                              className="min-w-0 flex-1 rounded-sm bg-highlight p-1"
                              value={handoffDir}
                              placeholder="e.g. .agents/handoffs"
                              data-testid={TEST_ID.settingsHandoffDir}
                              onChange={(event) => {
                                setHandoffDir(event.target.value)
                                setHandoffDirSaved(false)
                              }}
                            />
                            <button
                              type="button"
                              className="h-control shrink-0 rounded-md bg-button px-3 text-ink hover:bg-button-hover"
                              data-testid={TEST_ID.settingsHandoffDirBrowse}
                              onClick={() => {
                                void browseHandoffDir()
                              }}
                            >
                              Browse
                            </button>
                          </div>
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            aria-label="Save handoff directory"
                            className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
                            data-testid={TEST_ID.settingsHandoffDirSave}
                            onClick={() => {
                              void saveHandoffDir()
                            }}
                          >
                            Save
                          </button>
                          {handoffDirSaved ? (
                            <span
                              className="text-success"
                              data-testid={TEST_ID.settingsHandoffDirSaved}
                            >
                              Saved
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {configError ? (
                      <p role="alert" className="mt-2 text-error">
                        {configError}
                      </p>
                    ) : null}
                  </div>
                  <h3 className="mt-4 border-b border-edge pb-2 text-sm font-semibold">Actions</h3>
                  <ul className="mt-2 space-y-2">
                    {visible.map((action) => (
                      <li
                        key={action.id}
                        className="flex items-center gap-2 rounded border border-edge px-2 py-1 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{action.title}</div>
                          <div
                            className="truncate text-ink-secondary"
                            title={actionCommand(action.command).command}
                          >
                            {actionCommand(action.command).command}
                          </div>
                          <div className="text-ink-muted">
                            {action.runMode === 'background'
                              ? 'Background'
                              : action.runMode === 'bottom-terminal'
                                ? 'Bottom terminal'
                                : 'New terminal'}{' '}
                            · {action.scope}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                          onClick={() => edit(action)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-error/10 hover:text-error"
                          onClick={() => {
                            void remove(action.id)
                          }}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="mt-3 h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
                    onClick={() => {
                      setEditingId(null)
                      setForm(emptyInput(projectId, nextSortOrder(actions)))
                      setRunWithPowerShell(false)
                      setError(null)
                    }}
                  >
                    Add Action
                  </button>
                  {form !== null ? (
                    <form
                      className="mt-4 grid gap-3 text-xs"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void save()
                      }}
                    >
                      <h4 className="font-semibold">{editingId ? 'Edit Action' : 'Add Action'}</h4>
                      <label>
                        Scope
                        <select
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={form.scope}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              scope: event.target.value as ActionInput['scope'],
                              projectId: event.target.value === 'global' ? null : projectId,
                            })
                          }
                        >
                          <option value="project" disabled={projectId === null}>
                            Project
                          </option>
                          <option value="global">Global</option>
                        </select>
                      </label>
                      <label>
                        Title
                        <input
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={form.title}
                          onChange={(event) => setForm({ ...form, title: event.target.value })}
                        />
                      </label>
                      <label>
                        Icon
                        <select
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={iconModeOf(form.icon)}
                          data-testid={TEST_ID.settingsActionIconSelect}
                          onChange={(event) => {
                            const value = event.target.value
                            setForm({
                              ...form,
                              icon: value === ACTION_NONE || value === 'custom' ? null : value,
                            })
                          }}
                        >
                          {ICON_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {iconModeOf(form.icon) === 'custom' ? (
                        <label>
                          Icon emoji
                          <input
                            className="mt-1 block w-full rounded-sm bg-highlight p-1"
                            value={form.icon ?? ''}
                            placeholder="e.g. 🚀"
                            data-testid={TEST_ID.settingsActionIconEmoji}
                            onChange={(event) =>
                              setForm({ ...form, icon: event.target.value || null })
                            }
                          />
                        </label>
                      ) : null}
                      <p className="text-ink-muted">
                        Icon: pick a preset Lucide glyph, or choose Custom and paste any emoji.
                        Leave None for no icon.
                      </p>
                      <label>
                        Command
                        <input
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={form.command}
                          onChange={(event) => setForm({ ...form, command: event.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={runWithPowerShell}
                          onChange={(event) => setRunWithPowerShell(event.target.checked)}
                        />
                        Run with{' '}
                        <code className="min-w-0 rounded-sm bg-highlight px-1 font-mono">
                          {POWERSHELL_PREFIX.trim()}
                        </code>
                      </label>
                      <label>
                        Working Directory (project root by default)
                        <input
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={form.cwd ?? ''}
                          onChange={(event) =>
                            setForm({ ...form, cwd: event.target.value || null })
                          }
                        />
                      </label>
                      <label>
                        Run In
                        <select
                          className="mt-1 block w-full rounded-sm bg-highlight p-1"
                          value={form.runMode}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              runMode: event.target.value as ActionInput['runMode'],
                            })
                          }
                        >
                          <option value="background">Background</option>
                          <option value="new-terminal">New terminal</option>
                          <option value="bottom-terminal">Bottom terminal</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.confirm}
                          onChange={(event) => setForm({ ...form, confirm: event.target.checked })}
                        />
                        Ask for confirmation
                      </label>
                      {error ? (
                        <p role="alert" className="text-error">
                          {error}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="h-control rounded-md px-4 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                          onClick={() => {
                            setForm(null)
                            setError(null)
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : error ? (
                    <p role="alert" className="mt-2 text-xs text-error">
                      {error}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
