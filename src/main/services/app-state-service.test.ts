import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_STATE_KEY } from '../../shared/ipc-contract'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { AppStateService } from './app-state-service'

// AppStateService unit tests on an :memory: database (pattern: db.test.ts),
// covering every cleanupSelection branch (spec Edge cases: a selection
// pointing at a removed project/task falls back to the default empty state).

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function createService(): { state: AppStateService; db: Database.Database } {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  return { state: new AppStateService({ db }), db }
}

function insertProject(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, `project-${id}`, `D:/code/${id}`, null, '2026-01-01T00:00:00Z')
}

function insertTask(db: Database.Database, id: string, projectId: string): void {
  db.prepare(
    "INSERT INTO tasks (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'idle', ?)",
  ).run(id, projectId, `task-${id}`, '2026-01-01T00:00:00Z')
}

describe('AppStateService key–value store', () => {
  it('returns null for a missing key and round-trips set values', () => {
    const { state } = createService()
    expect(state.get('missing.key')).toBeNull()

    state.set('some.key', 'first')
    expect(state.get('some.key')).toBe('first')

    state.set('some.key', 'second')
    expect(state.get('some.key')).toBe('second')

    state.delete('some.key')
    expect(state.get('some.key')).toBeNull()
  })
})

describe('AppStateService.cleanupSelection', () => {
  it('returns an empty selection when nothing is stored', () => {
    const { state } = createService()
    expect(state.cleanupSelection()).toEqual({ projectId: null, taskId: null })
  })

  it('keeps a valid selection and its keys', () => {
    const { state, db } = createService()
    insertProject(db, 'p1')
    insertTask(db, 't1', 'p1')
    state.set(APP_STATE_KEY.selectedProjectId, 'p1')
    state.set(APP_STATE_KEY.selectedTaskId, 't1')

    expect(state.cleanupSelection()).toEqual({ projectId: 'p1', taskId: 't1' })
    expect(state.get(APP_STATE_KEY.selectedProjectId)).toBe('p1')
    expect(state.get(APP_STATE_KEY.selectedTaskId)).toBe('t1')
  })

  it('clears both keys when the selected project was removed', () => {
    const { state } = createService()
    state.set(APP_STATE_KEY.selectedProjectId, 'p-ghost')
    state.set(APP_STATE_KEY.selectedTaskId, 't-ghost')

    expect(state.cleanupSelection()).toEqual({ projectId: null, taskId: null })
    expect(state.get(APP_STATE_KEY.selectedProjectId)).toBeNull()
    expect(state.get(APP_STATE_KEY.selectedTaskId)).toBeNull()
  })

  it('clears only the task key when the selected task was removed', () => {
    const { state, db } = createService()
    insertProject(db, 'p1')
    state.set(APP_STATE_KEY.selectedProjectId, 'p1')
    state.set(APP_STATE_KEY.selectedTaskId, 't-ghost')

    expect(state.cleanupSelection()).toEqual({ projectId: 'p1', taskId: null })
    expect(state.get(APP_STATE_KEY.selectedProjectId)).toBe('p1')
    expect(state.get(APP_STATE_KEY.selectedTaskId)).toBeNull()
  })

  it('clears the task key when the task belongs to a different project', () => {
    const { state, db } = createService()
    insertProject(db, 'p1')
    insertProject(db, 'p2')
    insertTask(db, 't2', 'p2')
    state.set(APP_STATE_KEY.selectedProjectId, 'p1')
    state.set(APP_STATE_KEY.selectedTaskId, 't2')

    expect(state.cleanupSelection()).toEqual({ projectId: 'p1', taskId: null })
    expect(state.get(APP_STATE_KEY.selectedProjectId)).toBe('p1')
    expect(state.get(APP_STATE_KEY.selectedTaskId)).toBeNull()
  })

  it('is idempotent after cleaning', () => {
    const { state } = createService()
    state.set(APP_STATE_KEY.selectedProjectId, 'p-ghost')
    state.set(APP_STATE_KEY.selectedTaskId, 't-ghost')

    expect(state.cleanupSelection()).toEqual({ projectId: null, taskId: null })
    expect(state.cleanupSelection()).toEqual({ projectId: null, taskId: null })
  })
})

describe('AppStateService.getSelectedProject', () => {
  it('returns the selected project record', () => {
    const { state, db } = createService()
    insertProject(db, 'p1')
    state.set(APP_STATE_KEY.selectedProjectId, 'p1')

    expect(state.getSelectedProject()).toEqual({
      id: 'p1',
      name: 'project-p1',
      path: 'D:/code/p1',
      runtimeLabel: null,
    })
  })

  it('returns null and cleans the keys after the project is removed', () => {
    const { state, db } = createService()
    insertProject(db, 'p1')
    state.set(APP_STATE_KEY.selectedProjectId, 'p1')
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1')

    expect(state.getSelectedProject()).toBeNull()
    expect(state.get(APP_STATE_KEY.selectedProjectId)).toBeNull()
  })
})
