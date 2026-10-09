import { describe, expect, it } from 'vitest'
import { projectHandoffDirKey, projectKanbanAdapterKey } from '../../../shared/ipc-contract'
import {
  filenameMatchesRef,
  type HandoffMatcherFsAdapter,
  type HandoffMatcherFsEntry,
  HandoffMatcherService,
} from './handoff-matcher-service'

// Handoff match (kanban task launch amendment, stage 4; NEKODE-30 stage 2). The
// fs adapter is an in-memory fixture so every boundary (filename match,
// rejection, size, encoding, symlink) is deterministic. Only the file name
// decides the match; frontmatter identity is never parsed.

const PROJECT_PATH = 'D:/code/demo'

interface FakeFile {
  bytes?: Buffer
  size?: number
  mtimeMs: number
  /** Reads reject even though the stat reports a regular file. */
  unreadable?: boolean
}

function bytes(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

function fixture(input: {
  entries?: Record<string, HandoffMatcherFsEntry[]>
  files?: Record<string, FakeFile>
}): HandoffMatcherFsAdapter {
  return {
    async readdir(dirPath) {
      const list = input.entries?.[dirPath]
      if (list === undefined) {
        const error = new Error('ENOENT') as Error & { code?: string }
        error.code = 'ENOENT'
        throw error
      }
      return list
    },
    async stat(path) {
      const file = input.files?.[path]
      if (file === undefined) {
        return null
      }
      return {
        isFile: true,
        size: file.size ?? file.bytes?.length ?? 0,
        mtimeMs: file.mtimeMs,
      }
    },
    async readFile(path) {
      const file = input.files?.[path]
      if (file === undefined || file.unreadable === true) {
        throw new Error('EACCES')
      }
      return file.bytes ?? Buffer.alloc(0)
    },
  }
}

interface Store {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
  dump(): Record<string, string>
}

function stateStore(initial: Record<string, string> = {}): Store {
  const store = new Map(Object.entries(initial))
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => void store.set(key, value),
    delete: (key) => void store.delete(key),
    dump: () => Object.fromEntries(store.entries()),
  }
}

function makeService(input: {
  state?: Store
  projectPath?: string | null
  fs?: HandoffMatcherFsAdapter
}): { service: HandoffMatcherService; state: Store } {
  const state =
    input.state ??
    stateStore({ [projectHandoffDirKey('p1')]: 'h', [projectKanbanAdapterKey('p1')]: 'demo' })
  const service = new HandoffMatcherService({
    projects: {
      get: (projectId) =>
        projectId === 'p1' && input.projectPath !== null
          ? { path: input.projectPath ?? PROJECT_PATH }
          : null,
    },
    state,
    fs: input.fs ?? fixture({ entries: {}, files: {} }),
  })
  return { service, state }
}

const DIR = `${PROJECT_PATH}/h`
const ITEM = { projectId: 'p1', itemId: 'native-28', ref: 'NEKODE-28' }

describe('filenameMatchesRef', () => {
  it('accepts the exact ref and a ref-prefixed name, ignoring case', () => {
    expect(filenameMatchesRef('nekode-2.md', 'NEKODE-2')).toBe(true)
    expect(filenameMatchesRef('NEKODE-2.md', 'nekode-2')).toBe(true)
    expect(filenameMatchesRef('nekode-2-anything.md', 'NEKODE-2')).toBe(true)
  })

  it('rejects NEKODE-20, NEKODE-28 and old-nekode-2 for NEKODE-2', () => {
    expect(filenameMatchesRef('nekode-20.md', 'NEKODE-2')).toBe(false)
    expect(filenameMatchesRef('nekode-28.md', 'NEKODE-2')).toBe(false)
    expect(filenameMatchesRef('old-nekode-2.md', 'NEKODE-2')).toBe(false)
  })
})

