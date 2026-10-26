import { randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import {
  KANBAN_PRIORITIES,
  KANBAN_STATE_GROUPS,
  type KanbanBoard,
  type KanbanCreateInput,
  type KanbanItemWriteResult,
  type KanbanPriority,
  type KanbanState,
  type KanbanStateGroup,
  type KanbanUpdatePatch,
  LOCAL_TASK_FILE_MISSING,
  LOCAL_TASK_FILE_PATH,
  type WorkItem,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { joinProjectPath } from '../project-path'

// Built-in `local-file` task source (project-home spec Behaviour 7-9, 12,
// Edge cases, Errors). The document lives at `.nekode/tasks.json` under the
// stored project root, the same root the file tree reads (a WSL project uses
// its stored UNC path). Main reads and writes it directly: no process, no
// shell, no adapter config. Every write echoes the revision last read; a
// mismatch changes nothing and rejects with `conflict`. A successful write
// replaces the file by a temp file in the same directory followed by a
// rename. A missing, unreadable, or schema-invalid file is an error; only the
// explicit `Use a local task list` action creates it, and only when absent.

const TASK_DIR = '.nekode'
const TASK_FILE = 'tasks.json'
const SCHEMA_VERSION = 1

/** The five fixed states of a new document (spec Behaviour 8). */
const INITIAL_STATES: readonly KanbanState[] = [
  { id: 'backlog', name: 'Backlog', group: 'backlog', order: 0 },
  { id: 'todo', name: 'Todo', group: 'unstarted', order: 1 },
  { id: 'in-progress', name: 'In Progress', group: 'started', order: 2 },
  { id: 'done', name: 'Done', group: 'completed', order: 3 },
  { id: 'cancelled', name: 'Cancelled', group: 'cancelled', order: 4 },
]

/** `New task` default (spec Behaviour 9): the state named Todo. */
const DEFAULT_STATE_NAME = 'Todo'

export interface LocalTaskItem {
  ref: string
  id: string
  title: string
  description: string | null
  stateId: string
  priority: KanbanPriority | null
  updatedAt: string
}

export interface LocalTaskDocument {
  schemaVersion: 1
  revision: number
  nextRef: number
  states: KanbanState[]
  items: LocalTaskItem[]
}

/** Minimal project lookup: the stored project root path. */
export interface LocalTaskProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface LocalTaskFileDeps {
  projects: LocalTaskProjectLookup
  now?: () => Date
  newId?: () => string
}

const DOCUMENT_KEYS = ['schemaVersion', 'revision', 'nextRef', 'states', 'items'] as const
const STATE_KEYS = ['id', 'name', 'group', 'order'] as const
const ITEM_KEYS = ['ref', 'id', 'title', 'description', 'stateId', 'priority', 'updatedAt'] as const

function invalid(detail: string, channel: string): AppError {
  return new AppError(
    'validation_error',
    `The task file ${LOCAL_TASK_FILE_PATH} is not valid: ${detail}.`,
    channel,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function assertKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  channel: string,
): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw invalid(`${label} has an unknown field "${key}"`, channel)
  }
  for (const key of keys) {
    if (!(key in record)) throw invalid(`${label} is missing "${key}"`, channel)
  }
}

/**
 * Strict parse of the task document. Unknown fields are rejected so a write
 * never drops data it does not understand (spec Business rules: a
 * schema-invalid file is an error and stays unchanged).
 */
export function parseLocalTaskDocument(text: string, channel: string): LocalTaskDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw invalid('it is not valid JSON', channel)
  }
  if (!isRecord(parsed)) throw invalid('the document is not an object', channel)
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw invalid(`schemaVersion must be ${SCHEMA_VERSION}`, channel)
  }
  assertKeys(parsed, DOCUMENT_KEYS, 'the document', channel)
  if (!isCount(parsed.revision, 1)) throw invalid('revision must be a positive integer', channel)
  if (!isCount(parsed.nextRef, 1)) throw invalid('nextRef must be a positive integer', channel)
  if (!Array.isArray(parsed.states) || !Array.isArray(parsed.items)) {
    throw invalid('states and items must be arrays', channel)
  }

  const states: KanbanState[] = []
  const stateIds = new Set<string>()
  parsed.states.forEach((raw: unknown, index) => {
    const label = `states[${index}]`
    if (!isRecord(raw)) throw invalid(`${label} is not an object`, channel)
    assertKeys(raw, STATE_KEYS, label, channel)
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      throw invalid(`${label}.id must be a non-empty string`, channel)
    }
    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
      throw invalid(`${label}.name must be a non-empty string`, channel)
    }
    if (
      typeof raw.group !== 'string' ||
      !KANBAN_STATE_GROUPS.includes(raw.group as KanbanStateGroup)
    ) {
      throw invalid(`${label}.group must be one of ${KANBAN_STATE_GROUPS.join('|')}`, channel)
    }
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw invalid(`${label}.order must be a number`, channel)
    }
    if (stateIds.has(raw.id)) throw invalid(`state id "${raw.id}" is duplicated`, channel)
    stateIds.add(raw.id)
    states.push({
      id: raw.id,
      name: raw.name,
      group: raw.group as KanbanStateGroup,
      order: raw.order,
    })
  })

  const items: LocalTaskItem[] = []
  const refs = new Set<string>()
  const ids = new Set<string>()
  parsed.items.forEach((raw: unknown, index) => {
    const label = `items[${index}]`
    if (!isRecord(raw)) throw invalid(`${label} is not an object`, channel)
    assertKeys(raw, ITEM_KEYS, label, channel)
    if (typeof raw.ref !== 'string' || !/^T-[1-9][0-9]*$/.test(raw.ref)) {
      throw invalid(`${label}.ref must look like T-1`, channel)
    }
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      throw invalid(`${label}.id must be a non-empty string`, channel)
    }
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
      throw invalid(`${label}.title must be a non-empty string`, channel)
    }
    if (raw.description !== null && typeof raw.description !== 'string') {
      throw invalid(`${label}.description must be a string or null`, channel)
    }
    if (typeof raw.stateId !== 'string' || !stateIds.has(raw.stateId)) {
      throw invalid(`${label}.stateId does not name a state in the file`, channel)
    }
    if (
      raw.priority !== null &&
      (typeof raw.priority !== 'string' || !KANBAN_PRIORITIES.includes(raw.priority as never))
    ) {
      throw invalid(
        `${label}.priority must be one of ${KANBAN_PRIORITIES.join('|')} or null`,
        channel,
      )
    }
    if (typeof raw.updatedAt !== 'string') {
      throw invalid(`${label}.updatedAt must be a string`, channel)
    }
    if (refs.has(raw.ref)) throw invalid(`ref "${raw.ref}" is duplicated`, channel)
    if (ids.has(raw.id)) throw invalid(`id "${raw.id}" is duplicated`, channel)
    if (Number(raw.ref.slice(2)) >= (parsed.nextRef as number)) {
      throw invalid(`${label}.ref is not below nextRef`, channel)
    }
    refs.add(raw.ref)
    ids.add(raw.id)
    items.push({
      ref: raw.ref,
      id: raw.id,
      title: raw.title,
      description: raw.description as string | null,
      stateId: raw.stateId,
      priority: raw.priority as KanbanPriority | null,
      updatedAt: raw.updatedAt,
    })
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    revision: parsed.revision,
    nextRef: parsed.nextRef,
    states,
    items,
  }
}

