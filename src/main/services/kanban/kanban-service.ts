import type {
  KanbanAdapterInfo,
  KanbanBoard,
  KanbanCreateInput,
  KanbanPriority,
  KanbanProjectConfig,
  KanbanUpdatePatch,
  WorkItem,
} from '../../../shared/ipc-contract'
import {
  KANBAN_PRIORITIES,
  projectKanbanAdapterKey,
  projectKanbanConfigKey,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { AdapterHost, toAppError } from './adapter-host'
import { type DiscoveredAdapter, discoverAdapters } from './adapter-manifest'
import { normalizeItem, normalizeItems, normalizeStates } from './adapter-protocol'

// KanbanService (spec kanban-adapter-interface Behaviour 4–11): the single
// main-process facade behind the kanban:* channels. Binding and config live
// in the flat app_state store under per-project keys; secret values are
// write-only through getConfig. Every backend call goes through the adapter
// host (one process per request); errors map to typed codes — never silent
// fallbacks (spec Errors).

const CHANNEL = {
  adaptersList: 'kanban:adaptersList',
  getConfig: 'kanban:getConfig',
  setConfig: 'kanban:setConfig',
  test: 'kanban:test',
  listBoard: 'kanban:listBoard',
  createItem: 'kanban:createItem',
  updateItem: 'kanban:updateItem',
} as const

/** Minimal project lookup (the ProjectService surface this service needs). */
export interface KanbanProjectLookup {
  get(projectId: string): { path: string } | null
}

/** Minimal setting read/write/delete (the AppStateService surface). */
export interface KanbanStateStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export interface KanbanServiceDeps {
  projects: KanbanProjectLookup
  state: KanbanStateStore
  /** Absolute adapters directory (userData default or the stored override). */
  adaptersDir: () => string
  host?: AdapterHost
}

export interface KanbanSetConfigInput {
  adapterId: string | null
  values: Record<string, string>
}

interface StoredConfig {
  values: Record<string, string>
}

function parseStoredConfig(raw: string | null): StoredConfig {
  if (raw === null || raw.trim().length === 0) {
    return { values: {} }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { values: {} }
    }
    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        values[key] = value
      }
    }
    return { values }
  } catch {
    // A corrupt stored object degrades to unconfigured values; the binding
    // stays intact so the settings tab can surface and fix it.
    return { values: {} }
  }
}

export class KanbanService {
  readonly #projects: KanbanProjectLookup
  readonly #state: KanbanStateStore
  readonly #adaptersDir: () => string
  readonly #host: AdapterHost

  constructor(deps: KanbanServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
    this.#adaptersDir = deps.adaptersDir
    this.#host = deps.host ?? new AdapterHost()
  }

