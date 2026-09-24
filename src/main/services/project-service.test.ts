import { tmpdir } from 'node:os'
import { basename, join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type AppErrorCode } from '../../shared/ipc-error'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { type FileSystemAdapter, ProjectService } from './project-service'

// ProjectService unit tests on an :memory: database (pattern: db.test.ts).
// The injectable FileSystemAdapter keeps path-existence checks deterministic.

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function createService(fs: FileSystemAdapter): ProjectService {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  return new ProjectService({ db, fs })
}

function fakeFileSystem(entries: Record<string, 'dir' | 'file'>): FileSystemAdapter {
  return {
    stat(path: string) {
      const entry = entries[path]
      if (entry === undefined) {
        return null
      }
      return { isDirectory: () => entry === 'dir' }
    },
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

const demoPath = join(tmpdir(), 'nekode-project-service-tests', 'demo-project')
const otherPath = join(tmpdir(), 'nekode-project-service-tests', 'other-project')

describe('ProjectService', () => {
  it('add derives the name from the folder and stores the record', () => {
    const service = createService(fakeFileSystem({ [demoPath]: 'dir' }))
    const created = service.add(demoPath)

    expect(created.id.length).toBeGreaterThan(0)
    expect(created.name).toBe(basename(demoPath))
    expect(created.path).toBe(demoPath)
    expect(created.runtimeLabel).toBeNull()
    expect(service.get(created.id)).toEqual(created)
    expect(service.list()).toEqual([created])
  })

  it('list returns projects ordered by name', () => {
    const service = createService(fakeFileSystem({ [demoPath]: 'dir', [otherPath]: 'dir' }))
    // Inserted out of name order on purpose: list() must sort by name.
    service.add(otherPath)
    service.add(demoPath)

    expect(service.list().map((project) => project.name)).toEqual([
      basename(demoPath),
      basename(otherPath),
    ])
  })

  it('rejects an empty path', () => {
    const service = createService(fakeFileSystem({}))
    expectAppError(() => service.add(''), 'validation')
    expectAppError(() => service.add('   '), 'validation')
    expect(service.list()).toEqual([])
  })

  it('rejects a relative path', () => {
    const service = createService(fakeFileSystem({ 'relative/demo': 'dir' }))
    expectAppError(() => service.add('relative/demo'), 'validation')
  })

  it('rejects a drive root (no derivable project name)', () => {
    const service = createService(fakeFileSystem({ [parse(tmpdir()).root]: 'dir' }))
    const error = expectAppError(() => service.add(parse(tmpdir()).root), 'validation')
    expect(error.message).toContain('drive root')
  })

  it('rejects a path that does not exist', () => {
    const service = createService(fakeFileSystem({}))
    const error = expectAppError(() => service.add(demoPath), 'validation')
    expect(error.message).toBe('Directory does not exist.')
  })

  it('rejects a path that is not a directory', () => {
    const service = createService(fakeFileSystem({ [demoPath]: 'file' }))
    const error = expectAppError(() => service.add(demoPath), 'validation')
    expect(error.message).toBe('Path is not a directory.')
  })

  it('rejects registering the same directory twice', () => {
    const service = createService(fakeFileSystem({ [demoPath]: 'dir' }))
    service.add(demoPath)
    const error = expectAppError(() => service.add(demoPath), 'conflict')
    expect(error.message).toContain('already registered')
    expect(service.list()).toHaveLength(1)
  })

  it('remove deletes the project and remove of an unknown id is not_found', () => {
    const service = createService(fakeFileSystem({ [demoPath]: 'dir' }))
    const created = service.add(demoPath)

    expectAppError(() => service.remove('missing-project'), 'not_found')
    service.remove(created.id)
    expect(service.get(created.id)).toBeNull()
    expect(service.list()).toEqual([])
    expectAppError(() => service.remove(created.id), 'not_found')
  })

  it('get returns null for an unknown id', () => {
    const service = createService(fakeFileSystem({}))
    expect(service.get('missing-project')).toBeNull()
  })
})
