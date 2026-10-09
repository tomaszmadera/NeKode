import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatInfo } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { shellDisplayName } from './terminal/terminal-service'

// ChatService: chat list/create/remove scoped to a project (spec Business
// rules: the name is `[shell]` with an optional agent profile name and duplicates
// within one project are allowed — identity is the id). A chat is removed
// only by project removal (cascade) or by its terminal exiting (spec
// Behaviour 11) — that policy lives in the IPC layer, this service owns the
// row. Application quit never removes chats.

export interface ChatServiceDeps {
  db: Database.Database
  /**
   * Display name for newly created chats (the platform shell, spec
   * Behaviour 3). Injectable for tests; defaults to the same shell
   * configuration the PTY spawns with (process.platform-based). The
   * per-project form (spec project-shell-selection) receives the project id
   * and resolves the project's stored shell choice in the composition root.
   */
  chatName?: () => string
  chatNameForProject?: (projectId: string) => string
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
  private readonly chatName: () => string
  private readonly chatNameForProject: (projectId: string) => string

  constructor(deps: ChatServiceDeps) {
    this.db = deps.db
    this.chatName = deps.chatName ?? (() => shellDisplayName())
    this.chatNameForProject = deps.chatNameForProject ?? (() => this.chatName())
  }

  list(projectId: string): ChatInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, name, created_at FROM chats WHERE project_id = ? ORDER BY created_at, name',
      )
      .all(projectId) as ChatRow[]
    return rows.map(toInfo)
  }

  /**
   * Creates a chat with no naming form (spec Behaviour 3): the name is the
   * project's shell display label in brackets (spec project-shell-selection; the
   * platform default, e.g. "PowerShell" on win32, when the project has no
   * shell choice) and may repeat within a project — the generated id is the
   * identity.
   */
  create(projectId: string): ChatInfo {
    return this.insert(projectId, this.formatName(projectId, 'chats:create'), 'chats:create')
  }

  /**
   * Inserts a chat with a main-owned `[shell] profile` name. Task launch supplies
   * the agent profile name. `chats:create` does not accept a name
   * from the renderer.
   */
  createNamed(projectId: string, name: string): ChatInfo {
    const channel = 'kanban:launchTask'
    return this.insert(projectId, this.formatName(projectId, channel, name), channel)
  }

  private formatName(projectId: string, channel: string, profileName?: string): string {
    const shellName = this.chatNameForProject(projectId).trim()
    const profile = profileName?.trim()
    if (shellName.length === 0 || profile === '') {
      throw new AppError('validation', 'Chat name must not be empty.', channel)
    }
    return `[${shellName}]${profile === undefined ? '' : ` ${profile}`}`
  }

  private insert(projectId: string, name: string, channel: string): ChatInfo {
    const project = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      throw new AppError('not_found', 'Project not found.', channel)
    }

    const id = randomUUID()
    try {
      this.db
        .prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(id, projectId, name, new Date().toISOString())
    } catch (error) {
      console.error(`[sqlite] ${channel} failed:`, error)
      throw new AppError('sqlite', 'Database error.', channel)
    }

    return { id, projectId, name }
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
