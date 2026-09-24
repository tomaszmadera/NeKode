import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { ProjectInfo, TaskInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../shared/ipc-error'
import { CenterHeader } from './components/layout/CenterHeader'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { ResizeHandle } from './components/layout/ResizeHandle'
import { TopBar } from './components/layout/TopBar'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  useResizableRegion,
} from './hooks/useResizableRegion'

export const TEST_ID = {
  appShell: 'app-shell',
  topBar: 'region-top',
  leftNav: 'region-left',
  centerHeader: 'region-center-header',
  centerSurface: 'region-center-surface',
  rightRegion: 'region-right',
  bottomRegion: 'region-bottom',
  leftResizeHandle: 'resize-handle-left',
  bottomResizeHandle: 'resize-handle-bottom',
  projectList: 'project-list',
  emptyProjectList: 'project-list-empty',
  addProjectButton: 'add-project-button',
  welcomeSurface: 'welcome-surface',
  actionNotice: 'action-notice',
  newTaskForm: 'new-task-form',
  newTaskInput: 'new-task-input',
  newTaskSubmit: 'new-task-submit',
  headerProjectName: 'header-project-name',
  headerProjectPath: 'header-project-path',
  headerRuntimeLabel: 'header-runtime-label',
} as const

/** Test ids that depend on record ids (projects/tasks). */
export const testIdFor = {
  projectRow: (projectId: string): string => `project-row-${projectId}`,
  projectSelect: (projectId: string): string => `project-select-${projectId}`,
  projectToggle: (projectId: string): string => `project-toggle-${projectId}`,
  projectTasks: (projectId: string): string => `project-tasks-${projectId}`,
  removeProject: (projectId: string): string => `remove-project-${projectId}`,
  taskRow: (taskId: string): string => `task-row-${taskId}`,
}

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
  const [notice, setNotice] = useState<string | null>(null)
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)

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
        if (cancelled) {
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
  const persistSelection = useCallback(
    (projectId: string | null, taskId: string | null): void => {
      void app.state.set(APP_STATE_KEY.selectedProjectId, projectId ?? '').catch(() => undefined)
      void app.state.set(APP_STATE_KEY.selectedTaskId, taskId ?? '').catch(() => undefined)
    },
    [app],
  )

  const handleLeftResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.leftRegionWidth, String(size)).catch(() => undefined)
    },
    [app],
  )

  const handleBottomResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.bottomRegionHeight, String(size)).catch(() => undefined)
    },
    [app],
  )

  const loadTasks = useCallback(
    async (projectId: string): Promise<void> => {
      const tasks = await app.tasks.list(projectId)
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
        // the removed project is the currently selected one.
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
          <CenterHeader project={selectedProject} />
          <main
            className="flex min-h-0 flex-1 flex-col items-center justify-center px-6"
            data-testid={TEST_ID.centerSurface}
          >
            <WelcomeSurface />
          </main>
          <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
            Right Panel
          </div>
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
          onResizeStart={bottomRegion.startResize}
          testId={TEST_ID.bottomResizeHandle}
        />
      </div>
    </div>
  )
}

function WelcomeSurface(): React.JSX.Element {
  return (
    <section
      className="flex max-w-md flex-col items-center gap-3 text-center"
      data-testid={TEST_ID.welcomeSurface}
    >
      <h1 className="text-lg font-medium text-neutral-100">Welcome to NeKode</h1>
      <p className="text-sm leading-relaxed text-neutral-400">
        Add a local project to start working. Tasks you create will run in dedicated terminals
        attached to the project directory.
      </p>
    </section>
  )
}

export default App
