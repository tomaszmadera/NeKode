import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionControl, ActionExecution, AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
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
  onError: (message: string) => void
  onSettings: () => void
}

const fixed = [
  { label: 'Handoff', data: 'Napisz handoff\r' },
  { label: 'Resume', data: 'Wznów z handoffu\r' },
  { label: 'Stop', data: '\x03' },
  { label: 'Continue', data: 'Continue\r' },
] as const

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
      className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800 px-2"
      data-testid={TEST_ID.actionRowSlot}
    >
      {[
        { name: 'Handoff and Resume', items: fixed.slice(0, 2) },
        { name: 'Stop and Continue', items: fixed.slice(2) },
      ].map((group) => (
        <fieldset
          key={group.name}
          className="flex shrink-0 items-center rounded border border-neutral-700"
        >
          <legend className="sr-only">{group.name}</legend>
          {group.items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={!chatIsLive || !activeChatId}
              className="px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
              onClick={() => {
                void sendFixed(item.data)
              }}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
      ))}
      {visible.map((action) => {
        const state = states[action.id]
        const status = state?.status ?? 'idle'
        const symbol = { idle: '▶', running: '◌', success: '✓', failed: '✕' }[status]
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
            className="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:text-neutral-500"
            onClick={() => {
              void execute(action)
            }}
          >
            {`${symbol} `}
            {action.icon ? `${action.icon} ` : null}
            {action.title}
          </button>
        )
      })}
      <button
        type="button"
        className="ml-auto shrink-0 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
        onClick={onSettings}
      >
        Actions
      </button>
    </div>
  )
}
