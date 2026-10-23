import { watch as fsWatch, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  TaskProgressChangedEvent,
  TaskProgressEnvironment,
  TaskProgressError,
  TaskProgressErrorCode,
  TaskProgressItem,
  TaskProgressSnapshot,
} from '../../../shared/ipc-contract'
import type { TaskProgressWatchEntry, ValidatedTaskProgressSnapshot } from './snapshot'

// Snapshot refresh per observed project (spec task-progress-adapters Behaviour
// 12-13, 15-21). One runtime per bound, visible project. A runtime is the
// identity of its reads: stopping it (binding change, unobserve, removal,
// quit) aborts the in-flight read, and any late result whose runtime is no
// longer current is discarded, so a result never lands in another project or
// binding. Timers use the global clock, which tests replace with fake timers.

export const TASK_PROGRESS_DEBOUNCE_MS = 300
export const TASK_PROGRESS_MIN_GAP_MS = 2_000
export const TASK_PROGRESS_POLL_WATCHING_MS = 60_000
export const TASK_PROGRESS_POLL_FALLBACK_MS = 10_000
export const TASK_PROGRESS_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const
export const TASK_PROGRESS_CONFIRM_REMOVAL_MS = 1_000

/** Retried after 1/2/4 s keeping the last snapshot fresh (spec Behaviour 19). */
const RETRY_CODES: ReadonlySet<TaskProgressErrorCode> = new Set([
  'transient',
  'protocol',
  'timeout',
])
/**
 * Stale at once and no automatic reads until a binding change, a manual
 * Test, or the next watched change (spec Behaviour 19). `adapter_missing` and
 * `spawn` cannot heal without user action either. Any other code (`internal`)
 * is stale at once and keeps regular polling.
 */
const PAUSE_CODES: ReadonlySet<TaskProgressErrorCode> = new Set([
  'config',
  'runtime',
  'unsupported_source',
  'environment_unsupported',
  'adapter_missing',
  'spawn',
])

/** What a runtime reads: fixed for its lifetime; a binding change starts a new runtime. */
export interface TaskProgressTarget {
  adapterId: string
  /** Host path of the project; watch paths resolve against it. */
  root: string
  environment: TaskProgressEnvironment
}

export type TaskProgressReadOutcome =
  | { ok: true; snapshot: ValidatedTaskProgressSnapshot }
  | { ok: false; error: TaskProgressError }

export interface TaskProgressWatchHandle {
  close(): void
}

/** Starts watching one directory; throws when it cannot (missing directory, permissions). */
export type TaskProgressWatchFactory = (
  path: string,
  recursive: boolean,
  onChange: () => void,
  onError: (error: Error) => void,
) => TaskProgressWatchHandle

export interface TaskProgressSchedulerDeps {
  /** The project's binding, or null when it is unbound or gone (spec Behaviour 13). */
  target(projectId: string): TaskProgressTarget | null
  /** One `snapshot` invocation; must stop its process when `signal` aborts. */
  read(
    projectId: string,
    target: TaskProgressTarget,
    signal: AbortSignal,
  ): Promise<TaskProgressReadOutcome>
  emit(event: TaskProgressChangedEvent): void
  watch?: TaskProgressWatchFactory
  log?: (message: string) => void
}

interface Runtime {
  projectId: string
  target: TaskProgressTarget
  snapshot: TaskProgressSnapshot | null
  /** Earliest confirmation time for each task that vanished once. */
  pendingRemoval: Map<string, number>
  controller: AbortController | null
  followUp: boolean
  lastStart: number
  timer: ReturnType<typeof setTimeout> | null
  timerAt: number
  debounce: ReturnType<typeof setTimeout> | null
  failures: number
  paused: boolean
  /** A read came due while the window was hidden (spec Behaviour 18). */
  missed: boolean
  watchKey: string | null
  watchers: TaskProgressWatchHandle[]
  watching: boolean
  stopped: boolean
}

