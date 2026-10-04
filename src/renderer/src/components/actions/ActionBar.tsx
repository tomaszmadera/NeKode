import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionControl, ActionExecution, AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { cn } from '../../lib/cn'
import { actionIconGlyph, Icon, type LucideIcon } from '../../lib/icons'
import { writeSubmitLine } from '../../lib/pty-submit'
import { TEST_ID } from '../../lib/test-ids'

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
  onSettings: () => void
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
  onSettings,
}: ActionBarProps): React.JSX.Element {
  const [states, setStates] = useState<Record<string, ActionExecution>>({})
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

  return (
    <div
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-y border-edge px-2 py-2"
      data-testid={TEST_ID.actionRowSlot}
    >
      {[
        { name: 'Handoff and Resume', items: fixed.slice(0, 2) },
        { name: 'Stop and Continue', items: fixed.slice(2) },
      ].map((group) => (
        <fieldset
          key={group.name}
          className="flex h-control shrink-0 items-stretch overflow-hidden rounded-md bg-button"
        >
          <legend className="sr-only">{group.name}</legend>
          {group.items.map((item, index) => {
            const FixedIcon = item.icon
            return (
              <div key={item.label} className="flex items-stretch">
                {index > 0 ? (
                  // Toolbar-standard separator (design doc 5): a single
                  // low-contrast hairline, vertically centered, shorter than
                  // the buttons.
                  <span aria-hidden="true" className="h-4 w-px self-center bg-divider" />
                ) : null}
                <button
                  type="button"
                  disabled={!chatIsLive || !activeChatId}
                  className="flex items-center gap-1.5 bg-button px-3 text-sm text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
                  onClick={() => {
                    runFixed(item.action)
                  }}
                >
                  <FixedIcon size={14} aria-hidden />
                  {item.label}
                </button>
              </div>
            )
          })}
        </fieldset>
      ))}
      {visible.map((action) => {
        const state = states[action.id]
        const status = state?.status ?? 'idle'
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
          <button
            key={action.id}
            type="button"
            disabled={status === 'running'}
            title={details}
            data-status={status}
            className={cn(
              'flex shrink-0 items-center gap-1.5 self-stretch rounded-md bg-button px-3 text-sm hover:bg-button-hover disabled:text-ink-disabled',
              status === 'failed' && 'text-error',
              status === 'running' && 'text-info',
              status === 'idle' && 'text-ink',
            )}
            onClick={() => {
              void execute(action)
            }}
          >
            <StateIcon
              size={14}
              aria-hidden
              className={cn(status === 'running' && 'animate-spin')}
            />
            {!actionIconGlyph(action.icon) && action.icon ? (
              <span aria-hidden="true" className={cn(status === 'running' && 'animate-spin')}>
                {action.icon}
              </span>
            ) : null}
            {action.title}
          </button>
        )
      })}
      {/* Icon-only ghost control: no fill at rest or on hover (user request
          2026-10-04, the tab strip's New chat treatment): the icon brightens
          from --color-ink-secondary to --color-ink. The accessible name and
          tooltip come from aria-label and title since the visible label is
          gone. */}
      <button
        type="button"
        className="ml-auto flex shrink-0 items-center justify-center self-stretch rounded-md px-2 text-ink-secondary hover:text-ink"
        aria-label="Actions"
        title="Actions"
        onClick={onSettings}
      >
        <Icon.settings size={14} aria-hidden />
      </button>
    </div>
  )
}
