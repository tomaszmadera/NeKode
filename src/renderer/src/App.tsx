import { createBottomTabId } from '@shared/bottom-tab-id'
import type {
  ActionControl,
  ActionExecution,
  AgentProfilesDocument,
  ChatInfo,
  FileEntry,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  ProjectInfo,
  SessionTaskProgress,
  TaskProgressSnapshot,
  WorkItem,
} from '@shared/ipc-contract'
import {
  APP_STATE_KEY,
  LOCAL_FILE_ADAPTER_ID,
  projectColorKey,
  projectKanbanAdapterKey,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ActionBar } from './components/actions/ActionBar'
import { ActionSettings, type SettingsTabId } from './components/actions/ActionSettings'
import { HandoffPicker } from './components/actions/HandoffPicker'
import { emptyProjectFilesSession, type ProjectFilesSession } from './components/files/files-types'
import {
  DEFAULT_MARKDOWN_VIEW,
  isMarkdownPath,
  type MarkdownViewMode,
  markdownViewKey,
} from './components/files/markdown-path'
import { ProjectFilesPanel } from './components/files/ProjectFilesPanel'
import { applyDirectoryRefresh } from './components/files/tree-refresh'
import type { HeldLaunch } from './components/kanban/held-launch'
import type { KanbanToolbarControls } from './components/kanban/KanbanBoard'
import { KanbanSessions } from './components/kanban/KanbanSessions'
import { TaskResumeModal } from './components/kanban/TaskResumeModal'
import { TaskStartModal } from './components/kanban/TaskStartModal'
import { AddProject } from './components/layout/AddProject'
import { AppBrand } from './components/layout/AppBrand'
import { ConfirmDialog } from './components/layout/ConfirmDialog'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { LeftPanelTrack } from './components/layout/LeftPanelTrack'
import { PanelFooter } from './components/layout/PanelFooter'
import { StatusBar } from './components/layout/StatusBar'
import { AppSettings } from './components/settings/AppSettings'
import { CenterTabs, homeTabStateFor } from './components/tabs/CenterTabs'
import { absoluteFilePath } from './components/tabs/TabStrip'
import {
  activateTab,
  closeFileTab,
  emptyTabsSession,
  KANBAN_TAB,
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
import { UsageToolbar } from './components/usage/UsageToolbar'
import { ChatWorkspace } from './components/workspace/ChatWorkspace'
import { useDesktopDictation } from './hooks/useDesktopDictation'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  useResizableRegion,
} from './hooks/useResizableRegion'
import {
  ATTENTION_SETTING_KEYS,
  type AttentionSettings,
  DEFAULT_ATTENTION_SETTINGS,
  parseAttentionSettings,
} from './lib/attention-settings'
import type { ChatAttention } from './lib/chat-attention'
import { isNewChatChord } from './lib/new-chat-chord'
import { getProjectColor } from './lib/project-avatar'
import { writeSubmitLine } from './lib/pty-submit'
import { sessionTaskProgress } from './lib/task-progress'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  parseTerminalFontFamilies,
  parseTerminalFontSize,
  TERMINAL_FONT_FAMILIES_STORAGE_KEY,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  type TerminalFontFamilies,
} from './lib/terminal-font'
import { TERMINAL_CTRL_V_PASTE_STORAGE_KEY } from './lib/terminal-paste'
import { TEST_ID, testIdFor } from './lib/test-ids'
import {
  DEFAULT_THEME_ID,
  QUICK_THEME_SWITCH_STORAGE_KEY,
  resolveStoredThemeId,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
} from './lib/theme'

// Re-exported so existing imports keep working; the definitions live in
// lib/test-ids.ts to break the App ↔ component import cycle.
export { TEST_ID, testIdFor } from './lib/test-ids'

/** Selection/state values are cleared by writing an empty string (A5). */
function normalizeStoredId(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null
}

