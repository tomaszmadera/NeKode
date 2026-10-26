import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Setup welcome of the project home tab (project-home spec Behaviour 2-3, 7):
// shown on the home tab of a project with no task source bound. It never
// calls `kanban:listBoard`. `Use a local task list` creates the task file
// when absent and binds `local-file`; `Connect a tracker` opens Project
// Settings on the Tasks section of that project.

/**
 * `Use a local task list` with its own busy and inline error state (spec
 * Errors: setup errors are inline). The caller performs the action and
 * rejects with the typed error on failure.
 */
export function UseLocalTaskListButton({
  onUse,
  testId,
  errorTestId,
  className,
}: {
  onUse: () => Promise<void>
  testId: string
  errorTestId: string
  className: string
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function run(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onUse()
    } catch (cause) {
      if (alive.current) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Could not create the local task list.')
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        data-testid={testId}
        onClick={() => {
          void run()
        }}
      >
        Use a local task list
      </button>
      {error !== null ? (
        <p role="alert" className="mt-2 text-error" data-testid={errorTestId}>
          {error}
        </p>
      ) : null}
    </>
  )
}

export function ProjectHomeWelcome({
  onUseLocalTaskList,
  onConnectTracker,
}: {
  onUseLocalTaskList: () => Promise<void>
  onConnectTracker: () => void
}): React.JSX.Element {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-[12.6px]"
      data-testid={TEST_ID.projectHomeWelcome}
    >
      <h2 className="text-[14.7px] font-semibold text-ink">No task list yet</h2>
      <p className="mt-2 text-ink-secondary">
        Keep tasks in a file in this project, or connect a tracker.
      </p>
      <div className="mt-3 flex flex-col items-start">
        <UseLocalTaskListButton
          onUse={onUseLocalTaskList}
          testId={TEST_ID.projectHomeUseLocal}
          errorTestId={TEST_ID.projectHomeUseLocalError}
          className="h-control rounded-md bg-accent px-4 font-semibold text-app hover:opacity-90 disabled:opacity-50"
        />
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.projectHomeConnectTracker}
          onClick={onConnectTracker}
        >
          Connect a tracker
        </button>
      </div>
    </section>
  )
}

/** Home tab while the project's binding read has not settled (spec Edge cases). */
export function ProjectHomeLoading(): React.JSX.Element {
  return (
    <p
      className="p-3 text-[12.6px] text-ink-secondary"
      data-testid={TEST_ID.projectHomeLoading}
      role="status"
    >
      Loading tasks…
    </p>
  )
}

/** Home tab when the binding read failed (spec Errors: setup errors are inline). */
export function ProjectHomeError({ message }: { message: string }): React.JSX.Element {
  return (
    <p className="p-3 text-[12.6px] text-error" data-testid={TEST_ID.projectHomeError} role="alert">
      {message}
    </p>
  )
}
