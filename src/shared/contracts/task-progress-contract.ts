// ---------------------------------------------------------------------------
// Task progress adapters (spec task-progress-adapters). Adapters are external
// user-installed processes discovered in one fixed directory; the renderer
// never supplies a command, path, or adapters directory.
// ---------------------------------------------------------------------------

/** v1 field types. There are no secret or directory fields (spec Behaviour 2, Non-goals). */
export type TaskProgressConfigFieldType = 'string' | 'select' | 'boolean'

export interface TaskProgressConfigField {
  key: string
  label: string
  type: TaskProgressConfigFieldType
  required: boolean
  /** `select` fields only: the allowed values (at least one). */
  options?: string[]
  default?: string | boolean
}

export type TaskProgressEnvironment = 'local' | 'wsl'

export interface TaskProgressAdapterInfo {
  id: string
  name: string
  /** Project environments the adapter supports; the manifest default is `["local"]`. */
  environments: TaskProgressEnvironment[]
  configSchema: TaskProgressConfigField[]
}

/** `taskProgress:adaptersList` result: a fresh scan plus skipped-manifest warnings. */
export interface TaskProgressAdapterList {
  adapters: TaskProgressAdapterInfo[]
  warnings: string[]
}

/**
 * Stored project binding. Field values travel as strings (`boolean` fields as
 * `"true"`/`"false"`), like the kanban adapter config.
 */
export interface TaskProgressBinding {
  adapterId: string | null
  config: Record<string, string>
}

/** Typed error codes (spec Errors): host codes first, then adapter-reported codes. */
export type TaskProgressErrorCode =
  | 'adapter_missing'
  | 'environment_unsupported'
  | 'timeout'
  | 'protocol'
  | 'spawn'
  | 'config'
  | 'runtime'
  | 'unsupported_source'
  | 'transient'
  | 'internal'

export interface TaskProgressError {
  code: TaskProgressErrorCode
  /** Names the adapter id and the action; never carries adapter stderr. */
  message: string
}

/** `taskProgress:test` result: the adapter summary or a typed error, never a toast. */
export type TaskProgressTestResult =
  | { ok: true; summary: string }
  | { ok: false; error: TaskProgressError }

export type TaskProgressTaskState = 'active' | 'blocked' | 'completed'
export type TaskProgressLocation = 'live' | 'archived'
export type TaskProgressRecordState = 'valid' | 'invalid' | 'unsupported'
export type TaskProgressActivity = 'working' | 'waiting' | 'idle'

export interface TaskProgressStep {
  id: string
  label: string
  done: boolean
}

export interface TaskProgressPhase {
  name: string
  steps: TaskProgressStep[]
}

/**
 * One task of a validated `snapshot` response (spec Data / API). Optional
 * adapter fields are normalized: absent text and timestamps read as null,
 * absent lists as empty, absent counters as 0.
 */
export interface TaskProgressItem {
  id: string
  ref: string | null
  title: string | null
  state: TaskProgressTaskState
  location: TaskProgressLocation
  recordState: TaskProgressRecordState
  errors: string[]
  activity: TaskProgressActivity | null
  phases: TaskProgressPhase[]
  currentStepId: string | null
  currentLabel: string | null
  corrections: number
  reviews: number
  nextAction: string | null
  blockers: string | null
  createdAt: string | null
  updatedAt: string | null
  completedAt: string | null
  checkpoints: { stepId: string; completedAt: string }[]
  /** Relative, informational only. */
  path: string | null
}

/**
 * In-memory progress of one bound, observed project (spec Data / API).
 * `stale` keeps the last valid tasks and carries the current error.
 * `receivedAt` is the time of the last valid snapshot, null before the first.
 */
export interface TaskProgressSnapshot {
  projectId: string
  adapterId: string
  status: 'ok' | 'stale'
  tasks: TaskProgressItem[]
  receivedAt: string | null
  error?: TaskProgressError
}

/** `taskProgress:changed` payload: a new snapshot, or the project's snapshot was dropped. */
export type TaskProgressChangedEvent = TaskProgressSnapshot | { projectId: string; cleared: true }

/** Structural guard for the preload event listener. */
export function isTaskProgressChangedEvent(value: unknown): value is TaskProgressChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  if (typeof event.projectId !== 'string') return false
  if (event.cleared === true) return true
  return (
    typeof event.adapterId === 'string' &&
    (event.status === 'ok' || event.status === 'stale') &&
    Array.isArray(event.tasks)
  )
}
