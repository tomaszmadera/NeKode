import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AppStateService } from '../services/app-state-service'
import { openDatabase } from './connection'
import { MIGRATIONS, runMigrations } from './migrations'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-db-test-'))
  tempDirs.push(dir)
  return join(dir, 'test.db')
}

describe('openDatabase', () => {
  it('enables WAL, foreign keys and a busy timeout', () => {
    const db = openDatabase(tempDbPath())
    try {
      expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    } finally {
      db.close()
    }
  })
})

describe('runMigrations', () => {
  it('creates the schema once and is idempotent', () => {
    const db = openDatabase(':memory:')
    try {
      expect(runMigrations(db)).toBe(5)
      expect(runMigrations(db)).toBe(5)
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual([
        'actions',
        'app_state',
        'chats',
        'projects',
        'schema_migrations',
      ])
    } finally {
      db.close()
    }
  })

  it('enforces cascading chat deletion on project removal', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      db.prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(
        't1',
        'p1',
        'chat',
        '2026-01-01T00:00:00Z',
      )

      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
      const chats = db.prepare('SELECT COUNT(*) AS c FROM chats').get() as { c: number }
      expect(chats.c).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rejects duplicate project paths and allows duplicate chat names', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      const insertProject = db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      insertProject.run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      expect(() => insertProject.run('p2', 'other', 'D:/code/demo', null, 'x')).toThrow(/UNIQUE/i)

      const insertChat = db.prepare(
        'INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)',
      )
      insertChat.run('t1', 'p1', 'PowerShell', '2026-01-01T00:00:00Z')
      // The chat name is a display label; duplicates within a project are
      // allowed (spec Business rules, identity is the id).
      expect(() => insertChat.run('t2', 'p1', 'PowerShell', '2026-01-01T00:00:01Z')).not.toThrow()
    } finally {
      db.close()
    }
  })
})

