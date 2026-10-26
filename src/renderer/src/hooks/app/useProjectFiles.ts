import type { FileEntry } from '@shared/ipc-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  emptyProjectFilesSession,
  type ProjectFilesSession,
} from '../../components/files/files-types'
import { applyDirectoryRefresh } from '../../components/files/tree-refresh'
import { absoluteFilePath } from '../../components/tabs/TabStrip'
import {
  closeFileTab,
  openFileTab,
  type ProjectTabsSession,
} from '../../components/tabs/tabs-session'
import { errorMessage } from '../../lib/app-error-message'
import { testIdFor } from '../../lib/test-ids'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTabsStore } from '../../stores/useTabsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

function parentRelativePath(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

function pathIsAtOrUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

/** Trash paths recorded after `start` that make one directory read stale. */
function listingSuperseded(laterTrash: readonly string[], relativePath: string): boolean {
  return laterTrash.some(
    (path) => pathIsAtOrUnder(relativePath, path) || parentRelativePath(path) === relativePath,
  )
}

function dropTrashedPath(session: ProjectFilesSession, relativePath: string): ProjectFilesSession {
  const parent = parentRelativePath(relativePath)
  const childrenByPath = { ...session.childrenByPath }
  const parentEntries = childrenByPath[parent]
  if (parentEntries !== undefined) {
    childrenByPath[parent] = parentEntries.filter((entry) => entry.relativePath !== relativePath)
  }
  for (const key of Object.keys(childrenByPath)) {
    if (pathIsAtOrUnder(key, relativePath)) {
      delete childrenByPath[key]
    }
  }
  const expandedPaths = new Set(
    [...session.expandedPaths].filter((path) => !pathIsAtOrUnder(path, relativePath)),
  )
  return { ...session, childrenByPath, expandedPaths }
}

function closeTabsAtOrUnder(session: ProjectTabsSession, relativePath: string): ProjectTabsSession {
  let next = session
  for (const path of session.openFiles) {
    if (pathIsAtOrUnder(path, relativePath)) {
      next = closeFileTab(next, path)
    }
  }
  return next
}

/**
 * Project Files mode (spec Behaviour 1–2, 6, 12, 14–15, 25): the project
 * whose tree is shown in the left panel, or null for the Projects/Chats
 * navigation. The mode never touches the chat/project selection and does not
 * swap the center surface. Per-project tree state lives for the app session
 * only (Behaviour 14).
 */
export function useProjectFiles(runtime: WorkspaceRuntime) {
  const { app, setNotice, removedProjectIdsRef, persistSelection, loadChats } = runtime
  const { projects, selectedProjectId, setSelectedProjectId, setExpandedProjectIds } =
    useProjectStore(
      useShallow((state) => ({
        projects: state.projects,
        selectedProjectId: state.selectedProjectId,
        setSelectedProjectId: state.setSelectedProjectId,
        setExpandedProjectIds: state.setExpandedProjectIds,
      })),
    )
  const setSelectedChatId = useChatStore((state) => state.setSelectedChatId)
  const updateTabsSession = useTabsStore((state) => state.updateTabsSession)
  const [filesProjectId, setFilesProjectId] = useState<string | null>(null)
  const [filesSessions, setFilesSessions] = useState<Record<string, ProjectFilesSession>>({})
  // One Refresh per project (spec Behaviour 25). The generation drops a
  // result that belongs to an older click.
  const filesRefreshInFlight = useRef<Set<string>>(new Set())
  const filesRefreshGeneration = useRef<Record<string, number>>({})
  // Paths trashed in this session, in order. A directory or Git read that
  // started earlier must not write a trashed path back (review:1).
  const trashLog = useRef<Record<string, string[]>>({})
  const trashInFlight = useRef<Set<string>>(new Set())

  const updateFilesSession = useCallback(
    (projectId: string, updater: (session: ProjectFilesSession) => ProjectFilesSession): void => {
      setFilesSessions((previous) => ({
        ...previous,
        [projectId]: updater(previous[projectId] ?? emptyProjectFilesSession()),
      }))
    },
    [],
  )

  // One directory read per expansion (spec Behaviour 6): the children are
  // cached for the session, so collapsing and re-expanding never re-reads.
  // Refresh (Behaviour 25) is the explicit re-read.
  const loadFilesDirectory = useCallback(
    (projectId: string, relativePath: string): void => {
      const trashStart = (trashLog.current[projectId] ?? []).length
      void app.files
        .list(projectId, relativePath === '' ? null : relativePath)
        .then((entries: FileEntry[]) => {
          // A load resolving after its project was removed, or after a
          // trash of this directory, is stale.
          if (
            removedProjectIdsRef.current.has(projectId) ||
            listingSuperseded((trashLog.current[projectId] ?? []).slice(trashStart), relativePath)
          ) {
            return
          }
          updateFilesSession(projectId, (session) => ({
            ...session,
            childrenByPath: { ...session.childrenByPath, [relativePath]: entries },
            treeError: null,
          }))
        })
        .catch((error: unknown) => {
          if (
            removedProjectIdsRef.current.has(projectId) ||
            listingSuperseded((trashLog.current[projectId] ?? []).slice(trashStart), relativePath)
          ) {
            return
          }
          // Inline tree error (spec Errors): the app keeps working and
          // the back affordance always exits the mode.
          updateFilesSession(projectId, (session) => ({
            ...session,
            treeError: errorMessage(error, 'Failed to load project files.'),
          }))
        })
    },
    [app, removedProjectIdsRef, updateFilesSession],
  )

  // Git decoration (spec Behaviour 16-19, NEKODE-31): one read when the mode
  // is entered for a project, again on re-entry. A failed read leaves the
  // tree undecorated (empty map) instead of failing the mode.
  const loadGitStatuses = useCallback(
    (projectId: string): void => {
      const trashStart = (trashLog.current[projectId] ?? []).length
      void app.git
        .fileStatuses(projectId)
        .then((statuses) => {
          if (
            removedProjectIdsRef.current.has(projectId) ||
            (trashLog.current[projectId] ?? []).length !== trashStart
          ) {
            return
          }
          updateFilesSession(projectId, (session) => ({ ...session, gitStatuses: statuses }))
        })
        .catch(() => {
          if (
            removedProjectIdsRef.current.has(projectId) ||
            (trashLog.current[projectId] ?? []).length !== trashStart
          ) {
            return
          }
          updateFilesSession(projectId, (session) => ({ ...session, gitStatuses: {} }))
        })
    },
    [app, removedProjectIdsRef, updateFilesSession],
  )

  // Entering the mode is per project and idempotent (spec Behaviour 4): the
  // retained expansion state and open file tabs survive the round-trip.
  const handleOpenProjectFiles = useCallback(
    (projectId: string): void => {
      setNotice(null)
      setFilesProjectId(projectId)
      const project = projects.find((item) => item.id === projectId)
      if (project !== undefined) {
        loadGitStatuses(projectId)
      }
      const session = filesSessions[projectId] ?? emptyProjectFilesSession()
      if (session.childrenByPath[''] === undefined) {
        loadFilesDirectory(projectId, '')
      }
    },
    [filesSessions, loadFilesDirectory, loadGitStatuses, projects, setNotice],
  )

  const lastOpenedFilesProjectIdRef = useRef<string | null>(null)
  const previousFilesProjectIdRef = useRef<string | null>(filesProjectId)

  // Leaving the mode returns focus to the Project Files trigger of the
  // project whose tree was shown.
  useEffect(() => {
    if (filesProjectId !== null) {
      lastOpenedFilesProjectIdRef.current = filesProjectId
    } else if (
      previousFilesProjectIdRef.current !== null &&
      lastOpenedFilesProjectIdRef.current !== null
    ) {
      const targetId = lastOpenedFilesProjectIdRef.current
      requestAnimationFrame(() => {
        const trigger = document.querySelector<HTMLElement>(
          `[data-testid="${testIdFor.projectFiles(targetId)}"]`,
        )
        trigger?.focus({ preventScroll: true })
      })
    }
    previousFilesProjectIdRef.current = filesProjectId
  }, [filesProjectId])

  const handleCloseProjectFiles = useCallback((): void => {
    setNotice(null)
    setFilesProjectId(null)
  }, [setNotice])

  const handleFilesToggleDirectory = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      const projectId = filesProjectId
      const session = filesSessions[projectId] ?? emptyProjectFilesSession()
      const expandedPaths = new Set(session.expandedPaths)
      if (expandedPaths.has(relativePath)) {
        // Collapse keeps the cached children and nested expansion state.
        expandedPaths.delete(relativePath)
        updateFilesSession(projectId, (current) => ({ ...current, expandedPaths }))
        return
      }
      expandedPaths.add(relativePath)
      updateFilesSession(projectId, (current) => ({
        ...current,
        expandedPaths,
        treeError: null,
      }))
      if (session.childrenByPath[relativePath] === undefined) {
        loadFilesDirectory(projectId, relativePath)
      }
    },
    [filesProjectId, filesSessions, loadFilesDirectory, updateFilesSession],
  )

  // Manual refresh (spec Behaviour 25, user decision 2026-10-11). One
  // files:list for the root and for each directory expanded at the click,
  // plus one Git status read. The open tree stays visible until the reads
  // settle. Re-entering the mode does not call this.
  const handleRefreshProjectFiles = useCallback((): void => {
    if (filesProjectId === null) {
      return
    }
    const projectId = filesProjectId
    if (filesRefreshInFlight.current.has(projectId)) {
      return
    }
    const session = filesSessions[projectId] ?? emptyProjectFilesSession()
    const project = projects.find((item) => item.id === projectId)
    filesRefreshInFlight.current.add(projectId)
    const generation = (filesRefreshGeneration.current[projectId] ?? 0) + 1
    filesRefreshGeneration.current[projectId] = generation
    const trashStart = (trashLog.current[projectId] ?? []).length
    setNotice(null)
    updateFilesSession(projectId, (current) => ({ ...current, refreshing: true }))
    const paths = ['', ...session.expandedPaths]
    void (async () => {
      try {
        const [results, gitStatuses] = await Promise.all([
          Promise.all(
            paths.map(async (relativePath) => {
              try {
                const entries = await app.files.list(
                  projectId,
                  relativePath === '' ? null : relativePath,
                )
                return { relativePath, ok: true as const, entries }
              } catch (error) {
                return {
                  relativePath,
                  ok: false as const,
                  message: errorMessage(
                    error,
                    relativePath === ''
                      ? 'Failed to load project files.'
                      : 'Failed to refresh a folder.',
                  ),
                }
              }
            }),
          ),
          project === undefined
            ? Promise.resolve(null)
            : app.git.fileStatuses(project.id).then(
                (statuses) => statuses,
                () => null,
              ),
        ])
        if (
          removedProjectIdsRef.current.has(projectId) ||
          filesRefreshGeneration.current[projectId] !== generation ||
          (trashLog.current[projectId] ?? []).length !== trashStart
        ) {
          return
        }
        let notice: string | null = null
        // The notice is read from the same session the tree update uses.
        // flushSync runs that update before setNotice, so a folder failure
        // is not lost on the following render.
        flushSync(() => {
          updateFilesSession(projectId, (current) => {
            if (
              filesRefreshGeneration.current[projectId] !== generation ||
              (trashLog.current[projectId] ?? []).length !== trashStart
            ) {
              return current
            }
            const outcome = applyDirectoryRefresh(current, results, gitStatuses)
            notice = outcome.notice
            return outcome.session
          })
        })
        if (
          filesRefreshGeneration.current[projectId] === generation &&
          (trashLog.current[projectId] ?? []).length === trashStart &&
          !removedProjectIdsRef.current.has(projectId)
        ) {
          setNotice(notice)
        }
      } finally {
        if (filesRefreshGeneration.current[projectId] === generation) {
          filesRefreshInFlight.current.delete(projectId)
          if (!removedProjectIdsRef.current.has(projectId)) {
            updateFilesSession(projectId, (current) =>
              current.refreshing ? { ...current, refreshing: false } : current,
            )
          }
        }
      }
    })()
  }, [
    app,
    filesProjectId,
    filesSessions,
    projects,
    removedProjectIdsRef,
    setNotice,
    updateFilesSession,
  ])

  // Clicking a file in the tree opens its tab, or focuses it when already
  // open — a file never has two tabs (spec Behaviour 3). Opening a file from
  // an unselected project selects that project.
  const handleFilesSelectFile = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      const projectId = filesProjectId
      updateFilesSession(projectId, (session) => ({ ...session, selectedPath: relativePath }))
      updateTabsSession(projectId, (session) => openFileTab(session, relativePath))
      if (selectedProjectId !== projectId) {
        setSelectedProjectId(projectId)
        setSelectedChatId(null)
        setExpandedProjectIds((previous) => new Set(previous).add(projectId))
        persistSelection(projectId, null)
        void loadChats(projectId).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to load chats.'))
        })
      }
    },
    [
      filesProjectId,
      loadChats,
      persistSelection,
      selectedProjectId,
      setNotice,
      updateFilesSession,
      updateTabsSession,
      setSelectedProjectId,
      setSelectedChatId,
      setExpandedProjectIds,
    ],
  )

  const handleFilesShowInFolder = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      void app.files.showInFolder(filesProjectId, relativePath).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to show the item in the file explorer.'))
      })
    },
    [app, filesProjectId, setNotice],
  )

  const handleFilesCopyRelativePath = useCallback(
    (relativePath: string): void => {
      void navigator.clipboard.writeText(relativePath).catch(() => {
        setNotice('Failed to copy the path.')
      })
    },
    [setNotice],
  )

  const handleFilesCopyPath = useCallback(
    (relativePath: string): void => {
      const project = projects.find((item) => item.id === filesProjectId)
      if (project === undefined) {
        setNotice('Failed to copy the path.')
        return
      }
      void navigator.clipboard.writeText(absoluteFilePath(project.path, relativePath)).catch(() => {
        setNotice('Failed to copy the path.')
      })
    },
    [filesProjectId, projects, setNotice],
  )

  const handleFilesTrash = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      const projectId = filesProjectId
      const flightKey = `${projectId}\n${relativePath}`
      if (trashInFlight.current.has(flightKey)) {
        return
      }
      trashInFlight.current.add(flightKey)
      const project = projects.find((item) => item.id === projectId)
      void app.files
        .trash(projectId, relativePath)
        .then(() => {
          if (removedProjectIdsRef.current.has(projectId)) {
            return
          }
          const log = trashLog.current[projectId] ?? []
          log.push(relativePath)
          trashLog.current[projectId] = log
          const trashStart = log.length
          const current = (): boolean =>
            !removedProjectIdsRef.current.has(projectId) &&
            (trashLog.current[projectId] ?? []).length === trashStart
          const parent = parentRelativePath(relativePath)
          updateFilesSession(projectId, (session) => dropTrashedPath(session, relativePath))
          updateTabsSession(projectId, (session) => closeTabsAtOrUnder(session, relativePath))
          void app.files
            .list(projectId, parent === '' ? null : parent)
            .then((entries) => {
              if (!current()) {
                return
              }
              updateFilesSession(projectId, (session) => ({
                ...session,
                childrenByPath: { ...session.childrenByPath, [parent]: entries },
                treeError: null,
              }))
            })
            .catch((error: unknown) => {
              if (!current()) {
                return
              }
              setNotice(errorMessage(error, 'Failed to load project files.'))
            })
          if (project !== undefined) {
            void app.git.fileStatuses(project.id).then(
              (statuses) => {
                if (!current()) {
                  return
                }
                updateFilesSession(projectId, (session) => ({ ...session, gitStatuses: statuses }))
              },
              () => {
                // A rejected follow-up read keeps the decorations already shown.
              },
            )
          }
        })
        .catch((error: unknown) => {
          if (removedProjectIdsRef.current.has(projectId)) {
            return
          }
          setNotice(errorMessage(error, 'Failed to move the item to the Recycle Bin.'))
        })
        .finally(() => {
          trashInFlight.current.delete(flightKey)
        })
    },
    [
      app,
      filesProjectId,
      projects,
      removedProjectIdsRef,
      setNotice,
      updateFilesSession,
      updateTabsSession,
    ],
  )

  // Drop a removed project's file-tree session (Behaviour 14) and leave
  // Project Files mode if its tree is on screen.
  const dropFilesProject = useCallback((projectId: string): void => {
    setFilesSessions((previous) => {
      if (!(projectId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    setFilesProjectId((current) => (current === projectId ? null : current))
  }, [])

  const filesProject =
    filesProjectId === null
      ? null
      : (projects.find((project) => project.id === filesProjectId) ?? null)
  const filesSession =
    filesProjectId === null
      ? emptyProjectFilesSession()
      : (filesSessions[filesProjectId] ?? emptyProjectFilesSession())

  return {
    filesProject,
    filesSession,
    handleOpenProjectFiles,
    handleCloseProjectFiles,
    handleRefreshProjectFiles,
    handleFilesToggleDirectory,
    handleFilesSelectFile,
    handleFilesShowInFolder,
    handleFilesCopyPath,
    handleFilesCopyRelativePath,
    handleFilesTrash,
    dropFilesProject,
  }
}
