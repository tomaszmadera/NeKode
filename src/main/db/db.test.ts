import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AppStateService } from '../services/app-state-service'
import { openDatabase } from './connection'
import { assertValidMigrations, MIGRATIONS, runMigrations } from './migrations'

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

describe('migration 6 (chat launch identity)', () => {
  it('preserves legacy rows and round-trips identity across a file database reopen', () => {
    const path = tempDbPath()
    const db = openDatabase(path)
    try {
      runMigrations(
        db,
        MIGRATIONS.filter((migration) => migration.version <= 5),
      )
      db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
        'project',
        'Demo',
        'D:/demo',
        '2026-10-18T00:00:00Z',
      )
      db.prepare('INSERT INTO chats (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(
        'legacy',
        'project',
        '[PS7] Old profile',
        '2026-10-18T00:00:00Z',
      )
      expect(runMigrations(db)).toBe(7)
      expect(runMigrations(db)).toBe(7)
      expect(db.prepare('SELECT name, task_ref, agent_name FROM chats').get()).toEqual({
        name: '[PS7] Old profile',
        task_ref: null,
        agent_name: null,
      })
      db.prepare(
        'INSERT INTO chats (id, project_id, name, created_at, task_ref, agent_name) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('agent', 'project', '[PS7] Analysis', '2026-10-18T00:00:01Z', 'NEKODE-42', 'Claude')
    } finally {
      db.close()
    }
    const reopened = openDatabase(path)
    try {
      expect(runMigrations(reopened)).toBe(7)
      expect(
        reopened.prepare('SELECT name, task_ref, agent_name FROM chats WHERE id = ?').get('agent'),
      ).toEqual({
        name: '[PS7] Analysis',
        task_ref: 'NEKODE-42',
        agent_name: 'Claude',
      })
      reopened.prepare('DELETE FROM projects WHERE id = ?').run('project')
      expect(reopened.prepare('SELECT id FROM chats').all()).toEqual([])
    } finally {
      reopened.close()
    }
  })
})

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
      expect(runMigrations(db)).toBe(7)
      expect(runMigrations(db)).toBe(7)
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual([
        'actions',
        'app_state',
        'chats',
        'dictation_dictionary',
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

describe('migration sequence and downgrade safety', () => {
  it('validates that MIGRATIONS versions are unique and strictly ascending', () => {
    expect(() => assertValidMigrations(MIGRATIONS)).not.toThrow()

    expect(() =>
      assertValidMigrations([
        { version: 1, up: () => {} },
        { version: 1, up: () => {} },
      ]),
    ).toThrow(/strictly greater/i)

    expect(() =>
      assertValidMigrations([
        { version: 2, up: () => {} },
        { version: 1, up: () => {} },
      ]),
    ).toThrow(/strictly greater/i)

    expect(() => assertValidMigrations([{ version: 0, up: () => {} }])).toThrow(/strictly greater/i)
  })

  it('fails fast when the database was created by a newer version (downgrade)', () => {
    const db = openDatabase(':memory:')
    try {
      db.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
        INSERT INTO schema_migrations (version, applied_at) VALUES (999, '2026-01-01T00:00:00Z');
      `)
      expect(() => runMigrations(db)).toThrow(/database was created by a newer version/i)
    } finally {
      db.close()
    }
  })

  it('rejects execution when given an invalid migration sequence', () => {
    const db = openDatabase(':memory:')
    try {
      expect(() =>
        runMigrations(db, [
          { version: 2, up: () => {} },
          { version: 1, up: () => {} },
        ]),
      ).toThrow(/strictly greater/i)
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
      expect(runMigrations(db)).toBe(7)

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual([
        'actions',
        'app_state',
        'chats',
        'dictation_dictionary',
        'projects',
        'schema_migrations',
      ])

      const columns = db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'project_id',
        'name',
        'created_at',
        'task_ref',
        'agent_name',
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
      expect(applied.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7])
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
        ('a-bg', 'p1', 'project', 'Background', 'hammer', 'pnpm build', NULL, 'background', 0, 0),
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
      expect(runMigrations(db)).toBe(7)
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
      expect(runMigrations(db)).toBe(7)
    } finally {
      db.close()
    }
  })

  it('lets populated databases accept bottom-terminal and keeps old rows byte-for-byte', () => {
    const db = createLegacyDbAtV4()
    try {
      expect(runMigrations(db)).toBe(7)
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
      // `icon` is in the SELECT on purpose: migration 5 rebuilds the actions
      // table, and a dropped icon column must fail this assertion (review:4
      // follow-up — the fixture keeps one non-NULL icon so the copy is real).
      const rows = db
        .prepare(
          'SELECT id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order FROM actions ORDER BY sort_order',
        )
        .all() as Array<Record<string, unknown>>
      expect(rows).toEqual([
        {
          id: 'a-bg',
          project_id: 'p1',
          scope: 'project',
          title: 'Background',
          icon: 'hammer',
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
          icon: null,
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
          icon: null,
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
      expect(runMigrations(db)).toBe(7)
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
        'task_ref',
        'agent_name',
      ])
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
      expect((db.prepare('SELECT COUNT(*) AS c FROM chats').get() as { c: number }).c).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('migration 7 (dictation dictionary)', () => {
  it('creates the dictation_dictionary table with expected schema and indexes', () => {
    const db = openDatabase(':memory:')
    try {
      expect(runMigrations(db)).toBe(7)
      expect(runMigrations(db)).toBe(7)

      const columns = db.prepare('PRAGMA table_info(dictation_dictionary)').all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
        pk: number
      }>

      expect(
        columns.map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk })),
      ).toEqual([
        { name: 'id', type: 'TEXT', notnull: 0, pk: 1 },
        { name: 'term', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'aliases', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'description', type: 'TEXT', notnull: 0, pk: 0 },
        { name: 'scope', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'project_id', type: 'TEXT', notnull: 0, pk: 0 },
        { name: 'enabled', type: 'INTEGER', notnull: 1, pk: 0 },
        { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 },
      ])

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dictation_dictionary' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
        )
        .all() as Array<{ name: string }>

      expect(indexes.map((idx) => idx.name)).toEqual([
        'idx_dictation_dictionary_lookup',
        'uq_dictation_dictionary_global',
        'uq_dictation_dictionary_project',
      ])
    } finally {
      db.close()
    }
  })

  it('enforces check constraints on scope, enabled, and project_id relationship', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')

      const now = '2026-10-25T10:00:00Z'

      // Valid global entry
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('g1', 'Kubernetes', 'global', NULL, ?, ?)`,
          )
          .run(now, now),
      ).not.toThrow()

      // Invalid: global entry with project_id
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('g2', 'Docker', 'global', 'p1', ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/CHECK/i)

      // Invalid: project entry with NULL project_id
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('p-invalid', 'Docker', 'project', NULL, ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/CHECK/i)

      // Invalid: scope not 'global' or 'project'
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('bad-scope', 'Docker', 'workspace', NULL, ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/CHECK/i)

      // Invalid: enabled not 0 or 1
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, enabled, created_at, updated_at)
             VALUES ('bad-enabled', 'Docker', 'global', NULL, 2, ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/CHECK/i)
    } finally {
      db.close()
    }
  })

  it('enforces uniqueness for global terms and project terms case-insensitively', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p2', 'demo2', 'D:/code/demo2', null, '2026-01-01T00:00:00Z')

      const now = '2026-10-25T10:00:00Z'

      // Global term
      db.prepare(
        `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
         VALUES ('g1', 'Docker', 'global', NULL, ?, ?)`,
      ).run(now, now)

      // Duplicate global term (case-insensitive) should throw
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('g2', 'docker', 'global', NULL, ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/UNIQUE/i)

      // Same term in project scope is allowed (overrides global)
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('p1-docker', 'Docker', 'project', 'p1', ?, ?)`,
          )
          .run(now, now),
      ).not.toThrow()

      // Duplicate in same project (case-insensitive) should throw
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('p1-docker-dup', 'dOcKeR', 'project', 'p1', ?, ?)`,
          )
          .run(now, now),
      ).toThrow(/UNIQUE/i)

      // Same term in a different project is allowed
      expect(() =>
        db
          .prepare(
            `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
             VALUES ('p2-docker', 'docker', 'project', 'p2', ?, ?)`,
          )
          .run(now, now),
      ).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('cascades deletion of project dictionary entries when a project is removed', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p2', 'demo2', 'D:/code/demo2', null, '2026-01-01T00:00:00Z')

      const now = '2026-10-25T10:00:00Z'

      // Global entry
      db.prepare(
        `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
         VALUES ('g1', 'Kubernetes', 'global', NULL, ?, ?)`,
      ).run(now, now)

      // p1 entry
      db.prepare(
        `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
         VALUES ('p1-1', 'Docker', 'project', 'p1', ?, ?)`,
      ).run(now, now)

      // p2 entry
      db.prepare(
        `INSERT INTO dictation_dictionary (id, term, scope, project_id, created_at, updated_at)
         VALUES ('p2-1', 'Vitest', 'project', 'p2', ?, ?)`,
      ).run(now, now)

      expect(
        (db.prepare('SELECT COUNT(*) AS c FROM dictation_dictionary').get() as { c: number }).c,
      ).toBe(3)

      // Delete project p1
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')

      const remaining = db
        .prepare('SELECT id, term, scope, project_id FROM dictation_dictionary ORDER BY id')
        .all() as Array<{ id: string; term: string; scope: string; project_id: string | null }>

      expect(remaining).toEqual([
        { id: 'g1', term: 'Kubernetes', scope: 'global', project_id: null },
        { id: 'p2-1', term: 'Vitest', scope: 'project', project_id: 'p2' },
      ])
    } finally {
      db.close()
    }
  })

  it('migrates an existing v6 database cleanly and round-trips across reopen', () => {
    const path = tempDbPath()
    const db = openDatabase(path)
    try {
      // Migrate up to 6
      runMigrations(
        db,
        MIGRATIONS.filter((m) => m.version <= 6),
      )
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')

      // Now run migration 7
      expect(runMigrations(db)).toBe(7)

      const now = '2026-10-25T10:00:00Z'
      db.prepare(
        `INSERT INTO dictation_dictionary (id, term, aliases, description, scope, project_id, enabled, created_at, updated_at)
         VALUES ('d1', 'React', '["riakt"]', 'UI framework', 'global', NULL, 1, ?, ?)`,
      ).run(now, now)
    } finally {
      db.close()
    }

    const reopened = openDatabase(path)
    try {
      expect(runMigrations(reopened)).toBe(7)
      const entry = reopened
        .prepare('SELECT * FROM dictation_dictionary WHERE id = ?')
        .get('d1') as Record<string, unknown>

      expect(entry).toMatchObject({
        id: 'd1',
        term: 'React',
        aliases: '["riakt"]',
        description: 'UI framework',
        scope: 'global',
        project_id: null,
        enabled: 1,
      })
    } finally {
      reopened.close()
    }
  })
})
