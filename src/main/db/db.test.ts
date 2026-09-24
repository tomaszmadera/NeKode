import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './connection'
import { runMigrations } from './migrations'

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
      expect(runMigrations(db)).toBe(1)
      expect(runMigrations(db)).toBe(1)
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual([
        'app_state',
        'projects',
        'schema_migrations',
        'tasks',
      ])
    } finally {
      db.close()
    }
  })

  it('enforces cascading task deletion on project removal', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      db.prepare(
        "INSERT INTO tasks (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'idle', ?)",
      ).run('t1', 'p1', 'task', '2026-01-01T00:00:00Z')

      db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
      const tasks = db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }
      expect(tasks.c).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rejects duplicate project paths and duplicate task names', () => {
    const db = openDatabase(':memory:')
    try {
      runMigrations(db)
      const insertProject = db.prepare(
        'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      insertProject.run('p1', 'demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      expect(() => insertProject.run('p2', 'other', 'D:/code/demo', null, 'x')).toThrow(/UNIQUE/i)
    } finally {
      db.close()
    }
  })
})
