import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppApi, ChatInfo, ProjectInfo } from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { ChatTerminal } from '../terminal/ChatTerminal'
import type { PromptInjection } from '../terminal/PromptInput'
import { StartNewChatSurface } from './StartNewChatSurface'
import { WelcomeSurface } from './WelcomeSurface'

// Chat workspace (UX-UI §17): the primary terminal filling the center
// surface. This component is the session host:
// every chat terminal view that ever mounted stays mounted (hidden) while the
// user works elsewhere, so PTY processes and xterm scrollback survive chat and
// project switches (spec Behaviour 6-7, A4). Views for removed chats (project
// deletion cascade) are evicted; their PTYs are terminated in main
// (projects:remove), never here.
//
// Terminal exit closes the chat (spec Behaviour 11): the terminal view is
// disposed here and the host is asked to remove the chat from the tree and
// the database and to continue on the next chat. There is no "session ended"
// state in this slice; only spawn failures surface an overlay (with Retry).

interface SessionRecord {
  /** Bumped when a failed session is replaced by a fresh one (remount key). */
  generation: number
  status: 'running' | 'error'
  errorMessage: string | null
  /** Project directory captured at spawn time (the PTY cwd). */
  cwd: string
}

interface ChatWorkspaceProps {
  app: AppApi
  projects: ProjectInfo[]
  chatsByProject: Record<string, ChatInfo[]>
  /**
   * Whether the selected project's chat list finished loading. The
   * "Start new chat" empty state renders only then: an empty (missing) entry
   * before the load settles means "not loaded yet", never "no chats".
   */
  chatsLoaded: boolean
  selectedProjectId: string | null
  selectedChatId: string | null
  /**
   * Incremented on every explicit chat selection (chat row click / new chat),
   * so re-selecting a failed session retries it even when the id did not
   * change (spec Edge cases).
   */
  selectionNonce: number
  /**
   * Terminal-exit close flow (spec Behaviour 11): the host removes the chat
   * from the tree and the database and continues on the next chat of the
   * project. Never called for teardown caused by application quit.
   */
  onChatClosed: (chatId: string) => void
  /**
   * "Start new chat" empty state: create a chat immediately (no naming form,
   * spec Behaviour 3).
   */
  onStartNewChat: () => void
  /**
   * Files-mode divergence: no active chat belongs to the tab-strip project,
   * so the terminal surface shows the Behaviour 2 "Start new chat" empty
   * state regardless of the chat lists (spec Behaviour 2).
   */
  forceStartNewChat?: boolean
  terminalCwds?: Record<string, string>
  /** Terminal font size (App Settings); remounts nothing — see ChatTerminal. */
  terminalFontSize?: number
  onSessionStatus?: (chatId: string, live: boolean) => void
  onSessionReady?: (chatId: string) => void
  /**
   * Pending prompt-input fill from the action row (Handoff/Resume paste,
   * spec handoff-resume-flow Behaviour 3/7): delivered only to the addressed
   * chat's terminal, dropped when the selection moved elsewhere.
   */
  promptInjection?: { chatId: string; text: string; nonce: number } | null
  /** Reports consumption (with the injection nonce) to the host. */
  onPromptInjected?: (nonce: number) => void
}

function freshRecord(cwd: string): SessionRecord {
  return { generation: 0, status: 'running', errorMessage: null, cwd }
}