describe('migration 2 (tasks -> chats)', () => {
  /** Builds a legacy database exactly as migration 1 left it (with `tasks`). */
  function createLegacyDb(): Database.Database {
    const db = openDatabase(':memory:')
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
    `)
    MIGRATIONS[0].up(db)
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
    db.prepare(
      "INSERT INTO tasks (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'idle', ?)",
    ).run('t1', 'p1', 'First chat', '2026-01-01T00:00:00Z')
    db.prepare(
      "INSERT INTO tasks (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'idle', ?)",
    ).run('t2', 'p1', 'Second chat', '2026-01-01T00:00:01Z')
    // Legacy selection keys, as the old build wrote them.
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('selection.projectId', 'p1')
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('selection.taskId', 't1')
    return db
  }

  it('carries rows over to chats without status and drops the tasks table', () => {
    const db = createLegacyDb()
    try {
      expect(runMigrations(db)).toBe(5)

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual([
        'actions',
        'app_state',
        'chats',
        'projects',
        'schema_migrations',
      ])

      const columns = db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'project_id',
        'name',
        'created_at',
      ])

      const rows = db
        .prepare('SELECT id, project_id, name FROM chats ORDER BY created_at, name')
        .all() as Array<{ id: string; project_id: string; name: string }>
      expect(rows).toEqual([
        { id: 't1', project_id: 'p1', name: 'First chat' },
        { id: 't2', project_id: 'p1', name: 'Second chat' },
      ])
    } finally {
      db.close()
    }
  })

  it('keeps the selection working and cleans the legacy key', () => {
    const db = createLegacyDb()
    try {
      runMigrations(db)

      // The selection value survives under the new key (restart restores it).
      expect(
        db.prepare('SELECT value FROM app_state WHERE key = ?').get('selection.chatId'),
      ).toEqual({ value: 't1' })
      // The old key is cleaned up entirely.
      expect(
        db.prepare('SELECT value FROM app_state WHERE key = ?').get('selection.taskId'),
      ).toBeUndefined()

      // Stale-key cleanup still resolves the migrated selection.
      const state = new AppStateService({ db })
      expect(state.cleanupSelection()).toEqual({ projectId: 'p1', chatId: 't1' })
    } finally {
      db.close()
    }
  })

  it('prefers an existing selection.chatId over the legacy key', () => {
    const db = createLegacyDb()
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('selection.chatId', 't2')
    try {
      runMigrations(db)
      expect(
        db.prepare('SELECT value FROM app_state WHERE key = ?').get('selection.chatId'),
      ).toEqual({ value: 't2' })
      expect(
        db.prepare('SELECT value FROM app_state WHERE key = ?').get('selection.taskId'),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('is idempotent for fresh databases', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      runMigrations(db)
      const applied = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number }>
      expect(applied.map((row) => row.version)).toEqual([1, 2, 3, 4, 5])
    } finally {
      db.close()
    }
  })
})

describe('migration 5 (run_mode gains bottom-terminal)', () => {
  /**
   * Builds a database exactly as migration 4 left it: the `actions` table
   * whose CHECK still allows only 'background' and 'new-terminal'.
   */
  function createLegacyDbAtV4(): Database.Database {
    const db = openDatabase(':memory:')
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations (version, applied_at) VALUES (2, '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations (version, applied_at) VALUES (3, '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations (version, applied_at) VALUES (4, '2026-01-01T00:00:00Z');
    `)
    MIGRATIONS[0].up(db)
    MIGRATIONS[1].up(db)
    MIGRATIONS[2].up(db)
    MIGRATIONS[3].up(db)
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
    db.exec(`
      INSERT INTO actions (id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order) VALUES
        ('a-bg', 'p1', 'project', 'Background', NULL, 'pnpm build', NULL, 'background', 0, 0),
        ('a-nt', 'p1', 'project', 'New terminal', NULL, 'pnpm dev', NULL, 'new-terminal', 0, 1);
    `)
    return db
  }

  it('a v4 database really rejects bottom-terminal before the migration', () => {
    const db = createLegacyDbAtV4()
    try {
      expect(() =>
        db
          .prepare(
            `INSERT INTO actions
             (id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order)
             VALUES ('a-bt', 'p1', 'project', 'Bottom', NULL, 'pnpm test', NULL, 'bottom-terminal', 0, 2)`,
          )
          .run(),
      ).toThrow(/CHECK|run_mode/i)
    } finally {
      db.close()
    }
  })

  it('accepts bottom-terminal on an empty database and keeps the schema', () => {
    const db = openDatabase(':memory:')
    try {
      expect(runMigrations(db)).toBe(5)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      expect(() =>
        db
          .prepare(
            `INSERT INTO actions
             (id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order)
             VALUES ('a-bt', 'p1', 'project', 'Bottom', NULL, 'pnpm test', NULL, 'bottom-terminal', 0, 0)`,
          )
          .run(),
      ).not.toThrow()
      // Idempotent: a second run re-applies nothing.
      expect(runMigrations(db)).toBe(5)
    } finally {
      db.close()
    }
  })

  it('lets populated databases accept bottom-terminal and keeps old rows byte-for-byte', () => {
    const db = createLegacyDbAtV4()
    try {
      expect(runMigrations(db)).toBe(5)
      expect(() =>
        db
          .prepare(
            `INSERT INTO actions
             (id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order)
             VALUES ('a-bt', 'p1', 'project', 'Bottom', NULL, 'pnpm test', NULL, 'bottom-terminal', 0, 2)`,
          )
          .run(),
      ).not.toThrow()
      // Old run_mode values are rewritten by nothing (spec Business rules).
      const rows = db
        .prepare(
          'SELECT id, project_id, scope, title, command, cwd, run_mode, confirm, sort_order FROM actions ORDER BY sort_order',
        )
        .all() as Array<Record<string, unknown>>
      expect(rows).toEqual([
        {
          id: 'a-bg',
          project_id: 'p1',
          scope: 'project',
          title: 'Background',
          command: 'pnpm build',
          cwd: null,
          run_mode: 'background',
          confirm: 0,
          sort_order: 0,
        },
        {
          id: 'a-nt',
          project_id: 'p1',
          scope: 'project',
          title: 'New terminal',
          command: 'pnpm dev',
          cwd: null,
          run_mode: 'new-terminal',
          confirm: 0,
          sort_order: 1,
        },
        {
          id: 'a-bt',
          project_id: 'p1',
          scope: 'project',
          title: 'Bottom',
          command: 'pnpm test',
          cwd: null,
          run_mode: 'bottom-terminal',
          confirm: 0,
          sort_order: 2,
        },
      ])
      // The rebuilt table keeps the cascade.
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
      expect((db.prepare('SELECT COUNT(*) AS c FROM actions').get() as { c: number }).c).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('migration 3 (chat name unique index dropped)', () => {
  /**
   * Builds a legacy database exactly as migration 2 left it: `chats` with
   * UNIQUE (project_id, name) and real rows under it.
   */
  function createLegacyDbAtV2(): Database.Database {
    const db = openDatabase(':memory:')
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations (version, applied_at) VALUES (2, '2026-01-01T00:00:00Z');
    `)
    MIGRATIONS[0].up(db)
    MIGRATIONS[1].up(db)
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
    db.prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      't1',
      'p1',
      'PowerShell',
      '2026-01-01T00:00:00Z',
    )
    db.prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      't2',
      'p1',
      'bash',
      '2026-01-01T00:00:01Z',
    )
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('selection.chatId', 't1')
    return db
  }

  it('a legacy database really enforced the unique index before the migration', () => {
    const db = createLegacyDbAtV2()
    try {
      expect(() =>
        db
          .prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
          .run('t3', 'p1', 'PowerShell', '2026-01-01T00:00:02Z'),
      ).toThrow(/UNIQUE/i)
    } finally {
      db.close()
    }
  })

  it('drops the unique index: duplicate chat names within a project are allowed', () => {
    const db = createLegacyDbAtV2()
    try {
      expect(runMigrations(db)).toBe(5)
      expect(() =>
        db
          .prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
          .run('t3', 'p1', 'PowerShell', '2026-01-01T00:00:02Z'),
      ).not.toThrow()
      const names = db
        .prepare('SELECT name FROM chats WHERE project_id = ? ORDER BY created_at, name')
        .all('p1') as Array<{ name: string }>
      expect(names.map((row) => row.name)).toEqual(['PowerShell', 'bash', 'PowerShell'])
    } finally {
      db.close()
    }
  })

  it('leaves existing rows and state untouched', () => {
    const db = createLegacyDbAtV2()
    try {
      runMigrations(db)
      const rows = db
        .prepare('SELECT id, project_id, name, created_at FROM chats ORDER BY created_at, name')
        .all() as Array<{ id: string; project_id: string; name: string; created_at: string }>
      expect(rows).toEqual([
        {
          id: 't1',
          project_id: 'p1',
          name: 'PowerShell',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 't2',
          project_id: 'p1',
          name: 'bash',
          created_at: '2026-01-01T00:00:01Z',
        },
      ])
      expect(
        db.prepare('SELECT value FROM app_state WHERE key = ?').get('selection.chatId'),
      ).toEqual({ value: 't1' })
      // The cascade and the column set survive the table rebuild.
      const columns = db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'project_id',
        'name',
        'created_at',
      ])
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
      expect((db.prepare('SELECT COUNT(*) AS c FROM chats').get() as { c: number }).c).toBe(0)
    } finally {
      db.close()
    }
  })
})
