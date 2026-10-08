import { promises as nodeFs } from 'node:fs'
import { isAbsolute, posix } from 'node:path'
import type {
  HandoffCandidatesResult,
  HandoffFileInfo,
  HandoffRejection,
  KanbanHandoffCandidatesInput,
  KanbanHandoffLinksDocument,
  KanbanLinkHandoffInput,
} from '../../../shared/ipc-contract'
import {
  projectHandoffDirKey,
  projectKanbanAdapterKey,
  projectKanbanHandoffLinksKey,
  relativeToProject,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Handoff match and link (kanban task launch amendment, stage 4). A shallow scan
// of the project's configured handoff directory: regular `.md` files only,
// README.md and symlinks skipped, links never followed. A leading flat
// `key: value` frontmatter block is parsed here so no YAML dependency is added.
// The scan returns names, match kind, display path, a stamp and rejection
// reasons, never file bodies. There is no caching: every call re-resolves the
// directory and re-checks the files, so a changed directory is a fresh check.
// HandoffsService.list keeps its own contract; this service does not touch it.

const MAX_HANDOFF_BYTES = 1024 * 1024
const FRONTMATTER_KEYS = ['work_item_ref', 'work_item_id', 'work_item_adapter'] as const

/** Minimal project lookup (the ProjectService surface this service needs). */
export interface HandoffMatcherProjectLookup {
  get(projectId: string): { path: string } | null
}

/** Minimal setting read/write/delete (the AppStateService surface). */
export interface HandoffMatcherStateStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export interface HandoffMatcherFsEntry {
  name: string
  kind: 'file' | 'directory' | 'symlink'
}

/**
 * Filesystem surface used by the service (node:fs/promises by default).
 * Injectable so tests run deterministic directory fixtures.
 */
export interface HandoffMatcherFsAdapter {
  /** One directory read; throws when the path is missing or not a directory. */
  readdir(dirPath: string): Promise<HandoffMatcherFsEntry[]>
  /** Follows symlinks; null when the path does not resolve. */
  stat(path: string): Promise<{ isFile: boolean; size: number; mtimeMs: number } | null>
  /** Whole-file read; throws when the file cannot be read. */
  readFile(path: string): Promise<Buffer>
}

export interface HandoffMatcherServiceDeps {
  projects: HandoffMatcherProjectLookup
  state: HandoffMatcherStateStore
  fs?: HandoffMatcherFsAdapter
}

/** Forward-slash normalization, matching HandoffsService and FilesService. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

const nodeFsAdapter: HandoffMatcherFsAdapter = {
  async readdir(dirPath) {
    const entries = await nodeFs.readdir(dirPath, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'symlink',
    }))
  },
  async stat(path) {
    try {
      const stats = await nodeFs.stat(path)
      return { isFile: stats.isFile(), size: stats.size, mtimeMs: stats.mtimeMs }
    } catch {
      return null
    }
  },
  async readFile(path) {
    return nodeFs.readFile(path)
  },
}

/**
 * Leading flat `key: value` frontmatter block. A block opens with a line `---`
 * and closes with a later `---`; without the closing fence there is no
 * frontmatter. Only the three work-item keys are kept; other lines are ignored.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return {}
  }
  const values: Record<string, string> = {}
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') {
      return values
    }
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    if (match === null) {
      continue
    }
    const key = match[1]
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      continue
    }
    let value = match[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  // No closing fence: treat the file as having no frontmatter.
  return {}
}

/** Case-insensitive ref prefix: `nekode-2` matches `nekode-2` and
    `nekode-2-<desc>` but not `nekode-20`, `nekode-28` or `old-nekode-2`. */
export function filenameMatchesRef(name: string, ref: string): boolean {
  const base = name.replace(/\.md$/i, '').toLowerCase()
  const target = ref.trim().toLowerCase()
  if (target.length === 0) {
    return false
  }
  return base === target || base.startsWith(`${target}-`)
}

type MatchEvaluation = 'metadata' | 'filename' | 'none' | 'conflict'

/**
 * Metadata wins; a present field that names another item is a conflict and
 * excludes the filename match. Without `work_item_ref` the metadata method does
 * not apply (the ref is required), but a mismatching `work_item_id` or
 * `work_item_adapter` still conflicts. Ref and adapter compare case-insensitively;
 * the backend-native id compares exactly (it is opaque).
 */
function evaluateMatch(
  name: string,
  frontmatter: Record<string, string>,
  item: { itemId: string; ref: string },
  adapterId: string,
): MatchEvaluation {
  const ref = frontmatter.work_item_ref
  const id = frontmatter.work_item_id
  const adapter = frontmatter.work_item_adapter
  const hasRef = ref !== undefined && ref.length > 0
  const hasId = id !== undefined && id.length > 0
  const hasAdapter = adapter !== undefined && adapter.length > 0

  if (hasId && id !== item.itemId) {
    return 'conflict'
  }
  if (hasAdapter && adapter.toLowerCase() !== adapterId.toLowerCase()) {
    return 'conflict'
  }
  if (hasRef && ref.toLowerCase() !== item.ref.trim().toLowerCase()) {
    return 'conflict'
  }
  if (hasRef) {
    return 'metadata'
  }
  return filenameMatchesRef(name, item.ref) ? 'filename' : 'none'
}

function emptyLinksDocument(): KanbanHandoffLinksDocument {
  return { links: {} }
}

function parseLinks(raw: string | null): KanbanHandoffLinksDocument {
  if (raw === null || raw.length === 0) {
    return emptyLinksDocument()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyLinksDocument()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptyLinksDocument()
  }
  const record = (parsed as Record<string, unknown>).links
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return emptyLinksDocument()
  }
  const links: KanbanHandoffLinksDocument['links'] = {}
  for (const [adapterKey, byItem] of Object.entries(record as Record<string, unknown>)) {
    if (typeof byItem !== 'object' || byItem === null || Array.isArray(byItem)) {
      continue
    }
    const items: Record<string, { name: string; ref: string }> = {}
    for (const [itemKey, link] of Object.entries(byItem as Record<string, unknown>)) {
      if (typeof link !== 'object' || link === null || Array.isArray(link)) {
        continue
      }
      const entry = link as Record<string, unknown>
      if (typeof entry.name !== 'string' || typeof entry.ref !== 'string') {
        continue
      }
      items[itemKey] = { name: entry.name, ref: entry.ref }
    }
    links[adapterKey] = items
  }
  return { links }
}

