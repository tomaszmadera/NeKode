import { describe, expect, it } from 'vitest'
import type { GitFileStatuses } from '../../../../shared/ipc-contract'
import { buildStatusIndex, decorationFor } from './git-decoration'

// NEKODE-31 (spec Behaviour 16-19): the pure decoration logic behind the file
// tree: per-entry status from exact and directory-key matches, the folder
// aggregation precedence, the segment-wise path match, and the letter/color
// mapping that keeps the status readable without color.

const STATUSES: GitFileStatuses = {
  'src/app.ts': 'modified',
  'src/new.ts': 'added',
  'src/legacy/old.ts': 'modified',
  'docs/readme.md': 'modified',
  'docsx.txt': 'untracked',
  'conflict.txt': 'conflict',
  'sub/inner': 'untracked',
  'vendor-cache': 'ignored',
  node_modules: 'ignored',
}

describe('buildStatusIndex file resolution', () => {
  const index = buildStatusIndex(STATUSES)

  it('resolves an exact status', () => {
    expect(index.file('src/app.ts')).toBe('modified')
    expect(index.file('conflict.txt')).toBe('conflict')
  })

  it('covers every listed descendant of an untracked or ignored directory key', () => {
    expect(index.file('sub/inner/deep/file.ts')).toBe('untracked')
    expect(index.file('node_modules/pkg/index.js')).toBe('ignored')
  })

  it('matches whole path segments only', () => {
    // `docsx.txt` is its own untracked entry and must not be read as the
    // `docs` directory's descendant.
    expect(index.file('docsx.txt')).toBe('untracked')
    expect(index.file('src/app.ts.bak')).toBeNull()
  })

  it('returns null for an entry with no status', () => {
    expect(index.file('README.md')).toBeNull()
  })
})

describe('buildStatusIndex directory aggregation', () => {
  const index = buildStatusIndex(STATUSES)

  it('aggregates the strongest status anywhere below the directory', () => {
    expect(index.directory('src')).toBe('modified')
    expect(index.directory('docs')).toBe('modified')
  })

  it('prefers conflict over modified, added, untracked and ignored', () => {
    const mixed = buildStatusIndex({
      'a/conflict.ts': 'conflict',
      'a/modified.ts': 'modified',
      'a/added.ts': 'added',
      'a/untracked.ts': 'untracked',
      'a/ignored.ts': 'ignored',
    })
    expect(mixed.directory('a')).toBe('conflict')
  })

  it('orders modified over added, untracked and ignored', () => {
    const mixed = buildStatusIndex({
      'b/added.ts': 'added',
      'b/untracked/': 'untracked',
      'b/ignored.log': 'ignored',
      'b/modified.ts': 'modified',
    })
    expect(mixed.directory('b')).toBe('modified')
  })

  it('covers every descendant of an untracked or ignored directory key', () => {
    // Behaviour 18: a directory key stands for its whole subtree, so a
    // nested folder below it inherits the status too (not only files).
    const nested = buildStatusIndex({ utdir: 'untracked', 'cache-dir': 'ignored' })
    expect(nested.directory('utdir')).toBe('untracked')
    expect(nested.directory('utdir/sub')).toBe('untracked')
    expect(nested.directory('utdir/sub/deep')).toBe('untracked')
    expect(nested.directory('cache-dir/pkg')).toBe('ignored')
    expect(nested.directory('nothing-here')).toBeNull()
    // The same through the shared map: `sub/inner` is one untracked key.
    expect(index.directory('sub/inner/deeper')).toBe('untracked')
  })

  it('keeps its own directory status and reports null with nothing below', () => {
    expect(index.directory('sub/inner')).toBe('untracked')
    expect(index.directory('vendor-cache')).toBe('ignored')
    expect(index.directory('nothing-here')).toBeNull()
  })
})

describe('decorationFor', () => {
  it('maps every kind to its letter, word and theme class', () => {
    expect(decorationFor('modified')).toEqual({
      letter: 'M',
      word: 'modified',
      className: 'text-warning',
    })
    expect(decorationFor('added')).toEqual({
      letter: 'A',
      word: 'added',
      className: 'text-success',
    })
    expect(decorationFor('untracked')).toEqual({
      letter: 'U',
      word: 'untracked',
      className: 'text-success',
    })
    expect(decorationFor('conflict')).toEqual({
      letter: 'C',
      word: 'conflicted',
      className: 'text-error',
    })
    expect(decorationFor('ignored')).toEqual({
      letter: 'I',
      word: 'ignored',
      className: 'text-ink-disabled',
    })
  })

  it('renders no decoration for a missing or unknown kind', () => {
    expect(decorationFor(null)).toBeNull()
    expect(decorationFor('mystery' as never)).toBeNull()
    const index = buildStatusIndex({ 'src/app.ts': 'mystery' as never })
    expect(index.file('src/app.ts')).toBeNull()
    expect(index.directory('src')).toBeNull()
  })
})
