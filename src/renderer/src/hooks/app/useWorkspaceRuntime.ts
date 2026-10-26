import type { ChatInfo, ProjectInfo } from '@shared/ipc-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorMessage } from '../../lib/app-error-message'
import { writeSubmitLine } from '../../lib/pty-submit'
import { mergeFetchedChats, useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'

export type AppApi = typeof window.app
export type SetNotice = (notice: string | null) => void

/**
 * Mutable App-wide coordination shared by the workspace hooks of one App
 * mount: tombstones for in-flight IPC results, synchronous mirrors of store
 * state that close flows read within one tick, and pending PTY deliveries.
 */
export interface WorkspaceRuntime {
  app: AppApi
  setNotice: SetNotice
  // Projects removed in this session: pending loads for them are stale.
  removedProjectIdsRef: React.MutableRefObject<Set<string>>
  // Chats closed by explicit close flows in this session: fetched lists can
  // predate the close, and mergeFetchedChats must not resurrect them. Chat
  // ids are unique per database row, so they never legitimately return.
  removedChatIdsRef: React.MutableRefObject<Set<string>>
  // Overlapping removals of one id. One success keeps the tombstone; it is
  // cleared only when every in-flight attempt has failed.
  projectRemovalsRef: React.MutableRefObject<Map<string, { pending: number; succeeded: boolean }>>
  // Synchronous mirror of chatsByProject: every mutation goes through
  // applyChatsUpdate, so near-simultaneous terminal-exit close flows compute
  // their successor from live data, never from a stale render snapshot left
  // over from before the other flow's removal landed.
  chatsByProjectRef: React.MutableRefObject<Record<string, ChatInfo[]>>
  // Synchronous mirror of the selection for the same reason: a close flow
  // must see the selection written by a close flow that landed a moment
  // earlier in the same tick (render-time assignment syncs user selections).
  selectionRef: React.MutableRefObject<{ projectId: string | null; chatId: string | null }>
  projectsRef: React.MutableRefObject<ProjectInfo[]>
  /** The tab-strip project (the selected project), revalidated every render. */
  tabProjectIdRef: React.MutableRefObject<string | null>
  /** Action commands waiting for their new chat terminal to become ready. */
  pendingTerminalCommandsRef: React.MutableRefObject<Record<string, string>>
  // Bottom-terminal action commands waiting for their new tab's terminal to
  // become ready. Keyed by bottom tab id; consumed exactly once (AC10).
  pendingBottomCommandsRef: React.MutableRefObject<Record<string, string>>
  /** Single write path for chatsByProject; the mirror and the store move in lockstep. */
  applyChatsUpdate: (
    updater: (previous: Record<string, ChatInfo[]>) => Record<string, ChatInfo[]>,
  ) => void
  persistSelection: (projectId: string | null, chatId: string | null) => void
  loadChats: (projectId: string) => Promise<void>
  /** Cancels a pending split-write CR so it never reaches a disposed session. */
  cancelPendingSubmit: (id: string) => void
  /** Writes `text` and then one CR as its own chunk (lib/pty-submit.ts). */
  submitLine: (id: string, text: string, failureMessage: string) => void
}

export function useWorkspaceRuntime(app: AppApi, setNotice: SetNotice): WorkspaceRuntime {
  const { projects, selectedProjectId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
    })),
  )
  const { selectedChatId, setChatsByProject, setLoadedChatProjectIds } = useChatStore(
    useShallow((state) => ({
      selectedChatId: state.selectedChatId,
      setChatsByProject: state.setChatsByProject,
      setLoadedChatProjectIds: state.setLoadedChatProjectIds,
    })),
  )
  const removedProjectIdsRef = useRef<Set<string>>(new Set())
  const removedChatIdsRef = useRef<Set<string>>(new Set())
  const projectRemovalsRef = useRef(new Map<string, { pending: number; succeeded: boolean }>())
  const chatsByProjectRef = useRef<Record<string, ChatInfo[]>>({})
  const selectionRef = useRef({ projectId: selectedProjectId, chatId: selectedChatId })
  selectionRef.current = { projectId: selectedProjectId, chatId: selectedChatId }
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  // The tab strip and the main surface belong to the selected project.
  const tabProjectIdRef = useRef<string | null>(null)
  tabProjectIdRef.current = selectedProjectId
  const pendingTerminalCommandsRef = useRef<Record<string, string>>({})
  const pendingBottomCommandsRef = useRef<Record<string, string>>({})
  // Pending split-write submissions (lib/pty-submit.ts) waiting for their CR.
  // Keyed by chat id or bottom tab id; cancelled on teardown or when replaced.
  const pendingSubmitCancelsRef = useRef<Record<string, () => void>>({})

  const applyChatsUpdate = useCallback(
    (updater: (previous: Record<string, ChatInfo[]>) => Record<string, ChatInfo[]>): void => {
      chatsByProjectRef.current = updater(chatsByProjectRef.current)
      setChatsByProject(chatsByProjectRef.current)
    },
    [setChatsByProject],
  )

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
    [app, setNotice],
  )

  const loadChats = useCallback(
    async (projectId: string): Promise<void> => {
      const chats = await app.chats.list(projectId)
      // A load resolving after its project was removed must not re-populate
      // chatsByProject with an orphaned entry.
      if (removedProjectIdsRef.current.has(projectId)) {
        return
      }
      applyChatsUpdate((previous) => ({
        ...previous,
        [projectId]: mergeFetchedChats(previous[projectId] ?? [], chats, removedChatIdsRef.current),
      }))
      setLoadedChatProjectIds((previous) => new Set(previous).add(projectId))
    },
    [app, applyChatsUpdate, setLoadedChatProjectIds],
  )

  const cancelPendingSubmit = useCallback((id: string): void => {
    const cancel = pendingSubmitCancelsRef.current[id]
    if (cancel !== undefined) {
      delete pendingSubmitCancelsRef.current[id]
      cancel()
    }
  }, [])

  // The CR must arrive as its own chunk: a single `command\r` burst parses as
  // an unterminated bracketed paste in prompt_toolkit agent TUIs (Hermes
  // Agent): text lands in the input box, the CR is swallowed, nothing sends.
  const submitLine = useCallback(
    (id: string, text: string, failureMessage: string): void => {
      cancelPendingSubmit(id)
      pendingSubmitCancelsRef.current[id] = writeSubmitLine((data) => {
        if (data === '\r') {
          delete pendingSubmitCancelsRef.current[id]
        }
        void app.terminals.write(id, data).catch((error: unknown) => {
          setNotice(errorMessage(error, failureMessage))
        })
      }, text)
    },
    [app, cancelPendingSubmit, setNotice],
  )

  // Teardown unmount cleanup: cancel any in-flight split-write submission CR timers.
  useEffect(() => {
    return () => {
      for (const cancel of Object.values(pendingSubmitCancelsRef.current)) {
        cancel()
      }
      pendingSubmitCancelsRef.current = {}
    }
  }, [])

  return useMemo(
    () => ({
      app,
      setNotice,
      removedProjectIdsRef,
      removedChatIdsRef,
      projectRemovalsRef,
      chatsByProjectRef,
      selectionRef,
      projectsRef,
      tabProjectIdRef,
      pendingTerminalCommandsRef,
      pendingBottomCommandsRef,
      applyChatsUpdate,
      persistSelection,
      loadChats,
      cancelPendingSubmit,
      submitLine,
    }),
    [
      app,
      setNotice,
      applyChatsUpdate,
      persistSelection,
      loadChats,
      cancelPendingSubmit,
      submitLine,
    ],
  )
}