  /** Fresh one-level scan; warnings go to the main log, never to the UI. */
  adaptersList(): KanbanAdapterInfo[] {
    const { adapters, warnings } = discoverAdapters(this.#adaptersDir())
    for (const warning of warnings) {
      console.warn(`[kanban] ${warning}`)
    }
    return adapters.map((adapter) => adapter.info)
  }

  getConfig(projectId: string): KanbanProjectConfig {
    this.assertProject(projectId)
    const adapterId = this.#state.get(projectKanbanAdapterKey(projectId))
    const stored = parseStoredConfig(this.#state.get(projectKanbanConfigKey(projectId)))
    const schema = this.schemaFor(adapterId)
    const values: Record<string, string | null> = {}
    const secretKeys: string[] = []
    for (const field of schema) {
      const value = stored.values[field.key]
      if (value === undefined) {
        values[field.key] = null
        continue
      }
      if (field.type === 'secret') {
        secretKeys.push(field.key)
        values[field.key] = null
        continue
      }
      values[field.key] = value
    }
    // Keys without a schema entry (adapter replaced/removed) still surface as
    // null values so the renderer form stays exhaustive.
    for (const key of Object.keys(stored.values)) {
      if (!(key in values)) {
        values[key] = null
      }
    }
    return {
      adapterId: adapterId === null || adapterId.trim().length === 0 ? null : adapterId,
      values,
      secretKeys,
    }
  }

  setConfig(projectId: string, input: KanbanSetConfigInput): void {
    this.assertProject(projectId)
    if (typeof input !== 'object' || input === null) {
      throw new AppError(
        'validation',
        'kanban:setConfig requires a config object',
        CHANNEL.setConfig,
      )
    }
    const adapterId = input.adapterId
    if (adapterId !== null && typeof adapterId !== 'string') {
      throw new AppError(
        'validation',
        'kanban:setConfig adapterId must be a string or null',
        CHANNEL.setConfig,
      )
    }
    if (typeof input.values !== 'object' || input.values === null || Array.isArray(input.values)) {
      throw new AppError(
        'validation',
        'kanban:setConfig values must be an object',
        CHANNEL.setConfig,
      )
    }
    for (const [key, value] of Object.entries(input.values)) {
      if (typeof value !== 'string') {
        throw new AppError(
          'validation',
          `kanban:setConfig values.${key} must be a string`,
          CHANNEL.setConfig,
        )
      }
    }

    if (adapterId === null) {
      // Deselect keeps stored values (spec Behaviour 7).
      this.#state.set(projectKanbanAdapterKey(projectId), '')
      return
    }

    const schema = this.schemaFor(adapterId)
    const stored = parseStoredConfig(this.#state.get(projectKanbanConfigKey(projectId)))
    const merged: Record<string, string> = { ...stored.values }
    // Effective view after the apply rules below: required-field validation
    // counts only values that will remain stored (spec Behaviour 7).
    const effective: Record<string, string> = { ...merged }
    for (const [key, value] of Object.entries(input.values)) {
      const isSecret = schema.find((field) => field.key === key)?.type === 'secret'
      if (value === '' && !isSecret) {
        // Empty non-secret clears; empty secret keeps the stored value
        // (the masked form re-submits nothing) — spec Behaviour 7, AC5.
        delete effective[key]
      } else if (value !== '') {
        effective[key] = value
      }
    }
    for (const field of schema) {
      if (
        field.required &&
        (effective[field.key] === undefined || effective[field.key].trim().length === 0)
      ) {
        throw new AppError('validation', `Field "${field.label}" is required.`, CHANNEL.setConfig)
      }
    }
    // Apply (same rules as the effective view).
    for (const [key, value] of Object.entries(input.values)) {
      const isSecret = schema.find((field) => field.key === key)?.type === 'secret'
      if (value === '' && !isSecret) {
        delete merged[key]
      } else if (value !== '') {
        merged[key] = value
      }
    }
    this.#state.set(projectKanbanAdapterKey(projectId), adapterId)
    this.#state.set(projectKanbanConfigKey(projectId), JSON.stringify(merged))
  }

  async test(projectId: string, values?: Record<string, string>): Promise<void> {
    await this.invoke(projectId, 'test', values, {})
  }

  async listBoard(projectId: string): Promise<KanbanBoard> {
    const [states, items] = await Promise.all([
      this.invoke<unknown>(projectId, 'listStates', undefined, {}),
      this.invoke<unknown>(projectId, 'listItems', undefined, {}),
    ])
    return { states: normalizeStates(states), items: normalizeItems(items) }
  }

  async createItem(projectId: string, input: KanbanCreateInput): Promise<WorkItem> {
    const data = await this.invoke<unknown>(projectId, 'createItem', undefined, {
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.stateRef !== undefined ? { stateRef: input.stateRef } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    })
    return normalizeItem(data, 'createItem data')
  }

  async updateItem(projectId: string, ref: string, patch: KanbanUpdatePatch): Promise<WorkItem> {
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      throw new AppError(
        'validation',
        'kanban:updateItem ref must be a non-empty string',
        CHANNEL.updateItem,
      )
    }
    const patchRecord: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      patchRecord.title = patch.title
    }
    if (patch.description !== undefined) {
      patchRecord.description = patch.description
    }
    if (patch.stateRef !== undefined) {
      patchRecord.stateRef = patch.stateRef
    }
    if (patch.priority !== undefined) {
      patchRecord.priority = patch.priority
    }
    if (Object.keys(patchRecord).length === 0) {
      throw new AppError(
        'validation',
        'kanban:updateItem patch must change at least one field',
        CHANNEL.updateItem,
      )
    }
    const data = await this.invoke<unknown>(projectId, 'updateItem', undefined, {
      ref,
      ...patchRecord,
    })
    return normalizeItem(data, 'updateItem data')
  }

  /** Cascade cleanup on projects:remove (spec Behaviour 11). */
  cleanupProject(projectId: string): void {
    this.#state.delete(projectKanbanAdapterKey(projectId))
    this.#state.delete(projectKanbanConfigKey(projectId))
  }

  private assertProject(projectId: string): { path: string } {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', 'kanban')
    }
    return project
  }

  /** Manifest of the bound adapter; not_found names the missing id. */
  private schemaFor(adapterId: string | null) {
    if (adapterId === null) {
      return []
    }
    const found = discoverAdapters(this.#adaptersDir()).adapters.find(
      (candidate) => candidate.info.id === adapterId,
    )
    if (found === undefined) {
      return []
    }
    return found.info.configSchema
  }

  private boundAdapter(projectId: string): DiscoveredAdapter {
    const adapterId = this.#state.get(projectKanbanAdapterKey(projectId))
    if (adapterId === null || adapterId.trim().length === 0) {
      throw new AppError(
        'validation',
        'No Kanban adapter is configured for this project.',
        'kanban',
      )
    }
    const found = discoverAdapters(this.#adaptersDir()).adapters.find(
      (candidate) => candidate.info.id === adapterId,
    )
    if (found === undefined) {
      throw new AppError(
        'not_found',
        `Kanban adapter "${adapterId}" is not installed in the adapters directory.`,
        'kanban',
      )
    }
    return found
  }

  private effectiveConfig(
    projectId: string,
    override?: Record<string, string>,
  ): Record<string, string> {
    if (override !== undefined) {
      const stored = parseStoredConfig(this.#state.get(projectKanbanConfigKey(projectId))).values
      // Test-with-unsaved-edits (spec Behaviour 8): explicit values win,
      // absent keys fall back to stored ones.
      return { ...stored, ...override }
    }
    return parseStoredConfig(this.#state.get(projectKanbanConfigKey(projectId))).values
  }

  private async invoke<T>(
    projectId: string,
    action: 'test' | 'listStates' | 'listItems' | 'createItem' | 'updateItem',
    valuesOverride: Record<string, string> | undefined,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertProject(projectId)
    const adapter = this.boundAdapter(projectId)
    const config = this.effectiveConfig(projectId, valuesOverride)
    try {
      return await this.#host.invoke<T>(adapter, {
        protocolVersion: 1,
        action,
        config,
        params,
      })
    } catch (error) {
      throw toAppError(error, `kanban:${action}`)
    }
  }
}

/** Exported for tests: the priority allowlist check used in normalization. */
export function isKanbanPriority(value: unknown): value is KanbanPriority {
  return typeof value === 'string' && KANBAN_PRIORITIES.includes(value as KanbanPriority)
}
