import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBottomTabId } from '../../shared/bottom-tab-id'
import type {
  ActionControl,
  ActionExecution,
  ChatInfo,
  FileEntry,
  ProjectInfo,
} from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../shared/ipc-error'
import { ActionBar } from './components/actions/ActionBar'
import { ActionSettings } from './components/actions/ActionSettings'
import { HandoffPicker } from './components/actions/HandoffPicker'
import { FilePreview } from './components/files/FilePreview'
import { emptyProjectFilesSession, type ProjectFilesSession } from './components/files/files-types'
import { ProjectFilesPanel } from './components/files/ProjectFilesPanel'
import { AppBrand } from './components/layout/AppBrand'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { StatusBar } from './components/layout/StatusBar'
import { AppSettings } from './components/settings/AppSettings'
import { TabStrip } from './components/tabs/TabStrip'
import {
  activateTab,
  closeFileTab,
  emptyTabsSession,
  openFileTab,
  type ProjectTabsSession,
  type TabId,
  TERMINAL_TAB,
} from './components/tabs/tabs-session'
import { BottomPanel } from './components/terminal/BottomPanel'
import { isBottomPanelChord } from './components/terminal/bottom-panel-chord'
import {
  addBottomTab,
  allBottomTabs,
  type BottomTab,
  type BottomTabsState,
  closeBottomTab,
  dropBottomProject,
  emptyBottomTabs,
  markBottomTabError,
  retryBottomTab,
  selectBottomTab,
} from './components/terminal/bottom-tabs'
import { chatSwitchDirection } from './components/terminal/chat-switch-chord'
import { ChatWorkspace } from './components/workspace/ChatWorkspace'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  useResizableRegion,
} from './hooks/useResizableRegion'
import { Icon } from './lib/icons'
import { writeSubmitLine } from './lib/pty-submit'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  parseTerminalFontSize,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
} from './lib/terminal-font'
import { TEST_ID, testIdFor } from './lib/test-ids'
import { isThemeId, THEME_STORAGE_KEY, type ThemeId } from './lib/theme'

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

// True when the element can take focus. `display: none` on an ancestor (a
// chat switch, or the chat surface under a file tab) leaves the node
// connected, but focus() does not make it document.activeElement.
function isRenderedElement(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false
  }
  let current: HTMLElement | null = element
  while (current !== null) {
    if (current.hidden) {
      return false
    }
    const style = window.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false
    }
    current = current.parentElement
  }
  return true
}

/** Whether a chat id still exists in any project's chat list. */
function chatExistsIn(chatsByProject: Record<string, ChatInfo[]>, chatId: string): boolean {
  return Object.values(chatsByProject).some((chats) => chats.some((chat) => chat.id === chatId))
}

// A chats:list response is a snapshot that can predate mutations the renderer
// already applied: a concurrent create lands after the snapshot was taken, a
// close lands before a response that still carries the chat. Replacing the
// known list with such a snapshot transiently drops a chat whose session view
// is alive (the ChatWorkspace eviction effect then disposes its xterm and
// scrollback) or resurrects a closed chat. Merge instead: fetched entries
// update their id in place, known entries the snapshot predates are kept, and
// tombstoned ids (closed by this renderer in this session) never come back.
function mergeFetchedChats(
  known: ChatInfo[],
  fetched: ChatInfo[],
  removedChatIds: ReadonlySet<string>,
): ChatInfo[] {
  const byId = new Map(known.map((chat) => [chat.id, chat] as const))
  for (const chat of fetched) {
    byId.set(chat.id, chat)
  }
  for (const chatId of removedChatIds) {
    byId.delete(chatId)
  }
  return [...byId.values()]
}

