import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { seedDemo } from './seed-demo.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nekode-demo-test-'))
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
      path_identity TEXT UNIQUE NOT NULL, runtime_label TEXT, created_at TEXT NOT NULL);
    CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL, created_at TEXT NOT NULL, task_ref TEXT, agent_name TEXT);
    CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { db, root }
}

test('seeds usable project directories, sessions, and a restored selection once', (t) => {
  const { db, root } = fixture(t)
  assert.equal(seedDemo(db, root), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 3)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chats').get().count, 5)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM chats WHERE project_id = 'demo-empty'").get().count,
    0,
  )
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'selection.chatId'").get().value,
    'demo-atlas-1',
  )
  assert.match(readFileSync(join(root, 'Atlas Web', 'README.md'), 'utf8'), /Atlas Web/)

  db.prepare("UPDATE chats SET name = 'My edited session' WHERE id = 'demo-atlas-1'").run()
  writeFileSync(join(root, 'Atlas Web', 'README.md'), 'My edited project')
  db.prepare("DELETE FROM chats WHERE id = 'demo-orbit-2'").run()
  assert.equal(seedDemo(db, root), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chats').get().count, 4)
  assert.equal(
    db.prepare("SELECT name FROM chats WHERE id = 'demo-atlas-1'").get().name,
    'My edited session',
  )
  assert.equal(readFileSync(join(root, 'Atlas Web', 'README.md'), 'utf8'), 'My edited project')
})

test('keeps existing workspace settings', (t) => {
  const { db, root } = fixture(t)
  db.prepare('INSERT INTO app_state VALUES (?, ?)').run('region.left.width', '410')
  db.prepare('INSERT INTO app_state VALUES (?, ?)').run('selection.projectId', 'existing-project')
  seedDemo(db, root)
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'region.left.width'").get().value,
    '410',
  )
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'selection.projectId'").get().value,
    'existing-project',
  )
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'selection.chatId'").get(),
    undefined,
  )
})

test('selects the demo when the saved selection is explicitly empty', (t) => {
  const { db, root } = fixture(t)
  db.prepare('INSERT INTO app_state VALUES (?, ?)').run('selection.projectId', '')
  db.prepare('INSERT INTO app_state VALUES (?, ?)').run('selection.chatId', '')
  seedDemo(db, root)
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'selection.projectId'").get().value,
    'demo-atlas',
  )
  assert.equal(
    db.prepare("SELECT value FROM app_state WHERE key = 'selection.chatId'").get().value,
    'demo-atlas-1',
  )
})

test('rolls back database writes when a project identity conflicts', (t) => {
  const { db, root } = fixture(t)
  db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, NULL, ?)').run(
    'demo-orbit',
    'Existing',
    '/existing',
    '/existing',
    'now',
  )
  assert.throws(() => seedDemo(db, root), /UNIQUE/)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chats').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0)
})
