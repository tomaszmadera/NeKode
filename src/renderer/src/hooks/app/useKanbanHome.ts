import { LOCAL_FILE_ADAPTER_ID, projectKanbanAdapterKey } from '@shared/ipc-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { KanbanToolbarControls } from '../../components/kanban/kanban-board-logic'
import { errorMessage } from '../../lib/app-error-message'
import { useProjectStore } from '../../stores/useProjectStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/**
 * Project home tab data (project-home spec Behaviour 2): which projects are
 * bound to a task source, board reload versions and the board toolbar state
 * that the action row renders.
 */
export function useKanbanHome(runtime: WorkspaceRuntime) {
  const { app, projectsRef } = runtime
  const {
    projects,
    setKanbanProjectIds,
    setLocalFileProjectIds,
    setSettledKanbanProjects,
    setKanbanBindingsError,
  } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      setKanbanProjectIds: state.setKanbanProjectIds,
      setLocalFileProjectIds: state.setLocalFileProjectIds,
      setSettledKanbanProjects: state.setSettledKanbanProjects,
      setKanbanBindingsError: state.setKanbanBindingsError,
    })),
  )
  // A bound project's home tab shows the task list; an unbound one's shows
  // the setup welcome. `settledKanbanProjects` marks the projects whose read
  // has finished. `kanbanBindingsError` holds the message of the latest
  // failed read (null after a successful one); the read covers all projects
  // in one batch and fails as a whole, so the error is global. Bound projects
  // whose source is the built-in `local-file` are tracked too (project-home
  // spec Edge cases: a missing task file offers `Use a local task list`).
  const kanbanBindingsGeneration = useRef(0)
  const [kanbanVersions, setKanbanVersions] = useState<Record<string, number>>({})
  const [kanbanToolbarByProject, setKanbanToolbarByProject] = useState<
    Record<string, KanbanToolbarControls | null>
  >({})

  const invalidateKanban = useCallback(
    (projectId: string | null): void => {
      setKanbanVersions((previous) => {
        const next = { ...previous }
        for (const id of projectId === null ? projectsRef.current.map((p) => p.id) : [projectId]) {
          next[id] = (next[id] ?? 0) + 1
        }
        return next
      })
    },
    [projectsRef],
  )

  const handleKanbanToolbarControls = useCallback(
    (projectId: string, controls: KanbanToolbarControls | null) => {
      setKanbanToolbarByProject((previous) => {
        if (controls === null) {
          if (previous[projectId] === null || !(projectId in previous)) return previous
          return { ...previous, [projectId]: null }
        }
        const existing = previous[projectId]
        if (
          existing &&
          existing.phase === controls.phase &&
          existing.refreshing === controls.refreshing &&
          existing.isReviewing === controls.isReviewing &&
          existing.creatingBusy === controls.creatingBusy &&
          existing.sortState.sortBy === controls.sortState.sortBy &&
          existing.sortState.direction === controls.sortState.direction &&
          existing.searchQuery === controls.searchQuery
        ) {
          return previous
        }
        return { ...previous, [projectId]: controls }
      })
    },
    [],
  )

  // Task-source bindings: a project is bound when its per-project adapter key
  // holds a value. Read through the generic `state:get` (no new IPC channel);
  // recomputed on every projects-list change and when Project Settings
  // closes, so a bind/unbind switches the home tab between the list and the
  // welcome without a restart.
  const refreshKanbanBindings = useCallback(async (): Promise<void> => {
    const requestGen = ++kanbanBindingsGeneration.current
    const targetProjects = projects
    try {
      const bindings = await Promise.all(
        targetProjects.map(async (project) => ({
          id: project.id,
          adapterId: await app.state.get(projectKanbanAdapterKey(project.id)),
        })),
      )
      if (requestGen !== kanbanBindingsGeneration.current) return
      setKanbanProjectIds(
        new Set(bindings.filter((binding) => binding.adapterId).map((binding) => binding.id)),
      )
      setLocalFileProjectIds(
        new Set(
          bindings
            .filter((binding) => binding.adapterId === LOCAL_FILE_ADAPTER_ID)
            .map((binding) => binding.id),
        ),
      )
      setSettledKanbanProjects(new Set(targetProjects.map((project) => project.id)))
      setKanbanBindingsError(null)
    } catch (error) {
      if (requestGen !== kanbanBindingsGeneration.current) return
      // Shown inline on the home tab (project-home spec Errors), not as the
      // shell notice, which later actions clear.
      setKanbanBindingsError(errorMessage(error, 'Failed to load task sources.'))
    }
  }, [
    app,
    projects,
    setLocalFileProjectIds,
    setKanbanBindingsError,
    setSettledKanbanProjects,
    setKanbanProjectIds,
  ])

  useEffect(() => {
    void refreshKanbanBindings()
  }, [refreshKanbanBindings])

  // `Use a local task list` (project-home spec Behaviour 7): main creates the
  // task file when absent and binds `local-file`; the binding re-read then
  // switches the home tab to the list. A rejection reaches the caller, which
  // shows it inline.
  const handleUseLocalTaskList = useCallback(
    async (projectId: string): Promise<void> => {
      await app.kanban.bindLocalFile(projectId)
      invalidateKanban(projectId)
      await refreshKanbanBindings()
    },
    [app, invalidateKanban, refreshKanbanBindings],
  )

  return {
    kanbanVersions,
    kanbanToolbarByProject,
    invalidateKanban,
    handleKanbanToolbarControls,
    refreshKanbanBindings,
    handleUseLocalTaskList,
  }
}