/** Stable key order, two-space indent, one final newline (spec Behaviour 8). */
export function serializeLocalTaskDocument(document: LocalTaskDocument): string {
  const ordered = {
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    nextRef: document.nextRef,
    states: document.states.map((state) => ({
      id: state.id,
      name: state.name,
      group: state.group,
      order: state.order,
    })),
    items: document.items.map((item) => ({
      ref: item.ref,
      id: item.id,
      title: item.title,
      description: item.description,
      stateId: item.stateId,
      priority: item.priority,
      updatedAt: item.updatedAt,
    })),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

export function initialLocalTaskDocument(): LocalTaskDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    nextRef: 1,
    states: INITIAL_STATES.map((state) => ({ ...state })),
    items: [],
  }
}

function toWorkItem(item: LocalTaskItem, states: readonly KanbanState[]): WorkItem {
  // The parse guarantees the state exists.
  const state = states.find((candidate) => candidate.id === item.stateId) as KanbanState
  return {
    ref: item.ref,
    id: item.id,
    title: item.title,
    description: item.description,
    stateId: item.stateId,
    stateName: state.name,
    stateGroup: state.group,
    priority: item.priority,
    assignee: null,
    url: null,
    updatedAt: item.updatedAt,
  }
}

/** State id, then name (case-insensitive), then group alias (lowest order). */
function resolveState(
  states: readonly KanbanState[],
  stateRef: string,
  channel: string,
): KanbanState {
  const byId = states.find((state) => state.id === stateRef)
  if (byId !== undefined) return byId
  const lowered = stateRef.trim().toLowerCase()
  const byName = states.find((state) => state.name.toLowerCase() === lowered)
  if (byName !== undefined) return byName
  const byGroup = [...states]
    .sort((a, b) => a.order - b.order)
    .find((state) => state.group === lowered)
  if (byGroup !== undefined) return byGroup
  throw new AppError('validation_error', `The task list has no state named "${stateRef}".`, channel)
}

