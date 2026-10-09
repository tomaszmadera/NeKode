import { promises as nodeFs } from 'node:fs'
import { isAbsolute } from 'node:path'
import type {
  HandoffCandidatesResult,
  HandoffFileInfo,
  HandoffRejection,
  KanbanHandoffAvailabilityInput,
  KanbanHandoffAvailabilityResult,
  KanbanHandoffCandidatesInput,
} from '../../../shared/ipc-contract'
import { projectHandoffDirKey, relativeToProject } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { joinProjectPath } from '../project-path'

// Handoff match (kanban task launch amendment, stage 4; NEKODE-30 stage 2). A
// shallow scan of the project's configured handoff directory: regular `.md`
// files only, README.md and symlinks skipped, links never followed. The full
// work-item ref carried in the file name is the only link between a work item
// and a handoff (spec Jednolita konwencja nazw); frontmatter identity is never
// parsed here. The scan returns names, match kind, display path, a stamp and
// rejection reasons, never file bodies. There is no caching: every call
// re-resolves the directory and re-checks the files, so a changed directory is
// a fresh check. HandoffsService.list keeps its own contract; this service does
// not touch it.
//
// One directory read backs both `candidates` (one item) and `handoffAvailability`
// (a batch of loaded items). Usable files are read at most once into a snapshot,
// then `resolveItem` matches that same snapshot against each item, so the list
// view and the Resume modal can never resolve the same file+item+snapshot
// differently (spec Dostępność Resume, Dane i zgodność).

const MAX_HANDOFF_BYTES = 1024 * 1024

/** Minimal project lookup (the ProjectService surface this service needs). */
export interface HandoffMatcherProjectLookup {
  get(projectId: string): { path: string } | null
}

/** Minimal setting read (the AppStateService surface). */
export interface HandoffMatcherStateStore {
  get(key: string): string | null
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

/** One readable file of a directory snapshot (no per-item filtering). */
interface ScannedFile {
  name: string
  path: string
  modifiedAt: string
  mtimeMs: number
}

type HandoffDirectorySnapshot =
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | { state: 'ready'; files: ScannedFile[]; rejections: HandoffRejection[] }

function compareNames(a: { name: string }, b: { name: string }): number {
  const aLower = a.name.toLowerCase()
  const bLower = b.name.toLowerCase()
  return aLower < bLower ? -1 : aLower > bLower ? 1 : 0
}

/**
 * Matches one snapshot against one item by file name only (spec Jednolita
 * konwencja nazw). Every readable file is reported: a file whose name is the
 * full ref or a ref-prefixed name is a candidate (`filename`), every other name
 * is `none` and never drives Resume.
 */
function resolveItem(
  snapshotFiles: readonly ScannedFile[],
  item: { ref: string },
): HandoffFileInfo[] {
  return snapshotFiles.map((file) => ({
    name: file.name,
    path: file.path,
    modifiedAt: file.modifiedAt,
    matchKind: filenameMatchesRef(file.name, item.ref) ? 'filename' : 'none',
  }))
}

function tooLargeReason(): string {
  return 'File is larger than 1 MiB.'
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
    return this.#resolveCandidates(project.path, input)
  }

  /**
   * One batch scan of the configured directory for the loaded items (spec
   * Dostępność Resume, Dane): the directory and each qualifying file are read
   * at most once, then the same snapshot is matched against every item.
   */
  async availability(
    input: KanbanHandoffAvailabilityInput,
  ): Promise<KanbanHandoffAvailabilityResult> {
    const project = this.#requireProject(input.projectId, 'kanban:handoffAvailability')
    const snapshot = await this.#readDirectory(input.projectId, project.path)
    if (snapshot.state !== 'ready') {
      return snapshot
    }
    const items = input.items.map((item) => ({
      itemId: item.itemId,
      ref: item.ref,
      available: resolveItem(snapshot.files, item).some((file) => file.matchKind === 'filename'),
    }))
    return { state: 'ready', items, rejections: snapshot.rejections }
  }

  /** One item's candidates over the shared directory snapshot. */
  async #resolveCandidates(
    projectPath: string,
    input: KanbanHandoffCandidatesInput,
  ): Promise<HandoffCandidatesResult> {
    const snapshot = await this.#readDirectory(input.projectId, projectPath)
    if (snapshot.state !== 'ready') {
      return snapshot
    }
    return {
      state: 'ready',
      files: resolveItem(snapshot.files, input),
      rejections: snapshot.rejections,
    }
  }

  /**
   * One directory read plus at most one whole-file read per qualifying file.
   * The files are sorted newest first (case-insensitive name tie-break); the
   * rejections are the file-level warnings only (size cap, encoding, read). A
   * read failure is its own state, never presented as an empty set.
   */
  async #readDirectory(projectId: string, projectPath: string): Promise<HandoffDirectorySnapshot> {
    const configured = this.#state.get(projectHandoffDirKey(projectId))
    if (configured === null || configured.trim().length === 0) {
      return { state: 'not-configured' }
    }
    const dir = isAbsolute(configured)
      ? toPosix(configured)
      : joinProjectPath(toPosix(projectPath), toPosix(configured))

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

    const files: ScannedFile[] = []
    const rejections: HandoffRejection[] = []

    for (const entry of listed) {
      // Directories, symlinks and non-markdown files are never considered.
      if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) {
        continue
      }
      if (entry.name.toLowerCase() === 'readme.md') {
        continue
      }
      const filePath = joinProjectPath(dir, entry.name)
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
      try {
        // The body is read only to enforce the UTF-8 limit (spec Dane): the
        // decoded text is discarded because only the name decides the match.
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        rejections.push({
          name: entry.name,
          path: displayPath,
          reason: 'File is not valid UTF-8.',
        })
        continue
      }
      files.push({
        name: entry.name,
        path: displayPath,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        mtimeMs: stats.mtimeMs,
      })
    }

    files.sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) {
        return b.mtimeMs - a.mtimeMs
      }
      return compareNames(a, b)
    })
    rejections.sort(compareNames)
    return { state: 'ready', files, rejections }
  }

  #requireProject(projectId: string, channel: string): { path: string } {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    return project
  }
}