const MASCOT_VISIBLE_STORAGE_KEY = 'nekode.mascot-visible.v1'

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
  const desktopDictation = useDesktopDictation(app)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [appSettingsUpdate, setAppSettingsUpdate] = useState(false)
  const [appSettingsUsage, setAppSettingsUsage] = useState(false)
  const [usageVersion, setUsageVersion] = useState(0)
  // Global `Show usage quota` switch (spec rule 1), off until main reports it on. A failed read
  // keeps the button hidden; Usage settings shows the error when it loads the switch.
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
  const [appSettingsAgents, setAppSettingsAgents] = useState(false)
  const [mascotState, setMascotState] = useState<{ visible: boolean; error: string | null }>(() => {
    try {
      return { visible: localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY) !== '0', error: null }
    } catch {
      return { visible: true, error: 'Failed to load the mascot setting.' }
    }
  })

  function handleToggleMascot(): void {
    const visible = !mascotState.visible
    try {
      localStorage.setItem(MASCOT_VISIBLE_STORAGE_KEY, visible ? '1' : '0')
      setMascotState({ visible, error: null })
    } catch {
      setMascotState({ visible, error: 'Failed to save the mascot setting.' })
    }
  }
  const [agentLibraryRefreshKey, setAgentLibraryRefreshKey] = useState(0)
  const [themeState, setThemeState] = useState<{ theme: ThemeId; error: string | null }>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      return { theme: resolveStoredThemeId(saved), error: null }
    } catch {
      return { theme: DEFAULT_THEME_ID, error: 'Failed to load the saved theme.' }
    }
  })
  const [quickThemeSwitchState, setQuickThemeSwitchState] = useState<{
    enabled: boolean
    error: string | null
  }>(() => {
    try {
      return {
        enabled: localStorage.getItem(QUICK_THEME_SWITCH_STORAGE_KEY) === '1',
        error: null,
      }
    } catch {
      return { enabled: false, error: 'Failed to load the quick theme switch setting.' }
    }
  })
  const [terminalFontSize, setTerminalFontSize] = useState<number>(() => {
    try {
      return parseTerminalFontSize(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY))
    } catch {
      return DEFAULT_TERMINAL_FONT_SIZE
    }
  })
  const [terminalFontSizeError, setTerminalFontSizeError] = useState<string | null>(null)
  const [terminalFontState, setTerminalFontState] = useState<{
    families: TerminalFontFamilies
    error: string | null
  }>(() => {
    try {
      return {
        families: parseTerminalFontFamilies(
          localStorage.getItem(TERMINAL_FONT_FAMILIES_STORAGE_KEY),
        ),
        error: null,
      }
    } catch {
      return {
        families: DEFAULT_TERMINAL_FONT_FAMILIES,
        error: 'Failed to load the saved terminal fonts.',
      }
    }
  })

  function handleTerminalFontFamiliesChange(families: TerminalFontFamilies): void {
    try {
      localStorage.setItem(TERMINAL_FONT_FAMILIES_STORAGE_KEY, JSON.stringify(families))
      setTerminalFontState({ families, error: null })
    } catch {
      setTerminalFontState((previous) => ({
        ...previous,
        error: 'Failed to save the terminal fonts.',
      }))
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeState.theme
  }, [themeState.theme])

  const [terminalPasteState, setTerminalPasteState] = useState<{
    enabled: boolean
    error: string | null
  }>(() => {
    try {
      return {
        enabled: localStorage.getItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY) !== '0',
        error: null,
      }
    } catch {
      return { enabled: true, error: 'Failed to load the saved terminal paste setting.' }
    }
  })

  function handleTerminalCtrlVPasteChange(enabled: boolean): void {
    try {
      localStorage.setItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY, enabled ? '1' : '0')
      setTerminalPasteState({ enabled, error: null })
    } catch {
      setTerminalPasteState({ enabled, error: 'Failed to save the terminal paste setting.' })
    }
  }

  function handleThemeChange(theme: ThemeId): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
      setThemeState({ theme, error: null })
    } catch {
      setThemeState((previous) => ({ ...previous, error: 'Failed to save the theme.' }))
    }
  }

  function handleQuickThemeSwitchChange(enabled: boolean): void {
    try {
      localStorage.setItem(QUICK_THEME_SWITCH_STORAGE_KEY, enabled ? '1' : '0')
      setQuickThemeSwitchState({ enabled, error: null })
    } catch {
      setQuickThemeSwitchState((previous) => ({
        ...previous,
        error: 'Failed to save the quick theme switch setting.',
      }))
    }
  }

  function handleTerminalFontSizeChange(size: number): void {
    try {
      localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, String(size))
      setTerminalFontSize(size)
      setTerminalFontSizeError(null)
    } catch {
      setTerminalFontSizeError('Failed to save the terminal font size.')
    }
  }

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [chatsByProject, setChatsByProject] = useState<Record<string, ChatInfo[]>>({})
  const [taskSnapshots, setTaskSnapshots] = useState<Record<string, TaskProgressSnapshot>>({})
  const sessionTasks = useMemo(() => {
    const progress: Record<string, SessionTaskProgress> = {}
    for (const chats of Object.values(chatsByProject)) {
      for (const chat of chats) {
        const task = sessionTaskProgress(chat, taskSnapshots[chat.projectId])
        if (task !== undefined) progress[chat.id] = task
      }
    }
    return progress
  }, [chatsByProject, taskSnapshots])
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
  // Tab the Project Settings dialog opens on. Only the board's Configure
  // button sets 'kanban'; every other opener resets it to the Shell default
  // (the dialog remounts per open, so the initial value is read fresh).
  const [actionSettingsTab, setActionSettingsTab] = useState<SettingsTabId>('shell')
  // Handoff/Resume delivery (spec handoff-resume-flow): auto-send default off
  // (paste into the prompt input), the setting is application-global.
  const [autoSendHandoff, setAutoSendHandoff] = useState(false)
  // Ctrl+Tab chat switching (NEKODE-2): enabled unless explicitly turned off.
  const [chatSwitchEnabled, setChatSwitchEnabled] = useState(true)
  const [projectNamesUppercase, setProjectNamesUppercase] = useState(true)
  const projectNamesUppercaseTouchedRef = useRef(false)
  const [showProjectIcons, setShowProjectIcons] = useState(true)
  const showProjectIconsTouchedRef = useRef(false)
  const [projectColors, setProjectColors] = useState<Record<string, string>>({})
  // Attention alert settings (attention-alert-settings spec): all four
  // default on; the persisted off-switches load once and apply live.
  const [attentionSettings, setAttentionSettings] = useState<AttentionSettings>(
    DEFAULT_ATTENTION_SETTINGS,
  )
  const [handoffPickerOpen, setHandoffPickerOpen] = useState(false)
  // Close-chat control on a chat row (user request 2026-10-04): the row's X
  // requests the close; this dialog owns the destructive action.
  const [chatToClose, setChatToClose] = useState<{
    id: string
    name: string
  } | null>(null)
  // Pending prompt-input fill addressed to one chat (paste-only delivery).
  const [promptInjection, setPromptInjection] = useState<{
    chatId: string
    text: string
    nonce: number
  } | null>(null)
  const promptInjectionNonceRef = useRef(0)
  const [liveChatIds, setLiveChatIds] = useState<ReadonlySet<string>>(new Set())
  const [terminalCwds, setTerminalCwds] = useState<Record<string, string>>({})
  // Per-chat attention badges (chat attention badge spec): in-memory for one
  // run (AC8), keyed by chat id, rendered by the left navigation.
  const [chatAttention, setChatAttention] = useState<Record<string, ChatAttention>>({})
  const [chatActivity, setChatActivity] = useState<ReadonlySet<string>>(new Set())
  const pendingTerminalCommandsRef = useRef<Record<string, string>>({})
  // Bottom-terminal action commands waiting for their new tab's terminal to
  // become ready. Keyed by bottom tab id; consumed exactly once (AC10).
  const pendingBottomCommandsRef = useRef<Record<string, string>>({})
  // Pending split-write submissions (lib/pty-submit.ts) waiting for their CR.
  // Keyed by chat id or bottom tab id; cancelled on teardown or when replaced.
  const pendingSubmitCancelsRef = useRef<Record<string, () => void>>({})
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)
  const [bottomOpen, setBottomOpen] = useState(false)
  const [bottomTabs, setBottomTabs] = useState<BottomTabsState>(emptyBottomTabs)
  // Project Files mode (spec Behaviour 1–2, 12): the project whose tree is
  // shown in the left panel, or null for the Projects/Chats navigation. The
  // mode never touches the chat/project selection and no longer swaps the
  // center surface (the back affordance keeps the tab strip and the active tab).
  // Per-project tree state lives in filesSessions for the app session only
  // (Behaviour 14). LeftPanelTrack owns the paired slide between the two views.
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
  // Per-project tab-strip sessions (center-layout-tabs-actions spec
  // Behaviour 3–5): open file tabs in open order, the active tab and the
  // previously active tab. Per-session UI state — never persisted.
  const [tabsByProject, setTabsByProject] = useState<Record<string, ProjectTabsSession>>({})
  // Code or Preview per markdown file for this app session (user decision
  // 2026-10-06). Not written to the database. Preview is the default.
  const [markdownViewByKey, setMarkdownViewByKey] = useState<Record<string, MarkdownViewMode>>({})
  // Projects bound to a task source (project-home spec Behaviour 2): read
  // once per projects change and again when Project Settings closes, through
  // the generic `state:get` on the per-project binding key (no new IPC
  // channel). A bound project's home tab shows the task list; an unbound
  // one's shows the setup welcome. `settledKanbanProjects` marks the
  // projects whose read has finished. `kanbanBindingsError` holds the message
  // of the latest failed read (null after a successful one); the read covers
  // all projects in one batch and fails as a whole, so the error is global.
  const [kanbanProjectIds, setKanbanProjectIds] = useState<ReadonlySet<string>>(new Set())
  // Bound projects whose source is the built-in `local-file` (project-home
  // spec Edge cases: a missing task file offers `Use a local task list`).
  const [localFileProjectIds, setLocalFileProjectIds] = useState<ReadonlySet<string>>(new Set())
  const [settledKanbanProjects, setSettledKanbanProjects] = useState<ReadonlySet<string>>(new Set())
  const [kanbanBindingsError, setKanbanBindingsError] = useState<string | null>(null)
  const kanbanBindingsGeneration = useRef(0)
  const [kanbanVersions, setKanbanVersions] = useState<Record<string, number>>({})
  const [taskStart, setTaskStart] = useState<{
    projectId: string
    item: WorkItem
    draft: boolean
  } | null>(null)
  const [taskResume, setTaskResume] = useState<{ projectId: string; item: WorkItem } | null>(null)
  const [heldLaunches, setHeldLaunches] = useState<Record<string, HeldLaunch>>({})
  const heldLaunchesRef = useRef(heldLaunches)
  heldLaunchesRef.current = heldLaunches
  const retryingLaunchRef = useRef<string | null>(null)
  const [retryingLaunchChatId, setRetryingLaunchChatId] = useState<string | null>(null)
  const invalidateKanban = useCallback((projectId: string | null): void => {
    setKanbanVersions((previous) => {
      const next = { ...previous }
      for (const id of projectId === null ? projectsRef.current.map((p) => p.id) : [projectId]) {
        next[id] = (next[id] ?? 0) + 1
      }
      return next
    })
  }, [])
  const [kanbanToolbarByProject, setKanbanToolbarByProject] = useState<
    Record<string, KanbanToolbarControls | null>
  >({})
  const handleKanbanToolbarControls = useCallback(
    (projectId: string, controls: KanbanToolbarControls | null) => {
      setKanbanToolbarByProject((previous) => {
        if (controls === null) {
          if (previous[projectId] === null || !(projectId in previous)) return previous
          return { ...previous, [projectId]: null }
        }
        const existing = previous[projectId]
        if (
          existing &&
          existing.phase === controls.phase &&
          existing.refreshing === controls.refreshing &&
          existing.isReviewing === controls.isReviewing &&
          existing.creatingBusy === controls.creatingBusy &&
          existing.sortState.sortBy === controls.sortState.sortBy &&
          existing.sortState.direction === controls.sortState.direction &&
          existing.searchQuery === controls.searchQuery
        ) {
          return previous
        }
        return { ...previous, [projectId]: controls }
      })
    },
    [],
  )
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

  // Task-source bindings (project-home spec Behaviour 2): a project is bound
  // when its per-project adapter key holds a value. Read through the generic
  // `state:get` (no new IPC channel); recomputed on every projects-list
  // change and when Project Settings closes, so a bind/unbind switches the
  // home tab between the list and the welcome without a restart.
  const refreshKanbanBindings = useCallback(async (): Promise<void> => {
    const requestGen = ++kanbanBindingsGeneration.current
    const targetProjects = projects
    try {
      const bindings = await Promise.all(
        targetProjects.map(async (project) => ({
          id: project.id,
          adapterId: await app.state.get(projectKanbanAdapterKey(project.id)),
        })),
      )
      if (requestGen !== kanbanBindingsGeneration.current) return
      setKanbanProjectIds(
        new Set(bindings.filter((binding) => binding.adapterId).map((binding) => binding.id)),
      )
      setLocalFileProjectIds(
        new Set(
          bindings
            .filter((binding) => binding.adapterId === LOCAL_FILE_ADAPTER_ID)
            .map((binding) => binding.id),
        ),
      )
      setSettledKanbanProjects(new Set(targetProjects.map((project) => project.id)))
      setKanbanBindingsError(null)
    } catch (error) {
      if (requestGen !== kanbanBindingsGeneration.current) return
      // Shown inline on the home tab (project-home spec Errors), not as the
      // shell notice, which later actions clear.
      setKanbanBindingsError(errorMessage(error, 'Failed to load task sources.'))
    }
  }, [app, projects])

  useEffect(() => {
    void refreshKanbanBindings()
  }, [refreshKanbanBindings])

  // `Use a local task list` (project-home spec Behaviour 7): main creates the
  // task file when absent and binds `local-file`; the binding re-read then
  // switches the home tab to the list. A rejection reaches the caller, which
  // shows it inline.
  const handleUseLocalTaskList = useCallback(
    async (projectId: string): Promise<void> => {
      await app.kanban.bindLocalFile(projectId)
      invalidateKanban(projectId)
      await refreshKanbanBindings()
    },
    [app, invalidateKanban, refreshKanbanBindings],
  )

  // Task progress observation (spec task-progress-adapters Behaviour 15): main
  // reads bound projects that are visible, meaning selected or expanded in the
  // left navigation. The full set is reported on every change.
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
  }, [app, visibleProjectKey])

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

  useEffect(() => {
    let alive = true
    void app.state
      .get(APP_STATE_KEY.projectNamesUppercase)
      .then((value) => {
        if (alive && !projectNamesUppercaseTouchedRef.current) {
          setProjectNamesUppercase(value !== '0')
        }
      })
      .catch((error: unknown) => {
        if (alive) setNotice(errorMessage(error, 'Failed to load settings.'))
      })
    void app.state
      .get(APP_STATE_KEY.showProjectIcons)
      .then((value) => {
        if (alive && !showProjectIconsTouchedRef.current) {
          setShowProjectIcons(value !== '0')
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [app])

  const handleProjectNamesUppercaseChange = useCallback(
    (next: boolean): void => {
      projectNamesUppercaseTouchedRef.current = true
      setProjectNamesUppercase(next)
      void app.state
        .set(APP_STATE_KEY.projectNamesUppercase, next ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the setting.'))
        })
    },
    [app],
  )

  const handleShowProjectIconsChange = useCallback(
    (next: boolean): void => {
      showProjectIconsTouchedRef.current = true
      setShowProjectIcons(next)
      void app.state
        .set(APP_STATE_KEY.showProjectIcons, next ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save show project icons setting.'))
        })
    },
    [app],
  )

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
  }, [projects, app.state])

  const handleProjectColorChange = useCallback((projectId: string, color: string | null): void => {
    setProjectColors((previous) => {
      const next = { ...previous }
      if (color) {
        next[projectId] = color
      } else {
        delete next[projectId]
      }
      return next
    })
  }, [])

  // Attention alert settings (attention-alert-settings spec): one setter per
  // toggle-key; the settings apply live from the set state and persist
  // best-effort (failures surface on the notice banner like other settings).
  const handleAttentionSettingChange = useCallback(
    (key: keyof AttentionSettings, next: boolean): void => {
      setAttentionSettings((previous) => ({ ...previous, [key]: next }))
      void app.state.set(ATTENTION_SETTING_KEYS[key], next ? '1' : '0').catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the setting.'))
      })
    },
    [app],
  )

  // Load the four persisted attention off-switches once ('0' = off, missing
  // or anything else = on). A failed read keeps the defaults (all on) and
  // surfaces like every other settings load.
  useEffect(() => {
    let alive = true
    const keys = ATTENTION_SETTING_KEYS
    void Promise.all([
      app.state.get(keys.badge),
      app.state.get(keys.chime),
      app.state.get(keys.activeChime),
      app.state.get(keys.activeIndicator),
    ])
      .then(([badge, chime, activeChime, activeIndicator]) => {
        if (alive)
          setAttentionSettings(
            parseAttentionSettings({ badge, chime, activeChime, activeIndicator }),
          )
      })
      .catch((error: unknown) => {
        if (alive) setNotice(errorMessage(error, 'Failed to load settings.'))
      })
    return () => {
      alive = false
    }
  }, [app])

  // Handoff/Resume delivery (spec handoff-resume-flow Behaviour 3): auto-send
  // Pending split-write submission cancellation: cancels the delayed CR timer
  // so a pending Enter never reaches a disposed or terminated session.
  const cancelPendingSubmit = useCallback((id: string): void => {
    const cancel = pendingSubmitCancelsRef.current[id]
    if (cancel !== undefined) {
      delete pendingSubmitCancelsRef.current[id]
      cancel()
    }
  }, [])

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
        cancelPendingSubmit(chatId)
        pendingSubmitCancelsRef.current[chatId] = writeSubmitLine((data) => {
          if (data === '\r') {
            delete pendingSubmitCancelsRef.current[chatId]
          }
          void appApi.terminals.write(chatId, data).catch((error: unknown) => {
            setNotice(errorMessage(error, 'Failed to send the command.'))
          })
        }, text)
        return
      }
      promptInjectionNonceRef.current += 1
      setPromptInjection({ chatId, text, nonce: promptInjectionNonceRef.current })
    },
    [app, autoSendHandoff, cancelPendingSubmit, liveChatIds],
  )

  // Start without sending (NEKODE-99): the prompt main returned for a delivered
  // draft launch fills the new chat's prompt input; nothing is written to the PTY.
  const fillDraftPrompt = useCallback((chatId: string, text: string): void => {
    promptInjectionNonceRef.current += 1
    setPromptInjection({ chatId, text, nonce: promptInjectionNonceRef.current })
  }, [])

  const handlePromptInjected = useCallback((nonce: number): void => {
    setPromptInjection((previous) =>
      previous !== null && previous.nonce === nonce ? null : previous,
    )
  }, [])

  const handleSessionStatus = useCallback(
    (chatId: string, live: boolean): void => {
      if (!live) {
        cancelPendingSubmit(chatId)
      }
      setLiveChatIds((previous) => {
        const next = new Set(previous)
        if (live) next.add(chatId)
        else next.delete(chatId)
        return next
      })
    },
    [cancelPendingSubmit],
  )

  const handleSessionReady = useCallback(
    (chatId: string): void => {
      const command = pendingTerminalCommandsRef.current[chatId]
      if (command === undefined) return
      delete pendingTerminalCommandsRef.current[chatId]
      // Split-write submission (lib/pty-submit.ts): the CR must arrive as its
      // own chunk, or prompt_toolkit agent TUIs parse the burst as a paste.
      cancelPendingSubmit(chatId)
      pendingSubmitCancelsRef.current[chatId] = writeSubmitLine((data) => {
        if (data === '\r') {
          delete pendingSubmitCancelsRef.current[chatId]
        }
        void app.terminals.write(chatId, data).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to write the action command.'))
        })
      }, command)
    },
    [app, cancelPendingSubmit],
  )

  // Ready callback for bottom-tab terminals: same delivery contract as chat
  // sessions — the command, then one CR (0x0D) after the submit gap.
  const handleBottomSessionReady = useCallback(
    (tabId: string): void => {
      const command = pendingBottomCommandsRef.current[tabId]
      if (command === undefined) return
      delete pendingBottomCommandsRef.current[tabId]
      cancelPendingSubmit(tabId)
      pendingSubmitCancelsRef.current[tabId] = writeSubmitLine((data) => {
        if (data === '\r') {
          delete pendingSubmitCancelsRef.current[tabId]
        }
        void app.terminals.write(tabId, data).catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to write the action command.'))
        })
      }, command)
    },
    [app, cancelPendingSubmit],
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
        const restoredChat =
          savedChat !== null && mergedChats.some((chat) => chat.id === savedChat) ? savedChat : null
        setSelectedChatId(restoredChat)
        // Launch tab (project-home spec Behaviour 5): a restored chat opens on
        // the chat tab (the session default); a restored project without a
        // chat opens on its home tab. Tabs themselves are never persisted.
        if (restoredChat === null) {
          setTabsByProject((previous) => ({
            ...previous,
            [projectId]: activateTab(previous[projectId] ?? emptyTabsSession(), KANBAN_TAB),
          }))
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

  // The tab strip and the main surface belong to the selected project.
  // Entering Project Files in the left panel is an independent sidebar
  // navigation that does not steal or diverge the center surface from the
  // active project. Opening a file from the tree activates that project.
  const tabProjectId = selectedProjectId
  tabProjectIdRef.current = tabProjectId

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

  // Board not-configured state: Configure opens Project Settings on its Kanban
  // tab (mirrors the Resume picker's Configure affordance, spec Behaviour 14).
  const handleOpenKanbanSettings = useCallback((): void => {
    if (tabProjectId === null) {
      return
    }
    setNotice(null)
    setActionSettingsProjectId(tabProjectId)
    setActionSettingsTab('kanban')
    setActionSettingsOpen(true)
  }, [tabProjectId])

  const handleStartTask = useCallback((projectId: string, item: WorkItem): void => {
    setTaskStart({ projectId, item, draft: false })
  }, [])

  // Start without sending (NEKODE-99): the same confirmation in its draft variant.
  const handleStartTaskDraft = useCallback((projectId: string, item: WorkItem): void => {
    setTaskStart({ projectId, item, draft: true })
  }, [])

  // Project Settings on the Agents tab. Start and Resume share this opener.
  const openAgentsSettings = useCallback((projectId: string): void => {
    setNotice(null)
    setActionSettingsProjectId(projectId)
    setActionSettingsTab('agents')
    setActionSettingsOpen(true)
  }, [])

  const handleConfigureTaskAgents = useCallback((): void => {
    const projectId = taskStart?.projectId
    setTaskStart(null)
    if (projectId === undefined) {
      return
    }
    openAgentsSettings(projectId)
  }, [openAgentsSettings, taskStart])

  const handleConfigureResumeAgents = useCallback((): void => {
    const projectId = taskResume?.projectId
    setTaskResume(null)
    if (projectId === undefined) {
      return
    }
    openAgentsSettings(projectId)
  }, [openAgentsSettings, taskResume])

  const handleResumeTask = useCallback((projectId: string, item: WorkItem): void => {
    setTaskResume({ projectId, item })
  }, [])

  // The board's not-configured handoff notice opens Project Settings on the tab
  // that owns the per-project handoff directory.
  const handleConfigureProjectHandoffs = useCallback((projectId: string): void => {
    setNotice(null)
    setActionSettingsProjectId(projectId)
    setActionSettingsTab('actions')
    setActionSettingsOpen(true)
  }, [])

  // Resume with no configured directory: Configure handoffs opens Project
  // Settings on the tab that owns the handoff directory.
  const handleConfigureTaskHandoffs = useCallback((): void => {
    const projectId = taskResume?.projectId
    setTaskResume(null)
    if (projectId === undefined) {
      return
    }
    setNotice(null)
    setActionSettingsProjectId(projectId)
    setActionSettingsTab('actions')
    setActionSettingsOpen(true)
  }, [taskResume])

  // Closing Project Settings re-reads the task-source bindings (project-home
  // spec Behaviour 2): a bind/unbind saved in the dialog then switches the
  // home tab between the list and the welcome without a restart.
  const handleActionSettingsClose = useCallback((): void => {
    setActionSettingsOpen(false)
    void refreshKanbanBindings()
  }, [refreshKanbanBindings])

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
    [loadChats, persistSelection, selectedProjectId, updateTabsSession],
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
    [app, applyChatsUpdate, persistSelection],
  )

  const handleAddProject = useCallback((): void => {
    setNotice(null)
    setAddProjectOpen(true)
  }, [])

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
        setTaskStart((current) => (current?.projectId === projectId ? null : current))
        // The removed project's in-flight resume scan must not outlive it:
        // clearing the state unmounts the Resume modal and invalidates the
        // pending response (spec Bledy i wyscigi: removing a project before
        // confirmation invalidates pending responses).
        setTaskResume((current) => (current?.projectId === projectId ? null : current))
        setHeldLaunches((previous) => {
          let changed = false
          const next: Record<string, HeldLaunch> = {}
          for (const [chatId, held] of Object.entries(previous)) {
            if (held.input.projectId === projectId) {
              changed = true
              continue
            }
            next[chatId] = held
          }
          return changed ? next : previous
        })
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
          cancelPendingSubmit(tabId)
        }
        setBottomTabs((previous) => dropBottomProject(previous, projectId))
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
    [app, applyChatsUpdate, cancelPendingSubmit, persistSelection, refreshActions],
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
    [app, updateFilesSession],
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
    [app, updateFilesSession],
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
    [filesSessions, loadFilesDirectory, loadGitStatuses, projects],
  )

  const lastOpenedFilesProjectIdRef = useRef<string | null>(null)
  const previousFilesProjectIdRef = useRef<string | null>(filesProjectId)

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
  }, [app, filesProjectId, filesSessions, projects, updateFilesSession])

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
      updateFilesSession,
      updateTabsSession,
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
    [app, filesProjectId],
  )

  const handleFilesCopyRelativePath = useCallback((relativePath: string): void => {
    void navigator.clipboard.writeText(relativePath).catch(() => {
      setNotice('Failed to copy the path.')
    })
  }, [])

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
    [filesProjectId, projects],
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
    [app, filesProjectId, projects, updateFilesSession, updateTabsSession],
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
    [app, applyChatsUpdate, persistSelection, updateTabsSession],
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
    [applyChatsUpdate, persistSelection, updateTabsSession],
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
    [adoptLaunchedChat, app],
  )

  const handleTaskLaunched = useCallback(
    (projectId: string, result: KanbanLaunchResult & { input: KanbanLaunchTaskInput }): void => {
      if (removedProjectIdsRef.current.has(projectId)) {
        return
      }
      adoptLaunchedChat(projectId, result.chat)
      if (result.delivered) {
        if (result.draftPrompt !== undefined) {
          fillDraftPrompt(result.chat.id, result.draftPrompt)
        }
        setHeldLaunches((previous) => {
          if (!(result.chat.id in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[result.chat.id]
          return next
        })
      } else {
        setHeldLaunches((previous) => ({
          ...previous,
          [result.chat.id]: {
            message: 'Failed to start the terminal for this chat.',
            input: result.input,
          },
        }))
      }
      setTaskStart(null)
      setTaskResume(null)
    },
    [adoptLaunchedChat, fillDraftPrompt],
  )

  const handleRetryHeldLaunch = useCallback(
    (chatId: string): void => {
      const held = heldLaunchesRef.current[chatId]
      if (held === undefined || retryingLaunchRef.current !== null) {
        return
      }
      retryingLaunchRef.current = chatId
      setRetryingLaunchChatId(chatId)
      void (async () => {
        try {
          const result = await app.kanban.launchTask(held.input)
          if (removedProjectIdsRef.current.has(held.input.projectId)) {
            return
          }
          if (result.delivered) {
            setHeldLaunches((previous) => {
              if (!(chatId in previous)) {
                return previous
              }
              const next = { ...previous }
              delete next[chatId]
              return next
            })
            adoptLaunchedChat(held.input.projectId, result.chat)
            if (result.draftPrompt !== undefined) {
              fillDraftPrompt(result.chat.id, result.draftPrompt)
            }
          } else {
            setHeldLaunches((previous) => ({
              ...previous,
              [chatId]: {
                ...held,
                message: 'Failed to start the terminal for this chat.',
              },
            }))
          }
        } catch (error) {
          if (removedProjectIdsRef.current.has(held.input.projectId)) {
            return
          }
          setHeldLaunches((previous) => ({
            ...previous,
            [chatId]: {
              ...held,
              message: errorMessage(error, 'Failed to start the terminal for this chat.'),
            },
          }))
        } finally {
          if (retryingLaunchRef.current === chatId) {
            retryingLaunchRef.current = null
            setRetryingLaunchChatId(null)
          }
        }
      })()
    },
    [adoptLaunchedChat, app, fillDraftPrompt],
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
      // A closed chat's held launch can no longer be retried: drop the entry
      // so it does not outlive its chat in the renderer.
      setHeldLaunches((previous) => {
        if (!(chatId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[chatId]
        return next
      })
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
    [app, applyChatsUpdate, cancelPendingSubmit, persistSelection],
  )

  // Close-chat control on a chat row (user request 2026-10-04): the row's X
  // requests the close; the ConfirmDialog owns the destructive action — the
  // same close flow as a terminal exit (spec Behaviour 11): removal from the
  // tree and the database, successor selection included. Cancel/dismiss
  // stages nothing.
  const handleRequestCloseChat = useCallback((chatId: string): void => {
    for (const chats of Object.values(chatsByProjectRef.current)) {
      const chat = chats.find((item) => item.id === chatId)
      if (chat !== undefined) {
        setChatToClose({ id: chat.id, name: chat.name })
        return
      }
    }
    // The chat vanished (a parallel close flow): nothing to confirm.
    setChatToClose(null)
  }, [])

  const handleCloseChatConfirmed = useCallback((): void => {
    if (chatToClose === null) {
      return
    }
    const chatId = chatToClose.id
    setChatToClose(null)
    void handleChatClosed(chatId)
  }, [chatToClose, handleChatClosed])

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
          cancelPendingSubmit(tabId)
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
        // The label resolves the project's stored shell choice (spec
        // project-shell-selection): e.g. "WSL: Ubuntu-24.04" for a WSL-bound
        // project, the platform default name otherwise.
        label = (await app.terminals.shellName(projectId)).trim()
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
            cancelPendingSubmit(tabId)
          }
          return previous
        }
        return addBottomTab(previous, tab)
      })
    },
    [app, cancelPendingSubmit],
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
    (tabId: string, options?: { viaShortcut?: boolean }): void => {
      void (async () => {
        try {
          await app.terminals.terminate(tabId)
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to close the terminal.'))
          return
        }
        // A Ctrl+D close hides the panel when its project has no tabs left to
        // show (spec Behaviour 9, NEKODE-19). The visibleTabs rule of
        // BottomPanel (null project -> no tabs) applies too, so a shortcut
        // close without an active project also hides instead of emptying.
        // Hide runs after the removal below: it closes over the pre-removal
        // tabs, mirrors of the same tick. X-button and shell exits keep
        // Behaviour 9: the panel stays open and empty.
        const viaShortcut = options?.viaShortcut === true
        const projectOfRemoved = Object.entries(bottomTabsRef.current.byProject).find(([, s]) =>
          s.tabs.some((tab) => tab.id === tabId),
        )
        delete pendingBottomCommandsRef.current[tabId]
        cancelPendingSubmit(tabId)
        setBottomTabs((previous) => closeBottomTab(previous, tabId))
        if (viaShortcut) {
          const activeProjectId = tabProjectIdRef.current
          const remainingVisible =
            activeProjectId === null
              ? []
              : (projectOfRemoved?.[1].tabs ?? []).filter(
                  (tab) => tab.projectId === activeProjectId,
                )
          if (remainingVisible.length <= 1) {
            hideBottomRef.current()
          }
        }
      })()
    },
    [app, cancelPendingSubmit],
  )

  const handleBottomExit = useCallback(
    (tabId: string): void => {
      // The tab is gone: its staged bottom-terminal command must not linger
      // (review:4 follow-up). A spawn failure keeps the entry — the retry
      // remount fires a fresh ready event that must still deliver it.
      delete pendingBottomCommandsRef.current[tabId]
      cancelPendingSubmit(tabId)
      setBottomTabs((previous) => closeBottomTab(previous, tabId))
      void app.terminals.terminate(tabId).catch(() => undefined)
    },
    [app, cancelPendingSubmit],
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

  const handleToggleBottom = useCallback((): void => {
    if (bottomOpenRef.current) {
      hideBottomPanel()
    } else {
      showBottomPanel()
    }
  }, [hideBottomPanel, showBottomPanel])

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

  // Ctrl+Tab / Ctrl+Shift+Tab chat switching across all projects (NEKODE-18),
  // capture phase so it
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

  // Ctrl+N starts a new chat in the active project (spec Behaviour 3 path),
  // capture phase so it wins over focus traversal even inside a focused
  // terminal, and never reaches a PTY (ChatTerminal swallows the chord in its
  // custom key handler). The project target is read from the existing
  // tabProjectIdRef (revalidated every render above).
  const createChatRef = useRef(handleCreateChat)
  createChatRef.current = handleCreateChat

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isNewChatChord(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      const projectId = tabProjectIdRef.current
      if (projectId === null) {
        // Same contract as the "+ New chat" control (Behaviour 8): the flow
        // cannot run without an active project, so the dead press is noticed.
        setNotice('Select or add a project before starting a new chat.')
        return
      }
      void createChatRef.current(projectId)
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
  const activeMarkdownFile =
    tabProject !== null && activeTab.kind === 'file' && isMarkdownPath(activeTab.path)
      ? { projectId: tabProject.id, path: activeTab.path }
      : null
  // Home tab contents (project-home spec Behaviour 2, Edge cases): see
  // homeTabStateFor.
  const homeTabState = homeTabStateFor({
    project: tabProject,
    active: activeTab,
    bound: tabProject !== null && kanbanProjectIds.has(tabProject.id),
    bindingsError: kanbanBindingsError,
    settled: tabProject !== null && settledKanbanProjects.has(tabProject.id),
  })
  // The terminal-chat tab shows the active chat's name when the active project
  // has a chat selected.
  const activeChat =
    selectedProject !== null
      ? (chatsByProject[selectedProject.id]?.find((chat) => chat.id === selectedChatId) ?? null)
      : null
  const statusProject = tabProject

  // Floating shell theme (NeKode Float): the title bar strip stays (without
  // its hairline), the left panel floats detached with rounded corners and
  // the center content below the tab strip sits in a rounded frame with the
  // tabs attached to its top. Attached themes keep the window-edge shell.
  const floatingTheme = THEMES[themeState.theme].layout === 'floating'

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
    // An action-created chat lands in the center surface: its terminal-chat
    // tab becomes active.
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

  function openAppSettings(options?: { scrollToUpdate?: boolean }): void {
    if (options?.scrollToUpdate === true) {
      setAppSettingsUsage(false)
      setAppSettingsAgents(false)
    }
    setAppSettingsUpdate(options?.scrollToUpdate === true)
    setAppSettingsOpen(true)
  }

  return (
    <div
      className="nk-app-shell flex h-screen w-screen flex-col overflow-hidden bg-app text-ink antialiased"
      data-testid={TEST_ID.appShell}
    >
      {/* Window title bar (user decision 2026-10-01): one continuous
          full-width drag strip; the brand on the left, Windows caption
          buttons overlay the top-right corner. Tab strip and panel headers
          sit one level below. Every theme keeps the strip (user decision
          2026-10-04: the app name stays top-left beside the caption
          buttons); the floating theme only drops the hairline under it. */}
      <div
        className="nk-title-bar drag-region flex h-10 shrink-0 items-center bg-app px-4"
        data-testid={TEST_ID.titleBar}
      >
        <AppBrand />
        {usageEnabled ? (
          <UsageToolbar
            api={app.usage}
            version={usageVersion}
            onConfigure={() => {
              setAppSettingsUsage(true)
              setAppSettingsOpen(true)
            }}
          />
        ) : null}
      </div>
      {/* The hairline under the title bar is owned by the content row
          (border-t, design doc 26.2 convention), not by the strip itself;
          the floating theme drops only the hairline. */}
      <div
        className={
          floatingTheme ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 border-t border-edge'
        }
      >
        <LeftPanelTrack
          view={filesProject !== null ? 'files' : 'projects'}
          width={leftWidth}
          floating={floatingTheme}
          onResizeStart={leftRegion.startResize}
          onResizeNudge={leftRegion.nudge}
          projects={
            <LeftNavigation
              projects={projects}
              projectNamesUppercase={projectNamesUppercase}
              showProjectIcons={showProjectIcons}
              projectColors={projectColors}
              chatsByProject={chatsByProject}
              sessionTasks={sessionTasks}
              expandedProjectIds={expandedProjectIds}
              selectedProjectId={selectedProjectId}
              selectedChatId={selectedChatId}
              attention={chatAttention}
              activity={chatActivity}
              attentionBadgeEnabled={attentionSettings.badge}
              attentionActiveIndicatorEnabled={attentionSettings.activeIndicator}
              onSelectProject={handleOpenProjectKanban}
              onToggleProject={handleToggleProject}
              onSelectChat={handleSelectChat}
              onAddProject={handleAddProject}
              onRemoveProject={handleRemoveProject}
              onOpenProjectFiles={handleOpenProjectFiles}
              kanbanProjectIds={kanbanProjectIds}
              onOpenProjectKanban={handleOpenProjectKanban}
              onOpenInFileExplorer={handleOpenInFileExplorer}
              onOpenProjectSettings={(projectId) => {
                setActionSettingsProjectId(projectId)
                setActionSettingsTab('shell')
                setActionSettingsOpen(true)
              }}
              onCreateChat={handleCreateChat}
              onCreateAgentChat={handleCreateAgentChat}
              loadAgentProfiles={loadAgentProfiles}
              onConfigureAgents={openAgentsSettings}
              onRequestCloseChat={handleRequestCloseChat}
              notice={filesProject !== null ? null : notice}
            >
              <PanelFooter
                onOpenAppSettings={openAppSettings}
                mascotVisible={mascotState.visible}
                mascotError={mascotState.error}
                onToggleMascot={handleToggleMascot}
              />
            </LeftNavigation>
          }
          files={
            filesProject !== null ? (
              <ProjectFilesPanel
                project={filesProject}
                projectNamesUppercase={projectNamesUppercase}
                showProjectIcons={showProjectIcons}
                projectColor={projectColors?.[filesProject.id]}
                homeDir={app.homeDir}
                platform={app.platform}
                session={filesSession}
                onBack={handleCloseProjectFiles}
                onRefresh={handleRefreshProjectFiles}
                onToggleDirectory={handleFilesToggleDirectory}
                onSelectFile={handleFilesSelectFile}
                onShowInFolder={handleFilesShowInFolder}
                onCopyPath={handleFilesCopyPath}
                onCopyRelativePath={handleFilesCopyRelativePath}
                onTrash={handleFilesTrash}
                notice={notice}
              >
                <PanelFooter
                  onOpenAppSettings={openAppSettings}
                  mascotVisible={mascotState.visible}
                  mascotError={mascotState.error}
                  onToggleMascot={handleToggleMascot}
                />
              </ProjectFilesPanel>
            ) : null
          }
        />
        <CenterTabs
          app={app}
          floating={floatingTheme}
          project={tabProject}
          projectNamesUppercase={projectNamesUppercase}
          chatName={activeChat?.name ?? null}
          session={tabsSession}
          homeTabState={homeTabState}
          bindingsError={kanbanBindingsError}
          markdownViewByKey={markdownViewByKey}
          surfaceRef={centerSurfaceRef}
          onSelectTab={handleSelectTab}
          onCloseFile={handleCloseFileTab}
          onOpenSettings={() => {
            setActionSettingsProjectId(tabProjectId)
            setActionSettingsTab('shell')
            setActionSettingsOpen(true)
          }}
          onUseLocalTaskList={handleUseLocalTaskList}
          onConnectTracker={handleOpenKanbanSettings}
          onOpenExternalError={handleFilesOpenExternalError}
          actionRow={
            <ActionBar
              app={app}
              actions={actions}
              projectId={tabProjectId}
              activeChatId={activeChat?.id ?? null}
              chatIsLive={activeChat !== null && liveChatIds.has(activeChat.id)}
              task={activeChat === null ? undefined : sessionTasks[activeChat.id]}
              isKanban={homeTabState === 'list'}
              kanbanControls={
                tabProjectId !== null && homeTabState === 'list'
                  ? (kanbanToolbarByProject[tabProjectId] ?? null)
                  : null
              }
              onNewTerminal={handleNewTerminalAction}
              onBottomTerminal={handleBottomTerminalAction}
              onPromptCommand={handlePromptCommand}
              onResume={() => {
                if (tabProjectId !== null) {
                  setHandoffPickerOpen(true)
                }
              }}
              onError={setNotice}
              markdownView={
                activeMarkdownFile === null
                  ? null
                  : {
                      mode:
                        markdownViewByKey[
                          markdownViewKey(activeMarkdownFile.projectId, activeMarkdownFile.path)
                        ] ?? DEFAULT_MARKDOWN_VIEW,
                      onChange: (mode) => {
                        const key = markdownViewKey(
                          activeMarkdownFile.projectId,
                          activeMarkdownFile.path,
                        )
                        setMarkdownViewByKey((previous) =>
                          previous[key] === mode ? previous : { ...previous, [key]: mode },
                        )
                      },
                    }
              }
            />
          }
          chatSurface={
            <ChatWorkspace
              dictation={desktopDictation.control}
              app={app}
              projects={projects}
              chatsByProject={chatsByProject}
              chatsLoaded={
                selectedProjectId !== null && loadedChatProjectIds.has(selectedProjectId)
              }
              selectedProjectId={selectedProjectId}
              selectedChatId={selectedChatId}
              selectionNonce={selectionNonce}
              attention={chatAttention}
              onActivityChange={setChatActivity}
              onAttentionChange={setChatAttention}
              attentionSettings={attentionSettings}
              terminalCwds={terminalCwds}
              terminalFontSize={terminalFontSize}
              terminalFontFamilies={terminalFontState.families}
              terminalCtrlVPaste={terminalPasteState.enabled}
              onSessionStatus={handleSessionStatus}
              onSessionReady={handleSessionReady}
              onChatClosed={handleChatClosed}
              onStartNewChat={handleStartNewChat}
              onAddProject={handleAddProject}
              promptInjection={promptInjection}
              onPromptInjected={handlePromptInjected}
              heldLaunches={heldLaunches}
              onRetryHeldLaunch={handleRetryHeldLaunch}
              retryingLaunchChatId={retryingLaunchChatId}
            />
          }
          renderKanban={(activeKanbanProjectId) => (
            <KanbanSessions
              app={app}
              projectIds={
                new Set(
                  projects
                    .filter((project) => kanbanProjectIds.has(project.id))
                    .map((project) => project.id),
                )
              }
              activeProjectId={activeKanbanProjectId}
              versions={kanbanVersions}
              localFileProjectIds={localFileProjectIds}
              onUseLocalTaskList={handleUseLocalTaskList}
              onConfigure={handleOpenKanbanSettings}
              onConfigureHandoffs={handleConfigureProjectHandoffs}
              onStart={handleStartTask}
              onStartDraft={handleStartTaskDraft}
              onResume={handleResumeTask}
              onToolbarControls={handleKanbanToolbarControls}
            />
          )}
        />
        {/* Right region is a real five-region sibling (SDD §7), hidden by default. */}
        <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
          Right Panel
        </div>
      </div>
      {taskStart !== null ? (
        <TaskStartModal
          key={`${taskStart.projectId}:${taskStart.item.id}`}
          app={app}
          projectId={taskStart.projectId}
          item={taskStart.item}
          draft={taskStart.draft}
          onCancel={() => {
            setTaskStart(null)
          }}
          onConfigureAgents={handleConfigureTaskAgents}
          onLaunched={(result) => {
            handleTaskLaunched(taskStart.projectId, result)
          }}
        />
      ) : null}
      {taskResume !== null ? (
        <TaskResumeModal
          key={`resume:${taskResume.projectId}:${taskResume.item.id}`}
          app={app}
          projectId={taskResume.projectId}
          item={taskResume.item}
          onCancel={() => {
            setTaskResume(null)
          }}
          onConfigureHandoffs={handleConfigureTaskHandoffs}
          onConfigureAgents={handleConfigureResumeAgents}
          onLaunched={(result) => {
            handleTaskLaunched(taskResume.projectId, result)
          }}
        />
      ) : null}
      {chatToClose !== null ? (
        /* Close-chat confirmation (user request 2026-10-04): the row's X only
            requests the close; this dialog owns the destructive action.
            Cancel / backdrop / Escape keep everything untouched. */
        <ConfirmDialog
          title="Close chat"
          body={`Close "${chatToClose.name}"? Its terminal session ends and the chat is removed.`}
          confirmLabel="Close chat"
          destructive
          onConfirm={handleCloseChatConfirmed}
          onCancel={() => {
            setChatToClose(null)
          }}
        />
      ) : null}
      {appSettingsOpen ? (
        <AppSettings
          app={app}
          initialTab={
            appSettingsUpdate
              ? 'general'
              : appSettingsUsage
                ? 'usage'
                : appSettingsAgents
                  ? 'agents'
                  : 'general'
          }
          scrollToUpdate={appSettingsUpdate}
          onUsageSaved={handleUsageSaved}
          dictationApi={app.dictation}
          desktopDictation={desktopDictation}
          theme={themeState.theme}
          quickThemeSwitch={quickThemeSwitchState.enabled}
          onQuickThemeSwitchChange={handleQuickThemeSwitchChange}
          chatSwitch={chatSwitchEnabled}
          projectNamesUppercase={projectNamesUppercase}
          onProjectNamesUppercaseChange={handleProjectNamesUppercaseChange}
          showProjectIcons={showProjectIcons}
          onShowProjectIconsChange={handleShowProjectIconsChange}
          error={
            themeState.error ??
            quickThemeSwitchState.error ??
            terminalPasteState.error ??
            terminalFontState.error ??
            terminalFontSizeError
          }
          onThemeChange={handleThemeChange}
          onChatSwitchChange={handleChatSwitchChange}
          attentionSettings={attentionSettings}
          onAttentionSettingChange={handleAttentionSettingChange}
          terminalFontSize={terminalFontSize}
          terminalFontFamilies={terminalFontState.families}
          onTerminalFontFamiliesChange={handleTerminalFontFamiliesChange}
          onTerminalFontSizeChange={handleTerminalFontSizeChange}
          terminalCtrlVPaste={terminalPasteState.enabled}
          onTerminalCtrlVPasteChange={handleTerminalCtrlVPasteChange}
          onClose={() => {
            setAppSettingsOpen(false)
            setAppSettingsUsage(false)
            setAppSettingsAgents(false)
            setAppSettingsUpdate(false)
            setAgentLibraryRefreshKey((current) => current + 1)
          }}
        />
      ) : null}
      {actionSettingsOpen ? (
        <ActionSettings
          suspended={appSettingsOpen}
          libraryRefreshKey={agentLibraryRefreshKey}
          onManageAgents={() => {
            setAppSettingsAgents(true)
            setAppSettingsOpen(true)
          }}
          app={app}
          actions={actions}
          projectId={actionSettingsProjectId}
          projectPath={
            actionSettingsProjectId === null
              ? null
              : (projects.find((project) => project.id === actionSettingsProjectId)?.path ?? null)
          }
          projectName={
            actionSettingsProjectId === null
              ? null
              : (projects.find((project) => project.id === actionSettingsProjectId)?.name ?? null)
          }
          projectColor={
            actionSettingsProjectId === null
              ? null
              : getProjectColor(
                  { id: actionSettingsProjectId },
                  projectColors[actionSettingsProjectId],
                )
          }
          autoSend={autoSendHandoff}
          onAutoSendChange={handleAutoSendChange}
          onRefresh={refreshActions}
          initialTab={actionSettingsTab}
          onClose={handleActionSettingsClose}
          onKanbanInvalidate={invalidateKanban}
          onProjectColorChange={handleProjectColorChange}
        />
      ) : null}
      {handoffPickerOpen && tabProjectId !== null ? (
        <HandoffPicker
          key={`${tabProjectId}:${selectedChatId}`}
          app={app}
          projectId={tabProjectId}
          projectPath={projects.find((project) => project.id === tabProjectId)?.path ?? null}
          onPick={handlePromptCommand}
          onConfigure={() => {
            setHandoffPickerOpen(false)
            setActionSettingsProjectId(tabProjectId)
            setActionSettingsTab('actions')
            setActionSettingsOpen(true)
          }}
          onClose={() => setHandoffPickerOpen(false)}
        />
      ) : null}
      {addProjectOpen ? (
        <AddProject
          app={app}
          onAdded={handleProjectAdded}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}
      <BottomPanel
        app={app}
        open={bottomOpen}
        height={bottomHeight}
        activeProjectId={tabProjectId}
        tabs={allBottomTabs(bottomTabs)}
        terminalFontSize={terminalFontSize}
        terminalFontFamilies={terminalFontState.families}
        terminalCtrlVPaste={terminalPasteState.enabled}
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
      <StatusBar
        app={app}
        project={statusProject}
        theme={themeState.theme}
        quickThemeSwitch={quickThemeSwitchState.enabled}
        onThemeChange={handleThemeChange}
        onError={setNotice}
        bottomOpen={bottomOpen}
        onToggleBottom={handleToggleBottom}
      />
    </div>
  )
}

export default App
