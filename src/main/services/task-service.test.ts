import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type AppErrorCode } from '../../shared/ipc-error'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { ProjectService } from './project-service'
import { TaskService } from './task-service'

// TaskService unit tests on an :memory: database (pattern: db.test.ts),
// including the service-level cascade when a project is removed.

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function createServices(): { projects: ProjectService; tasks: TaskService } {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: {
      stat: () => ({ isDirectory: () => true }),
    },
  })
  return { projects, tasks: new TaskService({ db }) }
}

function expectAppError(run: () => unknown, code: AppErrorCode): AppError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) {
      expect(error.code).toBe(code)
      return error
    }
    throw error
  }
  throw new Error('expected the call to throw an AppError')
}

const demoPath = join(tmpdir(), 'nekode-task-service-tests', 'demo-project')
const otherPath = join(tmpdir(), 'nekode-task-service-tests', 'other-project')

describe('TaskService', () => {
  it('create stores a trimmed task with status idle under the project', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)

    const created = tasks.create(project.id, '  Ship the release  ')
    expect(created.id.length).toBeGreaterThan(0)
    expect(created.projectId).toBe(project.id)
    expect(created.name).toBe('Ship the release')
    expect(created.status).toBe('idle')
    expect(tasks.get(created.id)).toEqual(created)
    expect(tasks.list(project.id)).toEqual([created])
  })

  it('list only returns tasks of the given project', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)

    tasks.create(project.id, 'Task A')
    tasks.create(otherProject.id, 'Task B')

    expect(tasks.list(project.id).map((task) => task.name)).toEqual(['Task A'])
    expect(tasks.list(otherProject.id).map((task) => task.name)).toEqual(['Task B'])
  })

  it('rejects an empty or whitespace-only name', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)

    expectAppError(() => tasks.create(project.id, ''), 'validation')
    expectAppError(() => tasks.create(project.id, '   '), 'validation')
    expect(tasks.list(project.id)).toEqual([])
  })

  it('rejects a duplicate task name within one project', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)
    tasks.create(project.id, 'Fix login')

    const error = expectAppError(() => tasks.create(project.id, ' Fix login '), 'conflict')
    expect(error.message).toContain('already exists')
    expect(tasks.list(project.id)).toHaveLength(1)
  })

  it('allows the same task name in a different project', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)

    tasks.create(project.id, 'Shared name')
    const created = tasks.create(otherProject.id, 'Shared name')
    expect(created.name).toBe('Shared name')
    expect(tasks.list(otherProject.id)).toHaveLength(1)
  })

  it('rejects creating a task under a missing project', () => {
    const { tasks } = createServices()
    expectAppError(() => tasks.create('missing-project', 'Orphan'), 'not_found')
  })

  it('removing a project cascades to its tasks (service level)', () => {
    const { projects, tasks } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)
    const first = tasks.create(project.id, 'Task A')
    tasks.create(project.id, 'Task B')
    const kept = tasks.create(otherProject.id, 'Task C')

    projects.remove(project.id)

    expect(tasks.list(project.id)).toEqual([])
    expect(tasks.get(first.id)).toBeNull()
    // Tasks of other projects are untouched.
    expect(tasks.get(kept.id)).toEqual(kept)
  })

  it('get returns null for an unknown id', () => {
    const { tasks } = createServices()
    expect(tasks.get('missing-task')).toBeNull()
  })
})
