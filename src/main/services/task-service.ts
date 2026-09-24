import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { TaskInfo } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'

// TaskService: task list/create scoped to a project (spec Business rules:
// non-empty trimmed name, duplicates within one project rejected).

export interface TaskServiceDeps {
  db: Database.Database
}

interface TaskRow {
  id: string
  project_id: string
  name: string
  status: string
  created_at: string
}

function toInfo(row: TaskRow): TaskInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: 'idle',
  }
}

export class TaskService {
  private readonly db: Database.Database

  constructor(deps: TaskServiceDeps) {
    this.db = deps.db
  }

  list(projectId: string): TaskInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, name, status, created_at FROM tasks WHERE project_id = ? ORDER BY created_at, name',
      )
      .all(projectId) as TaskRow[]
    return rows.map(toInfo)
  }

  create(projectId: string, name: string): TaskInfo {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length === 0) {
      throw new AppError('validation', 'Task name must not be empty.', 'tasks:create')
    }

    const project = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      throw new AppError('not_found', 'Project not found.', 'tasks:create')
    }

    const id = randomUUID()
    try {
      this.db
        .prepare(
          "INSERT INTO tasks (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'idle', ?)",
        )
        .run(id, projectId, trimmed, new Date().toISOString())
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new AppError(
          'conflict',
          `A task named "${trimmed}" already exists in this project.`,
          'tasks:create',
        )
      }
      console.error('[sqlite] tasks:create failed:', error)
      throw new AppError('sqlite', 'Database error.', 'tasks:create')
    }

    return { id, projectId, name: trimmed, status: 'idle' }
  }

  get(taskId: string): TaskInfo | null {
    const row = this.db
      .prepare('SELECT id, project_id, name, status, created_at FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow | undefined
    return row ? toInfo(row) : null
  }
}