export class HandoffMatcherService {
  readonly #projects: HandoffMatcherProjectLookup
  readonly #state: HandoffMatcherStateStore
  readonly #fs: HandoffMatcherFsAdapter

  constructor(deps: HandoffMatcherServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
    this.#fs = deps.fs ?? nodeFsAdapter
  }

  /** One scan of the configured directory for the item. Never returns bodies. */
  async candidates(input: KanbanHandoffCandidatesInput): Promise<HandoffCandidatesResult> {
    const project = this.#requireProject(input.projectId, 'kanban:handoffCandidates')
    return this.#scan(project.path, input)
  }

  /**
   * Stores an explicit link for a file name a scan produced, then re-reads the
   * candidates so the link resolves. A rejected file (too large, invalid UTF-8,
   * or metadata naming another item) is refused and not written.
   */
  async link(input: KanbanLinkHandoffInput): Promise<HandoffCandidatesResult> {
    const project = this.#requireProject(input.projectId, 'kanban:linkHandoff')
    const scan = await this.#scan(project.path, input)
    if (scan.state === 'not-configured') {
      throw new AppError(
        'validation',
        'Handoff directory is not configured for this project.',
        'kanban:linkHandoff',
      )
    }
    if (scan.state === 'error') {
      throw new AppError('not_found', scan.message, 'kanban:linkHandoff')
    }
    const rejected = scan.rejections.find((entry) => entry.name === input.fileName)
    if (rejected !== undefined) {
      throw new AppError('validation', rejected.reason, 'kanban:linkHandoff')
    }
    const file = scan.files.find((entry) => entry.name === input.fileName)
    if (file === undefined) {
      throw new AppError(
        'validation',
        `Handoff file "${input.fileName}" is not in the configured directory.`,
        'kanban:linkHandoff',
      )
    }
    const adapterId = this.#adapterId(input.projectId)
    const document = parseLinks(this.#state.get(projectKanbanHandoffLinksKey(input.projectId)))
    const byItem = { ...(document.links[adapterId] ?? {}) }
    byItem[input.itemId] = { name: file.name, ref: input.ref }
    const stored: KanbanHandoffLinksDocument = {
      links: { ...document.links, [adapterId]: byItem },
    }
    this.#state.set(projectKanbanHandoffLinksKey(input.projectId), JSON.stringify(stored))
    return this.#scan(project.path, input)
  }

  async #scan(
    projectPath: string,
    input: KanbanHandoffCandidatesInput,
  ): Promise<HandoffCandidatesResult> {
    const configured = this.#state.get(projectHandoffDirKey(input.projectId))
    if (configured === null || configured.trim().length === 0) {
      return { state: 'not-configured' }
    }
    const dir = isAbsolute(configured)
      ? toPosix(configured)
      : posix.join(toPosix(projectPath), toPosix(configured))

    let listed: HandoffMatcherFsEntry[]
    try {
      listed = await this.#fs.readdir(dir)
    } catch (error) {
      // A read failure is its own state, never presented as an empty set. A
      // permission failure (EACCES/EPERM) has a message distinct from a
      // missing directory or non-directory (ENOENT/ENOTDIR), so the two are
      // never reported with the same text (spec Bledy i wyscigi line 360).
      const code = (error as { code?: unknown } | null)?.code
      const permissionDenied = code === 'EACCES' || code === 'EPERM'
      return {
        state: 'error',
        message: permissionDenied
          ? `Handoff directory is not readable: ${dir}`
          : `Handoff directory not found: ${dir}`,
      }
    }

    const adapterId = this.#adapterId(input.projectId)
    const found: Array<HandoffFileInfo & { mtimeMs: number }> = []
    const rejections: HandoffRejection[] = []

    for (const entry of listed) {
      // Directories, symlinks and non-markdown files are never considered.
      if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) {
        continue
      }
      if (entry.name.toLowerCase() === 'readme.md') {
        continue
      }
      const filePath = posix.join(dir, entry.name)
      const stats = await this.#fs.stat(filePath)
      if (stats === null || !stats.isFile) {
        continue
      }
      const displayPath = relativeToProject(projectPath, filePath) ?? filePath
      if (stats.size > MAX_HANDOFF_BYTES) {
        rejections.push({ name: entry.name, path: displayPath, reason: tooLargeReason() })
        continue
      }
      let bytes: Buffer
      try {
        bytes = await this.#fs.readFile(filePath)
      } catch {
        rejections.push({
          name: entry.name,
          path: displayPath,
          reason: 'File could not be read.',
        })
        continue
      }
      if (bytes.length > MAX_HANDOFF_BYTES) {
        rejections.push({ name: entry.name, path: displayPath, reason: tooLargeReason() })
        continue
      }
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        rejections.push({
          name: entry.name,
          path: displayPath,
          reason: 'File is not valid UTF-8.',
        })
        continue
      }
      const evaluation = evaluateMatch(entry.name, parseFrontmatter(content), input, adapterId)
      if (evaluation === 'conflict') {
        rejections.push({
          name: entry.name,
          path: displayPath,
          reason: 'Metadata names a different work item.',
        })
        continue
      }
      found.push({
        name: entry.name,
        path: displayPath,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        matchKind: evaluation,
        mtimeMs: stats.mtimeMs,
      })
    }

    found.sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) {
        return b.mtimeMs - a.mtimeMs
      }
      const aLower = a.name.toLowerCase()
      const bLower = b.name.toLowerCase()
      return aLower < bLower ? -1 : aLower > bLower ? 1 : 0
    })
    rejections.sort((a, b) => {
      const aLower = a.name.toLowerCase()
      const bLower = b.name.toLowerCase()
      return aLower < bLower ? -1 : aLower > bLower ? 1 : 0
    })
    const files: HandoffFileInfo[] = found.map(({ name, path, modifiedAt, matchKind }) => ({
      name,
      path,
      modifiedAt,
      matchKind,
    }))
    const stored = this.#linkFor(input.projectId, adapterId, input.itemId)
    const linked = stored === null ? undefined : files.find((file) => file.name === stored.name)
    return {
      state: 'ready',
      files,
      rejections,
      link:
        linked === undefined
          ? null
          : { name: linked.name, path: linked.path, modifiedAt: linked.modifiedAt },
    }
  }

  #linkFor(
    projectId: string,
    adapterId: string,
    itemId: string,
  ): { name: string; ref: string } | null {
    const document = parseLinks(this.#state.get(projectKanbanHandoffLinksKey(projectId)))
    return document.links[adapterId]?.[itemId] ?? null
  }

  #adapterId(projectId: string): string {
    const bound = this.#state.get(projectKanbanAdapterKey(projectId))
    return bound !== null && bound.trim().length > 0 ? bound : ''
  }

  #requireProject(projectId: string, channel: string): { path: string } {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    return project
  }
}

function tooLargeReason(): string {
  return 'File is larger than 1 MiB.'
}
