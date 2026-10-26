import {
  projectTaskProgressAdapterKey,
  projectTaskProgressConfigKey,
  type TaskProgressAdapterInfo,
  type TaskProgressAdapterList,
  type TaskProgressBinding,
  type TaskProgressChangedEvent,
  type TaskProgressError,
  type TaskProgressSnapshot,
  type TaskProgressTestResult,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { parseWslPath } from '@shared/wsl-path'
import {
  type TaskProgressAction,
  TaskProgressAdapterError,
  TaskProgressHost,
  type TaskProgressProjectContext,
} from './adapter-host'
import {
  type DiscoveredTaskProgressAdapter,
  discoverTaskProgressAdapters,
  TASK_PROGRESS_PROTOCOL_VERSION,
  type TaskProgressDiscovery,
} from './adapter-manifest'
import { validateTaskProgressSnapshot } from './snapshot'
import {
  type TaskProgressReadOutcome,
  TaskProgressScheduler,
  type TaskProgressTarget,
  type TaskProgressWatchFactory,
} from './snapshot-scheduler'

// TaskProgressService (spec task-progress-adapters): the main-process facade
// behind the taskProgress:* channels: discovery, the persisted project
// binding, the `test` action, and the observed `snapshot` reads driven by
// TaskProgressScheduler. The renderer only names an adapter id; command and
// directory always come from the discovered manifest.

const CHANNEL = {
  getBinding: 'taskProgress:getBinding',
  saveBinding: 'taskProgress:saveBinding',
  test: 'taskProgress:test',
  get: 'taskProgress:get',
} as const

const MAX_SUMMARY_CHARS = 500

type Failure = { ok: false; error: TaskProgressError }

type Prepared =
  | { ok: true; adapter: DiscoveredTaskProgressAdapter; context: TaskProgressProjectContext }
  | Failure

export interface TaskProgressServiceDeps {
  projects: { get(projectId: string): { path: string } | null }
  state: {
    get(key: string): string | null
    set(key: string, value: string): void
    delete(key: string): void
  }
  /** The fixed `<userData>/task-progress-adapters` directory (spec Behaviour 1). */
  adaptersDir: string
  host?: TaskProgressHost
  discover?: (dir: string) => TaskProgressDiscovery
  /** Directory watcher seam for the scheduler; defaults to fs.watch. */
  watch?: TaskProgressWatchFactory
  log?: (message: string) => void
}

export class TaskProgressService {
  readonly #projects: TaskProgressServiceDeps['projects']
  readonly #state: TaskProgressServiceDeps['state']
  readonly #adaptersDir: string
  readonly #host: TaskProgressHost
  readonly #discover: (dir: string) => TaskProgressDiscovery
  readonly #log: (message: string) => void
  readonly #scheduler: TaskProgressScheduler
  readonly #listeners = new Set<(event: TaskProgressChangedEvent) => void>()
  /** In-flight Test invocations, killed on app quit (spec Behaviour 18). */
  readonly #tests = new Set<AbortController>()

  constructor(deps: TaskProgressServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
    this.#adaptersDir = deps.adaptersDir
    this.#log = deps.log ?? ((message) => console.warn(message))
    this.#host = deps.host ?? new TaskProgressHost({ log: this.#log })
    this.#discover = deps.discover ?? discoverTaskProgressAdapters
    this.#scheduler = new TaskProgressScheduler({
      target: (projectId) => this.target(projectId),
      read: (projectId, target, signal) => this.readSnapshot(projectId, target, signal),
      emit: (event) => {
        for (const listener of this.#listeners) listener(event)
      },
      watch: deps.watch,
      log: this.#log,
    })
  }

  /** Fresh one-level scan on every call; warnings are logged and returned. */
  adaptersList(): TaskProgressAdapterList {
    const { adapters, warnings } = this.scan()
    return { adapters: adapters.map((adapter) => adapter.info), warnings }
  }

  getBinding(projectId: string): TaskProgressBinding {
    this.project(projectId, CHANNEL.getBinding)
    const adapterId = this.#state.get(projectTaskProgressAdapterKey(projectId))
    return {
      adapterId: adapterId === null || adapterId.length === 0 ? null : adapterId,
      config: this.storedConfig(projectId),
    }
  }

  /**
   * Saves the binding (spec Behaviour 7). `null` removes the adapter key and
   * keeps the stored values; an adapter id must name an installed adapter and
   * the values must satisfy its manifest. Either way the project's snapshot
   * and observation stop before a new one starts (Behaviour 12).
   */
  saveBinding(projectId: string, adapterId: string | null, config: Record<string, string>): void {
    this.project(projectId, CHANNEL.saveBinding)
    if (adapterId === null) {
      this.#state.delete(projectTaskProgressAdapterKey(projectId))
      this.#scheduler.rebind(projectId)
      return
    }
    const adapter = this.find(adapterId)
    if (adapter === null) {
      throw new AppError(
        'not_found',
        `Task progress adapter "${adapterId}" is not installed.`,
        CHANNEL.saveBinding,
      )
    }
    const invalid = configError(adapter.info, config)
    if (invalid !== null) {
      throw new AppError('validation', invalid, CHANNEL.saveBinding)
    }
    this.#state.set(projectTaskProgressAdapterKey(projectId), adapterId)
    this.#state.set(projectTaskProgressConfigKey(projectId), JSON.stringify(config))
    this.#scheduler.rebind(projectId)
  }

  /**
   * Runs `test` with the given values (spec Behaviour 8, 14); persists
   * nothing. Afterwards a paused observation of the project resumes
   * (Behaviour 19).
   */
  async test(
    projectId: string,
    adapterId: string,
    config: Record<string, string>,
  ): Promise<TaskProgressTestResult> {
    const project = this.project(projectId, CHANNEL.test)
    const controller = new AbortController()
    this.#tests.add(controller)
    try {
      return await this.runTest(project.path, adapterId, config, controller.signal)
    } finally {
      this.#tests.delete(controller)
      this.#scheduler.resume(projectId)
    }
  }

  /** The full visible project set from the renderer (spec Behaviour 15). */
  observe(projectIds: readonly string[]): void {
    this.#scheduler.observe(projectIds)
  }

  /** In-memory snapshot of an observed bound project, or null (spec Behaviour 22). */
  get(projectId: string): TaskProgressSnapshot | null {
    this.project(projectId, CHANNEL.get)
    return this.#scheduler.get(projectId)
  }

  onChanged(listener: (event: TaskProgressChangedEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  setVisible(visible: boolean): void {
    this.#scheduler.setVisible(visible)
  }

  /** App quit: stop observations and kill running adapter processes. */
  shutdown(): void {
    this.#scheduler.shutdown()
    for (const controller of this.#tests) controller.abort()
    this.#tests.clear()
  }

  /** projects:remove cleanup (spec Behaviour 12): stop observing, then drop the keys. */
  cleanupProject(projectId: string): void {
    this.#scheduler.remove(projectId)
    this.#state.delete(projectTaskProgressAdapterKey(projectId))
    this.#state.delete(projectTaskProgressConfigKey(projectId))
  }

  private async runTest(
    root: string,
    adapterId: string,
    config: Record<string, string>,
    signal: AbortSignal,
  ): Promise<TaskProgressTestResult> {
    const prepared = this.prepare(root, adapterId, config, 'test')
    if (!prepared.ok) return prepared
    let data: unknown
    try {
      data = await this.#host.invoke(
        {
          id: prepared.adapter.info.id,
          dir: prepared.adapter.dir,
          invocation: prepared.adapter.invocation,
        },
        {
          protocolVersion: TASK_PROGRESS_PROTOCOL_VERSION,
          action: 'test',
          config,
          project: prepared.context,
        },
        signal,
      )
    } catch (error) {
      if (error instanceof TaskProgressAdapterError) {
        return failure(error.code, error.message)
      }
      throw error
    }
    const summary = (data as { summary?: unknown } | null)?.summary
    if (
      typeof summary !== 'string' ||
      summary.trim().length === 0 ||
      summary.length > MAX_SUMMARY_CHARS
    ) {
      return failure(
        'protocol',
        `${actionLabel(adapterId, 'test')}: data.summary must be a non-empty string of at most ${MAX_SUMMARY_CHARS} characters.`,
      )
    }
    return { ok: true, summary }
  }

  /** The bound adapter of an existing project, or null (spec Behaviour 13). */
  private target(projectId: string): TaskProgressTarget | null {
    const project = this.#projects.get(projectId)
    if (project === null) return null
    const adapterId = this.#state.get(projectTaskProgressAdapterKey(projectId))
    if (adapterId === null || adapterId.length === 0) return null
    return {
      adapterId,
      root: project.path,
      environment: projectContext(project.path).environment,
    }
  }

  /**
   * One `snapshot` read for the scheduler. Typed failures become outcomes; a
   * cancelled invocation rejects and the scheduler discards it.
   */
  private async readSnapshot(
    projectId: string,
    target: TaskProgressTarget,
    signal: AbortSignal,
  ): Promise<TaskProgressReadOutcome> {
    const label = actionLabel(target.adapterId, 'snapshot')
    let config: Record<string, string>
    try {
      config = this.storedConfig(projectId)
    } catch (error) {
      if (error instanceof AppError) {
        return failure('config', `${label}: ${error.message}`)
      }
      throw error
    }
    const prepared = this.prepare(target.root, target.adapterId, config, 'snapshot')
    if (!prepared.ok) return prepared
    try {
      const data = await this.#host.invoke(
        {
          id: prepared.adapter.info.id,
          dir: prepared.adapter.dir,
          invocation: prepared.adapter.invocation,
        },
        {
          protocolVersion: TASK_PROGRESS_PROTOCOL_VERSION,
          action: 'snapshot',
          config,
          project: prepared.context,
        },
        signal,
      )
      return { ok: true, snapshot: validateTaskProgressSnapshot(data, label, target.root) }
    } catch (error) {
      if (error instanceof TaskProgressAdapterError) {
        return failure(error.code, error.message)
      }
      throw error
    }
  }

  /** Checks shared by Test and snapshot before any process starts (spec Behaviour 14). */
  private prepare(
    root: string,
    adapterId: string,
    config: Record<string, string>,
    action: TaskProgressAction,
  ): Prepared {
    const label = actionLabel(adapterId, action)
    const adapter = this.find(adapterId)
    if (adapter === null) {
      return failure(
        'adapter_missing',
        `${label}: not installed in the task progress adapters directory.`,
      )
    }
    const context = projectContext(root)
    if (!adapter.info.environments.includes(context.environment)) {
      return failure(
        'environment_unsupported',
        `${label}: does not support ${context.environment === 'wsl' ? 'WSL' : 'local'} projects.`,
      )
    }
    const invalid = configError(adapter.info, config)
    if (invalid !== null) {
      return failure('config', `${label}: ${invalid}`)
    }
    return { ok: true, adapter, context }
  }

  private scan(): TaskProgressDiscovery {
    const result = this.#discover(this.#adaptersDir)
    for (const warning of result.warnings) {
      this.#log(`[task-progress] ${warning}`)
    }
    return result
  }

  private find(adapterId: string): DiscoveredTaskProgressAdapter | null {
    return this.scan().adapters.find((adapter) => adapter.info.id === adapterId) ?? null
  }

  private project(projectId: string, channel: string): { path: string } {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    return project
  }

  private storedConfig(projectId: string): Record<string, string> {
    const key = projectTaskProgressConfigKey(projectId)
    const raw = this.#state.get(key)
    if (raw === null) {
      return {}
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((value) => typeof value !== 'string')
    ) {
      throw new AppError(
        'validation',
        `Stored task progress config "${key}" is corrupt; save the tab again to replace it.`,
        CHANNEL.getBinding,
      )
    }
    return parsed as Record<string, string>
  }
}

function failure(code: TaskProgressError['code'], message: string): Failure {
  return { ok: false, error: { code, message } }
}

function actionLabel(adapterId: string, action: TaskProgressAction): string {
  return `Adapter "${adapterId}" (${action})`
}

function projectContext(root: string): TaskProgressProjectContext {
  const wsl = parseWslPath(root)
  return wsl === null
    ? { root, environment: 'local' }
    : { root, environment: 'wsl', distribution: wsl.distribution, linuxRoot: wsl.linuxPath }
}

/** First rule the values break against the manifest schema, or null. */
function configError(
  adapter: TaskProgressAdapterInfo,
  config: Record<string, string>,
): string | null {
  const fields = new Map(adapter.configSchema.map((field) => [field.key, field]))
  for (const key of Object.keys(config)) {
    if (!fields.has(key)) {
      return `Unknown field "${key}" for adapter "${adapter.id}".`
    }
  }
  for (const field of adapter.configSchema) {
    const value = config[field.key]
    if (value === undefined || value.trim().length === 0) {
      if (field.required) {
        return `Field "${field.label}" is required.`
      }
      continue
    }
    if (field.type === 'select' && !(field.options ?? []).includes(value)) {
      return `Field "${field.label}" must be one of ${(field.options ?? []).join('|')}.`
    }
    if (field.type === 'boolean' && value !== 'true' && value !== 'false') {
      return `Field "${field.label}" must be "true" or "false".`
    }
  }
  return null
}