/** fs.watch on an existing directory; `persistent: false` never keeps the app alive. */
export const watchDirectory: TaskProgressWatchFactory = (path, recursive, onChange, onError) => {
  if (!statSync(path).isDirectory()) {
    throw new Error(`${path} is not a directory`)
  }
  const watcher = fsWatch(path, { recursive, persistent: false }, () => onChange())
  watcher.on('error', onError)
  return { close: () => watcher.close() }
}

export class TaskProgressScheduler {
  readonly #deps: TaskProgressSchedulerDeps
  readonly #watch: TaskProgressWatchFactory
  readonly #log: (message: string) => void
  readonly #runtimes = new Map<string, Runtime>()
  #observed = new Set<string>()
  #visible = false
  #shutdown = false

  constructor(deps: TaskProgressSchedulerDeps) {
    this.#deps = deps
    this.#watch = deps.watch ?? watchDirectory
    this.#log = deps.log ?? ((message) => console.warn(message))
  }

  /** The full visible set (spec Behaviour 15); projects outside it stop at once. */
  observe(projectIds: readonly string[]): void {
    if (this.#shutdown) return
    this.#observed = new Set(projectIds)
    for (const runtime of [...this.#runtimes.values()]) {
      if (!this.#observed.has(runtime.projectId)) {
        this.#stop(runtime, true)
      }
    }
    for (const projectId of this.#observed) {
      if (!this.#runtimes.has(projectId)) {
        this.#start(projectId)
      }
    }
  }

  get(projectId: string): TaskProgressSnapshot | null {
    return this.#runtimes.get(projectId)?.snapshot ?? null
  }

  /** Binding saved or set to None (spec Behaviour 12): stop first, then start anew. */
  rebind(projectId: string): void {
    const runtime = this.#runtimes.get(projectId)
    if (runtime !== undefined) {
      this.#stop(runtime, true)
    }
    if (!this.#shutdown && this.#observed.has(projectId)) {
      this.#start(projectId)
    }
  }

  /** Manual Test lifts a pause (spec Behaviour 19). */
  resume(projectId: string): void {
    const runtime = this.#runtimes.get(projectId)
    if (runtime === undefined || !runtime.paused) return
    runtime.paused = false
    this.#request(runtime)
  }

  /** projects:remove: stop without any event for the removed project. */
  remove(projectId: string): void {
    this.#observed.delete(projectId)
    const runtime = this.#runtimes.get(projectId)
    if (runtime !== undefined) {
      this.#stop(runtime, false)
    }
  }

  /** Hidden or minimized windows pause reads; showing runs one overdue read per project. */
  setVisible(visible: boolean): void {
    this.#visible = visible
    if (!visible) return
    for (const runtime of this.#runtimes.values()) {
      if (runtime.missed) {
        runtime.missed = false
        this.#request(runtime)
      }
    }
  }

  /** App quit: stop every observation and kill running adapter processes. */
  shutdown(): void {
    this.#shutdown = true
    for (const runtime of [...this.#runtimes.values()]) {
      this.#stop(runtime, false)
    }
    this.#observed.clear()
  }

  #start(projectId: string): void {
    const target = this.#deps.target(projectId)
    if (target === null) return
    const runtime: Runtime = {
      projectId,
      target,
      snapshot: null,
      pendingRemoval: new Map(),
      controller: null,
      followUp: false,
      lastStart: Number.NEGATIVE_INFINITY,
      timer: null,
      timerAt: 0,
      debounce: null,
      failures: 0,
      paused: false,
      missed: false,
      watchKey: null,
      watchers: [],
      watching: false,
      stopped: false,
    }
    this.#runtimes.set(projectId, runtime)
    this.#request(runtime)
  }

  #stop(runtime: Runtime, announce: boolean): void {
    runtime.stopped = true
    runtime.controller?.abort()
    runtime.controller = null
    if (runtime.timer !== null) clearTimeout(runtime.timer)
    if (runtime.debounce !== null) clearTimeout(runtime.debounce)
    runtime.timer = null
    runtime.debounce = null
    this.#closeWatchers(runtime)
    this.#runtimes.delete(runtime.projectId)
    if (announce) {
      this.#deps.emit({ projectId: runtime.projectId, cleared: true })
    }
  }

  /** A read for a change, a follow-up, or a catch-up: single-flight and the 2 s gap. */
  #request(runtime: Runtime): void {
    if (runtime.paused) return
    if (runtime.controller !== null) {
      runtime.followUp = true
      return
    }
    this.#scheduleAt(runtime, Math.max(Date.now(), runtime.lastStart + TASK_PROGRESS_MIN_GAP_MS))
  }

