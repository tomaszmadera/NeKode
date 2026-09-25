import type Database from 'better-sqlite3'
import type { ProjectInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY } from '../../shared/ipc-contract'

// AppStateService: flat key–value store (spec Data/API) plus cleanup of
// selection keys that point at removed projects/chats (spec Edge cases:
// stale selection falls back to the default empty state and is cleaned).

export interface AppStateServiceDeps {
  db: Database.Database
}

export interface SelectionRef {
  projectId: string | null
  chatId: string | null
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
    let chatId = this.get(APP_STATE_KEY.selectedChatId)

    if (projectId !== null && !this.projectExists(projectId)) {
      this.delete(APP_STATE_KEY.selectedProjectId)
      this.delete(APP_STATE_KEY.selectedChatId)
      projectId = null
      chatId = null
    }

    if (chatId !== null && !this.chatExists(chatId)) {
      this.delete(APP_STATE_KEY.selectedChatId)
      chatId = null
    }

    if (chatId !== null && projectId !== null && !this.chatBelongsToProject(chatId, projectId)) {
      this.delete(APP_STATE_KEY.selectedChatId)
      chatId = null
    }

    return { projectId, chatId }
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

  private chatExists(chatId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId)
  }

  private chatBelongsToProject(chatId: string, projectId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM chats WHERE id = ? AND project_id = ?')
      .get(chatId, projectId)
  }
}
