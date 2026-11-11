import type {
  ActionControl,
  ActionExecution,
  AgentProfilesDocument,
  AppApi,
  SessionTaskProgress,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type LucideIcon } from '../../lib/icons'
import { writeSubmitLine } from '../../lib/pty-submit'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { MarkdownViewToggle } from '../files/MarkdownViewToggle'
import type { MarkdownViewMode } from '../files/markdown-path'
import { KanbanSearch } from '../kanban/KanbanSearch'
import type { KanbanSortBy, KanbanToolbarControls } from '../kanban/kanban-board-logic'
import { NewChatAgentMenu } from '../layout/LeftNavigation'
import { TaskProgressButton } from '../task-progress/TaskProgressButton'
import { ActionContextMenu } from './ActionContextMenu'
import { ActionGlyph } from './ActionGlyph'
import { ActionGroupMenu } from './ActionGroupMenu'

interface ActionBarProps {
  app: AppApi
  actions: ActionControl[]
  projectId: string | null
  activeChatId: string | null
  chatIsLive: boolean
  /** Create a new session in the active project. */
  onNewChat?: () => void
  loadAgentProfiles?: (projectId: string) => Promise<AgentProfilesDocument>
  onCreateAgentChat?: (projectId: string, profileId: string) => Promise<boolean>
  onConfigureAgents?: (projectId: string) => void
  onNewTerminal: (execution: ActionExecution) => void
  /** Bottom-terminal delivery: opens the panel and adds a new bottom tab. */
  onBottomTerminal: (execution: ActionExecution, projectId: string) => void
  /**
   * Handoff/Resume delivery (spec handoff-resume-flow Behaviour 3): the host
   * pastes the English command into the active console, or sends it
   * straight to the PTY when auto-send is on. The command stays English.
   */
  onPromptCommand: (text: string) => void
  /** Resume opens the handoff picker (lazy list, spec Behaviour 4). */
  onResume: () => void
  onError: (message: string) => void
  /**
   * Code / Preview for the active markdown file tab. Null when the active
   * tab is not a markdown file (user decision 2026-10-06).
   */
  markdownView: {
    mode: MarkdownViewMode
    onChange: (mode: MarkdownViewMode) => void
  } | null
  /**
   * Optional normalized adapter progress for the active session.
   */
  task?: SessionTaskProgress
  /**
   * Kanban view: suppresses fixed actions (handoff, resume, stop, continue)
   * and renders Kanban controls on the left.
   */
  isKanban?: boolean
  /** Active board's toolbar controls when isKanban is true. */
  kanbanControls?: KanbanToolbarControls | null
}

/** Fixed Handoff command (English, spec Behaviour 2). */
const HANDOFF_COMMAND = 'Write a handoff'

type FixedAction = 'handoff' | 'resume' | 'stop' | 'continue'

const fixed: Array<{ label: string; action: FixedAction; icon: LucideIcon }> = [
  { label: 'Handoff', action: 'handoff', icon: Icon.handoff },
  { label: 'Resume', action: 'resume', icon: Icon.resume },
  { label: 'Stop', action: 'stop', icon: Icon.stop },
  { label: 'Continue', action: 'continue', icon: Icon.continue },
]

function message(error: unknown): string {
  return parseAppErrorPayload(error)?.message ?? 'Action failed.'
}

function epochOf(epochs: Record<string, number>, id: string): number {
  return epochs[id] ?? 0
}

interface GroupEntry {
  kind: 'group'
  name: string
  actions: ActionControl[]
}

type ActionEntry = { kind: 'action'; action: ActionControl } | GroupEntry

/** Global actions plus the active project's (center-layout spec Behaviour 13). */
function visibleActions(actions: ActionControl[], projectId: string | null): ActionControl[] {
  return actions.filter((action) => action.scope === 'global' || action.projectId === projectId)
}

/**
 * Action row entries in configured order (action-groups spec Behaviour 4): an
 * action with a group joins the entry anchored at that group's first visible
 * member; an action without one keeps its own button.
 */
function actionEntries(visible: ActionControl[]): ActionEntry[] {
  const entries: ActionEntry[] = []
  const groups = new Map<string, GroupEntry>()
  for (const action of visible) {
    const name = action.group?.trim() ?? ''
    if (name === '') {
      entries.push({ kind: 'action', action })
      continue
    }
    const existing = groups.get(name)
    if (existing) {
      existing.actions.push(action)
      continue
    }
    const entry: GroupEntry = { kind: 'group', name, actions: [action] }
    groups.set(name, entry)
    entries.push(entry)
  }
  return entries
}

