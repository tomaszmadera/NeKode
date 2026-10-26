import {
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_TASK_FILE_MISSING } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterInvocation, AdapterRequest } from './adapter-host'
import { KanbanService } from './kanban-service'
import { LocalTaskFile, parseLocalTaskDocument } from './local-task-file'

// Built-in `local-file` source (project-home spec Behaviour 7-10, 12, AC5-7
// and AC9, Edge cases, Errors). Real temp directories stand in for a project
// root; the adapter host and discovery are spies that must never run.

const CHANNEL = 'kanban:test-channel'

let root: string
let projectExists: boolean
let lookupCalls: number
/** Lookup call number at which the project disappears (null: never). */
let removeAtCall: number | null

function taskFile(): string {
  return join(root, '.nekode', 'tasks.json')
}

function readDocument(): Record<string, unknown> {
  return JSON.parse(readFileSync(taskFile(), 'utf8')) as Record<string, unknown>
}

function stateStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    get: vi.fn((key: string) => store.get(key) ?? null),
    set: vi.fn((key: string, value: string) => void store.set(key, value)),
    delete: vi.fn((key: string) => void store.delete(key)),
    has: (key: string) => store.has(key),
  }
}

function makeService(store: Record<string, string> = {}) {
  const state = stateStore(store)
  const invoke = vi.fn(async (_adapter: AdapterInvocation, _request: AdapterRequest) => {
    throw new Error('the adapter host must not run for local-file')
  })
  const discover = vi.fn(() => ({ adapters: [], warnings: [] }))
  let counter = 0
  const projects = {
    get: (projectId: string) => {
      lookupCalls += 1
      if (removeAtCall !== null && lookupCalls >= removeAtCall) projectExists = false
      return projectId === 'p1' && projectExists ? { path: root } : null
    },
  }
  const service = new KanbanService({
    projects,
    state,
    adaptersDir: () => 'unused-dir',
    host: { invoke } as unknown as ConstructorParameters<typeof KanbanService>[0]['host'],
    discoverAdapters: discover,
    localFile: new LocalTaskFile({
      projects,
      now: () => new Date('2026-10-24T10:00:00.000Z'),
      newId: () => `uuid-${++counter}`,
    }),
  })
  return { service, state, invoke, discover }
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-local-tasks-'))
  projectExists = true
  lookupCalls = 0
  removeAtCall = null
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function forward(path: string): string {
  return path.replace(/\\/g, '/')
}

function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, realpath '${path}'`), {
    code: 'ENOENT',
  })
}

/**
 * A WSL UNC path: `realpath` cannot follow a Linux symlink and reports ENOENT
 * although `lstat` finds the entry. `matches` picks the affected paths.
 */
function realpathCannotFollow(matches: (path: string) => boolean): void {
  const original = nodeFs.realpath.bind(nodeFs)
  vi.spyOn(nodeFs, 'realpath').mockImplementation((async (path: string) => {
    if (matches(forward(String(path)))) throw enoent(String(path))
    return await original(path)
  }) as typeof nodeFs.realpath)
}

describe('Use a local task list (Behaviour 7, AC5)', () => {
  it('creates the exact initial document and binds local-file', async () => {
    const { service, state, invoke, discover } = makeService()
    await service.bindLocalFile('p1')

    const text = readFileSync(taskFile(), 'utf8')
    expect(text).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          revision: 1,
          nextRef: 1,
          states: [
            { id: 'backlog', name: 'Backlog', group: 'backlog', order: 0 },
            { id: 'todo', name: 'Todo', group: 'unstarted', order: 1 },
            { id: 'in-progress', name: 'In Progress', group: 'started', order: 2 },
            { id: 'done', name: 'Done', group: 'completed', order: 3 },
            { id: 'cancelled', name: 'Cancelled', group: 'cancelled', order: 4 },
          ],
          items: [],
        },
        null,
        2,
      )}\n`,
    )
    expect(state.set).toHaveBeenCalledWith('project.kanbanAdapter:p1', 'local-file')
    const board = await service.listBoard('p1')
    expect(board).toEqual({
      states: expect.any(Array),
      items: [],
      revision: 1,
    })
    expect(board.states.map((entry) => entry.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
      'Cancelled',
    ])
    expect(invoke).not.toHaveBeenCalled()
    expect(discover).not.toHaveBeenCalled()
  })

  it('a second use does not reset an existing file', async () => {
    const { service } = makeService()
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Keep me' }, 1)
    const before = readFileSync(taskFile(), 'utf8')
    await service.bindLocalFile('p1')
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
  })

  it('leaves an existing invalid file untouched', async () => {
    mkdirSync(join(root, '.nekode'))
    writeFileSync(taskFile(), '{ not json', 'utf8')
    const { service, state } = makeService()
    await service.bindLocalFile('p1')
    expect(readFileSync(taskFile(), 'utf8')).toBe('{ not json')
    expect(state.set).toHaveBeenCalledWith('project.kanbanAdapter:p1', 'local-file')
  })

  it('rejects an unknown project and writes nothing', async () => {
    const { service, state } = makeService()
    const error = await rejection(service.bindLocalFile('nope'))
    expect(error.code).toBe('not_found')
    expect(readdirSync(root)).toEqual([])
    expect(state.set).not.toHaveBeenCalled()
  })

  it('rejects a .nekode folder that leaves the project root and does not bind', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nekode-local-outside-'))
    try {
      symlinkSync(outside, join(root, '.nekode'), 'junction')
      const { service, state } = makeService()
      const error = await rejection(service.bindLocalFile('p1'))
      expect(error.code).toBe('validation_error')
      expect(error.message).toContain('outside the project folder')
      expect(readdirSync(outside)).toEqual([])
      expect(state.set).not.toHaveBeenCalled()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('local-file list, create and update (Behaviour 8-9, AC5-6)', () => {
  const bound = { 'project.kanbanAdapter:p1': 'local-file' }

  it('creates items with T- refs in Todo by default and persists them across instances', async () => {
    const first = makeService(bound)
    await first.service.bindLocalFile('p1')
    const created = await first.service.createItem('p1', { title: 'First' }, 1)
    expect(created).toEqual({
      ref: 'T-1',
      id: 'uuid-1',
      title: 'First',
      description: null,
      stateId: 'todo',
      stateName: 'Todo',
      stateGroup: 'unstarted',
      priority: null,
      assignee: null,
      url: null,
      updatedAt: '2026-10-24T10:00:00.000Z',
      revision: 2,
    })
    const second = await first.service.createItem(
      'p1',
      { title: 'Second', description: 'Body', stateRef: 'Backlog', priority: 'high' },
      2,
    )
    expect(second).toMatchObject({ ref: 'T-2', stateId: 'backlog', priority: 'high', revision: 3 })

    const document = readDocument()
    expect(Object.keys(document)).toEqual([
      'schemaVersion',
      'revision',
      'nextRef',
      'states',
      'items',
    ])
    expect(document.revision).toBe(3)
    expect(document.nextRef).toBe(3)
    expect(Object.keys((document.items as Record<string, unknown>[])[0])).toEqual([
      'ref',
      'id',
      'title',
      'description',
      'stateId',
      'priority',
      'updatedAt',
    ])
    expect(readFileSync(taskFile(), 'utf8').endsWith('}\n')).toBe(true)

    // A fresh service (restart) reads the same items and revision.
    const restarted = makeService(bound)
    const board = await restarted.service.listBoard('p1')
    expect(board.revision).toBe(3)
    expect(board.items.map((entry) => [entry.ref, entry.stateName])).toEqual([
      ['T-1', 'Todo'],
      ['T-2', 'Backlog'],
    ])
    expect(restarted.invoke).not.toHaveBeenCalled()
  })

  it('moves an item by state name and clears its priority', async () => {
    const { service, invoke } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Task', priority: 'low' }, 1)
    const moved = await service.updateItem('p1', 'T-1', { stateRef: 'In Progress' }, 2)
    expect(moved).toMatchObject({ stateId: 'in-progress', stateGroup: 'started', revision: 3 })
    const cleared = await service.updateItem('p1', 'T-1', { priority: null }, 3)
    expect(cleared).toMatchObject({ priority: null, revision: 4 })
    const item = await service.getItem('p1', 'T-1')
    expect(item.stateName).toBe('In Progress')
    expect(await service.getComments('p1', 'T-1')).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('nextRef only increases', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'A' }, 1)
    await service.createItem('p1', { title: 'B' }, 2)
    expect(readDocument().nextRef).toBe(3)
  })

  it('a stale revision returns conflict and leaves the newer file unchanged (AC6)', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Newer' }, 1)
    const before = readFileSync(taskFile(), 'utf8')
    const createConflict = await rejection(service.createItem('p1', { title: 'Stale' }, 1))
    expect(createConflict.code).toBe('conflict')
    const updateConflict = await rejection(service.updateItem('p1', 'T-1', { title: 'Stale' }, 1))
    expect(updateConflict.code).toBe('conflict')
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
  })

  it('two writers with the same revision: the later one gets conflict', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    const results = await Promise.allSettled([
      service.createItem('p1', { title: 'One' }, 1),
      service.createItem('p1', { title: 'Two' }, 1),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect(((results[1] as PromiseRejectedResult).reason as AppError).code).toBe('conflict')
    expect((readDocument().items as unknown[]).length).toBe(1)
  })

  it('a write without a revision is a validation error', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    const error = await rejection(service.createItem('p1', { title: 'No revision' }))
    expect(error.code).toBe('validation_error')
    expect(readDocument().revision).toBe(1)
  })

  it('an empty title and a missing state are validation errors with the file unchanged', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    const before = readFileSync(taskFile(), 'utf8')
    expect((await rejection(service.createItem('p1', { title: '  ' }, 1))).code).toBe(
      'validation_error',
    )
    expect(
      (await rejection(service.createItem('p1', { title: 'X', stateRef: 'Review' }, 1))).code,
    ).toBe('validation_error')
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
  })

  it('updating an unknown ref is not_found', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    expect((await rejection(service.updateItem('p1', 'T-9', { title: 'X' }, 1))).code).toBe(
      'not_found',
    )
  })

  it('leaves no temporary file after a write', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'A' }, 1)
    expect(readdirSync(join(root, '.nekode'))).toEqual(['tasks.json'])
  })
})

