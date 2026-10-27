import { tmpdir } from 'node:os'
import { basename, join, parse } from 'node:path'
import { AppError, type AppErrorCode } from '@shared/ipc-error'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { isWindowsHost } from '../test-support/host-path'
import { type FileSystemAdapter, ProjectService } from './project-service'

// ProjectService unit tests on an :memory: database (pattern: db.test.ts).
// :memory: does not exercise WAL.
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
  // WSL UNC project paths are Windows-only (absolute only under win32 path rules).
  it.skipIf(!isWindowsHost)(
    'canonicalizes existing WSL UNC aliases and keeps distributions distinct',
    () => {
      const alias = '\\\\wsl$\\Ubuntu\\home\\user\\My Project'
      const canonical = '\\\\wsl.localhost\\Ubuntu\\home\\user\\My Project'
      const other = '\\\\wsl.localhost\\Debian\\home\\user\\My Project'
      const service = createService(
        fakeFileSystem({ [alias]: 'dir', [canonical]: 'dir', [other]: 'dir' }),
      )
      const created = service.add(alias)
      expect(created.path).toBe(canonical)
      expect(created.name).toBe('My Project')
      expect(service.get(created.id)).toEqual(created)
      expectAppError(() => service.add(canonical), 'conflict')
      service.add(other)
      expect(service.list()).toHaveLength(2)
    },
  )

  it('rejects malformed WSL locations without persisting them', () => {
    const paths = ['\\\\wsl$\\Ubuntu', '\\\\wsl$\\Ubuntu\\home\\..\\user']
    const service = createService(
      fakeFileSystem(Object.fromEntries(paths.map((path) => [path, 'dir']))),
    )
    for (const path of paths) expectAppError(() => service.add(path), 'validation')
    expect(service.list()).toEqual([])
  })
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
    expect(error.message).toBe('This directory is already registered as a project.')
    expect(error.channel).toBe('projects:add')
    expect(service.list()).toHaveLength(1)
  })

  it.skipIf(!isWindowsHost)(
    'reports the same conflict when a win32 path differs by case, slash, or trailing separator',
    () => {
      const first = 'D:\\Code\\Demo'
      const variants = ['d:/code/demo', 'D:/CODE/demo/', 'D:\\code\\demo\\']
      const entries: Record<string, 'dir'> = { [first]: 'dir' }
      for (const variant of variants) entries[variant] = 'dir'
      const service = createService(fakeFileSystem(entries))
      const created = service.add(first)
      expect(created.path).toBe(first)
      expect(created.name).toBe('Demo')
      for (const variant of variants) {
        const error = expectAppError(() => service.add(variant), 'conflict')
        expect(error.message).toBe('This directory is already registered as a project.')
        expect(error.channel).toBe('projects:add')
      }
      expect(service.list()).toHaveLength(1)
    },
  )

  it.skipIf(!isWindowsHost)('still rejects a drive root written with either separator', () => {
    const service = createService(fakeFileSystem({ 'D:/': 'dir', 'D:\\': 'dir' }))
    for (const root of ['D:/', 'D:\\']) {
      const error = expectAppError(() => service.add(root), 'validation')
      expect(error.message).toContain('drive root')
    }
    expect(service.list()).toEqual([])
  })

  it('derives a non-empty name when the directory only has a trailing separator', () => {
    const separator = isWindowsHost ? '\\' : '/'
    const path = `${demoPath}${separator}`
    const service = createService(fakeFileSystem({ [path]: 'dir' }))
    const created = service.add(path)
    expect(created.name).toBe(basename(demoPath))
    expect(created.name.length).toBeGreaterThan(0)
    expect(created.path).toBe(path)
  })

  it.skipIf(isWindowsHost)('keeps local directory case distinct', () => {
    const lower = `${demoPath}-case`
    const upper = `${demoPath}-Case`
    const service = createService(fakeFileSystem({ [lower]: 'dir', [upper]: 'dir' }))
    service.add(lower)
    service.add(upper)
    expect(service.list()).toHaveLength(2)
  })

  it.skipIf(!isWindowsHost)('keeps WSL distribution and Linux directory case distinct', () => {
    const alias = '\\\\wsl$\\Ubuntu\\home\\User\\App'
    const canonical = '\\\\wsl.localhost\\Ubuntu\\home\\User\\App'
    const linuxCase = '\\\\wsl.localhost\\Ubuntu\\home\\user\\App'
    const distributionCase = '\\\\wsl.localhost\\ubuntu\\home\\User\\App'
    const service = createService(
      fakeFileSystem({
        [alias]: 'dir',
        [canonical]: 'dir',
        [linuxCase]: 'dir',
        [distributionCase]: 'dir',
      }),
    )
    const created = service.add(alias)
    expect(created.path).toBe(canonical)
    expect(created.name).toBe('App')
    const error = expectAppError(() => service.add(canonical), 'conflict')
    expect(error.message).toBe('This directory is already registered as a project.')
    expect(error.channel).toBe('projects:add')
    expect(service.add(linuxCase).path).toBe(linuxCase)
    expect(service.add(distributionCase).path).toBe(distributionCase)
    expect(service.list()).toHaveLength(3)
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