export function ChatWorkspace({
  app,
  projects,
  chatsByProject,
  chatsLoaded,
  selectedProjectId,
  selectedChatId,
  selectionNonce,
  onChatClosed,
  onStartNewChat,
  forceStartNewChat = false,
  terminalCwds = {},
  terminalFontSize,
  onSessionStatus,
  onSessionReady,
  promptInjection = null,
  onPromptInjected,
}: ChatWorkspaceProps): React.JSX.Element {
  const [sessions, setSessions] = useState<Record<string, SessionRecord>>({})
  // Chats whose exit already started the close flow (guards duplicate exits).
  const closingChatIdsRef = useRef<Set<string>>(new Set())

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  // Empty-state contract (spec Behaviour 11): a selected project without any
  // chats shows the "Start new chat" affordance instead of the welcome page —
  // but only once its chat list actually loaded (before that "no chats" is
  // unknown, and the neutral welcome surface is shown). The Files-mode
  // divergence forces the Behaviour 2 empty state outright: no active chat
  // belongs to the tab-strip project (spec Behaviour 2).
  const selectedProjectChats =
    selectedProject === null ? [] : (chatsByProject[selectedProject.id] ?? [])
  const showStartNewChat =
    forceStartNewChat ||
    (selectedProject !== null &&
      selectedChatId === null &&
      chatsLoaded &&
      selectedProjectChats.length === 0)

  // Latest lookup data for the selection effect (below): read through a ref
  // so projects/chats reloads — which swap object identities on every
  // refresh — can never re-trigger session spawning.
  const lookupRef = useRef({ selectedProjectId, projects, chatsByProject, terminalCwds })
  lookupRef.current = { selectedProjectId, projects, chatsByProject, terminalCwds }

  const onSessionStatusRef = useRef(onSessionStatus)
  const onSessionReadyRef = useRef(onSessionReady)
  onSessionStatusRef.current = onSessionStatus
  onSessionReadyRef.current = onSessionReady

  const onChatClosedRef = useRef(onChatClosed)
  onChatClosedRef.current = onChatClosed

  // Selection opens (or re-opens) the chat's session view. A live session is
  // never touched here — switching back keeps the same session (A4).
  // Respawn is gated strictly on explicit selection (chat id + selection
  // nonce): a projects/chats reload must never replace a failed session with
  // a fresh PTY (spec Edge cases: a fresh session appears only when the user
  // selects the chat again).
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionNonce is a deliberate trigger — an explicit re-selection of the same chat id must re-run this effect to retry failed sessions (spec Edge cases); the project/chat lookup is read through a ref so data refreshes never re-trigger it.
  useEffect(() => {
    if (selectedChatId === null) {
      return
    }
    const lookup = lookupRef.current
    const project = lookup.projects.find((item) => item.id === lookup.selectedProjectId) ?? null
    if (project === null || findChat(lookup.chatsByProject, project.id, selectedChatId) === null) {
      return
    }
    const cwd = lookup.terminalCwds[selectedChatId] ?? project.path
    // Opening (or keeping) a session means this chat is not closing: a stale
    // close guard left behind by an earlier failed close (the host keeps the
    // chat when chats.remove rejects) must not swallow this session's exit —
    // a fresh session always ends in a fresh close flow.
    closingChatIdsRef.current.delete(selectedChatId)
    setSessions((previous) => {
      const existing = previous[selectedChatId]
      if (existing === undefined) {
        return { ...previous, [selectedChatId]: freshRecord(cwd) }
      }
      if (existing.status === 'running') {
        return previous
      }
      // Failed session re-selected: replace it with a fresh process (and view).
      return {
        ...previous,
        [selectedChatId]: { ...freshRecord(cwd), generation: existing.generation + 1 },
      }
    })
  }, [selectedChatId, selectionNonce])

  // Evict session views for removed chats (project deletion cascade or the
  // terminal-exit close flow): unmounting the view disposes its xterm instance
  // and unsubscribes from the bridge (ChatTerminal cleanup). PTYs of removed
  // projects are terminated in main — the renderer never owns OS capabilities.
  useEffect(() => {
    setSessions((previous) => {
      let evicted = false
      const kept: Record<string, SessionRecord> = {}
      for (const [chatId, record] of Object.entries(previous)) {
        if (chatExists(chatsByProject, chatId)) {
          kept[chatId] = record
        } else {
          evicted = true
          closingChatIdsRef.current.delete(chatId)
        }
      }
      return evicted ? kept : previous
    })
  }, [chatsByProject])

  // Terminal exit closes the chat (spec Behaviour 11): dispose the terminal
  // view (dropping the session record unmounts it) and hand the close flow to
  // the host — chat removal from the tree/database plus next-chat selection.
  const handleExit = useCallback((chatId: string): void => {
    if (closingChatIdsRef.current.has(chatId)) {
      return
    }
    closingChatIdsRef.current.add(chatId)
    onSessionStatusRef.current?.(chatId, false)
    setSessions((previous) => {
      if (previous[chatId] === undefined) {
        return previous
      }
      const next = { ...previous }
      delete next[chatId]
      return next
    })
    onChatClosedRef.current(chatId)
  }, [])

  const handleSpawnError = useCallback((chatId: string, message: string): void => {
    onSessionStatusRef.current?.(chatId, false)
    setSessions((previous) => {
      const existing = previous[chatId]
      if (existing === undefined) {
        return previous
      }
      return { ...previous, [chatId]: { ...existing, status: 'error', errorMessage: message } }
    })
  }, [])

  // Retry from the spawn-error state: remount the view (which lazily spawns a
  // fresh PTY). Spawn errors never close the chat (spec Edge cases).
  const handleRetry = useCallback((chatId: string): void => {
    setSessions((previous) => {
      const existing = previous[chatId]
      if (existing === undefined) {
        return previous
      }
      return {
        ...previous,
        [chatId]: { ...freshRecord(existing.cwd), generation: existing.generation + 1 },
      }
    })
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={selectedChatId !== null ? TEST_ID.chatWorkspace : undefined}
    >
      {/* The chat name lives in the terminal-chat tab label (tab model): no
          title bar above the terminal. */}
      <div className="relative min-h-0 flex-1" data-testid={TEST_ID.terminalHost}>
        {Object.entries(sessions).map(([chatId, record]) => {
          // Only the addressed chat sees the fill (Behaviour 7): hidden
          // terminals must not consume another chat's injection.
          const injectionNonce = promptInjection?.chatId === chatId ? promptInjection.nonce : null
          const injection: PromptInjection | null =
            promptInjection !== null && promptInjection.chatId === chatId
              ? { text: promptInjection.text, nonce: promptInjection.nonce }
              : null
          return (
            <div
              key={`${chatId}:${record.generation}`}
              className="absolute inset-0"
              style={{ display: chatId === selectedChatId ? 'block' : 'none' }}
              data-testid={testIdFor.terminalView(chatId)}
            >
              <ChatTerminal
                app={app}
                chatId={chatId}
                cwd={record.cwd}
                visible={chatId === selectedChatId}
                terminalFontSize={terminalFontSize}
                onExit={() => handleExit(chatId)}
                onClose={() => handleExit(chatId)}
                onSpawnError={(message) => handleSpawnError(chatId, message)}
                onReady={() => {
                  onSessionStatusRef.current?.(chatId, true)
                  onSessionReadyRef.current?.(chatId)
                }}
                injected={injection}
                onInjected={
                  injection !== null && injectionNonce !== null && onPromptInjected
                    ? () => onPromptInjected(injectionNonce)
                    : undefined
                }
              />
              {record.status === 'error' && chatId === selectedChatId ? (
                <SpawnErrorOverlay
                  message={record.errorMessage}
                  onRetry={() => handleRetry(chatId)}
                />
              ) : null}
            </div>
          )
        })}
        {showStartNewChat ? <StartNewChatSurface onStartNewChat={onStartNewChat} /> : null}
        {selectedChatId === null && !showStartNewChat ? <WelcomeSurface /> : null}
      </div>
    </div>
  )
}

function SpawnErrorOverlay({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-app/80 px-6 text-center"
      data-testid={TEST_ID.terminalSpawnError}
      role="alert"
    >
      <p className="text-sm text-error">
        {message ?? 'Failed to start the terminal for this chat.'}
      </p>
      <button
        type="button"
        className="h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
        data-testid={TEST_ID.terminalRetry}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  )
}

/**
 * Chats live under projects (chatsByProject); the selection pairs a project
 * id with a chat id, so lookup stays scoped to the selected project.
 */
function findChat(
  chatsByProject: Record<string, ChatInfo[]>,
  projectId: string,
  chatId: string | null,
): ChatInfo | null {
  if (chatId === null) {
    return null
  }
  return chatsByProject[projectId]?.find((chat) => chat.id === chatId) ?? null
}

/** Whether a chat id still exists in any project's chat list. */
function chatExists(chatsByProject: Record<string, ChatInfo[]>, chatId: string): boolean {
  return Object.values(chatsByProject).some((chats) => chats.some((chat) => chat.id === chatId))
}
