import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppApi, ProjectInfo, TaskInfo } from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { TaskTerminal } from '../terminal/TaskTerminal'
import { WelcomeSurface } from './WelcomeSurface'

// Task workspace (UX-UI §17): task title bar plus the primary terminal
// filling the rest of the center surface. This component is the session host:
// every task terminal view that ever mounted stays mounted (hidden) while the
// user works elsewhere, so PTY processes and xterm scrollback survive task and
// project switches (spec Behaviour 6-7, A4). Dead sessions (exited/failed) can
// be closed and re-created on the next selection (spec Edge cases) — never by
// a data refresh. Views for removed tasks (project deletion cascade) are
// evicted; their PTYs are terminated in main (projects:remove), never here.

interface SessionRecord {
  /** Bumped when a dead session is replaced by a fresh one (remount key). */
  generation: number
  status: 'running' | 'exited' | 'error'
  exitCode: number | null
  errorMessage: string | null
  /** Project directory captured at spawn time (the PTY cwd). */
  cwd: string
}

interface TaskWorkspaceProps {
  app: AppApi
  projects: ProjectInfo[]
  tasksByProject: Record<string, TaskInfo[]>
  selectedProjectId: string | null
  selectedTaskId: string | null
  /**
   * Incremented on every explicit task selection (task row click / new task),
   * so re-selecting a dead session spawns a fresh one even when the id did
   * not change (spec Edge cases: "selecting the task again spawns a fresh
   * session").
   */
  selectionNonce: number
}

function freshRecord(cwd: string): SessionRecord {
  return { generation: 0, status: 'running', exitCode: null, errorMessage: null, cwd }
}

