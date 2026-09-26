import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatInfo, FileEntry, ProjectInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../shared/ipc-error'
import { emptyProjectFilesSession, type ProjectFilesSession } from './components/files/files-types'
import { ProjectFilesPanel } from './components/files/ProjectFilesPanel'
import { ProjectFilesSurface } from './components/files/ProjectFilesSurface'
import { CenterHeader } from './components/layout/CenterHeader'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { ResizeHandle } from './components/layout/ResizeHandle'
import { TopBar } from './components/layout/TopBar'
import { ChatWorkspace } from './components/workspace/ChatWorkspace'
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

/** Whether a chat id still exists in any project's chat list. */
function chatExistsIn(chatsByProject: Record<string, ChatInfo[]>, chatId: string): boolean {
  return Object.values(chatsByProject).some((chats) => chats.some((chat) => chat.id === chatId))
}

export function App({ app = window.app }: { app?: typeof window.app }): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [chatsByProject, setChatsByProject] = useState<Record<string, ChatInfo[]>>({})
  // Projects whose chat list finished loading. The "Start new chat" empty
  // state renders only for those: a missing entry means "not loaded yet",
  // never "no chats" (it must not flash before the load settles).
  const [loadedChatProjectIds, setLoadedChatProjectIds] = useState<ReadonlySet<string>>(new Set())
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectionNonce, setSelectionNonce] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)
  // Project Files mode (spec Behaviour 1–2, 12): the project whose tree is
  // shown in the left panel, or null for the Projects/Chats navigation. The
  // mode never touches the chat/project selection — `← Projects` restores the
  // center surface that was active before entry (Behaviour 12). Per-project
  // tree state lives in filesSessions for the app session only (Behaviour 14).
  const [filesProjectId, setFilesProjectId] = useState<string | null>(null)
  const [filesSessions, setFilesSessions] = useState<Record<string, ProjectFilesSession>>({})
  // Projects removed in this session: pending chat loads for them are stale.
  const removedProjectIdsRef = useRef<Set<string>>(new Set())
  // Synchronous mirror of chatsByProject: every mutation goes through
  // applyChatsUpdate (below), so near-simultaneous terminal-exit close flows
  // compute their successor from live data, never from a stale render
  // snapshot left over from before the other flow's removal landed.
  const chatsByProjectRef = useRef<Record<string, ChatInfo[]>>({})
  // Synchronous mirror of the selection for the same reason: a close flow
  // must see the selection written by a close flow that landed a moment
  // earlier in the same tick (render-time assignment syncs user selections).
  const selectionRef = useRef({ projectId: selectedProjectId, chatId: selectedChatId })
  selectionRef.current = { projectId: selectedProjectId, chatId: selectedChatId }

  // Single write path for chatsByProject: the mirror and the state are
  // mutated in lockstep so concurrent close flows never act on stale data.
  const applyChatsUpdate = useCallback(
    (updater: (previous: Record<string, ChatInfo[]>) => Record<string, ChatInfo[]>): void => {
      chatsByProjectRef.current = updater(chatsByProjectRef.current)
      setChatsByProject(chatsByProjectRef.current)
    },
    [],
  )

  // Startup hydration: real project list, persisted selection (dropped when
  // it no longer matches existing records) and persisted region sizes.
  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        const [loadedProjects, savedProjectId, savedChatId, savedLeftWidth, savedBottomHeight] =
          await Promise.all([
            app.projects.list(),
            app.state.get(APP_STATE_KEY.selectedProjectId),
            app.state.get(APP_STATE_KEY.selectedChatId),
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
        applyChatsUpdate((previous) => ({ ...previous, [projectId]: chats }))
        setLoadedChatProjectIds((previous) => new Set(previous).add(projectId))
        setExpandedProjectIds((previous) => new Set(previous).add(projectId))
        setSelectedProjectId(projectId)
        setSelectedChatId(
          savedChat !== null && chats.some((chat) => chat.id === savedChat) ? savedChat : null,
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
  }, [app, applyChatsUpdate])

  // Selection keys are written on every selection change (spec Business
  // rules); an empty string clears a key so no stale selection survives.
  // Rejections surface to the notice banner (spec Errors: no silent fallback).
  const persistSelection = useCallback(
    (projectId: string | null, chatId: string | null): void => {
      void app.state
        .set(APP_STATE_KEY.selectedProjectId, projectId ?? '')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the selected project.'))
        })
      void app.state.set(APP_STATE_KEY.selectedChatId, chatId ?? '').catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the selected chat.'))
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

  const loadChats = useCallback(
    async (projectId: string): Promise<void> => {
      const chats = await app.chats.list(projectId)
      // A load resolving after its project was removed must not re-populate
      // chatsByProject with an orphaned entry.
      if (removedProjectIdsRef.current.has(projectId)) {
        return
      }
      applyChatsUpdate((previous) => ({ ...previous, [projectId]: chats }))
      setLoadedChatProjectIds((previous) => new Set(previous).add(projectId))
    },
    [app, applyChatsUpdate],
  )

  const handleSelectProject = useCallback(
    (projectId: string): void => {
      setNotice(null)
      setSelectedProjectId(projectId)
      setSelectedChatId(null)
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      persistSelection(projectId, null)
      void loadChats(projectId).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to load chats.'))
      })
    },
    [loadChats, persistSelection],
  )

  const handleSelectChat = useCallback(
    (projectId: string, chatId: string): void => {
      setNotice(null)
      setSelectedProjectId(projectId)
      setSelectedChatId(chatId)
      // Every explicit selection counts: re-selecting a failed session
      // retries it (spec Edge cases).
      setSelectionNonce((previous) => previous + 1)
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      persistSelection(projectId, chatId)
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
        void loadChats(projectId).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to load chats.'))
        })
      }
    },
    [expandedProjectIds, loadChats],
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
        applyChatsUpdate((previous) => ({ ...previous, [project.id]: [] }))
        setLoadedChatProjectIds((previous) => new Set(previous).add(project.id))
        setExpandedProjectIds((previous) => new Set(previous).add(project.id))
        setSelectedProjectId(project.id)
        setSelectedChatId(null)
        persistSelection(project.id, null)
      } catch (error) {
        setNotice(errorMessage(error, 'Failed to add the project.'))
      }
    })()
  }, [app, applyChatsUpdate, persistSelection])

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
        // the removed project is the currently selected one. Pending chat
        // loads for this project become stale (see loadChats).
        removedProjectIdsRef.current.add(projectId)
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
        // Drop the removed project's file-tree session (Behaviour 14) and
        // leave Project Files mode if its tree is on screen.
        setFilesSessions((previous) => {
          if (!(projectId in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[projectId]
          return next
        })
        setFilesProjectId((current) => (current === projectId ? null : current))
        if (projectId === selectedProjectId) {
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
      })()
    },
    [app, applyChatsUpdate, persistSelection, selectedProjectId],
  )

  // --- Project Files mode (spec Behaviour 1–2, 6, 12, 14–15) ---------------

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
  const loadFilesDirectory = useCallback(
    (projectId: string, relativePath: string): void => {
      void app.files
        .list(projectId, relativePath === '' ? null : relativePath)
        .then((entries: FileEntry[]) => {
          // A load resolving after its project was removed is stale.
          if (removedProjectIdsRef.current.has(projectId)) {
            return
          }
          updateFilesSession(projectId, (session) => ({
            ...session,
            childrenByPath: { ...session.childrenByPath, [relativePath]: entries },
            treeError: null,
          }))
        })
        .catch((error: unknown) => {
          if (removedProjectIdsRef.current.has(projectId)) {
            return
          }
          // Inline tree error (spec Errors): the app keeps working and
          // `← Projects` always exits the mode.
          updateFilesSession(projectId, (session) => ({
            ...session,
            treeError: errorMessage(error, 'Failed to load project files.'),
          }))
        })
    },
    [app, updateFilesSession],
  )

  // Entering the mode is per project and idempotent (spec Behaviour 4): the
  // retained expansion state and last selected file survive the round-trip.
  const handleOpenProjectFiles = useCallback(
    (projectId: string): void => {
      setNotice(null)
      setFilesProjectId(projectId)
      const session = filesSessions[projectId] ?? emptyProjectFilesSession()
      if (session.childrenByPath[''] === undefined) {
        loadFilesDirectory(projectId, '')
      }
    },
    [filesSessions, loadFilesDirectory],
  )

  const handleCloseProjectFiles = useCallback((): void => {
    setNotice(null)
    setFilesProjectId(null)
  }, [])

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

  const handleFilesSelectFile = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      updateFilesSession(filesProjectId, (session) => ({ ...session, selectedPath: relativePath }))
    },
    [filesProjectId, updateFilesSession],
  )

  // Failed "Open externally" (spec Errors): a notice, never a silent drop.
  const handleFilesOpenExternalError = useCallback((message: string): void => {
    setNotice(message)
  }, [])

  // New Chat (spec Behaviour 3): created immediately with no naming form —
  // the name comes from the platform shell in main and duplicates are
  // allowed. The new chat becomes the selected chat.
  const handleCreateChat = useCallback(
    (projectId: string): Promise<boolean> => {
      setNotice(null)
      return (async () => {
        try {
          const chat = await app.chats.create(projectId)
          applyChatsUpdate((previous) => {
            const existing = previous[projectId] ?? []
            return {
              ...previous,
              [projectId]: [...existing.filter((item) => item.id !== chat.id), chat],
            }
          })
          setSelectedProjectId(projectId)
          // A created chat must be visible in the tree: re-expand its project
          // node even when the user collapsed it (Start new chat / New Chat,
          // spec Behaviour 3).
          setExpandedProjectIds((previous) => new Set(previous).add(projectId))
          setSelectedChatId(chat.id)
          setSelectionNonce((previous) => previous + 1)
          persistSelection(projectId, chat.id)
          return true
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to create the chat.'))
          return false
        }
      })()
    },
    [app, applyChatsUpdate, persistSelection],
  )

  // Terminal-exit close flow (spec Behaviour 11): remove the chat from the
  // tree and the database, then continue on the next chat of the same project
  // in tree order (the previous one when the closed chat was last). A project
  // left without chats falls back to the "Start new chat" empty state.
  // Application quit never runs this flow: quit teardown suppresses the
  // terminals:exit events that start it (spec Behaviour 8).
  // The successor and the selection rewrite are computed against the
  // synchronous mirrors (chatsByProjectRef/selectionRef), so close flows
  // landing in the same tick see each other's removals instead of a stale
  // render snapshot — the selection can never end up pointing at a chat that
  // another flow already removed.
  const handleChatClosed = useCallback(
    (chatId: string): void => {
      setNotice(null)
      void (async () => {
        try {
          await app.chats.remove(chatId)
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to close the chat.'))
          return
        }
        let successorChatId: string | null = null
        for (const [projectId, chats] of Object.entries(chatsByProjectRef.current)) {
          const index = chats.findIndex((chat) => chat.id === chatId)
          if (index === -1) {
            continue
          }
          const remaining = chats.filter((chat) => chat.id !== chatId)
          // The successor rule applies to the currently viewed chat (the one
          // whose terminal the user closed); a background chat that exits on
          // its own is removed without stealing the current selection.
          if (
            projectId === selectionRef.current.projectId &&
            chatId === selectionRef.current.chatId
          ) {
            successorChatId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null
          }
          applyChatsUpdate((previous) => ({
            ...previous,
            [projectId]: (previous[projectId] ?? []).filter((chat) => chat.id !== chatId),
          }))
          break
        }
        // The selection must never point at a removed chat: rewrite it to the
        // successor, or fall back to the "Start new chat" empty state. This
        // also covers a chat already filtered out by an earlier close in the
        // same tick (its own flow computed no successor).
        const selectedChatIdNow = selectionRef.current.chatId
        if (
          selectedChatIdNow !== null &&
          !chatExistsIn(chatsByProjectRef.current, selectedChatIdNow)
        ) {
          const nextChatId =
            successorChatId !== null && chatExistsIn(chatsByProjectRef.current, successorChatId)
              ? successorChatId
              : null
          selectionRef.current = { ...selectionRef.current, chatId: nextChatId }
          setSelectedChatId(nextChatId)
          persistSelection(selectionRef.current.projectId, nextChatId)
        }
      })()
    },
    [app, applyChatsUpdate, persistSelection],
  )

  // "Start new chat" empty state (spec Behaviour 11): create a chat
  // immediately for the selected project (spec Behaviour 3 — no naming form).
  const handleStartNewChat = useCallback((): void => {
    if (selectedProjectId !== null) {
      void handleCreateChat(selectedProjectId)
    }
  }, [handleCreateChat, selectedProjectId])

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
  const filesProject =
    filesProjectId === null
      ? null
      : (projects.find((project) => project.id === filesProjectId) ?? null)
  const filesSession =
    filesProjectId === null
      ? emptyProjectFilesSession()
      : (filesSessions[filesProjectId] ?? emptyProjectFilesSession())

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100 antialiased"
      data-testid={TEST_ID.appShell}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {filesProject !== null ? (
          <ProjectFilesPanel
            width={leftWidth}
            onResizeStart={leftRegion.startResize}
            onResizeNudge={leftRegion.nudge}
            project={filesProject}
            session={filesSession}
            onBack={handleCloseProjectFiles}
            onToggleDirectory={handleFilesToggleDirectory}
            onSelectFile={handleFilesSelectFile}
            notice={notice}
          />
        ) : (
          <LeftNavigation
            width={leftWidth}
            onResizeStart={leftRegion.startResize}
            onResizeNudge={leftRegion.nudge}
            projects={projects}
            chatsByProject={chatsByProject}
            expandedProjectIds={expandedProjectIds}
            selectedProjectId={selectedProjectId}
            selectedChatId={selectedChatId}
            onSelectProject={handleSelectProject}
            onToggleProject={handleToggleProject}
            onSelectChat={handleSelectChat}
            onAddProject={handleAddProject}
            onRemoveProject={handleRemoveProject}
            onOpenProjectFiles={handleOpenProjectFiles}
            onCreateChat={handleCreateChat}
            notice={notice}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <CenterHeader app={app} project={filesProject ?? selectedProject} />
          <main className="flex min-h-0 flex-1 flex-col" data-testid={TEST_ID.centerSurface}>
            {filesProject !== null ? (
              <ProjectFilesSurface
                app={app}
                project={filesProject}
                selectedPath={filesSession.selectedPath}
                onOpenExternalError={handleFilesOpenExternalError}
              />
            ) : null}
            {/* Chat sessions stay mounted (hidden) while Project Files mode is
                open: PTY processes and xterm scrollback survive the round-trip
                (spec Behaviour 12 / AC6). */}
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ display: filesProject !== null ? 'none' : 'flex' }}
              data-testid={TEST_ID.chatSurfaceHost}
            >
              <ChatWorkspace
                app={app}
                projects={projects}
                chatsByProject={chatsByProject}
                chatsLoaded={
                  selectedProjectId !== null && loadedChatProjectIds.has(selectedProjectId)
                }
                selectedProjectId={selectedProjectId}
                selectedChatId={selectedChatId}
                selectionNonce={selectionNonce}
                onChatClosed={handleChatClosed}
                onStartNewChat={handleStartNewChat}
              />
            </div>
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
