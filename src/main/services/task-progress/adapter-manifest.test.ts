import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverTaskProgressAdapters,
  parseTaskProgressManifest,
  TaskProgressManifestError,
} from './adapter-manifest'

// Task progress manifest validation and discovery (spec task-progress-adapters
// Behaviour 1-2, Required tests "Manifest"). Real temp directories.

const VALID_MANIFEST = {
  id: 'demo-progress',
  name: 'Demo progress',
  kind: 'task-progress',
  protocolVersion: 1,
  invocation: { command: 'node', args: ['adapter.cjs'] },
  environments: ['local', 'wsl'],
  configSchema: [
    { key: 'path', label: 'Snapshot file', type: 'string', required: true, default: 'a.json' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['a', 'b'] },
    { key: 'verbose', label: 'Verbose', type: 'boolean', default: false },
  ],
}

function parse(manifest: unknown): ReturnType<typeof parseTaskProgressManifest> {
  return parseTaskProgressManifest(JSON.stringify(manifest), 'm/adapter.json')
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nekode-progress-adapters-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeAdapter(name: string, manifest: unknown): string {
  const adapterDir = join(dir, name)
  mkdirSync(adapterDir)
  writeFileSync(join(adapterDir, 'adapter.json'), JSON.stringify(manifest))
  return adapterDir
}

describe('parseTaskProgressManifest', () => {
  it('accepts a valid manifest with every field type', () => {
    const parsed = parse(VALID_MANIFEST)
    expect(parsed.info).toEqual({
      id: 'demo-progress',
      name: 'Demo progress',
      environments: ['local', 'wsl'],
      configSchema: [
        { key: 'path', label: 'Snapshot file', type: 'string', required: true, default: 'a.json' },
        { key: 'mode', label: 'Mode', type: 'select', required: false, options: ['a', 'b'] },
        { key: 'verbose', label: 'Verbose', type: 'boolean', required: false, default: false },
      ],
    })
    expect(parsed.invocation).toEqual({ command: 'node', args: ['adapter.cjs'] })
  })

  it('defaults environments to local and args to an empty list', () => {
    const { environments: _environments, ...rest } = VALID_MANIFEST
    const parsed = parse({ ...rest, invocation: { command: 'node' } })
    expect(parsed.info.environments).toEqual(['local'])
    expect(parsed.invocation.args).toEqual([])
  })

  it('rejects an unknown, empty, or duplicated environment', () => {
    expect(() => parse({ ...VALID_MANIFEST, environments: ['local', 'mac'] })).toThrow(
      /environments/,
    )
    expect(() => parse({ ...VALID_MANIFEST, environments: [] })).toThrow(/environments/)
    expect(() => parse({ ...VALID_MANIFEST, environments: ['wsl', 'wsl'] })).toThrow(/environments/)
    expect(() => parse({ ...VALID_MANIFEST, environments: 'local' })).toThrow(/environments/)
  })

  it('rejects a manifest of another kind or without kind', () => {
    expect(() => parse({ ...VALID_MANIFEST, kind: 'kanban' })).toThrow(/kind/)
    const { kind: _kind, ...withoutKind } = VALID_MANIFEST
    expect(() => parse(withoutKind)).toThrow(/kind/)
  })

  it('rejects another protocolVersion', () => {
    expect(() => parse({ ...VALID_MANIFEST, protocolVersion: 2 })).toThrow(/protocolVersion/)
    expect(() => parse({ ...VALID_MANIFEST, protocolVersion: '1' })).toThrow(/protocolVersion/)
  })

  it('rejects invalid JSON and non-object manifests naming the path', () => {
    expect(() => parseTaskProgressManifest('{nope', 'x/adapter.json')).toThrow(
      TaskProgressManifestError,
    )
    expect(() => parseTaskProgressManifest('{nope', 'x/adapter.json')).toThrow(/x\/adapter\.json/)
    expect(() => parseTaskProgressManifest('[]', 'm')).toThrow(TaskProgressManifestError)
  })

  it('rejects a bad id, empty name, or bad invocation', () => {
    expect(() => parse({ ...VALID_MANIFEST, id: 'Bad_Id' })).toThrow(/kebab-case/)
    expect(() => parse({ ...VALID_MANIFEST, name: ' ' })).toThrow(/name/)
    expect(() => parse({ ...VALID_MANIFEST, invocation: { command: ' ' } })).toThrow(/command/)
    expect(() => parse({ ...VALID_MANIFEST, invocation: { command: 'node', args: [1] } })).toThrow(
      /args/,
    )
    expect(() => parse({ ...VALID_MANIFEST, invocation: 'node' })).toThrow(/invocation/)
  })

  it('rejects unknown field types, including secret and directory', () => {
    for (const type of ['secret', 'directory', 'file', 'number']) {
      expect(() =>
        parse({ ...VALID_MANIFEST, configSchema: [{ key: 'x', label: 'X', type }] }),
      ).toThrow(/type must be one of string\|select\|boolean/)
    }
  })

  it('rejects malformed config fields', () => {
    const field = (extra: Record<string, unknown>) =>
      parse({
        ...VALID_MANIFEST,
        configSchema: [{ key: 'x', label: 'X', type: 'string', ...extra }],
      })
    expect(() => parse({ ...VALID_MANIFEST, configSchema: {} })).toThrow(/configSchema/)
    expect(() => field({ key: 'bad key' })).toThrow(/key/)
    expect(() => field({ label: 3 })).toThrow(/label/)
    expect(() => field({ required: 'yes' })).toThrow(/required/)
    expect(() => field({ options: ['a'] })).toThrow(/options is only valid for select/)
    expect(() => field({ default: true })).toThrow(/default must be a string/)
    expect(() =>
      parse({ ...VALID_MANIFEST, configSchema: [{ key: 'x', label: 'X', type: 'select' }] }),
    ).toThrow(/options must be a non-empty array/)
    expect(() =>
      parse({
        ...VALID_MANIFEST,
        configSchema: [{ key: 'x', label: 'X', type: 'boolean', default: 'yes' }],
      }),
    ).toThrow(/default must be a boolean/)
    expect(() =>
      parse({
        ...VALID_MANIFEST,
        configSchema: [
          { key: 'x', label: 'X', type: 'string' },
          { key: 'x', label: 'X again', type: 'string' },
        ],
      }),
    ).toThrow(/duplicates "x"/)
  })
})

describe('discoverTaskProgressAdapters', () => {
  it('lists one valid adapter with its directory and invocation', () => {
    writeAdapter('demo', VALID_MANIFEST)
    const result = discoverTaskProgressAdapters(dir)
    expect(result.adapters).toHaveLength(1)
    expect(result.adapters[0]?.info.id).toBe('demo-progress')
    expect(result.adapters[0]?.dir).toBe(join(dir, 'demo'))
    expect(result.adapters[0]?.invocation).toEqual({ command: 'node', args: ['adapter.cjs'] })
    expect(result.warnings).toEqual([])
  })

  it('returns an empty list for a missing directory without warnings', () => {
    const result = discoverTaskProgressAdapters(join(dir, 'does-not-exist'))
    expect(result).toEqual({ adapters: [], warnings: [] })
  })

  it('skips invalid manifests with a warning naming the path and keeps valid siblings', () => {
    const brokenDir = join(dir, 'broken')
    mkdirSync(brokenDir)
    writeFileSync(join(brokenDir, 'adapter.json'), 'not json')
    writeAdapter('kanban-one', { ...VALID_MANIFEST, id: 'other', kind: 'kanban' })
    writeAdapter('good', VALID_MANIFEST)
    mkdirSync(join(dir, 'no-manifest'))
    const result = discoverTaskProgressAdapters(dir)
    expect(result.adapters.map((adapter) => adapter.info.id)).toEqual(['demo-progress'])
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.some((w) => w.includes(join(brokenDir, 'adapter.json')))).toBe(true)
    expect(result.warnings.some((w) => w.includes(join(dir, 'kanban-one')))).toBe(true)
    expect(result.warnings.some((w) => w.includes(join(dir, 'no-manifest')))).toBe(true)
  })

  it('keeps the first duplicate id in lexicographic directory order', () => {
    writeAdapter('b-second', VALID_MANIFEST)
    writeAdapter('a-first', VALID_MANIFEST)
    const result = discoverTaskProgressAdapters(dir)
    expect(result.adapters).toHaveLength(1)
    expect(result.adapters[0]?.dir).toBe(join(dir, 'a-first'))
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('b-second')
    expect(result.warnings[0]).toContain('duplicate')
  })

  it('ignores plain files at the top level', () => {
    writeFileSync(join(dir, 'adapter.json'), JSON.stringify(VALID_MANIFEST))
    expect(discoverTaskProgressAdapters(dir).adapters).toEqual([])
  })

  it('follows a linked adapter folder (symbolic link or Windows junction)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'nekode-progress-linked-'))
    try {
      writeFileSync(join(outside, 'adapter.json'), JSON.stringify(VALID_MANIFEST))
      symlinkSync(outside, join(dir, 'linked'), 'junction')
      const result = discoverTaskProgressAdapters(dir)
      expect(result.warnings).toEqual([])
      expect(result.adapters.map((adapter) => [adapter.info.id, adapter.dir])).toEqual([
        ['demo-progress', join(dir, 'linked')],
      ])
    } finally {
      rmSync(join(dir, 'linked'), { force: true, recursive: false })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('skips a link that does not point to a directory with a warning naming it', () => {
    const missingTarget = join(dir, 'gone')
    mkdirSync(missingTarget)
    symlinkSync(missingTarget, join(dir, 'dangling'), 'junction')
    rmSync(missingTarget, { recursive: true })
    writeAdapter('good', VALID_MANIFEST)
    const result = discoverTaskProgressAdapters(dir)
    expect(result.adapters.map((adapter) => adapter.info.id)).toEqual(['demo-progress'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(join(dir, 'dangling'))
    expect(result.warnings[0]).toContain('not a directory')
  })
})
