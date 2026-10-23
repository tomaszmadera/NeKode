import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  TaskProgressAdapterInfo,
  TaskProgressConfigField,
  TaskProgressEnvironment,
} from '../../../shared/ipc-contract'

// Task progress manifest parsing and discovery (spec task-progress-adapters
// Behaviour 1-2). One subdirectory level of the fixed adapters directory; a
// valid `adapter.json` with `kind: "task-progress"` makes the directory an
// adapter. Invalid manifests are skipped with a warning naming the path;
// duplicate ids resolve in lexicographic directory order (first wins). A
// missing directory is an empty list, not an error.

export const TASK_PROGRESS_PROTOCOL_VERSION = 1
export const TASK_PROGRESS_ADAPTER_KIND = 'task-progress'
/** Directory name under `<userData>`; there is no setting or override (spec Behaviour 1). */
export const TASK_PROGRESS_ADAPTERS_DIR_NAME = 'task-progress-adapters'

const MANIFEST_FILE = 'adapter.json'
const ADAPTER_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FIELD_TYPES: readonly TaskProgressConfigField['type'][] = ['string', 'select', 'boolean']
const ENVIRONMENTS: readonly TaskProgressEnvironment[] = ['local', 'wsl']

export class TaskProgressManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskProgressManifestError'
  }
}

export interface TaskProgressAdapter {
  info: TaskProgressAdapterInfo
  invocation: { command: string; args: string[] }
}

/** A discovered adapter: its manifest plus the directory that is the spawn cwd. */
export interface DiscoveredTaskProgressAdapter extends TaskProgressAdapter {
  dir: string
}

export interface TaskProgressDiscovery {
  adapters: DiscoveredTaskProgressAdapter[]
  /** Skip reasons (path + rule); main logs them. */
  warnings: string[]
}