describe('local-file errors (Edge cases, Errors)', () => {
  const bound = { 'project.kanbanAdapter:p1': 'local-file' }

  it('a missing file while bound is not_found and is not recreated', async () => {
    const { service, invoke } = makeService(bound)
    const error = await rejection(service.listBoard('p1'))
    expect(error.code).toBe('not_found')
    expect(error.message).toContain('.nekode/tasks.json')
    expect(readdirSync(root)).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', '{ broken'],
    [
      'another schemaVersion',
      JSON.stringify({ schemaVersion: 2, revision: 1, nextRef: 1, states: [], items: [] }),
    ],
    [
      'an item with an unknown state',
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        nextRef: 2,
        states: [{ id: 'todo', name: 'Todo', group: 'unstarted', order: 1 }],
        items: [
          {
            ref: 'T-1',
            id: 'a',
            title: 'A',
            description: null,
            stateId: 'gone',
            priority: null,
            updatedAt: '2026-10-24T10:00:00.000Z',
          },
        ],
      }),
    ],
    [
      'an unknown field',
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        nextRef: 1,
        states: [],
        items: [],
        extra: 1,
      }),
    ],
  ])('%s is a validation_error and the file stays unchanged', async (_label, content) => {
    mkdirSync(join(root, '.nekode'))
    writeFileSync(taskFile(), content, 'utf8')
    const { service } = makeService(bound)
    expect((await rejection(service.listBoard('p1'))).code).toBe('validation_error')
    expect((await rejection(service.createItem('p1', { title: 'X' }, 1))).code).toBe(
      'validation_error',
    )
    expect((await rejection(service.test('p1'))).code).toBe('validation_error')
    expect(readFileSync(taskFile(), 'utf8')).toBe(content)
  })

  it('Test succeeds on a readable file without config fields or a process', async () => {
    const { service, invoke } = makeService(bound)
    await service.bindLocalFile('p1')
    await expect(service.test('p1')).resolves.toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('a project removed while a write is in flight drops the write and keeps the file', async () => {
    const { service } = makeService(bound)
    await service.bindLocalFile('p1')
    const before = readFileSync(taskFile(), 'utf8')
    // Lookups during the write: the binding check, the path resolution, then
    // the check right before the rename. The project disappears at the third,
    // after the temp file was written.
    const start = lookupCalls
    removeAtCall = start + 3
    const error = await rejection(service.createItem('p1', { title: 'Late' }, 1))
    expect(error.code).toBe('not_found')
    expect(lookupCalls - start).toBe(3)
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
    expect(readdirSync(join(root, '.nekode'))).toEqual(['tasks.json'])
  })
})

