import type Database from 'better-sqlite3'
import type { ProjectInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'

// AppStateService: flat key–value store (spec Data/API) plus cleanup of
// selection keys that point at removed projects/tasks (spec Edge cases:
// stale selection falls back to the default empty state and is cleaned).

export interface AppStateServiceDeps {
  db: Database.Database
}

export interface SelectionRef {
  projectId: string | null
  taskId: string | null
}

export class AppStateService {
  private readonly db: Database.Database

  constructor(deps: AppStateServiceDeps) {
    this.db = deps.db
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(key)
  }

  /**
   * Removes selection keys whose target rows no longer exist. Returns the
   * still-valid selection so callers hydrate it in one round trip.
   */
  cleanupSelection(): SelectionRef {
    let projectId = this.get(APP_STATE_KEY.selectedProjectId)
    let taskId = this.get(APP_STATE_KEY.selectedTaskId)

    if (projectId !== null && !this.projectExists(projectId)) {
      this.delete(APP_STATE_KEY.selectedProjectId)
      this.delete(APP_STATE_KEY.selectedTaskId)
      projectId = null
      taskId = null
    }

    if (taskId !== null && !this.taskExists(taskId)) {
      this.delete(APP_STATE_KEY.selectedTaskId)
      taskId = null
    }

    if (taskId !== null && projectId !== null && !this.taskBelongsToProject(taskId, projectId)) {
      this.delete(APP_STATE_KEY.selectedTaskId)
      taskId = null
    }

    return { projectId, taskId }
  }

  getSelectedProject(): ProjectInfo | null {
    const selection = this.cleanupSelection()
    if (selection.projectId === null) {
      return null
    }
    const row = this.db
      .prepare('SELECT id, name, path, runtime_label, created_at FROM projects WHERE id = ?')
      .get(selection.projectId) as
      | { id: string; name: string; path: string; runtime_label: string | null }
      | undefined
    if (!row) {
      return null
    }
    return { id: row.id, name: row.name, path: row.path, runtimeLabel: row.runtime_label }
  }

  private projectExists(projectId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)
  }

  private taskExists(taskId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)
  }

  private taskBelongsToProject(taskId: string, projectId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM tasks WHERE id = ? AND project_id = ?')
      .get(taskId, projectId)
  }
}