export function ActionBar({
  app,
  actions,
  projectId,
  activeChatId,
  chatIsLive,
  onNewChat,
  loadAgentProfiles,
  onCreateAgentChat,
  onConfigureAgents,
  onNewTerminal,
  onBottomTerminal,
  onPromptCommand,
  onResume,
  onError,
  markdownView,
  task,
  isKanban = false,
  kanbanControls = null,
}: ActionBarProps): React.JSX.Element {
  const [newChatMenu, setNewChatMenu] = useState<{
    projectId: string
    x: number
    y: number
  } | null>(null)
  useEffect(() => {
    if (newChatMenu === null) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setNewChatMenu(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [newChatMenu])
  const [states, setStates] = useState<Record<string, ActionExecution>>({})
  const [contextMenu, setContextMenu] = useState<{
    action: ActionControl
    x: number
    y: number
  } | null>(null)
  /**
   * Open group menu: the group name, the project it was opened in, and the
   * trigger anchor (action-groups spec Behaviour 7).
   */
  const [groupMenu, setGroupMenu] = useState<{
    name: string
    projectId: string | null
    x: number
    y: number
  } | null>(null)
  // A status read is stamped with the run epoch. execute() bumps it first, so
  // an earlier read (mount hydration included) cannot overwrite that run.
  const runEpochRef = useRef<Record<string, number>>({})
  const executeLockRef = useRef<Set<string>>(new Set())
  // status not_found means the row is gone. Further polls would report
  // "Action not found" for a process that is no longer an action.
  const forgottenRef = useRef<Set<string>>(new Set())
  const dropMissing = useCallback((id: string): void => {
    forgottenRef.current.add(id)
    setStates((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
  }, [])
  const visible = visibleActions(actions, projectId)
  const entries = actionEntries(visible)
  // Pending Continue CR timer (split-write submission); cancelled on unmount.
  const cancelContinueCrRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      cancelContinueCrRef.current?.()
      cancelContinueCrRef.current = null
    }
  }, [])

  useEffect(() => {
    if (contextMenu !== null && !actions.some((action) => action.id === contextMenu.action.id)) {
      setContextMenu(null)
    }
  }, [actions, contextMenu])

  // An open group menu closes when its group disappears (project switch,
  // deletion, or a regroup that leaves fewer than two visible members).
  useEffect(() => {
    if (groupMenu === null) return
    if (groupMenu.projectId !== projectId) {
      setGroupMenu(null)
      return
    }
    const entry = actionEntries(visibleActions(actions, projectId)).find(
      (candidate) => candidate.kind === 'group' && candidate.name === groupMenu.name,
    )
    if (entry === undefined || entry.kind !== 'group' || entry.actions.length < 2) {
      setGroupMenu(null)
    }
  }, [actions, projectId, groupMenu])

  useEffect(() => {
    let alive = true
    const ids = new Set(actions.map((action) => action.id))
    setStates((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))),
    )
    for (const action of actions) {
      const epoch = epochOf(runEpochRef.current, action.id)
      void Promise.resolve(app.actions.status(action.id))
        .then((state) => {
          if (
            !alive ||
            epochOf(runEpochRef.current, action.id) !== epoch ||
            !state ||
            forgottenRef.current.has(action.id)
          )
            return
          setStates((previous) => ({ ...previous, [action.id]: state }))
        })
        .catch((error: unknown) => {
          if (!alive || epochOf(runEpochRef.current, action.id) !== epoch) return
          if (parseAppErrorPayload(error)?.code === 'not_found') {
            dropMissing(action.id)
            return
          }
          onError(message(error))
        })
    }
    return () => {
      alive = false
    }
  }, [actions, app, dropMissing, onError])

  const runningActionIds = Object.entries(states)
    .filter(([, state]) => state.status === 'running')
    .map(([id]) => id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!runningActionIds) return
    const ids = runningActionIds.split(',')
    let alive = true
    const poll = window.setInterval(() => {
      for (const id of ids) {
        if (forgottenRef.current.has(id)) continue
        const epoch = epochOf(runEpochRef.current, id)
        void app.actions
          .status(id)
          .then((state) => {
            if (
              !alive ||
              epochOf(runEpochRef.current, id) !== epoch ||
              forgottenRef.current.has(id)
            )
              return
            setStates((previous) => ({ ...previous, [id]: state }))
          })
          .catch((error: unknown) => {
            if (!alive || epochOf(runEpochRef.current, id) !== epoch) return
            if (parseAppErrorPayload(error)?.code === 'not_found') {
              dropMissing(id)
              return
            }
            onError(message(error))
          })
      }
    }, 250)
    return () => {
      alive = false
      window.clearInterval(poll)
    }
  }, [app, dropMissing, runningActionIds, onError])

  async function sendFixed(data: string): Promise<void> {
    if (!activeChatId || !chatIsLive) return
    try {
      await app.terminals.write(activeChatId, data)
    } catch (error) {
      onError(message(error))
    }
  }

  // Stop/Continue write straight to the PTY; Handoff/Resume go through the
  // host (prompt-input paste, or direct send with auto-send on). Resume opens
  // the handoff picker instead of pasting a fixed command (spec Behaviour 4).
  // Continue submits through the split-write helper (lib/pty-submit.ts): a
  // single `Continue\r` chunk parses as an unterminated bracketed paste in
  // prompt_toolkit agent TUIs and never reaches the agent.
  function runFixed(action: FixedAction): void {
    if (!activeChatId || !chatIsLive) return
    if (action === 'handoff') {
      onPromptCommand(HANDOFF_COMMAND)
    } else if (action === 'resume') {
      onResume()
    } else if (action === 'stop') {
      void sendFixed('\x03')
    } else {
      cancelContinueCrRef.current?.()
      cancelContinueCrRef.current = writeSubmitLine((data) => {
        void sendFixed(data)
      }, 'Continue')
    }
  }

  async function execute(action: ActionControl): Promise<void> {
    if (executeLockRef.current.has(action.id)) return
    // Confirmation (spec Behaviour 16): the modal runs before the IPC call, so
    // a cancel sends nothing, creates no tab, and changes no panel state.
    if (action.confirm && !window.confirm(`Run ${action.title}?`)) return
    executeLockRef.current.add(action.id)
    const epoch = epochOf(runEpochRef.current, action.id) + 1
    runEpochRef.current[action.id] = epoch
    try {
      const state = await app.actions.execute(action.id, projectId, action.confirm)
      if (epochOf(runEpochRef.current, action.id) !== epoch) return
      setStates((previous) => ({ ...previous, [action.id]: state }))
      if (state.chat) onNewTerminal(state)
      if (state.bottomTabId !== undefined && projectId !== null) {
        onBottomTerminal(state, projectId)
      }
    } catch (error) {
      if (epochOf(runEpochRef.current, action.id) === epoch) onError(message(error))
    } finally {
      executeLockRef.current.delete(action.id)
    }
  }

  const renderAction = (action: ActionControl): React.JSX.Element => {
    const state = states[action.id]
    const status = state?.status ?? 'idle'
    const isRunning = status === 'running'
    // Hover details carry the command, exit code, and completion time.
    const details = [
      action.command,
      state?.exitCode !== null && state?.exitCode !== undefined
        ? `Exit code: ${state.exitCode}`
        : null,
      state?.error,
      state?.completedAt ? `Completed: ${state.completedAt}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    return (
      <div key={action.id} className="nk-btn-group shrink-0">
        <button
          type="button"
          disabled={isRunning}
          title={details}
          data-status={status}
          data-active={isRunning ? 'true' : 'false'}
          data-testid={testIdFor.actionButton(action.id)}
          className={cn(
            'nk-tb',
            isRunning && 'active text-info',
            status === 'failed' && 'text-error',
          )}
          onClick={() => {
            void execute(action)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setContextMenu({ action, x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              setContextMenu({ action, x: rect.left, y: rect.bottom })
            }
          }}
        >
          <ActionGlyph action={action} status={status} />
          {action.title}
        </button>
      </div>
    )
  }

  // A group with two or more visible members is one trigger plus a menu; a
  // single member keeps its own button (action-groups spec Behaviour 5-6).
  const renderGroup = (entry: GroupEntry): React.JSX.Element => {
    const isRunning = entry.actions.some((action) => states[action.id]?.status === 'running')
    const open = groupMenu?.name === entry.name
    return (
      <div key={`group:${entry.name}`} className="nk-btn-group shrink-0">
        <button
          type="button"
          title={`${entry.name} actions`}
          data-active={isRunning ? 'true' : 'false'}
          data-testid={testIdFor.actionGroup(entry.name)}
          className={cn('nk-tb', isRunning && 'active text-info')}
          onClick={(event) => {
            if (open) {
              setGroupMenu(null)
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            setGroupMenu({ name: entry.name, projectId, x: rect.left, y: rect.bottom })
          }}
        >
          {entry.name}
          <Icon.chevronDown size={13} aria-hidden className="text-ink-secondary" />
        </button>
      </div>
    )
  }

  const renderEntry = (entry: ActionEntry): React.JSX.Element => {
    if (entry.kind === 'action') return renderAction(entry.action)
    if (entry.actions.length === 1) return renderAction(entry.actions[0])
    return renderGroup(entry)
  }

  const openGroup =
    groupMenu === null
      ? null
      : (entries.find(
          (entry): entry is GroupEntry =>
            entry.kind === 'group' && entry.name === groupMenu.name && entry.actions.length > 1,
        ) ?? null)

  return (
    <div
      role="toolbar"
      aria-label="Agent controls"
      className="nk-action-row flex shrink-0 items-center gap-2 overflow-x-auto bg-panel border-b border-edge px-3 py-2"
      data-testid={TEST_ID.actionRowSlot}
      data-kanban={isKanban ? 'true' : undefined}
    >
      <div className="nk-btn-group shrink-0">
        <button
          type="button"
          disabled={!projectId || !onNewChat}
          className="nk-tb !px-2"
          aria-label="New session"
          title="New session"
          data-testid={TEST_ID.actionNewChat}
          onClick={() => {
            onNewChat?.()
          }}
          onContextMenu={(event) => {
            if (!projectId || !loadAgentProfiles || !onCreateAgentChat || !onConfigureAgents) return
            event.preventDefault()
            setNewChatMenu({ projectId, x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (!projectId || !loadAgentProfiles || !onCreateAgentChat || !onConfigureAgents) return
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              setNewChatMenu({ projectId, x: rect.left, y: rect.bottom })
            }
          }}
        >
          <Icon.newChat
            size={15}
            aria-hidden
            className={!projectId || !onNewChat ? 'text-ink-disabled' : 'text-ink-secondary'}
          />
        </button>
      </div>
      {newChatMenu && loadAgentProfiles && onCreateAgentChat && onConfigureAgents ? (
        <NewChatAgentMenu
          state={newChatMenu}
          loadProfiles={loadAgentProfiles}
          onCreateChat={onCreateAgentChat}
          onConfigureAgents={onConfigureAgents}
          onClose={() => setNewChatMenu(null)}
        />
      ) : null}
      {isKanban ? (
        <>
          <div className="nk-btn-group shrink-0">
            <button
              type="button"
              className="nk-tb !px-2"
              aria-label="Refresh"
              title="Refresh"
              data-testid={TEST_ID.kanbanBoardRefresh}
              disabled={!kanbanControls || kanbanControls.refreshing}
              onClick={kanbanControls?.onRefresh}
            >
              <Icon.retry
                size={15}
                aria-hidden
                className={cn('text-ink-secondary', kanbanControls?.refreshing && 'animate-spin')}
              />
            </button>
          </div>
          {kanbanControls?.isReviewing ? (
            <div className="nk-btn-group shrink-0">
              <button
                type="button"
                className="nk-tb"
                data-testid={TEST_ID.kanbanReviewBack}
                aria-label="Back"
                title="Back"
                onClick={kanbanControls.onCloseReview}
              >
                <Icon.back size={15} aria-hidden className="text-ink-secondary" />
                Back
              </button>
            </div>
          ) : null}
          {kanbanControls && !kanbanControls.isReviewing && kanbanControls.phase === 'ready' ? (
            <div className="nk-btn-group shrink-0">
              <button
                type="button"
                className="nk-tb"
                data-testid={TEST_ID.kanbanNewTask}
                disabled={kanbanControls.creatingBusy}
                onClick={kanbanControls.onNewTask}
              >
                <Icon.plus size={15} aria-hidden className="text-ink-secondary" />
                New task
              </button>
            </div>
          ) : null}
          <fieldset className="nk-btn-group shrink-0">
            <legend className="sr-only">Task sort</legend>
            <label htmlFor="kanban-sort-by" className="sr-only">
              Sort by
            </label>
            <select
              id="kanban-sort-by"
              className="h-[30px] rounded-[var(--radius-md)] border-none bg-transparent px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:text-ink-disabled disabled:cursor-not-allowed cursor-pointer"
              value={kanbanControls?.sortState.sortBy ?? 'slug'}
              onChange={(event) => {
                kanbanControls?.onSortByChange(event.target.value as KanbanSortBy)
              }}
              disabled={kanbanControls?.phase !== 'ready' || kanbanControls?.isReviewing}
              data-testid={TEST_ID.kanbanSortBy}
            >
              <option value="slug">Slug</option>
              <option value="priority">Priority</option>
            </select>
            <span aria-hidden="true" className="h-4 w-px bg-edge" />
            <button
              type="button"
              className="nk-tb !px-2"
              aria-label={
                (kanbanControls?.sortState.direction ?? 'asc') === 'asc'
                  ? 'Sort ascending'
                  : 'Sort descending'
              }
              title={
                (kanbanControls?.sortState.direction ?? 'asc') === 'asc'
                  ? 'Ascending'
                  : 'Descending'
              }
              disabled={kanbanControls?.phase !== 'ready' || kanbanControls?.isReviewing}
              data-testid={TEST_ID.kanbanSortDirection}
              onClick={kanbanControls?.onToggleSortDirection}
            >
              {(kanbanControls?.sortState.direction ?? 'asc') === 'asc' ? (
                <Icon.sortAsc size={15} aria-hidden className="text-ink-secondary" />
              ) : (
                <Icon.sortDesc size={15} aria-hidden className="text-ink-secondary" />
              )}
            </button>
          </fieldset>
          <div className="nk-btn-group shrink-0">
            <KanbanSearch
              query={kanbanControls?.searchQuery ?? ''}
              onQueryChange={(query) => kanbanControls?.onSearchQueryChange(query)}
              disabled={kanbanControls?.phase !== 'ready' || kanbanControls?.isReviewing}
            />
          </div>
        </>
      ) : (
        [
          { name: 'Handoff and Resume', items: fixed.slice(0, 2) },
          { name: 'Stop and Continue', items: fixed.slice(2) },
        ].map((group) => (
          <fieldset key={group.name} className="nk-btn-group shrink-0">
            <legend className="sr-only">{group.name}</legend>
            {group.items.map((item, index) => {
              const FixedIcon = item.icon
              const isDisabled = !chatIsLive || !activeChatId
              return (
                <div key={item.label} className="flex items-center">
                  {index > 0 ? (
                    // Toolbar separator from design reference (1px x 16px hairline)
                    <span aria-hidden="true" className="h-4 w-px bg-edge" />
                  ) : null}
                  <button
                    type="button"
                    disabled={isDisabled}
                    className="nk-tb"
                    data-fixed-action={item.action}
                    onClick={() => {
                      runFixed(item.action)
                    }}
                  >
                    <FixedIcon
                      size={15}
                      aria-hidden
                      className={isDisabled ? 'text-ink-disabled' : 'text-ink-secondary'}
                    />
                    {item.label}
                  </button>
                </div>
              )
            })}
          </fieldset>
        ))
      )}
      {/* Right side: custom actions are always right-aligned across all tabs,
          followed by Markdown Code | Preview if active. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!isKanban && task !== undefined ? <TaskProgressButton task={task} /> : null}
        {entries.map(renderEntry)}
        {markdownView !== null ? (
          <MarkdownViewToggle mode={markdownView.mode} onChange={markdownView.onChange} />
        ) : null}
      </div>
      {contextMenu !== null ? (
        <ActionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          command={contextMenu.action.command}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {openGroup !== null ? (
        <ActionGroupMenu
          name={openGroup.name}
          x={groupMenu?.x ?? 0}
          y={groupMenu?.y ?? 0}
          actions={openGroup.actions}
          statusOf={(id) => states[id]?.status ?? 'idle'}
          onSelect={(action) => {
            setGroupMenu(null)
            void execute(action)
          }}
          onCopy={(action, x, y) => {
            setGroupMenu(null)
            setContextMenu({ action, x, y })
          }}
          onClose={() => setGroupMenu(null)}
        />
      ) : null}
    </div>
  )
}
