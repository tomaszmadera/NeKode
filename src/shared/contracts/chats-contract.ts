export type SessionStatus = 'running' | 'waiting' | 'idle'

export interface SessionTaskProgress {
  taskId: string
  step: number
  totalSteps: number
  taskTitle?: string
  stepName?: string
  fix?: number
  review?: number
  stepNames?: readonly string[]
  ariaLabel?: string
  label?: string
  stale?: boolean
  staleReason?: string
}

/** Launch-time display identity, independent of mutable agent profile definitions. */
export interface ChatLaunchIdentity {
  taskRef?: string
  agentName?: string
}

// A chat is a terminal session listed under a project (spec Data/API).
export interface ChatInfo extends ChatLaunchIdentity {
  id: string
  projectId: string
  name: string
  status?: SessionStatus
}
