import { promises as nodeFs } from 'node:fs'
import { isAbsolute, posix } from 'node:path'
import type { HandoffEntry } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Handoff directory listing (spec handoff-resume-flow Data/API). Read-only:
// regular files of the user-configured per-project directory, newest first,
// names and mtimes only — never file content. The directory is explicitly
// configured per project, so unlike files:* it is not confined to the
// project root; a relative setting resolves against the registered root.

/** Minimal project lookup (the ProjectService surface this service needs). */
export interface HandoffsProjectLookup {
  get(projectId: string): { path: string } | null
}

/** Minimal setting read (the AppStateService surface this service needs). */
export interface HandoffsStateLookup {
  get(key: string): string | null
}

/**
 * Filesystem surface used by the service (node:fs/promises by default).
 * Injectable so tests run deterministic directory fixtures.
 */
export interface HandoffsFsAdapter {
  /** One directory read; throws when the path is missing or not a directory. */
  readdir(dirPath: string): Promise<HandoffsFsEntry[]>
  /** Follows symlinks; null when the path does not resolve. */
  stat(path: string): Promise<{ isFile: boolean; mtimeMs: number } | null>
}

export interface HandoffsFsEntry {
  name: string
  kind: 'file' | 'directory' | 'symlink'
}

export interface HandoffsServiceDeps {
  projects: HandoffsProjectLookup
  state: HandoffsStateLookup
  /** Reads the per-project setting (injected so the key format stays shared). */
  handoffDirKey: (projectId: string) => string
  fs?: HandoffsFsAdapter
}

/** Forward-slash normalization (FilesService precedent): mixed configured
    separators must resolve and compare deterministically across platforms. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

const nodeFsAdapter: HandoffsFsAdapter = {
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
      return { isFile: stats.isFile(), mtimeMs: stats.mtimeMs }
    } catch {
      return null
    }
  },
}

export class HandoffsService {
  readonly #projects: HandoffsProjectLookup
  readonly #state: HandoffsStateLookup
  readonly #handoffDirKey: (projectId: string) => string
  readonly #fs: HandoffsFsAdapter

  constructor(deps: HandoffsServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
    this.#handoffDirKey = deps.handoffDirKey
    this.#fs = deps.fs ?? nodeFsAdapter
  }

  /** Regular files of the configured directory, newest first. */
  async list(projectId: string): Promise<HandoffEntry[]> {
    const channel = 'handoffs:list'
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', channel)
    }
    const configured = this.#state.get(this.#handoffDirKey(projectId))
    if (configured === null || configured.trim().length === 0) {
      throw new AppError(
        'validation',
        'Handoff directory is not configured for this project.',
        channel,
      )
    }
    const dir = isAbsolute(configured)
      ? toPosix(configured)
      : posix.join(toPosix(project.path), toPosix(configured))

    let listed: HandoffsFsEntry[]
    try {
      listed = await this.#fs.readdir(dir)
    } catch {
      throw new AppError('not_found', `Handoff directory not found: ${dir}`, channel)
    }

    const entries: Array<HandoffEntry & { mtimeMs: number }> = []
    for (const entry of listed) {
      if (entry.kind === 'directory') {
        continue
      }
      // Symlinks classify by their target; broken links are skipped.
      const filePath = posix.join(dir, entry.name)
      const stats = await this.#fs.stat(filePath)
      if (stats === null || !stats.isFile) {
        continue
      }
      entries.push({
        name: entry.name,
        path: filePath,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        mtimeMs: stats.mtimeMs,
      })
    }
    // Newest first; equal mtimes fall back to a case-insensitive name order
    // so the listing is deterministic across reads.
    entries.sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) {
        return b.mtimeMs - a.mtimeMs
      }
      const aLower = a.name.toLowerCase()
      const bLower = b.name.toLowerCase()
      return aLower < bLower ? -1 : aLower > bLower ? 1 : 0
    })
    return entries.map(({ name, path, modifiedAt }) => ({ name, path, modifiedAt }))
  }
}