export function TaskWorkspace({
  app,
  projects,
  tasksByProject,
  selectedProjectId,
  selectedTaskId,
  selectionNonce,
}: TaskWorkspaceProps): React.JSX.Element {
  const [sessions, setSessions] = useState<Record<string, SessionRecord>>({})

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedTask =
    selectedProject === null ? null : findTask(tasksByProject, selectedProject.id, selectedTaskId)

  // Latest lookup data for the selection effect (below): read through a ref
  // so projects/tasks reloads — which swap object identities on every
  // refresh — can never re-trigger session spawning.
  const lookupRef = useRef({ selectedProjectId, projects, tasksByProject })
  lookupRef.current = { selectedProjectId, projects, tasksByProject }

  // Selection opens (or re-opens) the task's session view. A live session is
  // never touched here — switching back keeps the same session (A4).
  // Respawn is gated strictly on explicit selection (task id + selection
  // nonce): a projects/tasks reload must never replace an ended or failed
  // session with a fresh PTY (spec Edge cases: a fresh session appears only
  // when the user selects the task again).
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionNonce is a deliberate trigger — an explicit re-selection of the same task id must re-run this effect to respawn dead sessions (spec Edge cases); the project/task lookup is read through a ref so data refreshes never re-trigger it.
  useEffect(() => {
    if (selectedTaskId === null) {
      return
    }
    const lookup = lookupRef.current
    const project = lookup.projects.find((item) => item.id === lookup.selectedProjectId) ?? null
    if (project === null || findTask(lookup.tasksByProject, project.id, selectedTaskId) === null) {
      return
    }
    const cwd = project.path
    setSessions((previous) => {
      const existing = previous[selectedTaskId]
      if (existing === undefined) {
        return { ...previous, [selectedTaskId]: freshRecord(cwd) }
      }
      if (existing.status === 'running') {
        return previous
      }
      // Dead session re-selected: replace it with a fresh process (and view).
      return {
        ...previous,
        [selectedTaskId]: { ...freshRecord(cwd), generation: existing.generation + 1 },
      }
    })
  }, [selectedTaskId, selectionNonce])

  // Evict session views for removed tasks (project deletion cascade):
  // unmounting the view disposes its xterm instance and unsubscribes from the
  // bridge (TaskTerminal cleanup). The PTY itself is terminated in main on
  // project removal — the renderer never owns OS capabilities.
  useEffect(() => {
    setSessions((previous) => {
      let evicted = false
      const kept: Record<string, SessionRecord> = {}
      for (const [taskId, record] of Object.entries(previous)) {
        if (taskExists(tasksByProject, taskId)) {
          kept[taskId] = record
        } else {
          evicted = true
        }
      }
      return evicted ? kept : previous
    })
  }, [tasksByProject])

  const handleExit = useCallback((taskId: string, exitCode: number): void => {
    setSessions((previous) => {
      const existing = previous[taskId]
      if (existing === undefined || existing.status !== 'running') {
        return previous
      }
      return { ...previous, [taskId]: { ...existing, status: 'exited', exitCode } }
    })
  }, [])

  const handleSpawnError = useCallback((taskId: string, message: string): void => {
    setSessions((previous) => {
      const existing = previous[taskId]
      if (existing === undefined) {
        return previous
      }
      return { ...previous, [taskId]: { ...existing, status: 'error', errorMessage: message } }
    })
  }, [])

  // Closing/starting over from a dead session state: remount the view (which
  // lazily spawns a fresh PTY).
  const handleRestart = useCallback((taskId: string): void => {
    setSessions((previous) => {
      const existing = previous[taskId]
      if (existing === undefined) {
        return previous
      }
      return {
        ...previous,
        [taskId]: { ...freshRecord(existing.cwd), generation: existing.generation + 1 },
      }
    })
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={selectedTaskId !== null ? TEST_ID.taskWorkspace : undefined}
    >
      {selectedTask !== null ? (
        <div
          className="flex h-9 shrink-0 items-center border-b border-neutral-800 px-4"
          data-testid={TEST_ID.taskWorkspaceTitle}
        >
          <span className="truncate text-sm font-medium text-neutral-100">{selectedTask.name}</span>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1" data-testid={TEST_ID.terminalHost}>
        {Object.entries(sessions).map(([taskId, record]) => (
          <div
            key={`${taskId}:${record.generation}`}
            className="absolute inset-0"
            style={{ display: taskId === selectedTaskId ? 'block' : 'none' }}
            data-testid={testIdFor.terminalView(taskId)}
          >
            <TaskTerminal
              app={app}
              taskId={taskId}
              cwd={record.cwd}
              visible={taskId === selectedTaskId}
              onExit={(exitCode) => handleExit(taskId, exitCode)}
              onSpawnError={(message) => handleSpawnError(taskId, message)}
            />
            {record.status === 'exited' && taskId === selectedTaskId ? (
              <SessionEndedOverlay
                exitCode={record.exitCode}
                onRestart={() => handleRestart(taskId)}
              />
            ) : null}
            {record.status === 'error' && taskId === selectedTaskId ? (
              <SpawnErrorOverlay
                message={record.errorMessage}
                onRetry={() => handleRestart(taskId)}
              />
            ) : null}
          </div>
        ))}
        {selectedTaskId === null ? <WelcomeSurface /> : null}
      </div>
    </div>
  )
}

function SessionEndedOverlay({
  exitCode,
  onRestart,
}: {
  exitCode: number | null
  onRestart: () => void
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 px-6 text-center"
      data-testid={TEST_ID.terminalSessionEnded}
      role="status"
    >
      <p className="text-sm text-neutral-200">
        Session ended{exitCode !== null ? ` (exit code ${exitCode})` : ''}.
      </p>
      <button
        type="button"
        className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
        data-testid={TEST_ID.terminalStartNewSession}
        onClick={onRestart}
      >
        Start new session
      </button>
    </div>
  )
}

function SpawnErrorOverlay({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 px-6 text-center"
      data-testid={TEST_ID.terminalSpawnError}
      role="alert"
    >
      <p className="text-sm text-red-300">
        {message ?? 'Failed to start the terminal for this task.'}
      </p>
      <button
        type="button"
        className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
        data-testid={TEST_ID.terminalRetry}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  )
}

/**
 * Tasks live under projects (tasksByProject); the selection pairs a project
 * id with a task id, so lookup stays scoped to the selected project.
 */
function findTask(
  tasksByProject: Record<string, TaskInfo[]>,
  projectId: string,
  taskId: string | null,
): TaskInfo | null {
  if (taskId === null) {
    return null
  }
  return tasksByProject[projectId]?.find((task) => task.id === taskId) ?? null
}

/** Whether a task id still exists in any project's task list. */
function taskExists(tasksByProject: Record<string, TaskInfo[]>, taskId: string): boolean {
  return Object.values(tasksByProject).some((tasks) => tasks.some((task) => task.id === taskId))
}
