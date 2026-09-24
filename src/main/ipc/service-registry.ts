import type { ProjectInfo, TaskInfo } from '../../shared/ipc-contract'

// Real service registry for Stage 2 channels. Terminal and git channels stay
// on Stage 1 stub values behind the same contract until Stage 3 (see
// ipc-handlers.ts STUB_CHANNELS).

export interface AppServices {
  projects: {
    list(): ProjectInfo[]
    add(path: string): ProjectInfo
    remove(projectId: string): void
  }
  tasks: {
    list(projectId: string): TaskInfo[]
    create(projectId: string, name: string): TaskInfo
  }
  state: {
    get(key: string): string | null
    set(key: string, value: string): void
  }
}
