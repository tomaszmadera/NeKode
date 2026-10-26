import type { ChatInfo } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback, useState } from 'react'
import { errorMessage } from '../../lib/app-error-message'
import { useChatStore } from '../../stores/useChatStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/** Whether a chat id still exists in any project's chat list. */
function chatExistsIn(chatsByProject: Record<string, ChatInfo[]>, chatId: string): boolean {
  return Object.values(chatsByProject).some((chats) => chats.some((chat) => chat.id === chatId))
}

/** The chat close flow shared by a terminal exit and the row's confirmed close. */
export function useChatClose(
  runtime: WorkspaceRuntime,
  options: {
    dropHeldLaunch: (chatId: string) => void
    setTerminalCwds: React.Dispatch<React.SetStateAction<Record<string, string>>>
  },
) {
  const {
    app,
    setNotice,
    removedChatIdsRef,
    chatsByProjectRef,
    selectionRef,
    pendingTerminalCommandsRef,
    applyChatsUpdate,
    cancelPendingSubmit,
    persistSelection,
  } = runtime
  const { dropHeldLaunch, setTerminalCwds } = options
  const setSelectedChatId = useChatStore((state) => state.setSelectedChatId)
  // Close-chat control on a chat row (user request 2026-10-04): the row's X
  // requests the close; the confirmation dialog owns the destructive action.
  const [chatToClose, setChatToClose] = useState<{ id: string; name: string } | null>(null)

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
    async (chatId: string): Promise<boolean> => {
      setNotice(null)
      try {
        await app.chats.remove(chatId)
      } catch (error) {
        setNotice(errorMessage(error, 'Failed to close the chat.'))
        return false
      }
      // Tombstone before the map removal: fetched lists still in flight can
      // predate this close, and mergeFetchedChats must not resurrect it.
      removedChatIdsRef.current.add(chatId)
      dropHeldLaunch(chatId)
      delete pendingTerminalCommandsRef.current[chatId]
      cancelPendingSubmit(chatId)
      setTerminalCwds((previous) => {
        if (!(chatId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[chatId]
        return next
      })
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
      return true
    },
    [
      app,
      applyChatsUpdate,
      cancelPendingSubmit,
      chatsByProjectRef,
      dropHeldLaunch,
      pendingTerminalCommandsRef,
      persistSelection,
      removedChatIdsRef,
      selectionRef,
      setNotice,
      setSelectedChatId,
      setTerminalCwds,
    ],
  )

  // The row's X requests the close (same flow as a terminal exit, successor
  // selection included); Cancel or dismiss stages nothing.
  const handleRequestCloseChat = useCallback(
    (chatId: string): void => {
      for (const chats of Object.values(chatsByProjectRef.current)) {
        const chat = chats.find((item) => item.id === chatId)
        if (chat !== undefined) {
          setChatToClose({ id: chat.id, name: chat.name })
          return
        }
      }
      // The chat vanished (a parallel close flow): nothing to confirm.
      setChatToClose(null)
    },
    [chatsByProjectRef],
  )

  const handleCloseChatConfirmed = useCallback((): void => {
    if (chatToClose === null) {
      return
    }
    const chatId = chatToClose.id
    setChatToClose(null)
    void handleChatClosed(chatId)
  }, [chatToClose, handleChatClosed])

  const cancelCloseChat = useCallback((): void => {
    setChatToClose(null)
  }, [])

  return {
    chatToClose,
    handleChatClosed,
    handleRequestCloseChat,
    handleCloseChatConfirmed,
    cancelCloseChat,
  }
}
