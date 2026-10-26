import type { ActionControl } from '@shared/ipc-contract'
import { projectColorKey } from '@shared/ipc-contract'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorMessage } from '../../lib/app-error-message'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import type { AppApi, SetNotice } from './useWorkspaceRuntime'

/** The configured actions shown in the action row and Project Settings. */
export function useActionsList(app: AppApi, setNotice: SetNotice) {
  const [actions, setActions] = useState<ActionControl[]>([])

  const refreshActions = useCallback(async (): Promise<void> => {
    setActions(await app.actions.list())
  }, [app])

  useEffect(() => {
    void refreshActions().catch((error: unknown) => {
      setNotice(errorMessage(error, 'Failed to load actions.'))
    })
  }, [refreshActions, setNotice])

  return { actions, refreshActions }
}

// Global `Show usage quota` switch (spec rule 1), off until main reports it
// on. A failed read keeps the button hidden; Usage settings shows the error
// when it loads the switch.
export function useUsageQuota(app: AppApi) {
  const [usageVersion, setUsageVersion] = useState(0)
  const [usageEnabled, setUsageEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    app.usage.getEnabled().then(
      (enabled) => {
        if (alive) setUsageEnabled(enabled)
      },
      () => {
        if (alive) setUsageEnabled(false)
      },
    )
    return () => {
      alive = false
    }
  }, [app])
  const handleUsageSaved = useCallback(() => {
    setUsageVersion((v) => v + 1)
    app.usage.getEnabled().then(setUsageEnabled, () => setUsageEnabled(false))
  }, [app])
  return { usageEnabled, usageVersion, handleUsageSaved }
}

// Task progress observation (spec task-progress-adapters Behaviour 15): main
// reads bound projects that are visible, meaning selected or expanded in the
// left navigation. The full set is reported on every change.
export function useTaskProgressObservation(app: AppApi, setNotice: SetNotice): void {
  const { projects, expandedProjectIds, selectedProjectId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      expandedProjectIds: state.expandedProjectIds,
      selectedProjectId: state.selectedProjectId,
    })),
  )
  const setTaskSnapshots = useChatStore((state) => state.setTaskSnapshots)
  const visibleProjectKey = useMemo(() => {
    const known = new Set(projects.map((project) => project.id))
    const visible = new Set([...expandedProjectIds].filter((id) => known.has(id)))
    if (selectedProjectId !== null && known.has(selectedProjectId)) visible.add(selectedProjectId)
    return JSON.stringify([...visible].sort())
  }, [projects, expandedProjectIds, selectedProjectId])

  useEffect(() => {
    let alive = true
    const ids = JSON.parse(visibleProjectKey) as string[]
    const visible = new Set(ids)
    const revisions = new Map(ids.map((id) => [id, 0]))
    setTaskSnapshots((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => visible.has(id))),
    )
    const unsubscribe = app.taskProgress.onChanged((event) => {
      if (!alive || !visible.has(event.projectId)) return
      revisions.set(event.projectId, (revisions.get(event.projectId) ?? 0) + 1)
      setTaskSnapshots((previous) => {
        const next = { ...previous }
        if ('cleared' in event) delete next[event.projectId]
        else next[event.projectId] = event
        return next
      })
    })
    void app.taskProgress
      .observe(ids)
      .then(() =>
        Promise.all(
          ids.map(async (id) => {
            // A changed/cleared event supersedes the startup read, including one
            // emitted while observe was pending. A retired effect cannot publish.
            const snapshot = await app.taskProgress.get(id)
            if (!alive || revisions.get(id) !== 0) return
            setTaskSnapshots((previous) => {
              const next = { ...previous }
              if (snapshot === null) delete next[id]
              else next[id] = snapshot
              return next
            })
          }),
        ),
      )
      .catch((error: unknown) => {
        if (alive) setNotice(errorMessage(error, 'Failed to load task progress.'))
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [app, visibleProjectKey, setNotice, setTaskSnapshots])
}

// Per-project avatar colors from app_state, re-read when the project list
// changes; Project Settings reports a saved change live.
export function useProjectColors(app: AppApi) {
  const projects = useProjectStore((state) => state.projects)
  const setProjectColors = useProjectStore((state) => state.setProjectColors)

  useEffect(() => {
    let alive = true
    if (projects.length === 0) return
    void Promise.all(
      projects.map(async (project) => {
        const color = await app.state.get(projectColorKey(project.id)).catch(() => null)
        return [project.id, color] as const
      }),
    ).then((entries) => {
      if (!alive) return
      const map: Record<string, string> = {}
      for (const [id, color] of entries) {
        if (color) map[id] = color
      }
      setProjectColors(map)
    })
    return () => {
      alive = false
    }
  }, [projects, app.state, setProjectColors])

  return useCallback(
    (projectId: string, color: string | null): void => {
      setProjectColors((previous) => {
        const next = { ...previous }
        if (color) {
          next[projectId] = color
        } else {
          delete next[projectId]
        }
        return next
      })
    },
    [setProjectColors],
  )
}
