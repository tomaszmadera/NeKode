import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInfo, TaskInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../shared/ipc-error'
import { CenterHeader } from './components/layout/CenterHeader'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { ResizeHandle } from './components/layout/ResizeHandle'
import { TopBar } from './components/layout/TopBar'
import { TaskWorkspace } from './components/workspace/TaskWorkspace'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  useResizableRegion,
} from './hooks/useResizableRegion'
import { TEST_ID } from './lib/test-ids'

// Re-exported so existing imports keep working; the definitions live in
// lib/test-ids.ts to break the App ↔ component import cycle.
export { TEST_ID, testIdFor } from './lib/test-ids'

/** Selection/state values are cleared by writing an empty string (A5). */
function normalizeStoredId(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null
}

function parsePersistedSize(value: string | null, limits: RegionSizeLimits): number {
  if (value === null || value.trim().length === 0) {
    return limits.default
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clampRegionSize(parsed, limits) : limits.default
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function App({ app = window.app }: { app?: typeof window.app }): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [tasksByProject, setTasksByProject] = useState<Record<string, TaskInfo[]>>({})
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectionNonce, setSelectionNonce] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)
  // Projects removed in this session: pending task loads for them are stale.
  const removedProjectIdsRef = useRef<Set<string>>(new Set())

  // Startup hydration: real project list, persisted selection (dropped when
  // it no longer matches existing records) and persisted region sizes.
  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        const [loadedProjects, savedProjectId, savedTaskId, savedLeftWidth, savedBottomHeight] =
          await Promise.all([
            app.projects.list(),
            app.state.get(APP_STATE_KEY.selectedProjectId),
            app.state.get(APP_STATE_KEY.selectedTaskId),
            app.state.get(APP_STATE_KEY.leftRegionWidth),
            app.state.get(APP_STATE_KEY.bottomRegionHeight),
          ])
        if (cancelled) {
          return
        }

        setProjects(loadedProjects)
        setLeftWidth(parsePersistedSize(savedLeftWidth, LEFT_REGION_SIZE))
        setBottomHeight(parsePersistedSize(savedBottomHeight, BOTTOM_REGION_SIZE))

        // Stale selection falls back to the default empty state (spec Edge
        // cases); the main process deletes the stale keys (cleanupSelection).
        const savedProject = normalizeStoredId(savedProjectId)
        const savedTask = normalizeStoredId(savedTaskId)
        const projectId =
          savedProject !== null && loadedProjects.some((project) => project.id === savedProject)
            ? savedProject
            : null
        if (projectId === null) {
          setSelectedProjectId(null)
          setSelectedTaskId(null)
          return
        }

        const tasks = await app.tasks.list(projectId)
        if (cancelled || removedProjectIdsRef.current.has(projectId)) {
          return
        }
        setTasksByProject((previous) => ({ ...previous, [projectId]: tasks }))
        setExpandedProjectIds((previous) => new Set(previous).add(projectId))
        setSelectedProjectId(projectId)
        setSelectedTaskId(
          savedTask !== null && tasks.some((task) => task.id === savedTask) ? savedTask : null,
        )
      } catch (error) {
        if (!cancelled) {
          setNotice(errorMessage(error, 'Failed to restore the workspace state.'))
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [app])

  // Selection keys are written on every selection change (spec Business
  // rules); an empty string clears a key so no stale selection survives.
  // Rejections surface to the notice banner (spec Errors: no silent fallback).
  const persistSelection = useCallback(
    (projectId: string | null, taskId: string | null): void => {
      void app.state
        .set(APP_STATE_KEY.selectedProjectId, projectId ?? '')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the selected project.'))
        })
      void app.state.set(APP_STATE_KEY.selectedTaskId, taskId ?? '').catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the selected task.'))
      })
    },
    [app],
  )

  const handleLeftResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.leftRegionWidth, String(size)).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the panel width.'))
      })
    },
    [app],
  )

  const handleBottomResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.bottomRegionHeight, String(size)).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the panel height.'))
      })
    },
    [app],
  )

  const loadTasks = useCallback(
    async (projectId: string): Promise<void> => {
      const tasks = await app.tasks.list(projectId)
      // A load resolving after its project was removed must not re-populate
      // tasksByProject with an orphaned entry.
      if (removedProjectIdsRef.current.has(projectId)) {
        return
      }
      setTasksByProject((previous) => ({ ...previous, [projectId]: tasks }))
    },
    [app],
  )

  const handleSelectProject = useCallback(
    (projectId: string): void => {
      setNotice(null)
      setSelectedProjectId(projectId)
      setSelectedTaskId(null)
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      persistSelection(projectId, null)
      void loadTasks(projectId).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to load tasks.'))
      })
    },
    [loadTasks, persistSelection],
  )

  const handleSelectTask = useCallback(
    (projectId: string, taskId: string): void => {
      setNotice(null)
      setSelectedProjectId(projectId)
      setSelectedTaskId(taskId)
      // Every explicit selection counts: re-selecting an ended session spawns
      // a fresh terminal (spec Edge cases).
      setSelectionNonce((previous) => previous + 1)
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      persistSelection(projectId, taskId)
    },
    [persistSelection],
  )

  const handleToggleProject = useCallback(
    (projectId: string): void => {
      const isExpanded = expandedProjectIds.has(projectId)
      setExpandedProjectIds((previous) => {
        const next = new Set(previous)
        if (isExpanded) {
          next.delete(projectId)
        } else {
          next.add(projectId)
        }
        return next
      })
      if (!isExpanded) {
        void loadTasks(projectId).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to load tasks.'))
        })
      }
    },
    [expandedProjectIds, loadTasks],
  )

  const handleAddProject = useCallback((): void => {
    setNotice(null)
    void (async () => {
      try {
        const project = await app.projects.add()
        if (project === null) {
          // Native dialog cancelled: no data change, no selection change.
          return
        }
        removedProjectIdsRef.current.delete(project.id)
        setProjects(await app.projects.list())
        setTasksByProject((previous) => ({ ...previous, [project.id]: [] }))
        setExpandedProjectIds((previous) => new Set(previous).add(project.id))
        setSelectedProjectId(project.id)
        setSelectedTaskId(null)
        persistSelection(project.id, null)
      } catch (error) {
        setNotice(errorMessage(error, 'Failed to add the project.'))
      }
    })()
  }, [app, persistSelection])

  const handleRemoveProject = useCallback(
    (projectId: string): void => {
      setNotice(null)
      void (async () => {
        try {
          await app.projects.remove(projectId)
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to remove the project.'))
          return
        }
        // Drop the removed data (the main process cleans stale selection keys
        // on the next read) and fall back to the default empty state only when
        // the removed project is the currently selected one. Pending task
        // loads for this project become stale (see loadTasks).
        removedProjectIdsRef.current.add(projectId)
        setProjects((previous) => previous.filter((project) => project.id !== projectId))
        setTasksByProject((previous) => {
          const next = { ...previous }
          delete next[projectId]
          return next
        })
        setExpandedProjectIds((previous) => {
          const next = new Set(previous)
          next.delete(projectId)
          return next
        })
        if (projectId === selectedProjectId) {
          setSelectedProjectId(null)
          setSelectedTaskId(null)
          persistSelection(null, null)
        }
        try {
          setProjects(await app.projects.list())
        } catch {
          // The removal already succeeded; a failed follow-up refresh must not
          // be reported as a removal failure.
        }
      })()
    },
    [app, persistSelection, selectedProjectId],
  )

  const handleCreateTask = useCallback(
    (projectId: string, name: string): Promise<boolean> => {
      setNotice(null)
      return (async () => {
        try {
          const task = await app.tasks.create(projectId, name)
          setTasksByProject((previous) => {
            const existing = previous[projectId] ?? []
            return {
              ...previous,
              [projectId]: [...existing.filter((item) => item.id !== task.id), task],
            }
          })
          setSelectedProjectId(projectId)
          setSelectedTaskId(task.id)
          setSelectionNonce((previous) => previous + 1)
          persistSelection(projectId, task.id)
          return true
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to create the task.'))
          return false
        }
      })()
    },
    [app, persistSelection],
  )

  const leftRegion = useResizableRegion({
    axis: 'x',
    minSize: LEFT_REGION_SIZE.min,
    maxSize: LEFT_REGION_SIZE.max,
    size: leftWidth,
    onSizeChange: setLeftWidth,
    onResizeEnd: handleLeftResizeEnd,
  })
  const bottomRegion = useResizableRegion({
    axis: 'y',
    minSize: BOTTOM_REGION_SIZE.min,
    maxSize: BOTTOM_REGION_SIZE.max,
    size: bottomHeight,
    onSizeChange: setBottomHeight,
    onResizeEnd: handleBottomResizeEnd,
  })

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100 antialiased"
      data-testid={TEST_ID.appShell}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftNavigation
          width={leftWidth}
          onResizeStart={leftRegion.startResize}
          onResizeNudge={leftRegion.nudge}
          projects={projects}
          tasksByProject={tasksByProject}
          expandedProjectIds={expandedProjectIds}
          selectedProjectId={selectedProjectId}
          selectedTaskId={selectedTaskId}
          onSelectProject={handleSelectProject}
          onToggleProject={handleToggleProject}
          onSelectTask={handleSelectTask}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onCreateTask={handleCreateTask}
          notice={notice}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <CenterHeader app={app} project={selectedProject} />
          <main className="flex min-h-0 flex-1 flex-col" data-testid={TEST_ID.centerSurface}>
            <TaskWorkspace
              app={app}
              projects={projects}
              tasksByProject={tasksByProject}
              selectedProjectId={selectedProjectId}
              selectedTaskId={selectedTaskId}
              selectionNonce={selectionNonce}
            />
          </main>
        </div>
        {/* Right region is a real five-region sibling (SDD §7), hidden by default. */}
        <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
          Right Panel
        </div>
      </div>
      <div
        className="flex shrink-0 flex-col bg-neutral-900/60"
        data-testid={TEST_ID.bottomRegion}
        style={{ display: 'none' }}
      >
        <div className="flex-1 px-4 py-2 text-xs text-neutral-500">Auxiliary Terminal</div>
        <ResizeHandle
          axis="y"
          size={bottomHeight}
          minSize={BOTTOM_REGION_SIZE.min}
          maxSize={BOTTOM_REGION_SIZE.max}
          onResizeStart={bottomRegion.startResize}
          onResizeNudge={bottomRegion.nudge}
          testId={TEST_ID.bottomResizeHandle}
        />
      </div>
    </div>
  )
}

export default App
