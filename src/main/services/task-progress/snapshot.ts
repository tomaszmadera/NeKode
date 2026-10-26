import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  TaskProgressActivity,
  TaskProgressItem,
  TaskProgressLocation,
  TaskProgressPhase,
  TaskProgressRecordState,
  TaskProgressTaskState,
} from '@shared/ipc-contract'
import { TaskProgressAdapterError } from './adapter-host'

// Validation of the `snapshot` response (spec task-progress-adapters Data /
// API, `schemaVersion: 1`). A missing required field, a wrong type, or an
// inconsistency (duplicate task id, currentStepId without a step, a watch path
// leaving the project) rejects the whole snapshot as a protocol error. Unknown
// fields are ignored; optional fields are normalized for the renderer.

export const TASK_PROGRESS_SCHEMA_VERSION = 1
export const MAX_WATCH_ENTRIES = 8
const MAX_TASK_ID_CHARS = 120
const MAX_CURRENT_LABEL_CHARS = 40

const STATES: readonly TaskProgressTaskState[] = ['active', 'blocked', 'completed']
const LOCATIONS: readonly TaskProgressLocation[] = ['live', 'archived']
const RECORD_STATES: readonly TaskProgressRecordState[] = ['valid', 'invalid', 'unsupported']
const ACTIVITIES: readonly TaskProgressActivity[] = ['working', 'waiting', 'idle']
/** ISO 8601 in UTC (`Z`), optional fraction of a second. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export interface TaskProgressWatchEntry {
  /** Relative to `project.root`, `/`-separated. */
  path: string
  recursive: boolean
}

export interface ValidatedTaskProgressSnapshot {
  generatedAt: string
  watch: TaskProgressWatchEntry[]
  tasks: TaskProgressItem[]
}

type Fail = (detail: string) => never

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoUtc(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
}

/** `null` and absent read as null; any other non-string is a type error. */
function optionalText(value: unknown, field: string, fail: Fail): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') fail(`${field} must be a string or null`)
  return value as string
}

function optionalTimestamp(value: unknown, field: string, fail: Fail): string | null {
  if (value === undefined || value === null) return null
  if (!isIsoUtc(value)) fail(`${field} must be an ISO 8601 UTC timestamp`)
  return value as string
}

function optionalCount(value: unknown, field: string, fail: Fail): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${field} must be a non-negative integer`)
  }
  return value as number
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fail: Fail,
): T {
  if (!allowed.includes(value as T)) fail(`${field} must be one of ${allowed.join('|')}`)
  return value as T
}

/** Relative, no `..`, not absolute in POSIX, drive, or UNC form. */
function isContainedRelative(path: string): boolean {
  if (path.length === 0 || path.includes('\0')) return false
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

function parseWatch(value: unknown, fail: Fail): TaskProgressWatchEntry[] {
  if (!Array.isArray(value)) fail('watch must be an array')
  const entries = value as unknown[]
  if (entries.length > MAX_WATCH_ENTRIES) {
    fail(`watch must have at most ${MAX_WATCH_ENTRIES} entries`)
  }
  return entries.map((entry, index) => {
    const field = `watch[${index}]`
    if (!isRecord(entry)) fail(`${field} must be an object`)
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string' || !isContainedRelative(record.path)) {
      fail(`${field}.path must be a relative path inside the project without ".."`)
    }
    if (record.recursive !== undefined && typeof record.recursive !== 'boolean') {
      fail(`${field}.recursive must be a boolean`)
    }
    return {
      path: (record.path as string).replace(/\\/g, '/'),
      recursive: record.recursive === true,
    }
  })
}

function realPathIfPresent(path: string): string | null {
  try {
    return realpathSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Missing directories are supported by the scheduler's 10 s polling.
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

/** Resolve links as well as lexical paths before accepting directories to watch. */
function validateWatchRoots(root: string, watch: TaskProgressWatchEntry[], fail: Fail): void {
  const realRoot = realPathIfPresent(root)
  if (realRoot === null) return
  for (const entry of watch) {
    let candidate = resolve(root, entry.path)
    let realCandidate = realPathIfPresent(candidate)
    // A missing leaf can still have a linked parent outside the project.
    while (realCandidate === null && candidate !== dirname(candidate)) {
      candidate = dirname(candidate)
      realCandidate = realPathIfPresent(candidate)
    }
    if (realCandidate === null) continue
    const rel = relative(realRoot, realCandidate)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
      fail(`watch path "${entry.path}" resolves outside the project`)
    }
  }
}

function parsePhases(value: unknown, field: string, fail: Fail): TaskProgressPhase[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`)
  return (value as unknown[]).map((phase, phaseIndex) => {
    const phaseField = `${field}[${phaseIndex}]`
    if (!isRecord(phase)) fail(`${phaseField} must be an object`)
    const record = phase as Record<string, unknown>
    if (typeof record.name !== 'string') fail(`${phaseField}.name must be a string`)
    if (!Array.isArray(record.steps)) fail(`${phaseField}.steps must be an array`)
    const steps = (record.steps as unknown[]).map((step, stepIndex) => {
      const stepField = `${phaseField}.steps[${stepIndex}]`
      if (!isRecord(step)) fail(`${stepField} must be an object`)
      const s = step as Record<string, unknown>
      if (typeof s.id !== 'string' || s.id.length === 0) {
        fail(`${stepField}.id must be a non-empty string`)
      }
      if (typeof s.label !== 'string') fail(`${stepField}.label must be a string`)
      if (typeof s.done !== 'boolean') fail(`${stepField}.done must be a boolean`)
      return { id: s.id as string, label: s.label as string, done: s.done as boolean }
    })
    return { name: record.name as string, steps }
  })
}

