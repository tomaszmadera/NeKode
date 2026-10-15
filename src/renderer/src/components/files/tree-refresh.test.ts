import { describe, expect, it } from 'vitest'
import type { FileEntry } from '../../../../shared/ipc-contract'
import { emptyProjectFilesSession, type ProjectFilesSession } from './files-types'
import { applyDirectoryRefresh, type DirectoryRefreshResult } from './tree-refresh'

const rootEntries: FileEntry[] = [
  { name: 'src', relativePath: 'src', kind: 'directory' },
  { name: 'README.md', relativePath: 'README.md', kind: 'file' },
]
const srcEntries: FileEntry[] = [{ name: 'app.ts', relativePath: 'src/app.ts', kind: 'file' }]
const freshRoot: FileEntry[] = [
  ...rootEntries,
  { name: 'new-file.ts', relativePath: 'new-file.ts', kind: 'file' },
]
const freshSrc: FileEntry[] = [
  ...srcEntries,
  { name: 'extra.ts', relativePath: 'src/extra.ts', kind: 'file' },
]

function session(overrides: Partial<ProjectFilesSession> = {}): ProjectFilesSession {
  return {
    ...emptyProjectFilesSession(),
    childrenByPath: { '': rootEntries, src: srcEntries, stale: [] },
    expandedPaths: new Set(['src']),
    selectedPath: 'README.md',
    gitStatuses: { 'README.md': 'modified' },
    refreshing: true,
    ...overrides,
  }
}

describe('applyDirectoryRefresh', () => {
  it('replaces open listings, drops collapsed caches, and keeps selection', () => {
    const results: DirectoryRefreshResult[] = [
      { relativePath: '', ok: true, entries: freshRoot },
      { relativePath: 'src', ok: true, entries: freshSrc },
    ]
    const outcome = applyDirectoryRefresh(session(), results, { 'src/extra.ts': 'untracked' })

    expect(outcome.notice).toBeNull()
    expect(outcome.session.refreshing).toBe(false)
    expect(outcome.session.treeError).toBeNull()
    expect(outcome.session.selectedPath).toBe('README.md')
    expect(outcome.session.childrenByPath['']).toEqual(freshRoot)
    expect(outcome.session.childrenByPath.src).toEqual(freshSrc)
    expect(outcome.session.childrenByPath.stale).toBeUndefined()
    expect([...outcome.session.expandedPaths]).toEqual(['src'])
    expect(outcome.session.gitStatuses).toEqual({ 'src/extra.ts': 'untracked' })
  })

  it('keeps a directory expanded during the refresh when its parent still lists it', () => {
    const nested: FileEntry[] = [
      { name: 'deep.ts', relativePath: 'src/nested/deep.ts', kind: 'file' },
    ]
    const current = session({
      childrenByPath: {
        '': freshRoot,
        src: [{ name: 'nested', relativePath: 'src/nested', kind: 'directory' }],
        'src/nested': nested,
      },
      expandedPaths: new Set(['src', 'src/nested']),
    })
    const outcome = applyDirectoryRefresh(
      current,
      [
        { relativePath: '', ok: true, entries: freshRoot },
        {
          relativePath: 'src',
          ok: true,
          entries: [{ name: 'nested', relativePath: 'src/nested', kind: 'directory' }],
        },
      ],
      null,
    )

    expect(outcome.session.expandedPaths.has('src/nested')).toBe(true)
    expect(outcome.session.childrenByPath['src/nested']).toEqual(nested)
    expect(outcome.session.gitStatuses).toEqual({ 'README.md': 'modified' })
  })

  it('keeps the previous tree and sets the inline error when the root read fails', () => {
    const outcome = applyDirectoryRefresh(
      session(),
      [{ relativePath: '', ok: false, message: 'File not found.' }],
      null,
    )

    expect(outcome.notice).toBeNull()
    expect(outcome.session.treeError).toBe('File not found.')
    expect(outcome.session.childrenByPath.src).toEqual(srcEntries)
    expect(outcome.session.expandedPaths.has('src')).toBe(true)
    expect(outcome.session.gitStatuses).toEqual({ 'README.md': 'modified' })
    expect(outcome.session.refreshing).toBe(false)
  })

  it('drops an expanded directory whose read failed and names that failure', () => {
    const outcome = applyDirectoryRefresh(
      session(),
      [
        { relativePath: '', ok: true, entries: freshRoot },
        { relativePath: 'src', ok: false, message: 'Failed to refresh a folder.' },
      ],
      {},
    )

    expect(outcome.notice).toBe('Failed to refresh a folder.')
    expect(outcome.session.treeError).toBeNull()
    expect(outcome.session.expandedPaths.has('src')).toBe(false)
    expect(outcome.session.childrenByPath.src).toBeUndefined()
    expect(outcome.session.childrenByPath['']).toEqual(freshRoot)
  })

  it('drops an expanded directory that the parent listing no longer contains', () => {
    const outcome = applyDirectoryRefresh(
      session(),
      [
        {
          relativePath: '',
          ok: true,
          entries: [{ name: 'README.md', relativePath: 'README.md', kind: 'file' }],
        },
        { relativePath: 'src', ok: true, entries: srcEntries },
      ],
      null,
    )

    expect(outcome.notice).toBeNull()
    expect(outcome.session.expandedPaths.has('src')).toBe(false)
    expect(outcome.session.childrenByPath.src).toBeUndefined()
  })

  it('prioritizes notice for multi-failure by shallowest depth, then alphabetical tie-break', () => {
    const rootWithDirs: FileEntry[] = [
      { name: 'docs', relativePath: 'docs', kind: 'directory' },
      { name: 'src', relativePath: 'src', kind: 'directory' },
    ]
    const srcWithNested: FileEntry[] = [
      { name: 'nested', relativePath: 'src/nested', kind: 'directory' },
    ]
    const current = session({
      childrenByPath: {
        '': rootWithDirs,
        docs: [],
        src: srcWithNested,
        'src/nested': [],
      },
      expandedPaths: new Set(['src/nested', 'src', 'docs']),
    })

    // Both 'src/nested' (depth 2) and 'src' (depth 1) fail: 'src' has shallower depth and wins priority
    const outcomeDepth = applyDirectoryRefresh(
      current,
      [
        { relativePath: '', ok: true, entries: rootWithDirs },
        { relativePath: 'src', ok: false, message: 'Failed to read src.' },
        { relativePath: 'src/nested', ok: false, message: 'Failed to read nested.' },
      ],
      null,
    )
    expect(outcomeDepth.notice).toBe('Failed to read src.')

    // Both 'docs' (depth 1) and 'src' (depth 1) fail: alphabetical tie-break picks 'docs'
    const outcomeAlpha = applyDirectoryRefresh(
      current,
      [
        { relativePath: '', ok: true, entries: rootWithDirs },
        { relativePath: 'src', ok: false, message: 'Failed to read src.' },
        { relativePath: 'docs', ok: false, message: 'Failed to read docs.' },
      ],
      null,
    )
    expect(outcomeAlpha.notice).toBe('Failed to read docs.')
  })
})