function fail(manifestPath: string, rule: string): never {
  throw new TaskProgressManifestError(`${manifestPath}: ${rule}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, manifestPath: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(manifestPath, `field "${field}" must be a non-empty string`)
  }
  return value
}

function parseEnvironments(value: unknown, manifestPath: string): TaskProgressEnvironment[] {
  if (value === undefined) {
    return ['local']
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => !ENVIRONMENTS.includes(entry as TaskProgressEnvironment)) ||
    new Set(value).size !== value.length
  ) {
    fail(manifestPath, 'field "environments" must be a non-empty list of unique "local" | "wsl"')
  }
  return value as TaskProgressEnvironment[]
}

function parseField(entry: unknown, index: number, manifestPath: string): TaskProgressConfigField {
  const label = `configSchema[${index}]`
  if (!isRecord(entry)) {
    fail(manifestPath, `${label} must be an object`)
  }
  const key = entry.key
  if (typeof key !== 'string' || !/^[A-Za-z0-9_]+$/.test(key)) {
    fail(manifestPath, `${label}.key must be a non-empty alphanumeric/underscore string`)
  }
  if (typeof entry.label !== 'string' || entry.label.trim().length === 0) {
    fail(manifestPath, `${label}.label must be a non-empty string`)
  }
  const type = entry.type
  if (typeof type !== 'string' || !FIELD_TYPES.includes(type as TaskProgressConfigField['type'])) {
    fail(manifestPath, `${label}.type must be one of string|select|boolean`)
  }
  if (entry.required !== undefined && typeof entry.required !== 'boolean') {
    fail(manifestPath, `${label}.required must be a boolean`)
  }
  if (type === 'select') {
    if (
      !Array.isArray(entry.options) ||
      entry.options.length === 0 ||
      entry.options.some((option) => typeof option !== 'string')
    ) {
      fail(manifestPath, `${label}.options must be a non-empty array of strings`)
    }
  } else if (entry.options !== undefined) {
    fail(manifestPath, `${label}.options is only valid for select fields`)
  }
  if (entry.default !== undefined) {
    if (type === 'boolean') {
      if (typeof entry.default !== 'boolean') {
        fail(manifestPath, `${label}.default must be a boolean`)
      }
    } else if (typeof entry.default !== 'string') {
      fail(manifestPath, `${label}.default must be a string`)
    } else if (type === 'select' && !(entry.options as string[]).includes(entry.default)) {
      fail(manifestPath, `${label}.default must be one of the options`)
    }
  }
  const field: TaskProgressConfigField = {
    key,
    label: entry.label,
    type: type as TaskProgressConfigField['type'],
    required: entry.required === true,
  }
  if (type === 'select') {
    field.options = entry.options as string[]
  }
  if (entry.default !== undefined) {
    field.default = entry.default as string | boolean
  }
  return field
}

/** Parses and validates one manifest; throws TaskProgressManifestError on any violation. */
export function parseTaskProgressManifest(
  content: string,
  manifestPath: string,
): TaskProgressAdapter {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    fail(manifestPath, 'is not valid JSON')
  }
  if (!isRecord(raw)) {
    fail(manifestPath, 'must be a JSON object')
  }

  const id = nonEmptyString(raw.id, manifestPath, 'id')
  if (!ADAPTER_ID_PATTERN.test(id)) {
    fail(manifestPath, 'field "id" must be kebab-case ([a-z0-9-])')
  }
  const name = nonEmptyString(raw.name, manifestPath, 'name')
  if (raw.kind !== TASK_PROGRESS_ADAPTER_KIND) {
    fail(manifestPath, `field "kind" must be "${TASK_PROGRESS_ADAPTER_KIND}"`)
  }
  if (raw.protocolVersion !== TASK_PROGRESS_PROTOCOL_VERSION) {
    fail(manifestPath, `unsupported protocolVersion (expected ${TASK_PROGRESS_PROTOCOL_VERSION})`)
  }

  if (!isRecord(raw.invocation)) {
    fail(manifestPath, 'field "invocation" must be an object')
  }
  const command = nonEmptyString(raw.invocation.command, manifestPath, 'invocation.command')
  const args = raw.invocation.args
  if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))) {
    fail(manifestPath, 'field "invocation.args" must be an array of strings')
  }

  const environments = parseEnvironments(raw.environments, manifestPath)

  if (!Array.isArray(raw.configSchema)) {
    fail(manifestPath, 'field "configSchema" must be an array')
  }
  const seenKeys = new Set<string>()
  const configSchema = raw.configSchema.map((entry, index) => {
    const field = parseField(entry, index, manifestPath)
    if (seenKeys.has(field.key)) {
      fail(manifestPath, `configSchema[${index}].key duplicates "${field.key}"`)
    }
    seenKeys.add(field.key)
    return field
  })

  return {
    info: { id, name, environments, configSchema },
    invocation: { command, args: (args as string[] | undefined) ?? [] },
  }
}

/** One-level scan of the adapters directory (fresh on every call). */
export function discoverTaskProgressAdapters(dir: string): TaskProgressDiscovery {
  let dirents: Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { adapters: [], warnings: [] }
    }
    throw error
  }

  const adapters: DiscoveredTaskProgressAdapter[] = []
  const warnings: string[] = []
  const entries: string[] = []
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      entries.push(entry.name)
    } else if (entry.isSymbolicLink()) {
      // A symbolic link or Windows junction counts when it resolves to a directory.
      const linkPath = join(dir, entry.name)
      let linkedDirectory = false
      let reason = 'does not point to a directory'
      try {
        linkedDirectory = statSync(linkPath).isDirectory()
      } catch (error) {
        reason = `cannot be resolved (${(error as NodeJS.ErrnoException).code ?? String(error)})`
      }
      if (linkedDirectory) {
        entries.push(entry.name)
      } else {
        warnings.push(`${linkPath}: link is not a directory: ${reason}; skipped`)
      }
    }
  }
  entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const seenIds = new Map<string, string>()
  for (const name of entries) {
    const adapterDir = join(dir, name)
    const manifestPath = join(adapterDir, MANIFEST_FILE)
    let parsed: TaskProgressAdapter
    try {
      parsed = parseTaskProgressManifest(readFileSync(manifestPath, 'utf8'), manifestPath)
    } catch (error) {
      warnings.push(
        error instanceof TaskProgressManifestError
          ? error.message
          : `${manifestPath}: cannot be read (${String(error)})`,
      )
      continue
    }
    const existing = seenIds.get(parsed.info.id)
    if (existing !== undefined) {
      warnings.push(
        `${manifestPath}: duplicate adapter id "${parsed.info.id}" (already provided by ${existing}); skipped`,
      )
      continue
    }
    seenIds.set(parsed.info.id, manifestPath)
    adapters.push({ ...parsed, dir: adapterDir })
  }
  return { adapters, warnings }
}
