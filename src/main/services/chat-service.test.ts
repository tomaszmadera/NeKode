import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type AppErrorCode } from '../../shared/ipc-error'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { ChatService } from './chat-service'
import { ProjectService } from './project-service'

// ChatService unit tests on an :memory: database (pattern: db.test.ts),
// including the service-level cascade when a project is removed and the
// chat-removal close flow (spec Behaviour 11).

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function createServices(): { projects: ProjectService; chats: ChatService } {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: {
      stat: () => ({ isDirectory: () => true }),
    },
  })
  return { projects, chats: new ChatService({ db }) }
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

const demoPath = join(tmpdir(), 'nekode-chat-service-tests', 'demo-project')
const otherPath = join(tmpdir(), 'nekode-chat-service-tests', 'other-project')

describe('ChatService', () => {
  it('create stores a trimmed chat (no status field) under the project', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)

    const created = chats.create(project.id, '  Ship the release  ')
    expect(created.id.length).toBeGreaterThan(0)
    expect(created.projectId).toBe(project.id)
    expect(created.name).toBe('Ship the release')
    // The chat model has no task status (spec Data/API): the payload shape
    // itself is the contract.
    expect(created).toEqual({ id: created.id, projectId: project.id, name: 'Ship the release' })
    expect(chats.get(created.id)).toEqual(created)
    expect(chats.list(project.id)).toEqual([created])
  })

  it('list only returns chats of the given project', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)

    chats.create(project.id, 'Chat A')
    chats.create(otherProject.id, 'Chat B')

    expect(chats.list(project.id).map((chat) => chat.name)).toEqual(['Chat A'])
    expect(chats.list(otherProject.id).map((chat) => chat.name)).toEqual(['Chat B'])
  })

  it('rejects an empty or whitespace-only name', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    expectAppError(() => chats.create(project.id, ''), 'validation')
    expectAppError(() => chats.create(project.id, '   '), 'validation')
    expect(chats.list(project.id)).toEqual([])
  })

  it('rejects a duplicate chat name within one project', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    chats.create(project.id, 'Fix login')

    const error = expectAppError(() => chats.create(project.id, ' Fix login '), 'conflict')
    expect(error.message).toContain('already exists')
    expect(chats.list(project.id)).toHaveLength(1)
  })

  it('allows the same chat name in a different project', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)

    chats.create(project.id, 'Shared name')
    const created = chats.create(otherProject.id, 'Shared name')
    expect(created.name).toBe('Shared name')
    expect(chats.list(otherProject.id)).toHaveLength(1)
  })

  it('rejects creating a chat under a missing project', () => {
    const { chats } = createServices()
    expectAppError(() => chats.create('missing-project', 'Orphan'), 'not_found')
  })

  it('removing a project cascades to its chats (service level)', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)
    const first = chats.create(project.id, 'Chat A')
    chats.create(project.id, 'Chat B')
    const kept = chats.create(otherProject.id, 'Chat C')

    projects.remove(project.id)

    expect(chats.list(project.id)).toEqual([])
    expect(chats.get(first.id)).toBeNull()
    // Chats of other projects are untouched.
    expect(chats.get(kept.id)).toEqual(kept)
  })

  it('remove deletes exactly the given chat and is idempotent', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    const first = chats.create(project.id, 'Chat A')
    const second = chats.create(project.id, 'Chat B')

    chats.remove(first.id)
    expect(chats.get(first.id)).toBeNull()
    expect(chats.list(project.id)).toEqual([second])

    // Exit races: a repeated remove (or an unknown id) never throws.
    expect(() => chats.remove(first.id)).not.toThrow()
    expect(() => chats.remove('ghost-chat')).not.toThrow()
    expect(chats.list(project.id)).toEqual([second])
  })

  it('a removed chat name can be used again', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)
    const first = chats.create(project.id, 'Reusable')
    chats.remove(first.id)

    const recreated = chats.create(project.id, 'Reusable')
    expect(recreated.name).toBe('Reusable')
    expect(recreated.id).not.toBe(first.id)
    expect(chats.list(project.id)).toHaveLength(1)
  })

  it('get returns null for an unknown id', () => {
    const { chats } = createServices()
    expect(chats.get('missing-chat')).toBeNull()
  })
})