describe('HandoffMatcherService.candidates', () => {
  it('rejects an unknown project as not_found', async () => {
    const { service } = makeService({})
    await expect(service.candidates({ ...ITEM, projectId: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reports an unconfigured directory as not-configured', async () => {
    const { service } = makeService({ state: stateStore() })
    expect(await service.candidates(ITEM)).toEqual({ state: 'not-configured' })
  })

  it('reports a directory read failure as an error, not an empty set', async () => {
    const { service } = makeService({ fs: fixture({ entries: {}, files: {} }) })
    const result = await service.candidates(ITEM)
    expect(result.state).toBe('error')
    expect(result).toMatchObject({ message: expect.stringContaining(DIR) })
    // A missing directory is reported as not found (spec Bledy i wyscigi).
    expect(result).toMatchObject({ message: expect.stringContaining('not found') })
  })

  it('reports a permission failure with a message distinct from the not-found one', async () => {
    // EACCES stands in for an unreadable directory; the adapter must not reuse
    // the not-found wording (spec Bledy i wyscigi line 360: a missing directory
    // and invalid permissions carry separate, visible messages).
    const deniedFs: HandoffMatcherFsAdapter = {
      async readdir() {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
      async stat() {
        return null
      },
      async readFile() {
        return Buffer.alloc(0)
      },
    }
    const deniedResult = await makeService({ fs: deniedFs }).service.candidates(ITEM)
    if (deniedResult.state !== 'error') {
      throw new Error(`expected error, got ${deniedResult.state}`)
    }
    expect(deniedResult.message).toContain(DIR)
    expect(deniedResult.message).not.toContain('not found')

    const missingResult = await makeService({
      fs: fixture({ entries: {}, files: {} }),
    }).service.candidates(ITEM)
    if (missingResult.state !== 'error') {
      throw new Error(`expected error, got ${missingResult.state}`)
    }
    expect(missingResult.message).not.toBe(deniedResult.message)
  })

  it('reports EPERM like EACCES as a permission failure, not a missing directory', async () => {
    const deniedFs: HandoffMatcherFsAdapter = {
      async readdir() {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      },
      async stat() {
        return null
      },
      async readFile() {
        return Buffer.alloc(0)
      },
    }
    const result = await makeService({ fs: deniedFs }).service.candidates(ITEM)
    if (result.state !== 'error') {
      throw new Error(`expected error, got ${result.state}`)
    }
    expect(result.message).not.toContain('not found')
  })

  it('matches a ref-named file and carries the file stamp and display path', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'nekode-28.md', kind: 'file' }] },
        files: {
          [`${DIR}/nekode-28.md`]: { bytes: bytes('body'), mtimeMs: 2000 },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    expect(result).toEqual({
      state: 'ready',
      files: [
        {
          name: 'nekode-28.md',
          path: 'h/nekode-28.md',
          modifiedAt: new Date(2000).toISOString(),
          matchKind: 'filename',
        },
      ],
      rejections: [],
    })
  })

  it('matches a ref-prefixed filename, keeps boundaries, and marks other files none', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'nekode-2.md', kind: 'file' },
            { name: 'nekode-2-notes.md', kind: 'file' },
            { name: 'nekode-20.md', kind: 'file' },
            { name: 'old-nekode-2.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/nekode-2.md`]: { bytes: bytes('a'), mtimeMs: 10 },
          [`${DIR}/nekode-2-notes.md`]: { bytes: bytes('b'), mtimeMs: 9 },
          [`${DIR}/nekode-20.md`]: { bytes: bytes('c'), mtimeMs: 8 },
          [`${DIR}/old-nekode-2.md`]: { bytes: bytes('d'), mtimeMs: 7 },
        },
      }),
    })
    const result = await service.candidates({
      projectId: 'p1',
      itemId: 'native-2',
      ref: 'NEKODE-2',
    })
    if (result.state !== 'ready') {
      throw new Error(`expected ready, got ${result.state}`)
    }
    expect(result.files.map((file) => [file.name, file.matchKind])).toEqual([
      ['nekode-2.md', 'filename'],
      ['nekode-2-notes.md', 'filename'],
      ['nekode-20.md', 'none'],
      ['old-nekode-2.md', 'none'],
    ])
  })

  it('shows the size cap and invalid UTF-8 as rejections without hiding good candidates', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'big.md', kind: 'file' },
            { name: 'bad.md', kind: 'file' },
            { name: 'good.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/big.md`]: { size: 1024 * 1024 + 1, mtimeMs: 6 },
          [`${DIR}/bad.md`]: { bytes: Buffer.from([0xff, 0xfe, 0xfd]), mtimeMs: 5 },
          [`${DIR}/good.md`]: { bytes: bytes('plain'), mtimeMs: 4 },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files.map((file) => file.name)).toEqual(['good.md'])
    expect(result.rejections).toEqual([
      { name: 'bad.md', path: 'h/bad.md', reason: 'File is not valid UTF-8.' },
      { name: 'big.md', path: 'h/big.md', reason: 'File is larger than 1 MiB.' },
    ])
  })

  it('treats an unreadable file as a named rejection', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'locked.md', kind: 'file' }] },
        files: { [`${DIR}/locked.md`]: { bytes: bytes('x'), mtimeMs: 1, unreadable: true } },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files).toEqual([])
    expect(result.rejections[0]?.reason).toBe('File could not be read.')
  })

  it('skips directories, symlinks, README.md and non-markdown files', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'sub', kind: 'directory' },
            { name: 'link.md', kind: 'symlink' },
            { name: 'README.md', kind: 'file' },
            { name: 'notes.txt', kind: 'file' },
            { name: 'keep.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/README.md`]: { bytes: bytes('x'), mtimeMs: 3 },
          [`${DIR}/notes.txt`]: { bytes: bytes('x'), mtimeMs: 2 },
          [`${DIR}/keep.md`]: { bytes: bytes('x'), mtimeMs: 1 },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files.map((file) => file.name)).toEqual(['keep.md'])
    expect(result.rejections).toEqual([])
  })

  it('orders by modification time descending and breaks ties by case-insensitive name', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'Beta.md', kind: 'file' },
            { name: 'alpha.md', kind: 'file' },
            { name: 'new.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/Beta.md`]: { bytes: bytes('x'), mtimeMs: 7 },
          [`${DIR}/alpha.md`]: { bytes: bytes('x'), mtimeMs: 7 },
          [`${DIR}/new.md`]: { bytes: bytes('x'), mtimeMs: 9 },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files.map((file) => file.name)).toEqual(['new.md', 'alpha.md', 'Beta.md'])
  })

  it('uses an absolute display path when the directory is outside the project', async () => {
    const absolute = 'D:/elsewhere/handoffs'
    const { service } = makeService({
      state: stateStore({
        [projectHandoffDirKey('p1')]: absolute,
        [projectKanbanAdapterKey('p1')]: 'demo',
      }),
      fs: fixture({
        entries: { [absolute]: [{ name: 'nekode-28.md', kind: 'file' }] },
        files: { [`${absolute}/nekode-28.md`]: { bytes: bytes('x'), mtimeMs: 1 } },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files[0]?.path).toBe(`${absolute}/nekode-28.md`)
  })

  it('re-resolves the configured directory on each call (no caching)', async () => {
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'first',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    const firstDir = `${PROJECT_PATH}/first`
    const secondDir = `${PROJECT_PATH}/second`
    const { service } = makeService({
      state,
      fs: fixture({
        entries: {
          [firstDir]: [{ name: 'a.md', kind: 'file' }],
          [secondDir]: [{ name: 'b.md', kind: 'file' }],
        },
        files: {
          [`${firstDir}/a.md`]: { bytes: bytes('x'), mtimeMs: 1 },
          [`${secondDir}/b.md`]: { bytes: bytes('x'), mtimeMs: 2 },
        },
      }),
    })
    const before = await service.candidates(ITEM)
    state.set(projectHandoffDirKey('p1'), 'second')
    const after = await service.candidates(ITEM)
    if (before.state !== 'ready' || after.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(before.files.map((file) => file.name)).toEqual(['a.md'])
    expect(after.files.map((file) => file.name)).toEqual(['b.md'])
  })
})

// Batch handoff availability (spec Dostępność Resume): one directory read and
// at most one read per qualifying file, matched against every loaded item with
// the same rules as `candidates`.
describe('HandoffMatcherService.availability', () => {
  interface Counts {
    readdir: number
    stat: number
    readFile: number
  }

  function withCounts(input: {
    entries?: Record<string, HandoffMatcherFsEntry[]>
    files?: Record<string, FakeFile>
  }): { fs: HandoffMatcherFsAdapter; counts: Counts } {
    const base = fixture(input)
    const counts: Counts = { readdir: 0, stat: 0, readFile: 0 }
    return {
      counts,
      fs: {
        async readdir(dirPath) {
          counts.readdir += 1
          return base.readdir(dirPath)
        },
        async stat(path) {
          counts.stat += 1
          return base.stat(path)
        },
        async readFile(path) {
          counts.readFile += 1
          return base.readFile(path)
        },
      },
    }
  }

  it('reads the directory once and each file at most once for many items', async () => {
    const { fs, counts } = withCounts({
      entries: {
        [DIR]: [
          { name: 'nekode-2.md', kind: 'file' },
          { name: 'nekode-20.md', kind: 'file' },
          { name: 'notes.md', kind: 'file' },
        ],
      },
      files: {
        [`${DIR}/nekode-2.md`]: { bytes: bytes('x'), mtimeMs: 3 },
        [`${DIR}/nekode-20.md`]: { bytes: bytes('x'), mtimeMs: 2 },
        [`${DIR}/notes.md`]: { bytes: bytes('x'), mtimeMs: 1 },
      },
    })
    const { service } = makeService({ fs })
    const result = await service.availability({
      projectId: 'p1',
      items: [
        { itemId: 'native-2', ref: 'NEKODE-2' },
        { itemId: 'native-20', ref: 'NEKODE-20' },
        { itemId: 'native-28', ref: 'NEKODE-28' },
      ],
    })
    // NEKODE-2 never matches NEKODE-20 (the boundary holds through the batch).
    expect(result).toEqual({
      state: 'ready',
      items: [
        { itemId: 'native-2', ref: 'NEKODE-2', available: true },
        { itemId: 'native-20', ref: 'NEKODE-20', available: true },
        { itemId: 'native-28', ref: 'NEKODE-28', available: false },
      ],
      rejections: [],
    })
    expect(counts.readdir).toBe(1)
    expect(counts.readFile).toBe(3)
    expect(counts.stat).toBe(3)
  })

  it('matches by file name through the batch and keeps a metadata-only name unavailable', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'meta.md', kind: 'file' },
            { name: 'nekode-28.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/meta.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-28\nwork_item_id: native-28\n---\n'),
            mtimeMs: 2,
          },
          [`${DIR}/nekode-28.md`]: { bytes: bytes('x'), mtimeMs: 1 },
        },
      }),
    })
    expect(
      await service.availability({
        projectId: 'p1',
        items: [
          { itemId: 'native-28', ref: 'NEKODE-28' },
          { itemId: 'native-1', ref: 'NEKODE-1' },
        ],
      }),
    ).toEqual({
      state: 'ready',
      items: [
        { itemId: 'native-28', ref: 'NEKODE-28', available: true },
        { itemId: 'native-1', ref: 'NEKODE-1', available: false },
      ],
      rejections: [],
    })
  })

  it('keeps a rejected file visible without hiding a valid candidate', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'big.md', kind: 'file' },
            { name: 'nekode-28.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/big.md`]: { size: 1024 * 1024 + 1, mtimeMs: 2 },
          [`${DIR}/nekode-28.md`]: { bytes: bytes('x'), mtimeMs: 1 },
        },
      }),
    })
    expect(
      await service.availability({
        projectId: 'p1',
        items: [{ itemId: 'native-28', ref: 'NEKODE-28' }],
      }),
    ).toEqual({
      state: 'ready',
      items: [{ itemId: 'native-28', ref: 'NEKODE-28', available: true }],
      rejections: [{ name: 'big.md', path: 'h/big.md', reason: 'File is larger than 1 MiB.' }],
    })
  })

  it('distinguishes not-configured, a read error, and a ready empty scan', async () => {
    expect(
      await makeService({ state: stateStore() }).service.availability({
        projectId: 'p1',
        items: [{ itemId: ITEM.itemId, ref: ITEM.ref }],
      }),
    ).toEqual({ state: 'not-configured' })

    const errored = await makeService({
      fs: fixture({ entries: {}, files: {} }),
    }).service.availability({ projectId: 'p1', items: [{ itemId: ITEM.itemId, ref: ITEM.ref }] })
    expect(errored.state).toBe('error')

    const empty = await makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'README.md', kind: 'file' }] },
        files: { [`${DIR}/README.md`]: { bytes: bytes('x'), mtimeMs: 1 } },
      }),
    }).service.availability({ projectId: 'p1', items: [{ itemId: ITEM.itemId, ref: ITEM.ref }] })
    expect(empty).toEqual({
      state: 'ready',
      items: [{ itemId: ITEM.itemId, ref: ITEM.ref, available: false }],
      rejections: [],
    })
  })

  it('isolates the check by project: an unknown project is not_found', async () => {
    await expect(
      makeService({}).service.availability({
        projectId: 'missing',
        items: [{ itemId: ITEM.itemId, ref: ITEM.ref }],
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

// Filename-only matching (NEKODE-30 stage 2, spec Jednolita konwencja nazw):
// the file name is the only link. Frontmatter identity is never parsed and the
// scan result carries no explicit link.
describe('filename-only matching (NEKODE-30 stage 2)', () => {
  it('does not match a file whose frontmatter names the item but whose name does not carry the ref', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'metadata-only.md', kind: 'file' }] },
        files: {
          [`${DIR}/metadata-only.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-28\nwork_item_id: native-28\n---\n'),
            mtimeMs: 5,
          },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error(`expected ready, got ${result.state}`)
    }
    // The name decides: a metadata-only file is a name miss, not a candidate.
    expect(result.files).toEqual([
      {
        name: 'metadata-only.md',
        path: 'h/metadata-only.md',
        modifiedAt: new Date(5).toISOString(),
        matchKind: 'none',
      },
    ])
    const availability = await service.availability({
      projectId: 'p1',
      items: [{ itemId: ITEM.itemId, ref: ITEM.ref }],
    })
    expect(availability).toEqual({
      state: 'ready',
      items: [{ itemId: ITEM.itemId, ref: ITEM.ref, available: false }],
      rejections: [],
    })
  })

  it('reports no link field on a ready scan result', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'nekode-28.md', kind: 'file' }] },
        files: { [`${DIR}/nekode-28.md`]: { bytes: bytes('x'), mtimeMs: 1 } },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result).not.toHaveProperty('link')
    expect(Object.keys(result).sort()).toEqual(['files', 'rejections', 'state'])
  })

  it('ignores a legacy per-project handoff links document left in app_state', async () => {
    const fs = fixture({
      entries: {
        [DIR]: [
          { name: 'nekode-28.md', kind: 'file' },
          { name: 'loose.md', kind: 'file' },
        ],
      },
      files: {
        [`${DIR}/nekode-28.md`]: { bytes: bytes('x'), mtimeMs: 2 },
        [`${DIR}/loose.md`]: { bytes: bytes('x'), mtimeMs: 1 },
      },
    })
    const base = await makeService({
      state: stateStore({
        [projectHandoffDirKey('p1')]: 'h',
        [projectKanbanAdapterKey('p1')]: 'demo',
      }),
      fs,
    }).service.candidates(ITEM)
    // A leftover `project.kanbanHandoffLinks:<id>` document must not change the
    // scan: only the file name decides a match (NEKODE-30 stage 2). The former
    // document bound an adapter id and a work-item id to a file name; seeding
    // that real shape (an object keyed by adapter and item, not a rejected
    // array) is what makes this guard discriminate a reintroduced legacy reader.
    const withLegacyDocument = await makeService({
      state: stateStore({
        [projectHandoffDirKey('p1')]: 'h',
        [projectKanbanAdapterKey('p1')]: 'demo',
        'project.kanbanHandoffLinks:p1': JSON.stringify({
          links: { demo: { 'native-28': { name: 'loose.md', ref: 'NEKODE-28' } } },
        }),
      }),
      fs,
    }).service.candidates(ITEM)
    expect(withLegacyDocument).toEqual(base)
    if (base.state !== 'ready') {
      throw new Error('expected ready')
    }
    // The legacy link's file is a name miss (its name carries no ref), never a
    // candidate; only the ref-named file matches.
    expect(base.files.map((file) => [file.name, file.matchKind])).toEqual([
      ['nekode-28.md', 'filename'],
      ['loose.md', 'none'],
    ])
  })
})
