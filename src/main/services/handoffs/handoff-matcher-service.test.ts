import { describe, expect, it } from 'vitest'
import {
  projectHandoffDirKey,
  projectKanbanAdapterKey,
  projectKanbanHandoffLinksKey,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import {
  filenameMatchesRef,
  type HandoffMatcherFsAdapter,
  type HandoffMatcherFsEntry,
  HandoffMatcherService,
  parseFrontmatter,
} from './handoff-matcher-service'

// Handoff match and link (kanban task launch amendment, stage 4). The fs
// adapter is an in-memory fixture so every boundary (metadata, filename,
// conflicts, size, encoding, symlinks, links) is deterministic.

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

describe('parseFrontmatter', () => {
  it('reads a leading flat key: value block and stops at the closing fence', () => {
    const content = [
      '---',
      'work_item_ref: NEKODE-28',
      'work_item_id: native-28',
      '---',
      'body',
    ].join('\n')
    expect(parseFrontmatter(content)).toEqual({
      work_item_ref: 'NEKODE-28',
      work_item_id: 'native-28',
    })
  })

  it('ignores non-work-item keys, nested lines and unterminated blocks', () => {
    expect(parseFrontmatter('---\ntitle: x\n---\n')).toEqual({})
    expect(parseFrontmatter('---\nwork_item_ref: NEKODE-28\n')).toEqual({})
    expect(parseFrontmatter('work_item_ref: NEKODE-28\n')).toEqual({})
    expect(parseFrontmatter('---\n  work_item_ref: NEKODE-28\n---\n')).toEqual({})
  })

  it('strips one pair of matching quotes from a scalar', () => {
    expect(parseFrontmatter('---\nwork_item_ref: "NEKODE-28"\n---\n')).toEqual({
      work_item_ref: 'NEKODE-28',
    })
  })
})

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

  it('matches explicit metadata and carries the file stamp and display path', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: { [DIR]: [{ name: 'meta.md', kind: 'file' }] },
        files: {
          [`${DIR}/meta.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-28\nwork_item_id: native-28\n---\n'),
            mtimeMs: 2000,
          },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    expect(result).toEqual({
      state: 'ready',
      files: [
        {
          name: 'meta.md',
          path: 'h/meta.md',
          modifiedAt: new Date(2000).toISOString(),
          matchKind: 'metadata',
        },
      ],
      rejections: [],
      link: null,
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

  it('treats metadata naming another item as a visible rejection that excludes the filename', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'nekode-28-other.md', kind: 'file' },
            { name: 'clean.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/nekode-28-other.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-99\n---\n'),
            mtimeMs: 5,
          },
          [`${DIR}/clean.md`]: { bytes: bytes('plain'), mtimeMs: 4 },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    // The good candidate is still visible; the conflicting file is a warning.
    expect(result.files.map((file) => file.name)).toEqual(['clean.md'])
    expect(result.rejections).toEqual([
      {
        name: 'nekode-28-other.md',
        path: 'h/nekode-28-other.md',
        reason: 'Metadata names a different work item.',
      },
    ])
  })

  it('conflicts on a mismatching work_item_id or work_item_adapter', async () => {
    const { service } = makeService({
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'a.md', kind: 'file' },
            { name: 'b.md', kind: 'file' },
          ],
        },
        files: {
          [`${DIR}/a.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-28\nwork_item_id: other\n---\n'),
            mtimeMs: 3,
          },
          [`${DIR}/b.md`]: {
            bytes: bytes('---\nwork_item_ref: NEKODE-28\nwork_item_adapter: other\n---\n'),
            mtimeMs: 2,
          },
        },
      }),
    })
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.files).toEqual([])
    expect(result.rejections.map((rejection) => rejection.name)).toEqual(['a.md', 'b.md'])
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