  /** Keeps the earliest due read; a read already due starts now. */
  #scheduleAt(runtime: Runtime, at: number): void {
    if (runtime.stopped) return
    // Retry and removal-confirmation delays also obey the global per-project limit.
    at = Math.max(at, runtime.lastStart + TASK_PROGRESS_MIN_GAP_MS)
    if (runtime.timer !== null) {
      if (runtime.timerAt <= at) return
      clearTimeout(runtime.timer)
      runtime.timer = null
    }
    if (at <= Date.now()) {
      this.#fire(runtime)
      return
    }
    runtime.timerAt = at
    runtime.timer = setTimeout(() => this.#fire(runtime), Math.max(0, at - Date.now()))
  }

  #fire(runtime: Runtime): void {
    runtime.timer = null
    if (runtime.stopped) return
    if (!this.#visible) {
      runtime.missed = true
      return
    }
    if (runtime.controller !== null) {
      runtime.followUp = true
      return
    }
    void this.#run(runtime)
  }

  async #run(runtime: Runtime): Promise<void> {
    const controller = new AbortController()
    runtime.controller = controller
    runtime.lastStart = Date.now()
    let outcome: TaskProgressReadOutcome
    try {
      outcome = await this.#deps.read(runtime.projectId, runtime.target, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      this.#log(`[task-progress] snapshot read for project ${runtime.projectId} failed: ${detail}`)
      outcome = {
        ok: false,
        error: {
          code: 'internal',
          message: `Adapter "${runtime.target.adapterId}" (snapshot): unexpected failure: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      }
    }
    // Behaviour 21: a result whose runtime was stopped or replaced is discarded.
    if (controller.signal.aborted || runtime.stopped || runtime.controller !== controller) return
    runtime.controller = null
    if (outcome.ok) {
      this.#applySnapshot(runtime, outcome.snapshot)
    } else {
      this.#applyError(runtime, outcome.error)
    }
    if (runtime.followUp) {
      runtime.followUp = false
      this.#request(runtime)
    }
  }

  #pollDelay(runtime: Runtime): number {
    return runtime.watching ? TASK_PROGRESS_POLL_WATCHING_MS : TASK_PROGRESS_POLL_FALLBACK_MS
  }

  #applySnapshot(runtime: Runtime, snapshot: ValidatedTaskProgressSnapshot): void {
    runtime.failures = 0
    runtime.paused = false
    // Behaviour 20: a task missing from a valid snapshot stays until a
    // confirming read started after the delay agrees; a task that reappears
    // clears its pending mark.
    const nextIds = new Set(snapshot.tasks.map((item) => item.id))
    const kept: TaskProgressItem[] = []
    const pending = new Map<string, number>()
    for (const item of runtime.snapshot?.tasks ?? []) {
      if (nextIds.has(item.id)) continue
      const confirmAt = runtime.pendingRemoval.get(item.id)
      if (confirmAt !== undefined && confirmAt <= runtime.lastStart) continue
      kept.push(item)
      pending.set(item.id, confirmAt ?? Date.now() + TASK_PROGRESS_CONFIRM_REMOVAL_MS)
    }
    runtime.pendingRemoval = pending
    runtime.snapshot = {
      projectId: runtime.projectId,
      adapterId: runtime.target.adapterId,
      status: 'ok',
      tasks: [...snapshot.tasks, ...kept],
      receivedAt: new Date(Date.now()).toISOString(),
    }
    this.#deps.emit(runtime.snapshot)
    this.#refreshWatch(runtime, snapshot.watch)
    this.#scheduleAt(runtime, Date.now() + this.#pollDelay(runtime))
    if (pending.size > 0) {
      let nextConfirmation = Number.POSITIVE_INFINITY
      for (const at of pending.values()) nextConfirmation = Math.min(nextConfirmation, at)
      this.#scheduleAt(runtime, nextConfirmation)
    }
  }

  #applyError(runtime: Runtime, error: TaskProgressError): void {
    if (RETRY_CODES.has(error.code)) {
      runtime.failures += 1
      const delay = TASK_PROGRESS_RETRY_DELAYS_MS[runtime.failures - 1]
      if (delay !== undefined) {
        runtime.snapshot = {
          projectId: runtime.projectId,
          adapterId: runtime.target.adapterId,
          status: runtime.snapshot?.status ?? 'ok',
          tasks: runtime.snapshot?.tasks ?? [],
          receivedAt: runtime.snapshot?.receivedAt ?? null,
          error,
        }
        this.#deps.emit(runtime.snapshot)
        this.#scheduleAt(runtime, Date.now() + delay)
        return
      }
    }
    runtime.snapshot = {
      projectId: runtime.projectId,
      adapterId: runtime.target.adapterId,
      status: 'stale',
      tasks: runtime.snapshot?.tasks ?? [],
      receivedAt: runtime.snapshot?.receivedAt ?? null,
      error,
    }
    this.#deps.emit(runtime.snapshot)
    if (PAUSE_CODES.has(error.code)) {
      runtime.paused = true
      runtime.followUp = false
      if (runtime.timer !== null) clearTimeout(runtime.timer)
      runtime.timer = null
      if (runtime.debounce !== null) clearTimeout(runtime.debounce)
      runtime.debounce = null
      return
    }
    this.#scheduleAt(runtime, Date.now() + this.#pollDelay(runtime))
  }

  /**
   * Renews directory watching when `watch` changes, or when watching is not
   * fully working (a directory created later is picked up by the next
   * snapshot). WSL projects are never watched: changes over UNC are not
   * reported reliably, so they rely on the 10 s polling.
   */
  #refreshWatch(runtime: Runtime, watch: TaskProgressWatchEntry[]): void {
    if (runtime.target.environment === 'wsl') return
    const key = JSON.stringify(watch)
    if (key === runtime.watchKey && runtime.watching) return
    const firstAttempt = key !== runtime.watchKey
    this.#closeWatchers(runtime)
    runtime.watchKey = key
    let complete = watch.length > 0
    for (const entry of watch) {
      const path = resolve(runtime.target.root, entry.path)
      try {
        runtime.watchers.push(
          this.#watch(
            path,
            entry.recursive,
            () => this.#onChange(runtime),
            (error) => this.#onWatchError(runtime, path, error),
          ),
        )
      } catch (error) {
        complete = false
        if (firstAttempt) {
          this.#log(
            `[task-progress] cannot watch ${path} for project ${runtime.projectId}; polling every ${
              TASK_PROGRESS_POLL_FALLBACK_MS / 1000
            } s: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
    runtime.watching = complete
  }

  #closeWatchers(runtime: Runtime): void {
    for (const watcher of runtime.watchers) {
      watcher.close()
    }
    runtime.watchers = []
    runtime.watching = false
  }

  #onChange(runtime: Runtime): void {
    if (runtime.stopped) return
    // Behaviour 19: the next watched change lifts a pause.
    runtime.paused = false
    if (runtime.debounce !== null) clearTimeout(runtime.debounce)
    runtime.debounce = setTimeout(() => {
      runtime.debounce = null
      if (!runtime.stopped) this.#request(runtime)
    }, TASK_PROGRESS_DEBOUNCE_MS)
  }

  #onWatchError(runtime: Runtime, path: string, error: Error): void {
    if (runtime.stopped) return
    this.#log(
      `[task-progress] watching ${path} for project ${runtime.projectId} failed; polling every ${
        TASK_PROGRESS_POLL_FALLBACK_MS / 1000
      } s: ${error.message}`,
    )
    this.#closeWatchers(runtime)
    if (runtime.controller === null && !runtime.paused) {
      this.#scheduleAt(runtime, Date.now() + TASK_PROGRESS_POLL_FALLBACK_MS)
    }
  }
}
