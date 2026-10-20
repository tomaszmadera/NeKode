import {
  KANBAN_PRIORITIES,
  type KanbanAdapterInfo,
  type KanbanBoard,
  type KanbanComment,
  type KanbanCreateInput,
  type KanbanPriority,
  type KanbanProjectConfig,
  type KanbanUpdatePatch,
  projectKanbanAdapterKey,
  projectKanbanConfigKey,
  type WorkItem,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { AdapterHost, toAppError } from './adapter-host'
import { type DiscoveredAdapter, type DiscoveryResult, discoverAdapters } from './adapter-manifest'
import {
  normalizeComments,
  normalizeItem,
  normalizeItems,
  normalizeStates,
} from './adapter-protocol'

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
  getItem: 'kanban:getItem',
  getComments: 'kanban:getComments',
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

/** Minimal Electron safeStorage interface for encryption at rest. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface KanbanServiceDeps {
  projects: KanbanProjectLookup
  state: KanbanStateStore
  /** Absolute adapters directory (userData default or the stored override). */
  adaptersDir: () => string
  host?: AdapterHost
  safeStorage?: SafeStorageLike
  discoverAdapters?: (dir: string) => DiscoveryResult
}

export interface KanbanSetConfigInput {
  adapterId: string | null
  values: Record<string, string>
}

export interface KanbanStoredConfig {
  values: Record<string, string>
}

export const DEFAULT_KANBAN_STORED_CONFIG: KanbanStoredConfig = {
  values: {},
}

