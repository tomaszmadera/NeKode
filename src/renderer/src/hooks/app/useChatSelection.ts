import type { ActionExecution, AgentProfilesDocument, ChatInfo } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { activateTab, KANBAN_TAB, TERMINAL_TAB } from '../../components/tabs/tabs-session'
import { errorMessage } from '../../lib/app-error-message'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTabsStore } from '../../stores/useTabsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/** Selecting, switching and creating chats, and the selection flows that open a project. */
export function useChatSelection(
  runtime: WorkspaceRuntime,
  setTerminalCwds: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  const {
    app,
    setNotice,
    selectionRef,
    chatsByProjectRef,
    projectsRef,
    pendingTerminalCommandsRef,
    applyChatsUpdate,
    persistSelection,
    loadChats,
  } = runtime
  const { expandedProjectIds, setExpandedProjectIds, selectedProjectId, setSelectedProjectId } =
    useProjectStore(
      useShallow((state) => ({
        expandedProjectIds: state.expandedProjectIds,
        setExpandedProjectIds: state.setExpandedProjectIds,
        selectedProjectId: state.selectedProjectId,
        setSelectedProjectId: state.setSelectedProjectId,
      })),
    )
  const { setSelectedChatId, setSelectionNonce, setLoadedChatProjectIds } = useChatStore(
    useShallow((state) => ({
      setSelectedChatId: state.setSelectedChatId,
      setSelectionNonce: state.setSelectionNonce,
      setLoadedChatProjectIds: state.setLoadedChatProjectIds,
    })),
  )
  const updateTabsSession = useTabsStore((state) => state.updateTabsSession)

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
      // Selecting a chat shows its terminal: the terminal-chat tab becomes
      // the active tab of the chat's project (Behaviour 2).
      updateTabsSession(projectId, (session) => activateTab(session, TERMINAL_TAB))
    },
    [
      persistSelection,
      setNotice,
      updateTabsSession,
      setSelectedProjectId,
      setExpandedProjectIds,
      setSelectedChatId,
      setSelectionNonce,
    ],
  )

  // Project name or icon click in the left navigation (project-home spec
  // Behaviour 4): makes the project the tab-strip project and activates its
  // home tab. Switching projects selects, expands and clears the chat
  // selection; clicking the already selected project keeps its chat
  // selection, so returning via the chat tab shows the same chat instead of
  // an empty surface.
  const handleOpenProjectKanban = useCallback(
    (projectId: string): void => {
      setNotice(null)
      const switchingProject = projectId !== selectedProjectId
      setSelectedProjectId(projectId)
      if (switchingProject) {
        setSelectedChatId(null)
        persistSelection(projectId, null)
      }
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      void loadChats(projectId).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to load chats.'))
      })
      updateTabsSession(projectId, (session) => activateTab(session, KANBAN_TAB))
    },
    [
      loadChats,
      persistSelection,
      selectedProjectId,
      setNotice,
      updateTabsSession,
      setExpandedProjectIds,
      setSelectedProjectId,
      setSelectedChatId,
    ],
  )

  // Ctrl+Tab / Ctrl+Shift+Tab chat switching across all projects
  // (NEKODE-18). The switcher reuses the full select path, so persistence,
  // nonce, tree selection and tab activation behave exactly like a click on
  // the chat row — including making the chat's project the active one.
  // Chats of projects whose list was never loaded cannot participate: the
  // chord stays synchronous and does not fetch.
  const handleSwitchChat = useCallback(
    (direction: 1 | -1): void => {
      const projectId = selectionRef.current.projectId
      if (projectId === null) {
        return
      }
      const chatsByProject = chatsByProjectRef.current
      const flat: Array<{ projectId: string; chatId: string }> = []
      for (const project of projectsRef.current) {
        for (const chat of chatsByProject[project.id] ?? []) {
          flat.push({ projectId: project.id, chatId: chat.id })
        }
      }
      if (flat.length === 0) {
        return
      }
      const currentId = selectionRef.current.chatId
      const currentIndex =
        currentId === null ? -1 : flat.findIndex((entry) => entry.chatId === currentId)
      const base = currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex
      const next = flat[(base + direction + flat.length) % flat.length]
      handleSelectChat(next.projectId, next.chatId)
    },
    [chatsByProjectRef, handleSelectChat, projectsRef, selectionRef],
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
    [expandedProjectIds, loadChats, setExpandedProjectIds, setNotice],
  )

  // New Chat (spec Behaviour 3): created immediately with no naming form —
  // the name comes from the platform shell in main and duplicates are
  // allowed. The new chat becomes the selected chat and its terminal shows
  // (the terminal-chat tab becomes active).
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
          // The new chat's terminal shows in the center surface: the
          // terminal-chat tab becomes active.
          updateTabsSession(projectId, (session) => activateTab(session, TERMINAL_TAB))
          return true
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to create the chat.'))
          return false
        }
      })()
    },
    [
      app,
      applyChatsUpdate,
      persistSelection,
      setNotice,
      updateTabsSession,
      setSelectionNonce,
      setSelectedProjectId,
      setSelectedChatId,
      setExpandedProjectIds,
    ],
  )

  // Start confirmation (kanban task launch). The chat is named in main. This
  // activates the existing terminal-chat surface the same way New Chat does.
  const adoptLaunchedChat = useCallback(
    (projectId: string, chat: ChatInfo): void => {
      applyChatsUpdate((previous) => {
        const existing = previous[projectId] ?? []
        return {
          ...previous,
          [projectId]: [...existing.filter((item) => item.id !== chat.id), chat],
        }
      })
      setSelectedProjectId(projectId)
      setExpandedProjectIds((previous) => new Set(previous).add(projectId))
      setSelectedChatId(chat.id)
      setSelectionNonce((previous) => previous + 1)
      persistSelection(projectId, chat.id)
      updateTabsSession(projectId, (session) => activateTab(session, TERMINAL_TAB))
    },
    [
      applyChatsUpdate,
      persistSelection,
      updateTabsSession,
      setSelectionNonce,
      setSelectedProjectId,
      setSelectedChatId,
      setExpandedProjectIds,
    ],
  )

  // New Chat profile menu (spec new-chat-agent-menu): the menu reads the
  // project's profiles through the existing channel, and a chosen profile
  // launches one chat that is adopted exactly like a Kanban Start chat.
  const loadAgentProfiles = useCallback(
    (projectId: string): Promise<AgentProfilesDocument> => app.agentProfiles.get(projectId),
    [app],
  )

  const handleCreateAgentChat = useCallback(
    (projectId: string, profileId: string): Promise<boolean> => {
      setNotice(null)
      return (async () => {
        try {
          const chat = await app.chats.createWithAgent(projectId, profileId)
          adoptLaunchedChat(projectId, chat)
          return true
        } catch (error) {
          // No silent fallback to a plain shell chat (spec Errors): a failed
          // launch surfaces the typed error and main keeps no chat.
          setNotice(errorMessage(error, 'Failed to start the agent chat.'))
          return false
        }
      })()
    },
    [adoptLaunchedChat, app, setNotice],
  )

  // "Start new chat" empty state (spec Behaviour 11): create a chat
  // immediately for the tab-strip project (spec Behaviour 3 — no naming
  // form). handleCreateChat adopts the selection to the created chat's project.
  const tabProjectId = selectedProjectId
  const handleStartNewChat = useCallback((): void => {
    if (tabProjectId !== null) {
      void handleCreateChat(tabProjectId)
    }
  }, [handleCreateChat, tabProjectId])

  // An action-created chat (new-terminal action): its command waits for the
  // chat terminal's ready event, and its terminal-chat tab becomes active.
  const handleNewTerminalAction = (execution: ActionExecution): void => {
    const chat = execution.chat
    const command = execution.terminalCommand
    const cwd = execution.terminalCwd
    if (!chat || command === undefined || cwd === undefined) return
    pendingTerminalCommandsRef.current[chat.id] = command
    setTerminalCwds((previous) => ({ ...previous, [chat.id]: cwd }))
    applyChatsUpdate((previous) => ({
      ...previous,
      [chat.projectId]: [
        ...(previous[chat.projectId] ?? []).filter((item) => item.id !== chat.id),
        chat,
      ],
    }))
    setLoadedChatProjectIds((previous) => new Set(previous).add(chat.projectId))
    setExpandedProjectIds((previous) => new Set(previous).add(chat.projectId))
    setSelectedProjectId(chat.projectId)
    setSelectedChatId(chat.id)
    setSelectionNonce((previous) => previous + 1)
    persistSelection(chat.projectId, chat.id)
    updateTabsSession(chat.projectId, (session) => activateTab(session, TERMINAL_TAB))
  }

  return {
    handleSelectChat,
    handleOpenProjectKanban,
    handleSwitchChat,
    handleToggleProject,
    handleCreateChat,
    adoptLaunchedChat,
    loadAgentProfiles,
    handleCreateAgentChat,
    handleStartNewChat,
    handleNewTerminalAction,
  }
}
