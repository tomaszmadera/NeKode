import type { ProjectInfo } from '@shared/ipc-contract'
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { resolveUpdate, type StoreUpdate } from './store-update'

interface ProjectState {
  projects: ProjectInfo[]
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  projectColors: Record<string, string>
  kanbanProjectIds: ReadonlySet<string>
  localFileProjectIds: ReadonlySet<string>
  settledKanbanProjects: ReadonlySet<string>
  kanbanBindingsError: string | null
}

interface ProjectActions {
  setProjects: (update: StoreUpdate<ProjectState['projects']>) => void
  setExpandedProjectIds: (update: StoreUpdate<ProjectState['expandedProjectIds']>) => void
  setSelectedProjectId: (update: StoreUpdate<ProjectState['selectedProjectId']>) => void
  setProjectColors: (update: StoreUpdate<ProjectState['projectColors']>) => void
  setKanbanProjectIds: (update: StoreUpdate<ProjectState['kanbanProjectIds']>) => void
  setLocalFileProjectIds: (update: StoreUpdate<ProjectState['localFileProjectIds']>) => void
  setSettledKanbanProjects: (update: StoreUpdate<ProjectState['settledKanbanProjects']>) => void
  setKanbanBindingsError: (update: StoreUpdate<ProjectState['kanbanBindingsError']>) => void
  reset: () => void
}

function initialState(): ProjectState {
  return {
    projects: [],
    expandedProjectIds: new Set(),
    selectedProjectId: null,
    projectColors: {},
    kanbanProjectIds: new Set(),
    localFileProjectIds: new Set(),
    settledKanbanProjects: new Set(),
    kanbanBindingsError: null,
  }
}

export type ProjectStore = ProjectState & ProjectActions

// Persistence and asynchronous IPC remain with the App that owns this instance.
export function createProjectStore() {
  return createStore<ProjectStore>()((set) => ({
    ...initialState(),
    setProjects: (update) => set((state) => ({ projects: resolveUpdate(update, state.projects) })),
    setExpandedProjectIds: (update) =>
      set((state) => ({ expandedProjectIds: resolveUpdate(update, state.expandedProjectIds) })),
    setSelectedProjectId: (update) =>
      set((state) => ({ selectedProjectId: resolveUpdate(update, state.selectedProjectId) })),
    setProjectColors: (update) =>
      set((state) => ({ projectColors: resolveUpdate(update, state.projectColors) })),
    setKanbanProjectIds: (update) =>
      set((state) => ({ kanbanProjectIds: resolveUpdate(update, state.kanbanProjectIds) })),
    setLocalFileProjectIds: (update) =>
      set((state) => ({ localFileProjectIds: resolveUpdate(update, state.localFileProjectIds) })),
    setSettledKanbanProjects: (update) =>
      set((state) => ({
        settledKanbanProjects: resolveUpdate(update, state.settledKanbanProjects),
      })),
    setKanbanBindingsError: (update) =>
      set((state) => ({ kanbanBindingsError: resolveUpdate(update, state.kanbanBindingsError) })),
    reset: () => set(initialState()),
  }))
}

export type ProjectStoreApi = ReturnType<typeof createProjectStore>
export const ProjectStoreContext = createContext<ProjectStoreApi | null>(null)

export function useProjectStore<T>(selector: (state: ProjectStore) => T): T {
  const store = useContext(ProjectStoreContext)
  if (store === null) throw new Error('useProjectStore requires ProjectChatStoresProvider.')
  return useStore(store, selector)
}
