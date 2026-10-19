import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActionControl,
  ActionExecution,
  AppApi,
  SessionTaskProgress,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { cn } from '../../lib/cn'
import { actionIconGlyph, Icon, type LucideIcon } from '../../lib/icons'
import { writeSubmitLine } from '../../lib/pty-submit'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import type { MarkdownViewMode } from '../files/markdown-path'
import type { KanbanSortBy, KanbanToolbarControls } from '../kanban/KanbanBoard'
import { TaskProgressButton } from '../task-progress/TaskProgressButton'
import { ActionContextMenu } from './ActionContextMenu'

interface ActionBarProps {
  app: AppApi
  actions: ActionControl[]
  projectId: string | null
  activeChatId: string | null
  chatIsLive: boolean
  onNewTerminal: (execution: ActionExecution) => void
  /** Bottom-terminal delivery: opens the panel and adds a new bottom tab. */
  onBottomTerminal: (execution: ActionExecution, projectId: string) => void
  /**
   * Handoff/Resume delivery (spec handoff-resume-flow Behaviour 3): the host
   * pastes the English command into the active prompt input, or sends it
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
   * Optional task progress for the active session (agent harness task record).
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

/**
 * Status glyph per action state (design doc 10: status icons 13-14px).
 * Completion intentionally reverts to the idle glyph: the persisted run
 * state survives app restarts, so a success checkmark would never go
 * away; the tooltip (exit code, completed at) carries the result.
 */
const statusIcons: Record<'idle' | 'running' | 'success' | 'failed', LucideIcon> = {
  idle: Icon.run,
  running: Icon.running,
  success: Icon.run,
  failed: Icon.fail,
}

function message(error: unknown): string {
  return parseAppErrorPayload(error)?.message ?? 'Action failed.'
}

function epochOf(epochs: Record<string, number>, id: string): number {
  return epochs[id] ?? 0
}

export function ActionBar({
  app,
  actions,
  projectId,
  activeChatId,
  chatIsLive,
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
  const [states, setStates] = useState<Record<string, ActionExecution>>({})
  const [contextMenu, setContextMenu] = useState<{
    action: ActionControl
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
  const visible = actions.filter(
    (action) => action.scope === 'global' || action.projectId === projectId,
  )
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

  useEffect(() => {
    const running = Object.entries(states).filter(([, state]) => state.status === 'running')
    if (running.length === 0) return
    let alive = true
    const poll = window.setInterval(() => {
      for (const [id] of running) {
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
  }, [app, dropMissing, states, onError])

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
    // A preset icon name renders as its Lucide glyph; any other stored
    // value (custom emoji) stays literal text before the title. The
    // capitalized alias keeps JSX from reading the variable as a DOM tag.
    // The action's own icon (preset glyph or emoji) IS the run-state
    // glyph: it carries the state color and the running spin. The
    // generic status glyph (idle/run, failed) renders only when no
    // custom icon is set — never both (double-icon fix).
    const StateIcon = actionIconGlyph(action.icon) ?? statusIcons[status]
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
          <StateIcon
            size={15}
            aria-hidden
            className={cn(isRunning && 'animate-spin', status === 'idle' && 'text-ink-secondary')}
          />
          {!actionIconGlyph(action.icon) && action.icon ? (
            <span aria-hidden="true" className={cn(isRunning && 'animate-spin')}>
              {action.icon}
            </span>
          ) : null}
          {action.title}
        </button>
      </div>
    )
  }

  return (
    <div
      role="toolbar"
      aria-label="Agent controls"
      className="flex shrink-0 items-center gap-2 overflow-x-auto bg-panel border-b border-edge px-3 py-2"
      data-testid={TEST_ID.actionRowSlot}
    >
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
            <legend className="sr-only">Kanban sort</legend>
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
            <div className="flex h-[30px] items-center gap-2 px-2.5">
              <Icon.search size={14} aria-hidden className="text-ink-disabled shrink-0" />
              <input
                type="text"
                placeholder="Search... (not working yet)"
                disabled
                data-testid={TEST_ID.kanbanSearchInput}
                className="w-48 bg-transparent text-sm text-ink placeholder:text-ink-disabled opacity-70 cursor-not-allowed outline-none"
              />
            </div>
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
        {visible.map(renderAction)}
        {markdownView !== null ? (
          <fieldset className="nk-btn-group shrink-0">
            <legend className="sr-only">Markdown view</legend>
            <button
              type="button"
              className={cn('nk-tb', markdownView.mode === 'code' && 'active')}
              aria-pressed={markdownView.mode === 'code'}
              data-testid={TEST_ID.fileMarkdownCode}
              onClick={() => {
                markdownView.onChange('code')
              }}
            >
              <Icon.code
                size={15}
                aria-hidden
                className={markdownView.mode === 'code' ? 'text-ink' : 'text-ink-secondary'}
              />
              Code
            </button>
            <span aria-hidden="true" className="h-4 w-px bg-edge" />
            <button
              type="button"
              className={cn('nk-tb', markdownView.mode === 'preview' && 'active')}
              aria-pressed={markdownView.mode === 'preview'}
              data-testid={TEST_ID.fileMarkdownPreview}
              onClick={() => {
                markdownView.onChange('preview')
              }}
            >
              <Icon.preview
                size={15}
                aria-hidden
                className={markdownView.mode === 'preview' ? 'text-ink' : 'text-ink-secondary'}
              />
              Preview
            </button>
          </fieldset>
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
    </div>
  )
}
