import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type AppErrorCode } from '../../shared/ipc-error'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { ChatService } from './chat-service'
import { ProjectService } from './project-service'
import { shellDisplayName } from './terminal/terminal-service'

// ChatService unit tests on an :memory: database (pattern: db.test.ts),
// including the service-level cascade when a project is removed and the
// chat-removal close flow (spec Behaviour 11). Chat creation takes no name
// (spec Behaviour 3): the name is the shell-derived display label and may
// repeat within a project.

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

interface ServiceBundle {
  db: ReturnType<typeof openDatabase>
  projects: ProjectService
  chats: ChatService
  /** Builds an extra ChatService over the same database with its own name. */
  chatsNamed: (chatName: () => string) => ChatService
}

function createServices(options: { chatName?: () => string } = {}): ServiceBundle {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: {
      stat: () => ({ isDirectory: () => true }),
    },
  })
  return {
    db,
    projects,
    chats: new ChatService({ db, chatName: options.chatName }),
    chatsNamed: (chatName: () => string) => new ChatService({ db, chatName }),
  }
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
  it('create takes no name and stores the shell-named chat (no status field)', () => {
    const { projects, chats } = createServices({ chatName: () => 'PowerShell' })
    const project = projects.add(demoPath)

    const created = chats.create(project.id)
    expect(created.id.length).toBeGreaterThan(0)
    expect(created.projectId).toBe(project.id)
    expect(created.name).toBe('PowerShell')
    // The chat model has no task status (spec Data/API): the payload shape
    // itself is the contract.
    expect(created).toEqual({ id: created.id, projectId: project.id, name: 'PowerShell' })
    expect(chats.get(created.id)).toEqual(created)
    expect(chats.list(project.id)).toEqual([created])
  })

  it('derives the default name from the platform shell (same config as the PTY)', () => {
    const { projects, chats } = createServices()
    const project = projects.add(demoPath)

    const created = chats.create(project.id)
    expect(created.name).toBe(shellDisplayName())
    expect(created.name.length).toBeGreaterThan(0)
  })

  it('createNamed stores the profile name and create keeps the shell label', () => {
    const { projects, chats } = createServices({ chatName: () => 'PowerShell' })
    const project = projects.add(demoPath)
    const named = chats.createNamed(project.id, '  Codex  ')
    expect(named.name).toBe('Codex')
    const shell = chats.create(project.id)
    expect(shell.name).toBe('PowerShell')
    expect(
      chats
        .list(project.id)
        .map((chat) => chat.name)
        .sort(),
    ).toEqual(['Codex', 'PowerShell'])
  })

  it('rejects an empty derived name', () => {
    const { projects, chats } = createServices({ chatName: () => '   ' })
    const project = projects.add(demoPath)
    expectAppError(() => chats.create(project.id), 'validation')
    expect(chats.list(project.id)).toEqual([])
  })

  it('allows two chats with the same name within one project (spec Business rules)', () => {
    const { projects, chats } = createServices({ chatName: () => 'PowerShell' })
    const project = projects.add(demoPath)

    const first = chats.create(project.id)
    const second = chats.create(project.id)
    expect(second.name).toBe(first.name)
    expect(second.id).not.toBe(first.id)
    expect(chats.list(project.id)).toHaveLength(2)
  })

  it('list only returns chats of the given project', () => {
    const { projects, chatsNamed } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)

    chatsNamed(() => 'Chat A').create(project.id)
    chatsNamed(() => 'Chat B').create(otherProject.id)

    const chats = chatsNamed(() => 'unused')
    expect(chats.list(project.id).map((chat) => chat.name)).toEqual(['Chat A'])
    expect(chats.list(otherProject.id).map((chat) => chat.name)).toEqual(['Chat B'])
  })

  it('rejects creating a chat under a missing project', () => {
    const { chats } = createServices()
    expectAppError(() => chats.create('missing-project'), 'not_found')
  })

  it('removing a project cascades to its chats (service level)', () => {
    const { projects, chats, chatsNamed } = createServices()
    const project = projects.add(demoPath)
    const otherProject = projects.add(otherPath)
    const first = chatsNamed(() => 'Chat A').create(project.id)
    chatsNamed(() => 'Chat B').create(project.id)
    const kept = chatsNamed(() => 'Chat C').create(otherProject.id)

    projects.remove(project.id)

    expect(chats.list(project.id)).toEqual([])
    expect(chats.get(first.id)).toBeNull()
    // Chats of other projects are untouched.
    expect(chats.get(kept.id)).toEqual(kept)
  })

  it('remove deletes exactly the given chat and is idempotent', () => {
    const { projects, chats, chatsNamed } = createServices()
    const project = projects.add(demoPath)
    const first = chatsNamed(() => 'Chat A').create(project.id)
    const second = chatsNamed(() => 'Chat B').create(project.id)

    chats.remove(first.id)
    expect(chats.get(first.id)).toBeNull()
    expect(chats.list(project.id)).toEqual([second])

    // Exit races: a repeated remove (or an unknown id) never throws.
    expect(() => chats.remove(first.id)).not.toThrow()
    expect(() => chats.remove('ghost-chat')).not.toThrow()
    expect(chats.list(project.id)).toEqual([second])
  })

  it('get returns null for an unknown id', () => {
    const { chats } = createServices()
    expect(chats.get('missing-chat')).toBeNull()
  })
})