describe('HandoffMatcherService.link', () => {
  function linkFixture(): {
    fs: HandoffMatcherFsAdapter
    files: Record<string, FakeFile>
  } {
    const files: Record<string, FakeFile> = {
      [`${DIR}/matched.md`]: { bytes: bytes('auto'), mtimeMs: 9 },
      [`${DIR}/other.md`]: { bytes: bytes('manual'), mtimeMs: 8 },
      [`${DIR}/conflict.md`]: {
        bytes: bytes('---\nwork_item_ref: NEKODE-99\n---\n'),
        mtimeMs: 7,
      },
    }
    return {
      files,
      fs: fixture({
        entries: {
          [DIR]: [
            { name: 'matched.md', kind: 'file' },
            { name: 'other.md', kind: 'file' },
            { name: 'conflict.md', kind: 'file' },
          ],
        },
        files,
      }),
    }
  }

  it('stores a chosen name without editing the file and wins over automatic candidates', async () => {
    const { fs, files } = linkFixture()
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'h',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    const { service } = makeService({ state, fs })
    const before = await service.candidates(ITEM)
    if (before.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(before.link).toBeNull()

    const after = await service.link({ ...ITEM, fileName: 'other.md' })
    if (after.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(after.link).toEqual({
      name: 'other.md',
      path: 'h/other.md',
      modifiedAt: new Date(8).toISOString(),
    })
    // The file body is untouched; only the app_state document was written.
    expect(files[`${DIR}/other.md`]?.bytes?.toString('utf8')).toBe('manual')
    const stored = JSON.parse(state.dump()[projectKanbanHandoffLinksKey('p1')] ?? 'null') as {
      links: Record<string, Record<string, { name: string; ref: string }>>
    }
    expect(stored.links.demo?.[ITEM.itemId]).toEqual({ name: 'other.md', ref: 'NEKODE-28' })
  })

  it('refuses a file whose metadata names another item and writes nothing', async () => {
    const { fs } = linkFixture()
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'h',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    const { service } = makeService({ state, fs })
    await expect(service.link({ ...ITEM, fileName: 'conflict.md' })).rejects.toMatchObject({
      code: 'validation',
      message: 'Metadata names a different work item.',
    })
    expect(state.dump()[projectKanbanHandoffLinksKey('p1')]).toBeUndefined()
  })

  it('refuses a name that is not in the directory', async () => {
    const { fs } = linkFixture()
    const { service } = makeService({ fs })
    await expect(service.link({ ...ITEM, fileName: 'missing.md' })).rejects.toMatchObject({
      code: 'validation',
    })
  })

  it('refuses to link when the directory is unconfigured', async () => {
    const { service } = makeService({ state: stateStore() })
    await expect(service.link({ ...ITEM, fileName: 'a.md' })).rejects.toMatchObject({
      code: 'validation',
    })
  })

  it('does not resolve a link stored under a different adapter binding', async () => {
    const { fs } = linkFixture()
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'h',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    const { service } = makeService({ state, fs })
    await service.link({ ...ITEM, fileName: 'other.md' })
    state.set(projectKanbanAdapterKey('p1'), 'other-adapter')
    const result = await service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.link).toBeNull()
  })

  it('survives a reopen: a fresh service over the same state resolves the link', async () => {
    const { fs } = linkFixture()
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'h',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    await makeService({ state, fs }).service.link({ ...ITEM, fileName: 'other.md' })
    const reopened = await makeService({ state, fs }).service.candidates(ITEM)
    if (reopened.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(reopened.link?.name).toBe('other.md')
  })

  it('drops a link whose file is gone', async () => {
    const { fs } = linkFixture()
    const state = stateStore({
      [projectHandoffDirKey('p1')]: 'h',
      [projectKanbanAdapterKey('p1')]: 'demo',
    })
    const { service } = makeService({ state, fs })
    await service.link({ ...ITEM, fileName: 'other.md' })
    const withoutOther = fixture({
      entries: { [DIR]: [{ name: 'matched.md', kind: 'file' }] },
      files: { [`${DIR}/matched.md`]: { bytes: bytes('auto'), mtimeMs: 9 } },
    })
    const result = await makeService({ state, fs: withoutOther }).service.candidates(ITEM)
    if (result.state !== 'ready') {
      throw new Error('expected ready')
    }
    expect(result.link).toBeNull()
  })

  it('rejects an unknown project with not_found', async () => {
    const { service } = makeService({})
    const error = await service
      .link({ ...ITEM, projectId: 'missing', fileName: 'a.md' })
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('not_found')
  })
})
