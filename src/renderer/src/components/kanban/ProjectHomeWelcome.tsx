import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Setup welcome of the project home tab (project-home spec Behaviour 2-3):
// shown on the home tab of a project with no task source bound. It never
// calls `kanban:listBoard`. `Connect a tracker` opens Project Settings on the
// Tasks section of that project.

export function ProjectHomeWelcome({
  onConnectTracker,
}: {
  onConnectTracker: () => void
}): React.JSX.Element {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-[12.6px]"
      data-testid={TEST_ID.projectHomeWelcome}
    >
      <h2 className="text-[14.7px] font-semibold text-ink">No task list yet</h2>
      <p className="mt-2 text-ink-secondary">Connect a tracker to see this project's tasks here.</p>
      <button
        type="button"
        className="mt-3 h-control self-start rounded-md bg-button px-4 text-ink hover:bg-button-hover"
        data-testid={TEST_ID.projectHomeConnectTracker}
        onClick={onConnectTracker}
      >
        Connect a tracker
      </button>
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