function parseTask(value: unknown, index: number, fail: Fail): TaskProgressItem {
  const field = `tasks[${index}]`
  if (!isRecord(value)) fail(`${field} must be an object`)
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > MAX_TASK_ID_CHARS) {
    fail(`${field}.id must be a string of 1-${MAX_TASK_ID_CHARS} characters`)
  }
  const id = raw.id as string
  const at = `${field} ("${id}")`
  const recordState = oneOf(raw.recordState, RECORD_STATES, `${at}.recordState`, fail)
  const phases = parsePhases(raw.phases, `${at}.phases`, fail)
  if (recordState === 'valid' && phases.length === 0) {
    fail(`${at}.phases must not be empty for a valid record`)
  }
  const stepIds = new Set<string>()
  for (const phase of phases) {
    for (const step of phase.steps) {
      if (stepIds.has(step.id)) fail(`${at} repeats step id "${step.id}"`)
      stepIds.add(step.id)
    }
  }
  const currentStepId = optionalText(raw.currentStepId, `${at}.currentStepId`, fail)
  if (currentStepId !== null && !stepIds.has(currentStepId)) {
    fail(`${at}.currentStepId "${currentStepId}" names no step`)
  }
  const currentLabel = optionalText(raw.currentLabel, `${at}.currentLabel`, fail)
  if (currentLabel !== null && currentLabel.length > MAX_CURRENT_LABEL_CHARS) {
    fail(`${at}.currentLabel must have at most ${MAX_CURRENT_LABEL_CHARS} characters`)
  }
  let errors: string[] = []
  if (raw.errors !== undefined && raw.errors !== null) {
    if (!Array.isArray(raw.errors) || raw.errors.some((entry) => typeof entry !== 'string')) {
      fail(`${at}.errors must be a list of strings`)
    }
    errors = raw.errors as string[]
  }
  const activity =
    raw.activity === undefined || raw.activity === null
      ? null
      : oneOf(raw.activity, ACTIVITIES, `${at}.activity`, fail)
  let checkpoints: TaskProgressItem['checkpoints'] = []
  if (raw.checkpoints !== undefined && raw.checkpoints !== null) {
    if (!Array.isArray(raw.checkpoints)) fail(`${at}.checkpoints must be an array`)
    checkpoints = (raw.checkpoints as unknown[]).map((entry, checkpointIndex) => {
      const checkpointField = `${at}.checkpoints[${checkpointIndex}]`
      if (!isRecord(entry) || typeof entry.stepId !== 'string' || !isIsoUtc(entry.completedAt)) {
        fail(`${checkpointField} must carry stepId and an ISO 8601 UTC completedAt`)
      }
      const checkpoint = entry as Record<string, unknown>
      return { stepId: checkpoint.stepId as string, completedAt: checkpoint.completedAt as string }
    })
  }
  const path = optionalText(raw.path, `${at}.path`, fail)
  if (path !== null && !isContainedRelative(path)) {
    fail(`${at}.path must be a relative path`)
  }
  return {
    id,
    ref: optionalText(raw.ref, `${at}.ref`, fail),
    title: optionalText(raw.title, `${at}.title`, fail),
    state: oneOf(raw.state, STATES, `${at}.state`, fail),
    location: oneOf(raw.location, LOCATIONS, `${at}.location`, fail),
    recordState,
    errors,
    activity,
    phases,
    currentStepId,
    currentLabel,
    corrections: optionalCount(raw.corrections, `${at}.corrections`, fail),
    reviews: optionalCount(raw.reviews, `${at}.reviews`, fail),
    nextAction: optionalText(raw.nextAction, `${at}.nextAction`, fail),
    blockers: optionalText(raw.blockers, `${at}.blockers`, fail),
    createdAt: optionalTimestamp(raw.createdAt, `${at}.createdAt`, fail),
    updatedAt: optionalTimestamp(raw.updatedAt, `${at}.updatedAt`, fail),
    completedAt: optionalTimestamp(raw.completedAt, `${at}.completedAt`, fail),
    checkpoints,
    path,
  }
}

/**
 * Validates the `data` of an ok `snapshot` response. Throws a
 * TaskProgressAdapterError with code `protocol` whose message starts with
 * `label` (the adapter id and action).
 */
export function validateTaskProgressSnapshot(
  data: unknown,
  label: string,
  projectRoot?: string,
): ValidatedTaskProgressSnapshot {
  const fail: Fail = (detail) => {
    throw new TaskProgressAdapterError('protocol', `${label}: invalid snapshot: ${detail}`)
  }
  if (!isRecord(data)) fail('data must be a JSON object')
  const raw = data as Record<string, unknown>
  if (raw.schemaVersion !== TASK_PROGRESS_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${TASK_PROGRESS_SCHEMA_VERSION}`)
  }
  if (!isIsoUtc(raw.generatedAt)) fail('generatedAt must be an ISO 8601 UTC timestamp')
  const watch = parseWatch(raw.watch, fail)
  if (projectRoot !== undefined) validateWatchRoots(projectRoot, watch, fail)
  if (!Array.isArray(raw.tasks)) fail('tasks must be an array')
  const tasks = (raw.tasks as unknown[]).map((entry, index) => parseTask(entry, index, fail))
  const seen = new Set<string>()
  for (const item of tasks) {
    if (seen.has(item.id)) fail(`task id "${item.id}" is repeated`)
    seen.add(item.id)
  }
  return { generatedAt: raw.generatedAt as string, watch, tasks }
}