export function errnoCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function missingFile(channel: string): AppError {
  // The detail marks the one `not_found` that `Use a local task list` can
  // fix; an unknown project or a missing project folder carries none.
  return new AppError(
    'not_found',
    `The task file ${LOCAL_TASK_FILE_PATH} was not found. Use a local task list to create it.`,
    channel,
    undefined,
    LOCAL_TASK_FILE_MISSING,
  )
}

/**
 * The entry exists but `realpath` cannot resolve it: on a WSL UNC path a
 * Linux symlink reports ENOENT. Containment cannot be proven, so nothing is
 * read or written (spec Behaviour 12, Errors: `unknown` with the relative path).
 */
function unresolvable(relative: string, channel: string): AppError {
  return new AppError(
    'unknown',
    `Could not resolve ${relative}: it exists but its link cannot be followed.`,
    channel,
  )
}

/** IO failure with the relative path (spec Errors); the original goes to the main log. */
function ioFailure(action: string, error: unknown, channel: string): AppError {
  console.warn(`[kanban] local-file ${action} failed for ${LOCAL_TASK_FILE_PATH}:`, error)
  return new AppError('unknown', `Could not ${action} ${LOCAL_TASK_FILE_PATH}.`, channel)
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isInside(root: string, target: string): boolean {
  const rootPrefix = stripTrailingSlash(root)
  const targetPrefix = stripTrailingSlash(target)
  return targetPrefix === rootPrefix || targetPrefix.startsWith(`${rootPrefix}/`)
}

interface Located {
  root: string
  dir: string
  file: string
}

export class LocalTaskFile {
  readonly #projects: LocalTaskProjectLookup
  readonly #now: () => Date
  readonly #newId: () => string
  /** Per-project write queue: one read-check-replace at a time in this process. */
  readonly #queues = new Map<string, Promise<void>>()

  constructor(deps: LocalTaskFileDeps) {
    this.#projects = deps.projects
    this.#now = deps.now ?? (() => new Date())
    this.#newId = deps.newId ?? randomUUID
  }

  /** Creates the document only when the file is absent; an existing file is untouched. */
  async ensure(projectId: string, channel: string): Promise<void> {
    await this.#serialized(projectId, async () => {
      const located = this.#locate(projectId, channel)
      const realRoot = await this.#realRoot(located, channel)
      try {
        // Only `.nekode` is created; the root itself must already exist.
        await nodeFs.mkdir(located.dir)
      } catch (error) {
        if (errnoCode(error) !== 'EEXIST') throw ioFailure('create the folder for', error, channel)
      }
      await this.#assertContained(realRoot, located.dir, TASK_DIR, channel)
      try {
        await nodeFs.writeFile(
          located.file,
          serializeLocalTaskDocument(initialLocalTaskDocument()),
          {
            encoding: 'utf8',
            flag: 'wx',
          },
        )
      } catch (error) {
        if (errnoCode(error) === 'EEXIST') {
          // A second use does not reset an existing file (spec AC5); a
          // symlink at the path must still resolve inside the root.
          await this.#assertContained(realRoot, located.file, LOCAL_TASK_FILE_PATH, channel)
          return
        }
        throw ioFailure('create', error, channel)
      }
    })
  }

  async read(projectId: string, channel: string): Promise<LocalTaskDocument> {
    const located = this.#locate(projectId, channel)
    return await this.#readDocument(located, channel)
  }

  async listBoard(projectId: string, channel: string): Promise<KanbanBoard> {
    const document = await this.read(projectId, channel)
    return {
      states: document.states.map((state) => ({ ...state })),
      items: document.items.map((item) => toWorkItem(item, document.states)),
      revision: document.revision,
    }
  }

  async getItem(projectId: string, ref: string, channel: string): Promise<WorkItem> {
    const document = await this.read(projectId, channel)
    const found = document.items.find((item) => item.ref === ref)
    if (found === undefined) {
      throw new AppError(
        'not_found',
        `Task "${ref}" was not found in ${LOCAL_TASK_FILE_PATH}.`,
        channel,
      )
    }
    return toWorkItem(found, document.states)
  }

  async createItem(
    projectId: string,
    input: KanbanCreateInput,
    revision: number | undefined,
    channel: string,
  ): Promise<KanbanItemWriteResult> {
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new AppError('validation_error', 'A task needs a title.', channel)
    }
    return await this.#write(projectId, revision, channel, (document) => {
      const state = resolveState(document.states, input.stateRef ?? DEFAULT_STATE_NAME, channel)
      const ref = `T-${document.nextRef}`
      if (document.items.some((item) => item.ref === ref)) {
        throw invalid(`ref "${ref}" already exists`, channel)
      }
      const created: LocalTaskItem = {
        ref,
        id: this.#newId(),
        title: input.title,
        description: input.description ?? null,
        stateId: state.id,
        priority: input.priority ?? null,
        updatedAt: this.#now().toISOString(),
      }
      document.items.push(created)
      document.nextRef += 1
      return created
    })
  }

  async updateItem(
    projectId: string,
    ref: string,
    patch: KanbanUpdatePatch,
    revision: number | undefined,
    channel: string,
  ): Promise<KanbanItemWriteResult> {
    if (patch.title !== undefined && patch.title.trim().length === 0) {
      throw new AppError('validation_error', 'A task needs a title.', channel)
    }
    return await this.#write(projectId, revision, channel, (document) => {
      const found = document.items.find((item) => item.ref === ref)
      if (found === undefined) {
        throw new AppError(
          'not_found',
          `Task "${ref}" was not found in ${LOCAL_TASK_FILE_PATH}.`,
          channel,
        )
      }
      if (patch.stateRef !== undefined) {
        found.stateId = resolveState(document.states, patch.stateRef, channel).id
      }
      if (patch.title !== undefined) found.title = patch.title
      if (patch.description !== undefined) found.description = patch.description
      if (patch.priority !== undefined) found.priority = patch.priority
      found.updatedAt = this.#now().toISOString()
      return found
    })
  }

  async #write(
    projectId: string,
    revision: number | undefined,
    channel: string,
    apply: (document: LocalTaskDocument) => LocalTaskItem,
  ): Promise<KanbanItemWriteResult> {
    if (revision === undefined) {
      throw new AppError(
        'validation_error',
        `A write to ${LOCAL_TASK_FILE_PATH} needs the revision last read.`,
        channel,
      )
    }
    return await this.#serialized(projectId, async () => {
      const located = this.#locate(projectId, channel)
      const document = await this.#readDocument(located, channel)
      if (document.revision !== revision) {
        throw new AppError(
          'conflict',
          `${LOCAL_TASK_FILE_PATH} changed since it was read. The list was reloaded; try again.`,
          channel,
        )
      }
      const written = apply(document)
      document.revision += 1
      await this.#replace(projectId, located, serializeLocalTaskDocument(document), channel)
      return { ...toWorkItem(written, document.states), revision: document.revision }
    })
  }

  /** Temp file in the same directory, then rename over the document (spec Behaviour 9). */
  async #replace(
    projectId: string,
    located: Located,
    text: string,
    channel: string,
  ): Promise<void> {
    const temp = joinProjectPath(located.dir, `${TASK_FILE}.${this.#newId()}.tmp`)
    try {
      await nodeFs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      throw ioFailure('write', error, channel)
    }
    // A project removed while this write was in flight drops the write; the
    // existing document is neither replaced nor deleted (spec Edge cases).
    if (this.#projects.get(projectId) === null) {
      await this.#removeTemp(temp)
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    try {
      await nodeFs.rename(temp, located.file)
    } catch (error) {
      await this.#removeTemp(temp)
      throw ioFailure('write', error, channel)
    }
  }

  async #removeTemp(temp: string): Promise<void> {
    try {
      await nodeFs.rm(temp, { force: true })
    } catch (error) {
      // The primary failure is already being reported; a leftover temp file
      // is logged, never mistaken for the document.
      console.warn(`[kanban] Could not remove the temporary task file ${temp}:`, error)
    }
  }

  async #readDocument(located: Located, channel: string): Promise<LocalTaskDocument> {
    const realRoot = await this.#realRoot(located, channel)
    // The folder is checked too: a write puts its temp file there, so a
    // `.nekode` that leaves the root is rejected even when `tasks.json`
    // links back inside.
    await this.#assertContained(realRoot, located.dir, TASK_DIR, channel)
    await this.#assertContained(realRoot, located.file, LOCAL_TASK_FILE_PATH, channel)
    let text: string
    try {
      text = await nodeFs.readFile(located.file, 'utf8')
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') throw missingFile(channel)
      throw ioFailure('read', error, channel)
    }
    return parseLocalTaskDocument(text, channel)
  }

  #locate(projectId: string, channel: string): Located {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    // Same root and join as the file tree (FilesService), UNC roots included.
    const root = project.path.replace(/\\/g, '/')
    return {
      root,
      dir: joinProjectPath(root, TASK_DIR),
      file: joinProjectPath(root, TASK_DIR, TASK_FILE),
    }
  }

  async #realRoot(located: Located, channel: string): Promise<string> {
    try {
      return await nodeFs.realpath(located.root)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw ioFailure('read', error, channel)
      if (await this.#exists(located.root, channel)) {
        throw unresolvable(`the project folder for ${LOCAL_TASK_FILE_PATH}`, channel)
      }
      throw new AppError('not_found', 'The project folder was not found.', channel)
    }
  }

  /** `lstat` sees the entry itself, so a link realpath cannot follow still counts. */
  async #exists(path: string, channel: string): Promise<boolean> {
    try {
      await nodeFs.lstat(path)
      return true
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return false
      throw ioFailure('read', error, channel)
    }
  }

  /**
   * The canonical path must stay inside the canonical project root: a
   * `.nekode` or `tasks.json` symlink that leaves the root is rejected
   * (spec Behaviour 12).
   */
  async #assertContained(
    realRoot: string,
    path: string,
    relative: string,
    channel: string,
  ): Promise<void> {
    let real: string
    try {
      real = await nodeFs.realpath(path)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw ioFailure('read', error, channel)
      if (await this.#exists(path, channel)) throw unresolvable(relative, channel)
      throw missingFile(channel)
    }
    if (!isInside(realRoot, real)) {
      throw new AppError(
        'validation_error',
        `${LOCAL_TASK_FILE_PATH} resolves outside the project folder.`,
        channel,
      )
    }
  }

  async #serialized<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve()
    const result = previous.then(run)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(projectId, settled)
    void settled.then(() => {
      if (this.#queues.get(projectId) === settled) this.#queues.delete(projectId)
    })
    return await result
  }
}
