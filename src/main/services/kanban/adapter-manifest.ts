import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KanbanAdapterInfo, KanbanConfigField } from '../../../shared/ipc-contract'

// Adapter manifest parsing and directory discovery (spec kanban-adapter-
// interface Behaviour 1–2). One subdirectory level; a valid `adapter.json`
// makes the directory an adapter. Invalid manifests are skipped with a
// warning naming the path; valid siblings still list. Duplicate adapter ids
// resolve in lexicographic directory-name order (first wins, later skipped).

export const ADAPTER_PROTOCOL_VERSION = 1

const MANIFEST_FILE = 'adapter.json'
const ADAPTER_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FIELD_TYPES: readonly KanbanConfigField['type'][] = ['string', 'secret', 'select', 'boolean']

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

function fail(manifestPath: string, rule: string): never {
  throw new ManifestError(`${manifestPath}: ${rule}`)
}

function assertString(value: unknown, manifestPath: string, rule: string): string {
  if (typeof value !== 'string') {
    fail(manifestPath, rule)
  }
  return value
}

/** Parses and validates one manifest; throws ManifestError on any violation. */
export function parseAdapterManifest(content: string, manifestPath: string): KanbanAdapterInfo {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    fail(manifestPath, 'is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(manifestPath, 'must be a JSON object')
  }
  const manifest = raw as Record<string, unknown>

  const id = assertString(manifest.id, manifestPath, 'field "id" must be a string')
  if (!ADAPTER_ID_PATTERN.test(id)) {
    fail(manifestPath, 'field "id" must be kebab-case ([a-z0-9-])')
  }
  const name = assertString(manifest.name, manifestPath, 'field "name" must be a string')
  if (name.trim().length === 0) {
    fail(manifestPath, 'field "name" must be non-empty')
  }

  if (manifest.protocolVersion !== ADAPTER_PROTOCOL_VERSION) {
    fail(manifestPath, `unsupported protocolVersion (expected ${ADAPTER_PROTOCOL_VERSION})`)
  }

  const invocationRaw = manifest.invocation
  if (typeof invocationRaw !== 'object' || invocationRaw === null || Array.isArray(invocationRaw)) {
    fail(manifestPath, 'field "invocation" must be an object')
  }
  const invocation = invocationRaw as Record<string, unknown>
  const command = assertString(
    invocation.command,
    manifestPath,
    'field "invocation.command" must be a string',
  )
  if (command.trim().length === 0) {
    fail(manifestPath, 'field "invocation.command" must be non-empty')
  }
  if (
    invocation.args !== undefined &&
    (!Array.isArray(invocation.args) || invocation.args.some((arg) => typeof arg !== 'string'))
  ) {
    fail(manifestPath, 'field "invocation.args" must be an array of strings')
  }

  const schemaRaw = manifest.configSchema
  if (!Array.isArray(schemaRaw)) {
    fail(manifestPath, 'field "configSchema" must be an array')
  }
  const seenKeys = new Set<string>()
  const configSchema: KanbanConfigField[] = schemaRaw.map((entry, index) => {
    const label = `configSchema[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(manifestPath, `${label} must be an object`)
    }
    const field = entry as Record<string, unknown>
    const key = assertString(field.key, manifestPath, `${label}.key must be a string`)
    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      fail(manifestPath, `${label}.key must be alphanumeric/underscore`)
    }
    if (seenKeys.has(key)) {
      fail(manifestPath, `${label}.key duplicates "${key}"`)
    }
    seenKeys.add(key)
    const fieldLabel = assertString(field.label, manifestPath, `${label}.label must be a string`)
    const type = field.type
    if (typeof type !== 'string' || !FIELD_TYPES.includes(type as KanbanConfigField['type'])) {
      fail(manifestPath, `${label}.type must be one of string|secret|select|boolean`)
    }
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      fail(manifestPath, `${label}.required must be a boolean`)
    }
    const required = field.required === true
    if (type === 'select') {
      if (
        !Array.isArray(field.options) ||
        field.options.length === 0 ||
        field.options.some((option) => typeof option !== 'string')
      ) {
        fail(manifestPath, `${label}.options must be a non-empty array of strings`)
      }
    } else if (field.options !== undefined) {
      fail(manifestPath, `${label}.options is only valid for select fields`)
    }
    if (field.default !== undefined) {
      if (type === 'boolean') {
        if (typeof field.default !== 'boolean') {
          fail(manifestPath, `${label}.default must be a boolean`)
        }
      } else if (typeof field.default !== 'string') {
        fail(manifestPath, `${label}.default must be a string`)
      }
    }
    const parsed: KanbanConfigField = {
      key,
      label: fieldLabel,
      type: type as KanbanConfigField['type'],
      required,
    }
    if (type === 'select') {
      parsed.options = field.options as string[]
    }
    if (field.default !== undefined) {
      parsed.default = field.default as string | boolean
    }
    return parsed
  })

  return {
    id,
    name,
    configSchema,
  }
}

/** Full invocation declaration carried alongside the public adapter info. */
export interface DiscoveredAdapter {
  info: KanbanAdapterInfo
  /** Directory containing adapter.json; the spawn cwd. */
  dir: string
  invocation: { command: string; args: string[] }
}

export interface DiscoveryResult {
  adapters: DiscoveredAdapter[]
  /** Human-readable skip reasons (path + rule); main logs them. */
  warnings: string[]
}

/**
 * One-level scan of the adapters directory. A missing directory yields an
 * empty result (spec Edge cases: explanatory empty state, not an error).
 */
export function discoverAdapters(dir: string): DiscoveryResult {
  const warnings: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  } catch {
    return { adapters: [], warnings }
  }

  const adapters: DiscoveredAdapter[] = []
  const seenIds = new Map<string, string>()
  for (const name of entries) {
    const adapterDir = join(dir, name)
    const manifestPath = join(adapterDir, MANIFEST_FILE)
    let info: KanbanAdapterInfo
    let invocation: { command: string; args: string[] }
    try {
      const content = readFileSync(manifestPath, 'utf8')
      const parsed = parseAdapterManifest(content, manifestPath)
      // Re-extract the invocation (parse validates it; the shape carries to
      // the host so the service never re-reads the manifest).
      const raw = JSON.parse(content) as {
        invocation: { command: string; args?: string[] }
      }
      invocation = { command: raw.invocation.command, args: raw.invocation.args ?? [] }
      info = parsed
    } catch (error) {
      if (error instanceof ManifestError) {
        warnings.push(error.message)
      } else {
        warnings.push(`${manifestPath}: cannot be read (${String(error)})`)
      }
      continue
    }
    const existing = seenIds.get(info.id)
    if (existing !== undefined) {
      warnings.push(
        `${manifestPath}: duplicate adapter id "${info.id}" (already provided by ${existing}); skipped`,
      )
      continue
    }
    seenIds.set(info.id, manifestPath)
    adapters.push({ info, dir: adapterDir, invocation })
  }
  return { adapters, warnings }
}
