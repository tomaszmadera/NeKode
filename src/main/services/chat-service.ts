import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatInfo } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'

// ChatService: chat list/create/remove scoped to a project (spec Business
// rules: non-empty trimmed name, duplicates within one project rejected). A
// chat is removed only by project removal (cascade) or by its terminal
// exiting (spec Behaviour 11) — that policy lives in the IPC layer, this
// service owns the row. Application quit never removes chats.

export interface ChatServiceDeps {
  db: Database.Database
}

interface ChatRow {
  id: string
  project_id: string
  name: string
  created_at: string
}

function toInfo(row: ChatRow): ChatInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
  }
}

export class ChatService {
  private readonly db: Database.Database

  constructor(deps: ChatServiceDeps) {
    this.db = deps.db
  }

  list(projectId: string): ChatInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, name, created_at FROM chats WHERE project_id = ? ORDER BY created_at, name',
      )
      .all(projectId) as ChatRow[]
    return rows.map(toInfo)
  }

  create(projectId: string, name: string): ChatInfo {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length === 0) {
      throw new AppError('validation', 'Chat name must not be empty.', 'chats:create')
    }

    const project = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      throw new AppError('not_found', 'Project not found.', 'chats:create')
    }

    const id = randomUUID()
    try {
      this.db
        .prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(id, projectId, trimmed, new Date().toISOString())
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new AppError(
          'conflict',
          `A chat named "${trimmed}" already exists in this project.`,
          'chats:create',
        )
      }
      console.error('[sqlite] chats:create failed:', error)
      throw new AppError('sqlite', 'Database error.', 'chats:create')
    }

    return { id, projectId, name: trimmed }
  }

  get(chatId: string): ChatInfo | null {
    const row = this.db
      .prepare('SELECT id, project_id, name, created_at FROM chats WHERE id = ?')
      .get(chatId) as ChatRow | undefined
    return row ? toInfo(row) : null
  }

  /**
   * Removes one chat row (terminal-exit close flow). Idempotent: removing an
   * unknown id is a safe no-op so exit races never fail the close flow.
   */
  remove(chatId: string): void {
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId)
  }
}