describe('local-file reads by ref (Behaviour 9)', () => {
  const bound = { 'project.kanbanAdapter:p1': 'local-file' }

  it('getItem returns a known item and is not_found for an unknown ref', async () => {
    const { service, invoke } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Known' }, 1)
    expect(await service.getItem('p1', 'T-1')).toMatchObject({ ref: 'T-1', title: 'Known' })
    const error = await rejection(service.getItem('p1', 'T-7'))
    expect(error.code).toBe('not_found')
    expect(error.message).toContain('T-7')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('getComments returns [] for a known ref and is not_found for an unknown one', async () => {
    const { service, invoke } = makeService(bound)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Known' }, 1)
    expect(await service.getComments('p1', 'T-1')).toEqual([])
    expect((await rejection(service.getComments('p1', 'T-7'))).code).toBe('not_found')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('local-file containment (Behaviour 12)', () => {
  const bound = { 'project.kanbanAdapter:p1': 'local-file' }

  it('a .nekode junction that leaves the root rejects listBoard and createItem and writes nothing', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nekode-local-outside-'))
    try {
      const outsideFile = join(outside, 'tasks.json')
      const { service: seed } = makeService()
      await seed.bindLocalFile('p1')
      writeFileSync(outsideFile, readFileSync(taskFile(), 'utf8'), 'utf8')
      rmSync(join(root, '.nekode'), { recursive: true, force: true })
      symlinkSync(outside, join(root, '.nekode'), 'junction')
      const before = readFileSync(outsideFile, 'utf8')

      const { service } = makeService(bound)
      const read = await rejection(service.listBoard('p1'))
      expect(read.code).toBe('validation_error')
      expect(read.message).toContain('outside the project folder')
      const write = await rejection(service.createItem('p1', { title: 'Escape' }, 1))
      expect(write.code).toBe('validation_error')
      expect(readFileSync(outsideFile, 'utf8')).toBe(before)
      expect(readdirSync(outside)).toEqual(['tasks.json'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('a tasks.json symlink that leaves the root rejects listBoard and createItem and writes nothing', async (context) => {
    const outside = mkdtempSync(join(tmpdir(), 'nekode-local-outside-'))
    try {
      const outsideFile = join(outside, 'tasks.json')
      const { service: seed } = makeService()
      await seed.bindLocalFile('p1')
      writeFileSync(outsideFile, readFileSync(taskFile(), 'utf8'), 'utf8')
      rmSync(taskFile())
      try {
        symlinkSync(outsideFile, taskFile(), 'file')
      } catch (error) {
        // Windows without Developer Mode cannot create a file symlink, and a
        // junction can only name a directory.
        if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
        throw error
      }
      const before = readFileSync(outsideFile, 'utf8')

      const { service } = makeService(bound)
      expect((await rejection(service.listBoard('p1'))).code).toBe('validation_error')
      expect((await rejection(service.createItem('p1', { title: 'Escape' }, 1))).code).toBe(
        'validation_error',
      )
      expect(readFileSync(outsideFile, 'utf8')).toBe(before)
      expect(readdirSync(outside)).toEqual(['tasks.json'])
      expect(readdirSync(join(root, '.nekode'))).toEqual(['tasks.json'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('a .nekode junction leaving the root with a tasks.json symlink back inside writes nothing outside', async (context) => {
    const outside = mkdtempSync(join(tmpdir(), 'nekode-local-outside-'))
    try {
      const { service: seed } = makeService()
      await seed.bindLocalFile('p1')
      const inside = join(root, 'real-tasks.json')
      writeFileSync(inside, readFileSync(taskFile(), 'utf8'), 'utf8')
      rmSync(join(root, '.nekode'), { recursive: true, force: true })
      try {
        symlinkSync(inside, join(outside, 'tasks.json'), 'file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
        throw error
      }
      symlinkSync(outside, join(root, '.nekode'), 'junction')
      const before = readFileSync(inside, 'utf8')

      const { service } = makeService(bound)
      expect((await rejection(service.listBoard('p1'))).code).toBe('validation_error')
      expect((await rejection(service.createItem('p1', { title: 'Escape' }, 1))).code).toBe(
        'validation_error',
      )
      expect(readFileSync(inside, 'utf8')).toBe(before)
      expect(readdirSync(outside)).toEqual(['tasks.json'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('local-file on a path realpath cannot follow (WSL UNC symlinks, Errors)', () => {
  const bound = { 'project.kanbanAdapter:p1': 'local-file' }

  it('an existing project root realpath cannot follow is unknown, not not_found', async () => {
    const { service: seed } = makeService()
    await seed.bindLocalFile('p1')
    const before = readFileSync(taskFile(), 'utf8')
    const rootPath = forward(root)
    realpathCannotFollow((path) => path === rootPath)

    const { service, state } = makeService(bound)
    const read = await rejection(service.listBoard('p1'))
    expect(read.code).toBe('unknown')
    expect(read.message).toContain('.nekode/tasks.json')
    expect(read.message).not.toContain(forward(root))
    expect((await rejection(service.createItem('p1', { title: 'X' }, 1))).code).toBe('unknown')
    expect((await rejection(service.bindLocalFile('p1'))).code).toBe('unknown')
    expect(state.set).not.toHaveBeenCalled()
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
    expect(readdirSync(join(root, '.nekode'))).toEqual(['tasks.json'])
  })

  it('an existing .nekode realpath cannot follow is unknown naming .nekode', async () => {
    const { service: seed } = makeService()
    await seed.bindLocalFile('p1')
    const before = readFileSync(taskFile(), 'utf8')
    realpathCannotFollow((path) => path.endsWith('/.nekode') || path.includes('/.nekode/'))

    const { service, state } = makeService(bound)
    const read = await rejection(service.listBoard('p1'))
    expect(read.code).toBe('unknown')
    expect(read.message).toContain('.nekode')
    expect((await rejection(service.createItem('p1', { title: 'X' }, 1))).code).toBe('unknown')
    expect((await rejection(service.bindLocalFile('p1'))).code).toBe('unknown')
    expect(state.set).not.toHaveBeenCalled()
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
    expect(readdirSync(join(root, '.nekode'))).toEqual(['tasks.json'])
  })

  it('an existing tasks.json realpath cannot follow is unknown naming the file', async () => {
    const { service: seed } = makeService()
    await seed.bindLocalFile('p1')
    const before = readFileSync(taskFile(), 'utf8')
    realpathCannotFollow((path) => path.endsWith('/.nekode/tasks.json'))

    const { service } = makeService(bound)
    const read = await rejection(service.listBoard('p1'))
    expect(read.code).toBe('unknown')
    expect(read.message).toContain('.nekode/tasks.json')
    expect((await rejection(service.createItem('p1', { title: 'X' }, 1))).code).toBe('unknown')
    expect(readFileSync(taskFile(), 'utf8')).toBe(before)
  })

  it('a genuinely missing project root stays not_found without the missing-file detail', async () => {
    rmSync(root, { recursive: true, force: true })
    const { service } = makeService(bound)
    const error = await rejection(service.listBoard('p1'))
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('The project folder was not found.')
    expect(error.detail).toBeUndefined()
  })

  it('a missing task file is not_found with the missing-file detail', async () => {
    const { service } = makeService(bound)
    const error = await rejection(service.listBoard('p1'))
    expect(error.code).toBe('not_found')
    expect(error.detail).toBe(LOCAL_TASK_FILE_MISSING)
    mkdirSync(join(root, '.nekode'))
    const inDir = await rejection(service.listBoard('p1'))
    expect(inDir.code).toBe('not_found')
    expect(inDir.detail).toBe(LOCAL_TASK_FILE_MISSING)
  })

  it('an unknown project is not_found without the missing-file detail', async () => {
    const { service } = makeService(bound)
    projectExists = false
    const error = await rejection(service.listBoard('p1'))
    expect(error.code).toBe('not_found')
    expect(error.detail).toBeUndefined()
  })
})

describe('project removal and bindings (Behaviour 7, 9, AC7, AC9)', () => {
  it('cleanupProject deletes the binding keys and keeps the task file', async () => {
    const { service, state } = makeService()
    await service.bindLocalFile('p1')
    service.cleanupProject('p1')
    expect(state.delete).toHaveBeenCalledWith('project.kanbanAdapter:p1')
    expect(state.delete).toHaveBeenCalledWith('project.kanbanConfig:p1')
    expect(state.has('project.kanbanAdapter:p1')).toBe(false)
    expect(readDocument().schemaVersion).toBe(1)
  })

  it('clearing or replacing the binding leaves the file on disk', async () => {
    const { service } = makeService()
    await service.bindLocalFile('p1')
    service.setConfig('p1', { adapterId: null, values: {} })
    expect(service.getConfig('p1').adapterId).toBeNull()
    service.setConfig('p1', { adapterId: 'plane', values: {} })
    expect(readDocument().revision).toBe(1)
  })

  it('a process-adapter binding never creates a task file', async () => {
    const { service } = makeService({ 'project.kanbanAdapter:p1': 'plane' })
    await rejection(service.listBoard('p1'))
    expect(readdirSync(root)).toEqual([])
  })
})

describe('parseLocalTaskDocument', () => {
  it('rejects a ref at or above nextRef', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      nextRef: 1,
      states: [{ id: 'todo', name: 'Todo', group: 'unstarted', order: 1 }],
      items: [
        {
          ref: 'T-1',
          id: 'a',
          title: 'A',
          description: null,
          stateId: 'todo',
          priority: null,
          updatedAt: 'x',
        },
      ],
    })
    expect(() => parseLocalTaskDocument(text, CHANNEL)).toThrow(/nextRef/)
  })
})
