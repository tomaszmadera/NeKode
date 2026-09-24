// Typed IPC contract shared by main, preload and renderer (SDD §6, §44).
// Every channel is served by a real service in main: projects/tasks/state by
// the SQLite persistence services, terminals by real PTY sessions
// (TerminalService) and git:status by the git service.

export interface ProjectInfo {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}

export interface TaskInfo {
  id: string
  projectId: string
  name: string
  status: 'idle'
}

export interface GitStatus {
  branch: string | null
  dirty: boolean
}

export type Unsubscribe = () => void

// Channel names mirror the spec Data/API bridge. terminals:terminate is
// intentionally absent: app-quit PTY teardown runs in the main process
// (TerminalService.terminateAll on app quit), never through the renderer.
export const IPC_CHANNEL = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  stateGet: 'state:get',
  stateSet: 'state:set',
  terminalsCreate: 'terminals:create',
  terminalsWrite: 'terminals:write',
  terminalsResize: 'terminals:resize',
  terminalsData: 'terminals:data',
  terminalsExit: 'terminals:exit',
  gitStatus: 'git:status',
} as const

// Keys of the flat app_state key–value store (spec Data/API). Shared so the
// renderer persists with the same keys the main process cleans up.
export const APP_STATE_KEY = {
  selectedProjectId: 'selection.projectId',
  selectedTaskId: 'selection.taskId',
  leftRegionWidth: 'region.left.width',
  bottomRegionHeight: 'region.bottom.height',
} as const

export interface AppApi {
  projects: {
    list(): Promise<ProjectInfo[]>
    /** Opens the native directory dialog in main. Resolves null when the user cancels. */
    add(): Promise<ProjectInfo | null>
    remove(projectId: string): Promise<void>
  }
  tasks: {
    list(projectId: string): Promise<TaskInfo[]>
    create(projectId: string, name: string): Promise<TaskInfo>
  }
  state: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  terminals: {
    create(taskId: string, cwd: string): Promise<string>
    write(taskId: string, data: string): Promise<void>
    resize(taskId: string, cols: number, rows: number): Promise<void>
    onData(taskId: string, callback: (data: string) => void): Unsubscribe
    onExit(taskId: string, callback: (exitCode: number) => void): Unsubscribe
  }
  git: {
    getStatus(projectPath: string): Promise<GitStatus>
  }
}