export function App({ app = window.app }: { app?: typeof window.app }): React.JSX.Element {
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [themeState, setThemeState] = useState<{ theme: ThemeId; error: string | null }>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      return { theme: isThemeId(saved) ? saved : 'default', error: null }
    } catch {
      return { theme: 'default', error: 'Failed to load the saved theme.' }
    }
  })
  const [terminalFontSize, setTerminalFontSize] = useState<number>(() => {
    try {
      return parseTerminalFontSize(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY))
    } catch {
      return DEFAULT_TERMINAL_FONT_SIZE
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = themeState.theme
  }, [themeState.theme])

  function handleThemeChange(theme: ThemeId): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
      setThemeState({ theme, error: null })
    } catch {
      setThemeState((previous) => ({ ...previous, error: 'Failed to save the theme.' }))
    }
  }

  function handleTerminalFontSizeChange(size: number): void {
    setTerminalFontSize(size)
    try {
      localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, String(size))
    } catch {
      // The live terminals keep the new size; persistence is best effort.
    }
  }

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
  const [actions, setActions] = useState<ActionControl[]>([])
  const [actionSettingsOpen, setActionSettingsOpen] = useState(false)
  const [actionSettingsProjectId, setActionSettingsProjectId] = useState<string | null>(null)
  // Handoff/Resume delivery (spec handoff-resume-flow): auto-send default off
  // (paste into the prompt input), the setting is application-global.
  const [autoSendHandoff, setAutoSendHandoff] = useState(false)
  // Ctrl+Tab chat switching (NEKODE-2): enabled unless explicitly turned off.
  const [chatSwitchEnabled, setChatSwitchEnabled] = useState(true)
  const [handoffPickerOpen, setHandoffPickerOpen] = useState(false)
  // Pending prompt-input fill addressed to one chat (paste-only delivery).
  const [promptInjection, setPromptInjection] = useState<{
    chatId: string
    text: string
    nonce: number
  } | null>(null)
  const promptInjectionNonceRef = useRef(0)
  const [liveChatIds, setLiveChatIds] = useState<ReadonlySet<string>>(new Set())
  const [terminalCwds, setTerminalCwds] = useState<Record<string, string>>({})
  const pendingTerminalCommandsRef = useRef<Record<string, string>>({})
  // Bottom-terminal action commands waiting for their new tab's terminal to
  // become ready. Keyed by bottom tab id; consumed exactly once (AC10).
  const pendingBottomCommandsRef = useRef<Record<string, string>>({})
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)
  const [bottomOpen, setBottomOpen] = useState(false)
  const [bottomTabs, setBottomTabs] = useState<BottomTabsState>(emptyBottomTabs)
  // Project Files mode (spec Behaviour 1–2, 12): the project whose tree is
  // shown in the left panel, or null for the Projects/Chats navigation. The
  // mode never touches the chat/project selection and no longer swaps the
  // center surface (the back affordance keeps the tab strip and the active tab).
  // Per-project tree state lives in filesSessions for the app session only
  // (Behaviour 14).
  const [filesProjectId, setFilesProjectId] = useState<string | null>(null)
  // True only right after leaving Project Files: the returning Projects list
  // replays the files panel's slide (user decision 2026-09-29, round 8).
  const [navSlideIn, setNavSlideIn] = useState(false)
  const [filesSessions, setFilesSessions] = useState<Record<string, ProjectFilesSession>>({})
  // Per-project tab-strip sessions (center-layout-tabs-actions spec
  // Behaviour 3–5): open file tabs in open order, the active tab and the
  // previously active tab. Per-session UI state — never persisted.
  const [tabsByProject, setTabsByProject] = useState<Record<string, ProjectTabsSession>>({})
  // Projects removed in this session: pending chat loads for them are stale.
  const removedProjectIdsRef = useRef<Set<string>>(new Set())
  // Chats closed by explicit close flows in this session: fetched lists can
  // predate the close, and mergeFetchedChats must not resurrect them. Chat
  // ids are unique per database row, so they never legitimately return.
  const removedChatIdsRef = useRef<Set<string>>(new Set())
  // Overlapping removals of one id. One success keeps the tombstone; it is
  // cleared only when every in-flight attempt has failed.
  const projectRemovalsRef = useRef(new Map<string, { pending: number; succeeded: boolean }>())
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
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const bottomOpenRef = useRef(bottomOpen)
  bottomOpenRef.current = bottomOpen
  const bottomOpenTouchedRef = useRef(false)
  const bottomTabsRef = useRef(bottomTabs)
  bottomTabsRef.current = bottomTabs
  const tabProjectIdRef = useRef<string | null>(null)
  const focusBeforeOpenRef = useRef<HTMLElement | null>(null)
  const centerSurfaceRef = useRef<HTMLElement | null>(null)

  // Single write path for chatsByProject: the mirror and the state are
  // mutated in lockstep so concurrent close flows never act on stale data.
  const applyChatsUpdate = useCallback(
    (updater: (previous: Record<string, ChatInfo[]>) => Record<string, ChatInfo[]>): void => {
      chatsByProjectRef.current = updater(chatsByProjectRef.current)
      setChatsByProject(chatsByProjectRef.current)
    },
    [],
  )

  const refreshActions = useCallback(async (): Promise<void> => {
    setActions(await app.actions.list())
  }, [app])

  useEffect(() => {
    void refreshActions().catch((error: unknown) => {
      setNotice(errorMessage(error, 'Failed to load actions.'))
    })
  }, [refreshActions])

  useEffect(() => {
    let alive = true
    void app.state
      .get(APP_STATE_KEY.autoSendHandoffResume)
      .then((value) => {
        if (alive) setAutoSendHandoff(value === '1')
      })
      .catch((error: unknown) => {
        if (alive) setNotice(errorMessage(error, 'Failed to load settings.'))
      })
    return () => {
      alive = false
    }
  }, [app])

  // Ctrl+Tab chat switch on/off (NEKODE-2): missing or '1' means enabled.
  useEffect(() => {
    let alive = true
    void app.state
      .get(APP_STATE_KEY.chatSwitchEnabled)
      .then((value) => {
        if (alive) setChatSwitchEnabled(value !== '0')
      })
      .catch((error: unknown) => {
        if (alive) setNotice(errorMessage(error, 'Failed to load settings.'))
      })
    return () => {
      alive = false
    }
  }, [app])

  const handleAutoSendChange = useCallback(
    (next: boolean): void => {
      setAutoSendHandoff(next)
      void app.state
        .set(APP_STATE_KEY.autoSendHandoffResume, next ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the setting.'))
        })
    },
    [app],
  )

  const handleChatSwitchChange = useCallback(
    (next: boolean): void => {
      setChatSwitchEnabled(next)
      void app.state
        .set(APP_STATE_KEY.chatSwitchEnabled, next ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the setting.'))
        })
    },
    [app],
  )

  // Handoff/Resume delivery (spec handoff-resume-flow Behaviour 3): auto-send
  // writes the English command plus CR straight to the PTY; the default paste
  // mode fills the addressed chat's prompt input and waits for the user. The
  // CR goes through the split-write helper (lib/pty-submit.ts) — a single
  // `command\r` burst parses as an unterminated bracketed paste in
  // prompt_toolkit agent TUIs (Hermes Agent): text lands in the input box,
  // the CR is swallowed, nothing sends.
  const handlePromptCommand = useCallback(
    (text: string): void => {
      const chatId = selectionRef.current.chatId
      if (chatId === null || !liveChatIds.has(chatId)) return
      if (autoSendHandoff) {
        const appApi = app
        writeSubmitLine((data) => {
          void appApi.terminals.write(chatId, data).catch((error: unknown) => {
            setNotice(errorMessage(error, 'Failed to send the command.'))
          })
        }, text)
        return
      }
      promptInjectionNonceRef.current += 1
      setPromptInjection({ chatId, text, nonce: promptInjectionNonceRef.current })
    },
    [app, autoSendHandoff, liveChatIds],
  )

  const handlePromptInjected = useCallback((nonce: number): void => {
    setPromptInjection((previous) =>
      previous !== null && previous.nonce === nonce ? null : previous,
    )
  }, [])

  const handleSessionStatus = useCallback((chatId: string, live: boolean): void => {
    setLiveChatIds((previous) => {
      const next = new Set(previous)
      if (live) next.add(chatId)
      else next.delete(chatId)
      return next
    })
  }, [])

  const handleSessionReady = useCallback(
    (chatId: string): void => {
      const command = pendingTerminalCommandsRef.current[chatId]
      if (command === undefined) return
      delete pendingTerminalCommandsRef.current[chatId]
      // Split-write submission (lib/pty-submit.ts): the CR must arrive as its
      // own chunk, or prompt_toolkit agent TUIs parse the burst as a paste.
      writeSubmitLine((data) => {
        void app.terminals.write(chatId, data).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to write the action command.'))
        })
      }, command)
    },
    [app],
  )

  // Ready callback for bottom-tab terminals: same delivery contract as chat
  // sessions — the command, then one CR (0x0D) after the submit gap.
  const handleBottomSessionReady = useCallback(
    (tabId: string): void => {
      const command = pendingBottomCommandsRef.current[tabId]
      if (command === undefined) return
      delete pendingBottomCommandsRef.current[tabId]
      writeSubmitLine((data) => {
        void app.terminals.write(tabId, data).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to write the action command.'))
        })
      }, command)
    },
    [app],
  )

  // Startup hydration: real project list, persisted selection (dropped when
  // it no longer matches existing records) and persisted region sizes.
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
        setLeftWidth(parsePersistedSize(savedLeftWidth, LEFT_REGION_SIZE))
        setBottomHeight(parsePersistedSize(savedBottomHeight, BOTTOM_REGION_SIZE))
        // A toggle that landed before hydration wins. Missing or invalid
        // open flag stays hidden (spec Behaviour 2). Tabs are not restored.
        if (!bottomOpenTouchedRef.current) {
          const open = savedBottomOpen === '1'
          bottomOpenRef.current = open
          setBottomOpen(open)
        }

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
        setSelectedChatId(
          savedChat !== null && mergedChats.some((chat) => chat.id === savedChat)
            ? savedChat
            : null,
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

  const persistBottomOpen = useCallback(
    (open: boolean): void => {
      void app.state
        .set(APP_STATE_KEY.bottomRegionOpen, open ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the bottom panel.'))
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
      applyChatsUpdate((previous) => ({
        ...previous,
        [projectId]: mergeFetchedChats(previous[projectId] ?? [], chats, removedChatIdsRef.current),
      }))
      setLoadedChatProjectIds((previous) => new Set(previous).add(projectId))
    },
    [app, applyChatsUpdate],
  )

  // --- Tab strip sessions (spec Behaviour 3–5) ----------------------------

  const updateTabsSession = useCallback(
    (projectId: string, updater: (session: ProjectTabsSession) => ProjectTabsSession): void => {
      setTabsByProject((previous) => ({
        ...previous,
        [projectId]: updater(previous[projectId] ?? emptyTabsSession()),
      }))
    },
    [],
  )

  // The tab strip and the main surface belong to one project at a time: the
  // Files-mode project while its tree is on screen, else the selected one.
  // The active project is this tab-strip project, end to end: the terminal
  // tab, the terminal surface and the status bar follow it. The chat
  // selection points elsewhere only in the reachable Files-mode divergence —
  // a split between two projects (Files action on an unselected project row
  // while a chat selection is active; Behaviour 19 unchanged). There the
  // surface shows the Behaviour 2 empty state whose `Start new chat` creates
  // in the tab-strip project (see handleStartNewChat). With no selection at
  // all there is no split: the neutral surfaces stay as today.
  const tabProjectId = filesProjectId ?? selectedProjectId
  tabProjectIdRef.current = tabProjectId
  const chatSurfaceDiverged = selectedProjectId !== null && selectedProjectId !== tabProjectId

  const handleSelectTab = useCallback(
    (tab: TabId): void => {
      if (tabProjectId === null) {
        return
      }
      updateTabsSession(tabProjectId, (session) => activateTab(session, tab))
    },
    [tabProjectId, updateTabsSession],
  )

  const handleCloseFileTab = useCallback(
    (relativePath: string): void => {
      if (tabProjectId === null) {
        return
      }
      updateTabsSession(tabProjectId, (session) => closeFileTab(session, relativePath))
    },
    [tabProjectId, updateTabsSession],
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
      // Selecting a chat shows its terminal: the terminal-chat tab becomes
      // the active tab of the chat's project (Behaviour 2).
      updateTabsSession(projectId, (session) => activateTab(session, TERMINAL_TAB))
    },
    [persistSelection, updateTabsSession],
  )

  // Ctrl+Tab / Ctrl+Shift+Tab chat switching within the active project
  // (NEKODE-2). The switcher reuses the full select path, so persistence,
  // nonce and tab activation behave exactly like a click on the chat row.
  const handleSwitchChat = useCallback(
    (direction: 1 | -1): void => {
      const projectId = selectionRef.current.projectId
      if (projectId === null) {
        return
      }
      const chats = chatsByProjectRef.current[projectId]
      if (chats === undefined || chats.length === 0) {
        return
      }
      const currentId = selectionRef.current.chatId
      const currentIndex =
        currentId === null ? -1 : chats.findIndex((chat) => chat.id === currentId)
      const base = currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex
      const next = chats[(base + direction + chats.length) % chats.length]
      handleSelectChat(projectId, next.id)
    },
    [handleSelectChat],
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
        projectRemovalsRef.current.delete(project.id)
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

  // Open in file explorer (context menu): the OS file manager on the
  // registered project root. Failures surface as notices, the selection and
  // project data stay untouched.
  const handleOpenInFileExplorer = useCallback(
    (projectId: string): void => {
      void app.files.openRoot(projectId).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to open the project directory.'))
      })
    },
    [app],
  )

  const handleRemoveProject = useCallback(
    (projectId: string): void => {
      setNotice(null)
      void (async () => {
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
        const bottomIds =
          bottomTabsRef.current.byProject[projectId]?.tabs.map((tab) => tab.id) ?? []
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
        // tab-strip session (tabs are per-project, spec Behaviour 5), and
        // leave Project Files mode if its tree is on screen.
        setFilesSessions((previous) => {
          if (!(projectId in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[projectId]
          return next
        })
        setTabsByProject((previous) => {
          if (!(projectId in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[projectId]
          return next
        })
        setFilesProjectId((current) => (current === projectId ? null : current))
        // The removal succeeded: those tabs are gone and their staged
        // bottom-terminal commands can never be delivered (review follow-up:
        // same leak class as the close/exit paths).
        for (const tabId of bottomIds) {
          delete pendingBottomCommandsRef.current[tabId]
        }
        setBottomTabs((previous) => dropBottomProject(previous, projectId))
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
        try {
          await refreshActions()
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to load actions.'))
        }
      })()
    },
    [app, applyChatsUpdate, persistSelection, refreshActions, selectedProjectId],
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
          // the back affordance always exits the mode.
          updateFilesSession(projectId, (session) => ({
            ...session,
            treeError: errorMessage(error, 'Failed to load project files.'),
          }))
        })
    },
    [app, updateFilesSession],
  )

  // Entering the mode is per project and idempotent (spec Behaviour 4): the
  // retained expansion state and open file tabs survive the round-trip.
  const handleOpenProjectFiles = useCallback(
    (projectId: string): void => {
      setNotice(null)
      setNavSlideIn(false)
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
    setNavSlideIn(true)
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

  // Clicking a file in the tree opens its tab, or focuses it when already
  // open — a file never has two tabs (spec Behaviour 3).
  const handleFilesSelectFile = useCallback(
    (relativePath: string): void => {
      if (filesProjectId === null) {
        return
      }
      const projectId = filesProjectId
      updateFilesSession(projectId, (session) => ({ ...session, selectedPath: relativePath }))
      updateTabsSession(projectId, (session) => openFileTab(session, relativePath))
    },
    [filesProjectId, updateFilesSession, updateTabsSession],
  )

  // Failed "Open externally" (spec Errors): a notice, never a silent drop.
  const handleFilesOpenExternalError = useCallback((message: string): void => {
    setNotice(message)
  }, [])

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
          updateTabsSession(projectId, (session) => activateTab(session, TERMINAL_TAB))
          return true
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to create the chat.'))
          return false
        }
      })()
    },
    [app, applyChatsUpdate, persistSelection, updateTabsSession],
  )

  // `+ New chat` (spec Behaviour 8): the existing new-chat flow unchanged —
  // immediate creation in the active project, shell display name, chat
  // selected and its terminal shown.
  const handleTabNewChat = useCallback((): void => {
    if (tabProjectId === null) {
      // The control is always present (Behaviour 8); with no active project
      // the flow cannot run, so the dead click is noticed, not swallowed.
      setNotice('Select or add a project before starting a new chat.')
      return
    }
    void handleCreateChat(tabProjectId)
  }, [handleCreateChat, tabProjectId])

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
        // Tombstone before the map removal: fetched lists still in flight can
        // predate this close, and mergeFetchedChats must not resurrect it.
        removedChatIdsRef.current.add(chatId)
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
  // immediately for the tab-strip project (spec Behaviour 3 — no naming
  // form). In the Files-mode divergence this creates in the tab-strip
  // project; handleCreateChat adopts the selection to the created chat's
  // project, which dissolves the divergence.
  const handleStartNewChat = useCallback((): void => {
    if (tabProjectId !== null) {
      void handleCreateChat(tabProjectId)
    }
  }, [handleCreateChat, tabProjectId])

  const createBottomTab = useCallback(
    async (projectId: string, options?: { tabId?: string; cwd?: string }): Promise<void> => {
      const tabId = options?.tabId
      const dropStagedCommand = (): void => {
        // An aborted creation leaves a staged bottom-terminal command that can
        // never be delivered (review:4 follow-up); a completed creation keeps
        // it — the tab's ready event consumes it.
        if (tabId !== undefined) {
          delete pendingBottomCommandsRef.current[tabId]
        }
      }
      if (removedProjectIdsRef.current.has(projectId)) {
        dropStagedCommand()
        return
      }
      const project = projectsRef.current.find((item) => item.id === projectId)
      if (project === undefined) {
        dropStagedCommand()
        setNotice('Select or add a project before starting a terminal.')
        return
      }
      let label: string
      try {
        label = (await app.terminals.shellName()).trim()
      } catch (error) {
        if (removedProjectIdsRef.current.has(projectId)) {
          dropStagedCommand()
          return
        }
        dropStagedCommand()
        setNotice(errorMessage(error, 'Failed to start the terminal.'))
        return
      }
      if (removedProjectIdsRef.current.has(projectId)) {
        dropStagedCommand()
        return
      }
      if (label.length === 0) {
        dropStagedCommand()
        setNotice('Failed to start the terminal.')
        return
      }
      const tab: BottomTab = {
        id: options?.tabId ?? createBottomTabId(projectId),
        projectId,
        label,
        cwd: options?.cwd ?? project.path,
        generation: 0,
        status: 'running',
        errorMessage: null,
      }
      setBottomTabs((previous) => {
        if (removedProjectIdsRef.current.has(projectId)) {
          // The tombstone check drops the tab here; its staged command (if a
          // bottom-terminal action staged one) must not survive either.
          if (tabId !== undefined) {
            delete pendingBottomCommandsRef.current[tabId]
          }
          return previous
        }
        return addBottomTab(previous, tab)
      })
    },
    [app],
  )

  const handleNewBottomTerminal = useCallback((): void => {
    const projectId = tabProjectIdRef.current
    if (projectId === null) {
      setNotice('Select or add a project before starting a terminal.')
      return
    }
    setNotice(null)
    void createBottomTab(projectId)
  }, [createBottomTab])

  const handleCloseBottomTab = useCallback(
    (tabId: string): void => {
      void (async () => {
        try {
          await app.terminals.terminate(tabId)
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to close the terminal.'))
          return
        }
        delete pendingBottomCommandsRef.current[tabId]
        setBottomTabs((previous) => closeBottomTab(previous, tabId))
      })()
    },
    [app],
  )

  const handleBottomExit = useCallback(
    (tabId: string): void => {
      // The tab is gone: its staged bottom-terminal command must not linger
      // (review:4 follow-up). A spawn failure keeps the entry — the retry
      // remount fires a fresh ready event that must still deliver it.
      delete pendingBottomCommandsRef.current[tabId]
      setBottomTabs((previous) => closeBottomTab(previous, tabId))
      void app.terminals.terminate(tabId).catch(() => undefined)
    },
    [app],
  )

  const hideBottomPanel = useCallback((): void => {
    bottomOpenTouchedRef.current = true
    bottomOpenRef.current = false
    setBottomOpen(false)
    persistBottomOpen(false)
    const previous = focusBeforeOpenRef.current
    focusBeforeOpenRef.current = null
    queueMicrotask(() => {
      if (previous?.isConnected) {
        previous.focus()
      }
      if (
        previous === null ||
        !previous.isConnected ||
        !isRenderedElement(previous) ||
        document.activeElement !== previous
      ) {
        centerSurfaceRef.current?.focus()
      }
    })
  }, [persistBottomOpen])

  const showBottomPanel = useCallback((): void => {
    const active = document.activeElement
    focusBeforeOpenRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null
    bottomOpenTouchedRef.current = true
    bottomOpenRef.current = true
    setBottomOpen(true)
    persistBottomOpen(true)
    const projectId = tabProjectIdRef.current
    if (projectId === null) {
      return
    }
    const session = bottomTabsRef.current.byProject[projectId]
    if (session !== undefined && session.tabs.length > 0) {
      return
    }
    void createBottomTab(projectId)
  }, [createBottomTab, persistBottomOpen])

  const showBottomRef = useRef(showBottomPanel)
  const hideBottomRef = useRef(hideBottomPanel)
  showBottomRef.current = showBottomPanel
  hideBottomRef.current = hideBottomPanel

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isBottomPanelChord(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      if (bottomOpenRef.current) {
        hideBottomRef.current()
      } else {
        showBottomRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  // Ctrl+Tab / Ctrl+Shift+Tab chat switching (NEKODE-2), capture phase so it
  // wins over focus traversal even inside a focused terminal, and never
  // reaches a PTY (ChatTerminal swallows the chord in its custom key handler).
  const switchChatRef = useRef(handleSwitchChat)
  switchChatRef.current = handleSwitchChat
  const chatSwitchEnabledRef = useRef(chatSwitchEnabled)
  chatSwitchEnabledRef.current = chatSwitchEnabled

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return
      }
      const direction = chatSwitchDirection(event)
      if (direction === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      if (!chatSwitchEnabledRef.current) {
        return
      }
      switchChatRef.current(direction)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

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
  const tabProject =
    tabProjectId === null ? null : (projects.find((project) => project.id === tabProjectId) ?? null)
  const tabsSession =
    tabProjectId === null ? emptyTabsSession() : (tabsByProject[tabProjectId] ?? emptyTabsSession())
  const activeTab = tabsSession.active
  // The terminal-chat tab shows the active chat's name only while the active
  // chat belongs to the tab-strip project (Behaviour 2); in the Files-mode
  // divergence the strip never labels itself with another project's chat.
  const activeChat =
    selectedProject !== null && selectedProjectId === tabProjectId
      ? (chatsByProject[selectedProject.id]?.find((chat) => chat.id === selectedChatId) ?? null)
      : null
  // The status bar context is the tab-strip project (AC9). The former
  // `?? selectedProject` fallback is dead: tabProjectId always covers
  // selectedProjectId (filesProjectId ?? selectedProjectId).
  const statusProject = tabProject

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

  // Bottom-terminal delivery (bottom-auxiliary-terminal spec Behaviour 16–18):
  // the execution addresses a brand-new bottom tab id. The panel opens if
  // hidden (plain open: no chord auto-tab, so exactly one new tab lands per
  // execution), the tab is added to the tab-strip project (never a chat,
  // never a selection change), and the command plus CR (0x0D) is written once
  // that tab's terminal view is subscribed and ready
  // (handleBottomSessionReady).
  const handleBottomTerminalAction = useCallback(
    (execution: ActionExecution, projectId: string): void => {
      const tabId = execution.bottomTabId
      const command = execution.terminalCommand
      const cwd = execution.terminalCwd
      if (tabId === undefined || command === undefined || cwd === undefined) return
      pendingBottomCommandsRef.current[tabId] = command
      if (!bottomOpenRef.current) {
        // Same focus contract as showBottomPanel (Behaviour 4): remember what
        // held focus before the hidden panel opened, so a later hide restores
        // focus there instead of falling back to the center surface.
        const active = document.activeElement
        focusBeforeOpenRef.current =
          active instanceof HTMLElement && active !== document.body ? active : null
        bottomOpenTouchedRef.current = true
        bottomOpenRef.current = true
        setBottomOpen(true)
        persistBottomOpen(true)
      }
      void createBottomTab(projectId, { tabId, cwd })
    },
    [createBottomTab, persistBottomOpen],
  )

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-app text-ink antialiased"
      data-testid={TEST_ID.appShell}
    >
      {/* Window title bar (user decision 2026-10-01): one continuous
          full-width drag strip; the brand on the left, Windows caption
          buttons overlay the top-right corner. Tab strip and panel headers
          sit one level below. */}
      <div className="drag-region flex h-10 shrink-0 items-center bg-app px-4">
        <AppBrand />
        <button
          type="button"
          aria-label="App Settings"
          title="App Settings"
          className="no-drag ml-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info"
          onClick={() => setAppSettingsOpen(true)}
        >
          <Icon.settings size={16} aria-hidden />
        </button>
      </div>
      {/* The hairline under the title bar is owned by the content row
          (border-t, design doc 26.2 convention), not by the strip itself. */}
      <div className="flex min-h-0 flex-1 border-t border-edge">
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
            slideIn={navSlideIn}
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
            onOpenInFileExplorer={handleOpenInFileExplorer}
            onOpenProjectSettings={(projectId) => {
              setActionSettingsProjectId(projectId)
              setActionSettingsOpen(true)
            }}
            onCreateChat={handleCreateChat}
            notice={notice}
          />
        )}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-app">
          {/* Center column (spec Behaviour 1): tab strip, reserved action-row
              slot, main surface. No window-top band and no context header.
              Raised above the sliding left panel (transform creates a stacking
              context that would otherwise paint over this column): the panel
              emerges from under the middle panel, never over it. */}
          <TabStrip
            chatName={activeChat?.name ?? null}
            openFiles={tabsSession.openFiles}
            projectRoot={tabProject?.path ?? null}
            active={activeTab}
            onSelectTab={handleSelectTab}
            onCloseFile={handleCloseFileTab}
            onNewChat={handleTabNewChat}
          />
          <ActionBar
            app={app}
            actions={actions}
            projectId={tabProjectId}
            activeChatId={activeChat?.id ?? null}
            chatIsLive={activeChat !== null && liveChatIds.has(activeChat.id)}
            onNewTerminal={handleNewTerminalAction}
            onBottomTerminal={handleBottomTerminalAction}
            onPromptCommand={handlePromptCommand}
            onResume={() => {
              if (tabProjectId !== null) {
                setHandoffPickerOpen(true)
              }
            }}
            onError={setNotice}
            onSettings={() => {
              setActionSettingsProjectId(tabProjectId)
              setActionSettingsOpen(true)
            }}
          />
          <main
            ref={centerSurfaceRef}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            data-testid={TEST_ID.centerSurface}
          >
            {/* Every open file tab owns its preview view (hidden while another
                tab is active): per-tab loading/fallback/error state survives
                tab switches and never touches the other tabs (Behaviour 6–7). */}
            {tabProject !== null
              ? tabsSession.openFiles.map((path) => (
                  <div
                    key={path}
                    className="flex min-h-0 flex-1 flex-col"
                    style={{
                      display:
                        activeTab.kind === 'file' && activeTab.path === path ? 'flex' : 'none',
                    }}
                    data-testid={testIdFor.filePreviewPane(path)}
                  >
                    <FilePreview
                      app={app}
                      projectId={tabProject.id}
                      relativePath={path}
                      onOpenExternalError={handleFilesOpenExternalError}
                    />
                  </div>
                ))
              : null}
            {/* Chat sessions stay mounted (hidden) while a file tab is active:
                PTY processes and xterm scrollback survive tab switches and
                mode round-trips (spec Behaviour 6 / AC2, AC11). In the
                Files-mode divergence no active chat belongs to the tab-strip
                project: the surface shows the Behaviour 2 empty state, never
                another project's terminal. */}
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ display: activeTab.kind === 'terminal' ? 'flex' : 'none' }}
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
                selectedChatId={chatSurfaceDiverged ? null : selectedChatId}
                selectionNonce={selectionNonce}
                forceStartNewChat={chatSurfaceDiverged}
                terminalCwds={terminalCwds}
                terminalFontSize={terminalFontSize}
                onSessionStatus={handleSessionStatus}
                onSessionReady={handleSessionReady}
                onChatClosed={handleChatClosed}
                onStartNewChat={handleStartNewChat}
                promptInjection={promptInjection}
                onPromptInjected={handlePromptInjected}
              />
            </div>
          </main>
        </div>
        {/* Right region is a real five-region sibling (SDD §7), hidden by default. */}
        <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
          Right Panel
        </div>
      </div>
      {appSettingsOpen ? (
        <AppSettings
          theme={themeState.theme}
          chatSwitch={chatSwitchEnabled}
          error={themeState.error}
          onThemeChange={handleThemeChange}
          onChatSwitchChange={handleChatSwitchChange}
          terminalFontSize={terminalFontSize}
          onTerminalFontSizeChange={handleTerminalFontSizeChange}
          onClose={() => setAppSettingsOpen(false)}
        />
      ) : null}
      {actionSettingsOpen ? (
        <ActionSettings
          app={app}
          actions={actions}
          projectId={actionSettingsProjectId}
          projectPath={
            actionSettingsProjectId === null
              ? null
              : (projects.find((project) => project.id === actionSettingsProjectId)?.path ?? null)
          }
          autoSend={autoSendHandoff}
          onAutoSendChange={handleAutoSendChange}
          onRefresh={refreshActions}
          onClose={() => setActionSettingsOpen(false)}
        />
      ) : null}
      {handoffPickerOpen && tabProjectId !== null ? (
        <HandoffPicker
          app={app}
          projectId={tabProjectId}
          onPick={handlePromptCommand}
          onConfigure={() => {
            setHandoffPickerOpen(false)
            setActionSettingsProjectId(tabProjectId)
            setActionSettingsOpen(true)
          }}
          onClose={() => setHandoffPickerOpen(false)}
        />
      ) : null}
      <BottomPanel
        app={app}
        open={bottomOpen}
        height={bottomHeight}
        activeProjectId={tabProjectId}
        tabs={allBottomTabs(bottomTabs)}
        terminalFontSize={terminalFontSize}
        activeTabId={
          tabProjectId === null ? null : (bottomTabs.byProject[tabProjectId]?.activeId ?? null)
        }
        onNewTerminal={handleNewBottomTerminal}
        onSelectTab={(tabId) => {
          if (tabProjectId !== null) {
            setBottomTabs((previous) => selectBottomTab(previous, tabProjectId, tabId))
          }
        }}
        onCloseTab={handleCloseBottomTab}
        onExit={handleBottomExit}
        onSessionReady={handleBottomSessionReady}
        onSpawnError={(tabId, message) => {
          setBottomTabs((previous) => markBottomTabError(previous, tabId, message))
        }}
        onRetry={(tabId) => {
          setBottomTabs((previous) => retryBottomTab(previous, tabId))
        }}
        onResizeStart={bottomRegion.startResize}
        onResizeNudge={bottomRegion.nudge}
      />
      {/* Status bar: the very bottom of the window, full width (spec
          Behaviour 18). */}
      <StatusBar app={app} project={statusProject} />
    </div>
  )
}

export default App
