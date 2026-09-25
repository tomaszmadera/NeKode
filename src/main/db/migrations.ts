import type Database from 'better-sqlite3'

// Simple versioned migration queue kept in code (no external tooling).
// Each migration runs once inside a transaction and is recorded in
// schema_migrations; later versions append to MIGRATIONS, never rewrite.

export interface Migration {
  version: number
  up: (db: Database.Database) => void
}

export const MIGRATIONS: readonly Migration[] = [
  {
    // Historical schema (Stage 2): the tree entity was misnamed `tasks` here;
    // version 2 renames it to `chats`. Kept byte-stable so databases created
    // by earlier builds migrate cleanly (append, never rewrite).
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          runtime_label TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          created_at TEXT NOT NULL,
          UNIQUE (project_id, name)
        );

        CREATE TABLE app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    },
  },
  {
    // Stage 4: the tree entity is the chat (spec Data/API). The old `tasks`
    // table becomes `chats` without the dropped `status` column; rows are
    // carried over and the old table is dropped. The selection key is renamed
    // as well and the old key is always cleaned up. Literal key names on
    // purpose: migrations must keep working even if APP_STATE_KEY changes.
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE chats (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (project_id, name)
        );

        INSERT INTO chats (id, project_id, name, created_at)
          SELECT id, project_id, name, created_at FROM tasks;

        DROP TABLE tasks;

        INSERT INTO app_state (key, value)
          SELECT 'selection.chatId', value FROM app_state
          WHERE key = 'selection.taskId'
            AND NOT EXISTS (SELECT 1 FROM app_state WHERE key = 'selection.chatId');

        DELETE FROM app_state WHERE key = 'selection.taskId';
      `)
    },
  },
]

export function runMigrations(db: Database.Database): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number
  }>
  const applied = new Set(appliedRows.map((row) => row.version))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue
    }
    const applyMigration = db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
    })
    applyMigration()
  }

  const current = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined
  return current?.version ?? 0
}
