// In-memory bottom terminal tabs for one application run (spec Behaviour 6).
// Not chats, not persisted. One list per project, in creation order.

export interface BottomTab {
  id: string
  projectId: string
  label: string
  cwd: string
  generation: number
  status: 'running' | 'error'
  errorMessage: string | null
}

interface ProjectBottomTabs {
  tabs: BottomTab[]
  activeId: string | null
}

export interface BottomTabsState {
  byProject: Record<string, ProjectBottomTabs>
}

export function emptyBottomTabs(): BottomTabsState {
  return { byProject: {} }
}

export function allBottomTabs(state: BottomTabsState): BottomTab[] {
  return Object.values(state.byProject).flatMap((session) => session.tabs)
}

export function addBottomTab(state: BottomTabsState, tab: BottomTab): BottomTabsState {
  const session = state.byProject[tab.projectId] ?? { tabs: [], activeId: null }
  return {
    byProject: {
      ...state.byProject,
      [tab.projectId]: { tabs: [...session.tabs, tab], activeId: tab.id },
    },
  }
}

export function selectBottomTab(
  state: BottomTabsState,
  projectId: string,
  tabId: string,
): BottomTabsState {
  const session = state.byProject[projectId]
  if (session === undefined || !session.tabs.some((tab) => tab.id === tabId)) {
    return state
  }
  if (session.activeId === tabId) {
    return state
  }
  return {
    byProject: { ...state.byProject, [projectId]: { ...session, activeId: tabId } },
  }
}

/**
 * Removes one tab. When it was active, the next tab in creation order becomes
 * active, or the previous one when the closed tab was last (spec Behaviour 9).
 */
export function closeBottomTab(state: BottomTabsState, tabId: string): BottomTabsState {
  const projectId = projectIdOf(state, tabId)
  if (projectId === null) {
    return state
  }
  const session = state.byProject[projectId]
  if (session === undefined) {
    return state
  }
  const index = session.tabs.findIndex((tab) => tab.id === tabId)
  const tabs = session.tabs.filter((tab) => tab.id !== tabId)
  let activeId = session.activeId
  if (activeId === tabId) {
    activeId = (tabs[index] ?? tabs[index - 1])?.id ?? null
  }
  return {
    byProject: { ...state.byProject, [projectId]: { tabs, activeId } },
  }
}

export function markBottomTabError(
  state: BottomTabsState,
  tabId: string,
  message: string,
): BottomTabsState {
  return mapTab(state, tabId, (tab) => ({ ...tab, status: 'error', errorMessage: message }))
}

export function retryBottomTab(state: BottomTabsState, tabId: string): BottomTabsState {
  return mapTab(state, tabId, (tab) => ({
    ...tab,
    generation: tab.generation + 1,
    status: 'running',
    errorMessage: null,
  }))
}

export function dropBottomProject(state: BottomTabsState, projectId: string): BottomTabsState {
  if (!(projectId in state.byProject)) {
    return state
  }
  const byProject = { ...state.byProject }
  delete byProject[projectId]
  return { byProject }
}

function projectIdOf(state: BottomTabsState, tabId: string): string | null {
  for (const [projectId, session] of Object.entries(state.byProject)) {
    if (session.tabs.some((tab) => tab.id === tabId)) {
      return projectId
    }
  }
  return null
}

function mapTab(
  state: BottomTabsState,
  tabId: string,
  mapper: (tab: BottomTab) => BottomTab,
): BottomTabsState {
  const projectId = projectIdOf(state, tabId)
  if (projectId === null) {
    return state
  }
  const session = state.byProject[projectId]
  if (session === undefined) {
    return state
  }
  return {
    byProject: {
      ...state.byProject,
      [projectId]: {
        ...session,
        tabs: session.tabs.map((tab) => (tab.id === tabId ? mapper(tab) : tab)),
      },
    },
  }
}
