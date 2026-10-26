import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { MarkdownViewMode } from '../components/files/markdown-path'
import { emptyTabsSession, type ProjectTabsSession } from '../components/tabs/tabs-session'

// Center tab-strip state for this app session only. Neither the per-project
// tab sessions (center-layout-tabs-actions spec Behaviour 3–5) nor the
// markdown Code/Preview choice (user decision 2026-10-06) is ever persisted.
interface TabsState {
  tabsByProject: Record<string, ProjectTabsSession>
  markdownViewByKey: Record<string, MarkdownViewMode>
}

interface TabsActions {
  /** Applies a pure tabs-session reducer to one project's session (created on first use). */
  updateTabsSession: (
    projectId: string,
    updater: (session: ProjectTabsSession) => ProjectTabsSession,
  ) => void
  /** Drops a removed project's session; a missing session changes nothing. */
  dropProject: (projectId: string) => void
  setMarkdownView: (key: string, mode: MarkdownViewMode) => void
  reset: () => void
}

export type TabsStore = TabsState & TabsActions

function initialState(): TabsState {
  return { tabsByProject: {}, markdownViewByKey: {} }
}

export function createTabsStore() {
  return createStore<TabsStore>()((set) => ({
    ...initialState(),
    updateTabsSession: (projectId, updater) =>
      set((state) => ({
        tabsByProject: {
          ...state.tabsByProject,
          [projectId]: updater(state.tabsByProject[projectId] ?? emptyTabsSession()),
        },
      })),
    dropProject: (projectId) =>
      set((state) => {
        if (!(projectId in state.tabsByProject)) return state
        const tabsByProject = { ...state.tabsByProject }
        delete tabsByProject[projectId]
        return { tabsByProject }
      }),
    setMarkdownView: (key, mode) =>
      set((state) =>
        state.markdownViewByKey[key] === mode
          ? state
          : { markdownViewByKey: { ...state.markdownViewByKey, [key]: mode } },
      ),
    reset: () => set(initialState()),
  }))
}

export type TabsStoreApi = ReturnType<typeof createTabsStore>
export const TabsStoreContext = createContext<TabsStoreApi | null>(null)

export function useTabsStore<T>(selector: (state: TabsStore) => T): T {
  const store = useContext(TabsStoreContext)
  if (store === null) throw new Error('useTabsStore requires AppStoresProvider.')
  return useStore(store, selector)
}
