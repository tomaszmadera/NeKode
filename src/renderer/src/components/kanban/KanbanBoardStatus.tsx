import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import type { KanbanBoardPhase } from './kanban-board-logic'
import { UseLocalTaskListButton } from './ProjectHomeWelcome'

// Inline board states beneath the header: loading, not-configured with
// Configure (Project Settings on its Kanban tab, mirroring the Resume picker's
// affordance), the typed load error, `Use a local task list` for a missing
// `local-file` task file, and the empty board. Ready renders nothing here.

export interface KanbanBoardStatusProps {
  phase: KanbanBoardPhase
  /** Typed message of the last failed load; also shown over a kept snapshot. */
  error: string | null
  /** The last load failed because the local task file is missing. */
  sourceMissing: boolean
  onConfigure: () => void
  onUseLocalTaskList?: () => Promise<void>
}

export function KanbanBoardStatus({
  phase,
  error,
  sourceMissing,
  onConfigure,
  onUseLocalTaskList,
}: KanbanBoardStatusProps): React.JSX.Element {
  return (
    <>
      {phase === 'loading' ? (
        <p
          className="text-[12.6px] text-ink-secondary"
          role="status"
          data-testid={TEST_ID.kanbanBoardLoading}
        >
          Loading board…
        </p>
      ) : null}
      {phase === 'not-configured' ? (
        <div className="text-[12.6px]" data-testid={TEST_ID.kanbanBoardUnconfigured}>
          <p className="text-ink-secondary">
            No task source is configured for this project. Connect one in Project Settings to see
            its tasks.
          </p>
          <button
            type="button"
            className="mt-3 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
            data-testid={TEST_ID.kanbanBoardConfigure}
            onClick={onConfigure}
          >
            Configure
          </button>
        </div>
      ) : null}
      {error !== null && phase !== 'not-configured' ? (
        <p role="alert" className="text-[12.6px] text-error" data-testid={TEST_ID.kanbanBoardError}>
          {error}
        </p>
      ) : null}
      {phase === 'error' && sourceMissing && onUseLocalTaskList !== undefined ? (
        <div className="mt-3 flex flex-col items-start text-[12.6px]">
          <UseLocalTaskListButton
            onUse={onUseLocalTaskList}
            testId={TEST_ID.kanbanBoardUseLocal}
            errorTestId={TEST_ID.projectHomeUseLocalError}
            className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover disabled:opacity-50"
          />
        </div>
      ) : null}
      {phase === 'empty' ? (
        <p className="text-[12.6px] text-ink-secondary" data-testid={TEST_ID.kanbanBoardEmpty}>
          This board has no states yet.
        </p>
      ) : null}
    </>
  )
}
