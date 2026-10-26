import type { ProjectInfo } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorMessage } from '../../lib/app-error-message'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTabsStore } from '../../stores/useTabsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/** Adding, removing and revealing projects, with every per-project session the removal ends. */
export function useProjectLifecycle(
  runtime: WorkspaceRuntime,
  owners: {
    refreshActions: () => Promise<void>
    dropProjectLaunches: (projectId: string) => void
    setTerminalCwds: React.Dispatch<React.SetStateAction<Record<string, string>>>
    dropFilesProject: (projectId: string) => void
    bottomTabIdsOf: (projectId: string) => string[]
    dropProjectBottomTabs: (projectId: string, tabIds: readonly string[]) => void
  },
) {
  const {
    app,
    setNotice,
    removedProjectIdsRef,
    projectRemovalsRef,
    chatsByProjectRef,
    selectionRef,
    pendingTerminalCommandsRef,
    applyChatsUpdate,
    cancelPendingSubmit,
    persistSelection,
  } = runtime
  const {
    refreshActions,
    dropProjectLaunches,
    setTerminalCwds,
    dropFilesProject,
    bottomTabIdsOf,
    dropProjectBottomTabs,
  } = owners
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
  const dropTabsProject = useTabsStore((state) => state.dropProject)
  const [addProjectOpen, setAddProjectOpen] = useState(false)

  const handleProjectAdded = useCallback(
    async (project: ProjectInfo): Promise<void> => {
      removedProjectIdsRef.current.delete(project.id)
      projectRemovalsRef.current.delete(project.id)
      setProjects(await app.projects.list())
      applyChatsUpdate((previous) => ({ ...previous, [project.id]: [] }))
      setLoadedChatProjectIds((previous) => new Set(previous).add(project.id))
      setExpandedProjectIds((previous) => new Set(previous).add(project.id))
      setSelectedProjectId(project.id)
      setSelectedChatId(null)
      persistSelection(project.id, null)
    },
    [
      app,
      applyChatsUpdate,
      persistSelection,
      projectRemovalsRef,
      removedProjectIdsRef,
      setSelectedChatId,
      setSelectedProjectId,
      setLoadedChatProjectIds,
      setProjects,
      setExpandedProjectIds,
    ],
  )

  const handleAddProject = useCallback((): void => {
    setNotice(null)
    setAddProjectOpen(true)
  }, [setNotice])

  // Open in file explorer (context menu): the OS file manager on the
  // registered project root. Failures surface as notices, the selection and
  // project data stay untouched.
  const handleOpenInFileExplorer = useCallback(
    (projectId: string): void => {
      void app.files.openRoot(projectId).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to open the project directory.'))
      })
    },
    [app, setNotice],
  )

  const handleRemoveProject = useCallback(
    (projectId: string): void => {
      setNotice(null)
      void (async () => {
        dropProjectLaunches(projectId)
        // Before the first await. A shell-name fetch already in flight must
        // not add or spawn a bottom tab, and a state update that lands after
        // the drop must not put the tab back.
        const removal = projectRemovalsRef.current.get(projectId) ?? {
          pending: 0,
          succeeded: false,
        }
        removal.pending += 1
        projectRemovalsRef.current.set(projectId, removal)
        removedProjectIdsRef.current.add(projectId)
        const bottomIds = bottomTabIdsOf(projectId)
        try {
          await app.projects.remove(projectId)
        } catch (error) {
          removal.pending -= 1
          if (removal.pending === 0 && !removal.succeeded) {
            projectRemovalsRef.current.delete(projectId)
            removedProjectIdsRef.current.delete(projectId)
          }
          setNotice(errorMessage(error, 'Failed to remove the project.'))
          return
        }
        removal.succeeded = true
        removal.pending -= 1
        // projects:remove already killed these PTYs. terminate is idempotent.
        const closeResults = await Promise.all(
          bottomIds.map(async (tabId) => {
            try {
              await app.terminals.terminate(tabId)
              return null
            } catch (error) {
              return error
            }
          }),
        )
        const closeFailure = closeResults.find((result) => result !== null)
        if (closeFailure) {
          setNotice(errorMessage(closeFailure, 'Failed to close the terminal.'))
        }
        // Drop the removed data (the main process cleans stale selection keys
        // on the next read) and fall back to the default empty state only when
        // the removed project is the currently selected one. Pending chat
        // loads for this project become stale (see loadChats).
        const projectChatIds = (chatsByProjectRef.current[projectId] ?? []).map((chat) => chat.id)
        for (const chatId of projectChatIds) {
          delete pendingTerminalCommandsRef.current[chatId]
          cancelPendingSubmit(chatId)
        }
        setTerminalCwds((previous) => {
          let changed = false
          const next = { ...previous }
          for (const chatId of projectChatIds) {
            if (chatId in next) {
              delete next[chatId]
              changed = true
            }
          }
          return changed ? next : previous
        })
        setProjects((previous) => previous.filter((project) => project.id !== projectId))
        applyChatsUpdate((previous) => {
          const next = { ...previous }
          delete next[projectId]
          return next
        })
        setLoadedChatProjectIds((previous) => {
          const next = new Set(previous)
          next.delete(projectId)
          return next
        })
        setExpandedProjectIds((previous) => {
          const next = new Set(previous)
          next.delete(projectId)
          return next
        })
        // The file-tree session (Behaviour 14) and the tab-strip session
        // (tabs are per-project, spec Behaviour 5) go with the project.
        dropFilesProject(projectId)
        dropTabsProject(projectId)
        dropProjectBottomTabs(projectId, bottomIds)
        if (projectId === selectionRef.current.projectId) {
          selectionRef.current = { projectId: null, chatId: null }
          setSelectedProjectId(null)
          setSelectedChatId(null)
          persistSelection(null, null)
        }
        try {
          setProjects(await app.projects.list())
        } catch {
          // The removal already succeeded; a failed follow-up refresh must not
          // be reported as a removal failure.
        }
        try {
          await refreshActions()
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to load actions.'))
        }
      })()
    },
    [
      app,
      applyChatsUpdate,
      bottomTabIdsOf,
      cancelPendingSubmit,
      chatsByProjectRef,
      dropFilesProject,
      dropProjectBottomTabs,
      dropProjectLaunches,
      dropTabsProject,
      pendingTerminalCommandsRef,
      persistSelection,
      projectRemovalsRef,
      refreshActions,
      removedProjectIdsRef,
      selectionRef,
      setNotice,
      setSelectedChatId,
      setLoadedChatProjectIds,
      setSelectedProjectId,
      setProjects,
      setExpandedProjectIds,
      setTerminalCwds,
    ],
  )

  return {
    addProjectOpen,
    closeAddProject: () => setAddProjectOpen(false),
    handleProjectAdded,
    handleAddProject,
    handleOpenInFileExplorer,
    handleRemoveProject,
  }
}