export function parseKanbanStoredConfig(raw: string | null): KanbanStoredConfig {
  if (raw === null || raw.trim().length === 0) {
    return { values: {} }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { values: {} }
    }
    const record = parsed as Record<string, unknown>
    const source =
      typeof record.values === 'object' && record.values !== null && !Array.isArray(record.values)
        ? (record.values as Record<string, unknown>)
        : record

    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(source)) {
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

export function serializeKanbanStoredConfig(config: KanbanStoredConfig): string {
  return JSON.stringify(config.values)
}

export class KanbanService {
  readonly #projects: KanbanProjectLookup
  readonly #state: KanbanStateStore
  readonly #adaptersDir: () => string
  readonly #host: AdapterHost
  readonly #safeStorage: SafeStorageLike | undefined
  readonly #discoverAdapters: (dir: string) => DiscoveryResult
  /**
   * Secrets entered while safeStorage cannot encrypt (Linux without a
   * keyring). They live only for this app session, keyed by project + field,
   * and are never persisted in plain text.
   */
  readonly #sessionSecrets = new Map<string, string>()

  constructor(deps: KanbanServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
    this.#adaptersDir = deps.adaptersDir
    this.#host = deps.host ?? new AdapterHost()
    this.#safeStorage = deps.safeStorage
    this.#discoverAdapters = deps.discoverAdapters ?? discoverAdapters
  }

  /**
   * A provided safeStorage that cannot encrypt means secrets must not reach
   * disk. Without any safeStorage (unit harnesses) the legacy storage applies.
   */
  private sessionOnlySecrets(): boolean {
    return this.#safeStorage !== undefined && !this.#safeStorage.isEncryptionAvailable()
  }

  private sessionSecretsFor(projectId: string): Record<string, string> {
    const prefix = `${projectId}\u0000`
    const values: Record<string, string> = {}
    for (const [key, value] of this.#sessionSecrets) {
      if (key.startsWith(prefix)) values[key.slice(prefix.length)] = value
    }
    return values
  }

  private encryptSecret(value: string): string {
    if (value.startsWith('enc:v1:')) {
      return value
    }
    if (!this.#safeStorage?.isEncryptionAvailable()) {
      return value
    }
    try {
      const buffer = this.#safeStorage.encryptString(value)
      return `enc:v1:${buffer.toString('base64')}`
    } catch (error) {
      console.warn('[kanban] Failed to encrypt secret:', error)
      return value
    }
  }

  private decryptSecret(value: string): string {
    if (!value.startsWith('enc:v1:')) {
      return value
    }
    if (!this.#safeStorage?.isEncryptionAvailable()) {
      console.warn('[kanban] Cannot decrypt secret: safeStorage is unavailable')
      return ''
    }
    try {
      const buffer = Buffer.from(value.slice('enc:v1:'.length), 'base64')
      return this.#safeStorage.decryptString(buffer)
    } catch (error) {
      console.warn('[kanban] Failed to decrypt secret:', error)
      return ''
    }
  }

  private readStoredConfig(projectId: string, adapterId?: string | null): KanbanStoredConfig {
    const raw = this.#state.get(projectKanbanConfigKey(projectId))
    const stored = parseKanbanStoredConfig(raw)
    const resolvedAdapterId =
      adapterId !== undefined ? adapterId : this.#state.get(projectKanbanAdapterKey(projectId))
    const schema = this.schemaFor(resolvedAdapterId)

    if (this.#safeStorage?.isEncryptionAvailable() && schema.length > 0) {
      let migrated = false
      const updatedValues = { ...stored.values }
      for (const field of schema) {
        if (field.type === 'secret') {
          const val = updatedValues[field.key]
          if (typeof val === 'string' && val.length > 0 && !val.startsWith('enc:v1:')) {
            updatedValues[field.key] = this.encryptSecret(val)
            migrated = true
          }
        }
      }
      if (migrated) {
        this.#state.set(
          projectKanbanConfigKey(projectId),
          serializeKanbanStoredConfig({ values: updatedValues }),
        )
        stored.values = updatedValues
      }
    }

    return stored
  }

  /** Fresh one-level scan; warnings go to the main log, never to the UI. */
  adaptersList(): KanbanAdapterInfo[] {
    const { adapters, warnings } = this.#discoverAdapters(this.#adaptersDir())
    for (const warning of warnings) {
      console.warn(`[kanban] ${warning}`)
    }
    return adapters.map((adapter) => adapter.info)
  }

  getConfig(projectId: string): KanbanProjectConfig {
    this.assertProject(projectId)
    const adapterId = this.#state.get(projectKanbanAdapterKey(projectId))
    const stored = this.readStoredConfig(projectId, adapterId)
    const schema = this.schemaFor(adapterId)
    const values: Record<string, string | null> = {}
    const secretKeys: string[] = []
    for (const field of schema) {
      const rawValue = stored.values[field.key]
      if (rawValue === undefined) {
        values[field.key] = null
        continue
      }
      if (field.type === 'secret') {
        const decrypted = this.decryptSecret(rawValue)
        if (decrypted.length > 0) {
          secretKeys.push(field.key)
        }
        values[field.key] = null
        continue
      }
      values[field.key] = rawValue
    }
    for (const field of schema) {
      if (field.type === 'secret' && this.#sessionSecrets.has(`${projectId}\u0000${field.key}`)) {
        if (!secretKeys.includes(field.key)) secretKeys.push(field.key)
        values[field.key] = null
      }
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
      ...(this.sessionOnlySecrets() ? { sessionOnlySecrets: true } : {}),
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
    const stored = this.readStoredConfig(projectId, adapterId)
    const merged: Record<string, string> = { ...stored.values }
    // Effective view after the apply rules below: required-field validation
    // counts only values that will remain stored (spec Behaviour 7).
    const effective: Record<string, string> = {}
    for (const [key, val] of Object.entries(merged)) {
      effective[key] = this.decryptSecret(val)
    }
    Object.assign(effective, this.sessionSecretsFor(projectId))
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
    const sessionOnly = this.sessionOnlySecrets()
    for (const [key, value] of Object.entries(input.values)) {
      const isSecret = schema.find((field) => field.key === key)?.type === 'secret'
      if (value === '' && !isSecret) {
        delete merged[key]
      } else if (value !== '' && isSecret && sessionOnly) {
        // No keyring: keep the secret in memory for this session only and
        // drop any older on-disk copy instead of writing plain text.
        this.#sessionSecrets.set(`${projectId}\u0000${key}`, value)
        delete merged[key]
      } else if (value !== '') {
        merged[key] = isSecret ? this.encryptSecret(value) : value
      }
    }
    for (const field of schema) {
      if (
        field.type === 'secret' &&
        merged[field.key] !== undefined &&
        merged[field.key].length > 0
      ) {
        merged[field.key] = this.encryptSecret(merged[field.key])
      }
    }
    this.#state.set(projectKanbanAdapterKey(projectId), adapterId)
    const nextConfig = serializeKanbanStoredConfig({ values: merged })
    this.#state.set(projectKanbanConfigKey(projectId), nextConfig)
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

  /** Live item for task launch. Adapter action `getItem` with `{ ref }`. */
  async getItem(projectId: string, ref: string): Promise<WorkItem> {
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      throw new AppError(
        'validation',
        'kanban:getItem ref must be a non-empty string',
        CHANNEL.getItem,
      )
    }
    const data = await this.invoke<unknown>(projectId, 'getItem', undefined, { ref })
    return normalizeItem(data, 'getItem data')
  }

  /** Comments for one work item. Adapter action `listComments` with `{ ref }`. */
  async getComments(projectId: string, ref: string): Promise<KanbanComment[]> {
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      throw new AppError(
        'validation',
        'kanban:getComments ref must be a non-empty string',
        CHANNEL.getComments,
      )
    }
    const data = await this.invoke<unknown>(projectId, 'listComments', undefined, { ref })
    return normalizeComments(data, 'listComments data')
  }

  /** Cascade cleanup on projects:remove (spec Behaviour 11). */
  cleanupProject(projectId: string): void {
    this.#state.delete(projectKanbanAdapterKey(projectId))
    this.#state.delete(projectKanbanConfigKey(projectId))
  }

  private assertProject(projectId: string): { path: string } {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, 'kanban')
    }
    return project
  }

  /** Manifest of the bound adapter; not_found names the missing id. */
  private schemaFor(adapterId: string | null) {
    if (adapterId === null) {
      return []
    }
    const found = this.#discoverAdapters(this.#adaptersDir()).adapters.find(
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
        `No Kanban adapter is configured for project "${projectId}".`,
        'kanban',
      )
    }
    const found = this.#discoverAdapters(this.#adaptersDir()).adapters.find(
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
    const stored = this.readStoredConfig(projectId)
    const decryptedStored: Record<string, string> = {}
    for (const [key, val] of Object.entries(stored.values)) {
      decryptedStored[key] = this.decryptSecret(val)
    }
    Object.assign(decryptedStored, this.sessionSecretsFor(projectId))
    if (override !== undefined) {
      // Test-with-unsaved-edits (spec Behaviour 8): explicit values win,
      // absent keys fall back to stored ones.
      return { ...decryptedStored, ...override }
    }
    return decryptedStored
  }

  private async invoke<T>(
    projectId: string,
    action:
      | 'test'
      | 'listStates'
      | 'listItems'
      | 'createItem'
      | 'updateItem'
      | 'getItem'
      | 'listComments',
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
