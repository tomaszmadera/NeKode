import { APP_STATE_KEY } from '@shared/ipc-contract'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { activateTab, KANBAN_TAB } from '../../components/tabs/tabs-session'
import { errorMessage } from '../../lib/app-error-message'
import { mergeFetchedChats, useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTabsStore } from '../../stores/useTabsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/** Selection/state values are cleared by writing an empty string (A5). */
function normalizeStoredId(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null
}

/**
 * Startup hydration: real project list, persisted selection (dropped when it
 * no longer matches existing records) and persisted region sizes and bottom
 * panel visibility.
 */
export function useWorkspaceHydration(
  runtime: WorkspaceRuntime,
  restore: {
    restoreRegionSizes: (savedLeftWidth: string | null, savedBottomHeight: string | null) => void
    restoreBottomOpen: (savedBottomOpen: string | null) => void
  },
): void {
  const { app, setNotice, removedProjectIdsRef, removedChatIdsRef, chatsByProjectRef } = runtime
  const { applyChatsUpdate } = runtime
  const { restoreRegionSizes, restoreBottomOpen } = restore
  const { setProjects, setExpandedProjectIds, setSelectedProjectId } = useProjectStore(
    useShallow((state) => ({
      setProjects: state.setProjects,
      setExpandedProjectIds: state.setExpandedProjectIds,
      setSelectedProjectId: state.setSelectedProjectId,
    })),
  )
  const { setSelectedChatId, setLoadedChatProjectIds } = useChatStore(
    useShallow((state) => ({
      setSelectedChatId: state.setSelectedChatId,
      setLoadedChatProjectIds: state.setLoadedChatProjectIds,
    })),
  )
  const updateTabsSession = useTabsStore((state) => state.updateTabsSession)

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        const [
          loadedProjects,
          savedProjectId,
          savedChatId,
          savedLeftWidth,
          savedBottomHeight,
          savedBottomOpen,
        ] = await Promise.all([
          app.projects.list(),
          app.state.get(APP_STATE_KEY.selectedProjectId),
          app.state.get(APP_STATE_KEY.selectedChatId),
          app.state.get(APP_STATE_KEY.leftRegionWidth),
          app.state.get(APP_STATE_KEY.bottomRegionHeight),
          app.state.get(APP_STATE_KEY.bottomRegionOpen),
        ])
        if (cancelled) {
          return
        }

        setProjects(loadedProjects)
        restoreRegionSizes(savedLeftWidth, savedBottomHeight)
        restoreBottomOpen(savedBottomOpen)

        // Stale selection falls back to the default empty state (spec Edge
        // cases); the main process deletes the stale keys (cleanupSelection).
        const savedProject = normalizeStoredId(savedProjectId)
        const savedChat = normalizeStoredId(savedChatId)
        const projectId =
          savedProject !== null && loadedProjects.some((project) => project.id === savedProject)
            ? savedProject
            : null
        if (projectId === null) {
          setSelectedProjectId(null)
          setSelectedChatId(null)
          return
        }

        const chats = await app.chats.list(projectId)
        if (cancelled || removedProjectIdsRef.current.has(projectId)) {
          return
        }
        applyChatsUpdate((previous) => ({
          ...previous,
          [projectId]: mergeFetchedChats(
            previous[projectId] ?? [],
            chats,
            removedChatIdsRef.current,
          ),
        }))
        setLoadedChatProjectIds((previous) => new Set(previous).add(projectId))
        setExpandedProjectIds((previous) => new Set(previous).add(projectId))
        setSelectedProjectId(projectId)
        // applyChatsUpdate applies synchronously, so the mirror already holds
        // the merged list here.
        const mergedChats = chatsByProjectRef.current[projectId] ?? []
        const restoredChat =
          savedChat !== null && mergedChats.some((chat) => chat.id === savedChat) ? savedChat : null
        setSelectedChatId(restoredChat)
        // Launch tab (project-home spec Behaviour 5): a restored chat opens on
        // the chat tab (the session default); a restored project without a
        // chat opens on its home tab. Tabs themselves are never persisted.
        if (restoredChat === null) {
          updateTabsSession(projectId, (session) => activateTab(session, KANBAN_TAB))
        }
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
  }, [
    app,
    applyChatsUpdate,
    chatsByProjectRef,
    removedChatIdsRef,
    removedProjectIdsRef,
    restoreBottomOpen,
    restoreRegionSizes,
    setNotice,
    setSelectedChatId,
    setSelectedProjectId,
    setLoadedChatProjectIds,
    setExpandedProjectIds,
    setProjects,
    updateTabsSession,
  ])
}
