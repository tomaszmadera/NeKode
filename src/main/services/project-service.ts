import { randomUUID } from 'node:crypto'
import { basename, isAbsolute } from 'node:path'
import type Database from 'better-sqlite3'
import type { ProjectInfo } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'

// ProjectService: project CRUD on top of the projects table.
// All rule validation happens here (spec Business rules / Edge cases);
// IPC handlers only validate payload shape before calling in.

export interface FileSystemAdapter {
  /** Synchronous stat; null when the path does not exist. */
  stat(path: string): { isDirectory(): boolean } | null
}

export interface ProjectServiceDeps {
  db: Database.Database
  fs: FileSystemAdapter
}

interface ProjectRow {
  id: string
  name: string
  path: string
  runtime_label: string | null
  created_at: string
}

function toInfo(row: ProjectRow): ProjectInfo {
  return { id: row.id, name: row.name, path: row.path, runtimeLabel: row.runtime_label }
}

export class ProjectService {
  private readonly db: Database.Database
  private readonly fs: FileSystemAdapter

  constructor(deps: ProjectServiceDeps) {
    this.db = deps.db
    this.fs = deps.fs
  }

  list(): ProjectInfo[] {
    const rows = this.db
      .prepare('SELECT id, name, path, runtime_label, created_at FROM projects ORDER BY name')
      .all() as ProjectRow[]
    return rows.map(toInfo)
  }

  add(path: string): ProjectInfo {
    const validation = this.validatePath(path)
    if (validation !== null) {
      throw new AppError('validation', validation, 'projects:add')
    }

    const normalized = path
    const name = basename(normalized)
    const id = randomUUID()
    try {
      this.db
        .prepare(
          'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, name, normalized, null, new Date().toISOString())
    } catch (error) {
      if (isUniquePathViolation(error)) {
        throw new AppError(
          'conflict',
          'This directory is already registered as a project.',
          'projects:add',
        )
      }
      throw wrapSqliteError(error, 'projects:add')
    }
    return { id, name, path: normalized, runtimeLabel: null }
  }

  remove(projectId: string): void {
    // FK cascade removes the project's chats; stale selection keys in
    // app_state are handled by AppStateService.cleanupSelection on next read.
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    if (result.changes === 0) {
      throw new AppError('not_found', 'Project not found.', 'projects:remove')
    }
  }

  get(projectId: string): ProjectInfo | null {
    const row = this.db
      .prepare('SELECT id, name, path, runtime_label, created_at FROM projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined
    return row ? toInfo(row) : null
  }

  private validatePath(path: string): string | null {
    if (typeof path !== 'string' || path.trim().length === 0) {
      return 'Project path must be a non-empty string.'
    }
    if (!isAbsolute(path)) {
      return 'Project path must be an absolute directory path.'
    }
    // Drive roots (C:\, D:\, /) have no usable folder name.
    const name = basename(path)
    if (name.length === 0) {
      return 'Cannot add a drive root as a project.'
    }
    const stat = this.fs.stat(path)
    if (stat === null) {
      return 'Directory does not exist.'
    }
    if (!stat.isDirectory()) {
      return 'Path is not a directory.'
    }
    return null
  }
}

export function isUniquePathViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_UNIQUE'
  )
}

export function wrapSqliteError(error: unknown, channel: string): AppError {
  // Raw SQLite messages can leak paths/SQL internals; keep them on the main
  // side and send a generic message across the bridge.
  console.error(`[sqlite] ${channel} failed:`, error)
  return new AppError('sqlite', 'Database error.', channel)
}
