import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverAdapters, ManifestError, parseAdapterManifest } from './adapter-manifest'

// Manifest validation and directory discovery (spec kanban-adapter-interface
// Acceptance criteria 1–3). Real temp directories; no mocking of the fs.

const VALID_MANIFEST = {
  id: 'demo-adapter',
  name: 'Demo Adapter',
  protocolVersion: 1,
  invocation: { command: 'node', args: ['adapter.js'] },
  configSchema: [
    { key: 'base_url', label: 'Base URL', type: 'string', required: true },
    { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    { key: 'mode', label: 'Mode', type: 'select', required: false, options: ['a', 'b'] },
    { key: 'verbose', label: 'Verbose', type: 'boolean', default: false },
  ],
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nekode-adapters-'))
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

describe('parseAdapterManifest', () => {
  it('accepts a valid manifest with all field types', () => {
    const parsed = parseAdapterManifest(JSON.stringify(VALID_MANIFEST), 'm/adapter.json')
    expect(parsed.id).toBe('demo-adapter')
    expect(parsed.name).toBe('Demo Adapter')
    expect(parsed.configSchema).toHaveLength(4)
    expect(parsed.configSchema[1]).toMatchObject({ key: 'api_key', type: 'secret', required: true })
    expect(parsed.configSchema[2]?.options).toEqual(['a', 'b'])
  })

  it('rejects invalid JSON naming the path', () => {
    expect(() => parseAdapterManifest('{nope', 'x/adapter.json')).toThrow(ManifestError)
    expect(() => parseAdapterManifest('{nope', 'x/adapter.json')).toThrow(/x[/\\]adapter\.json/)
  })

  it('rejects a non-object manifest', () => {
    expect(() => parseAdapterManifest('[]', 'm')).toThrow(ManifestError)
  })

  it('rejects a missing id', () => {
    const { id: _id, ...rest } = VALID_MANIFEST
    expect(() => parseAdapterManifest(JSON.stringify(rest), 'm')).toThrow(/"id" must be a string/)
  })

  it('rejects a non-kebab-case id', () => {
    expect(() =>
      parseAdapterManifest(JSON.stringify({ ...VALID_MANIFEST, id: 'Bad_Id' }), 'm'),
    ).toThrow(/kebab-case/)
  })

  it('rejects an unsupported protocolVersion without best-effort parsing', () => {
    expect(() =>
      parseAdapterManifest(JSON.stringify({ ...VALID_MANIFEST, protocolVersion: 2 }), 'm'),
    ).toThrow(/unsupported protocolVersion/)
  })

  it('rejects a missing or empty invocation command', () => {
    expect(() =>
      parseAdapterManifest(JSON.stringify({ ...VALID_MANIFEST, invocation: { args: [] } }), 'm'),
    ).toThrow(/invocation\.command" must be a string/)
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({ ...VALID_MANIFEST, invocation: { command: '  ' } }),
        'm',
      ),
    ).toThrow(/must be non-empty/)
  })

  it('rejects non-string invocation args', () => {
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({ ...VALID_MANIFEST, invocation: { command: 'node', args: [1] } }),
        'm',
      ),
    ).toThrow(/args" must be an array of strings/)
  })

  it('rejects an unknown config field type', () => {
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({
          ...VALID_MANIFEST,
          configSchema: [{ key: 'x', label: 'X', type: 'number' }],
        }),
        'm',
      ),
    ).toThrow(/type must be one of/)
  })

  it('rejects select fields without options and options on non-select fields', () => {
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({
          ...VALID_MANIFEST,
          configSchema: [{ key: 'x', label: 'X', type: 'select' }],
        }),
        'm',
      ),
    ).toThrow(/options must be a non-empty array/)
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({
          ...VALID_MANIFEST,
          configSchema: [{ key: 'x', label: 'X', type: 'string', options: ['a'] }],
        }),
        'm',
      ),
    ).toThrow(/options is only valid for select/)
  })

  it('rejects duplicate config keys and a default type mismatch', () => {
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({
          ...VALID_MANIFEST,
          configSchema: [
            { key: 'x', label: 'X', type: 'string' },
            { key: 'x', label: 'X again', type: 'string' },
          ],
        }),
        'm',
      ),
    ).toThrow(/duplicates "x"/)
    expect(() =>
      parseAdapterManifest(
        JSON.stringify({
          ...VALID_MANIFEST,
          configSchema: [{ key: 'x', label: 'X', type: 'boolean', default: 'yes' }],
        }),
        'm',
      ),
    ).toThrow(/default must be a boolean/)
  })
})

describe('discoverAdapters', () => {
  it('lists one valid adapter directory', () => {
    writeAdapter('demo', VALID_MANIFEST)
    const result = discoverAdapters(dir)
    expect(result.adapters).toHaveLength(1)
    expect(result.adapters[0]?.info.id).toBe('demo-adapter')
    expect(result.adapters[0]?.invocation).toEqual({ command: 'node', args: ['adapter.js'] })
    expect(result.adapters[0]?.dir).toBe(join(dir, 'demo'))
    expect(result.warnings).toEqual([])
  })

  it('returns an empty result for a missing directory without warnings', () => {
    const result = discoverAdapters(join(dir, 'does-not-exist'))
    expect(result.adapters).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('skips an invalid manifest with a warning naming the path and keeps valid siblings', () => {
    const brokenDir = join(dir, 'broken')
    mkdirSync(brokenDir)
    writeFileSync(join(brokenDir, 'adapter.json'), 'not json')
    writeAdapter('good', VALID_MANIFEST)
    const result = discoverAdapters(dir)
    expect(result.adapters.map((adapter) => adapter.info.id)).toEqual(['demo-adapter'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(join(brokenDir, 'adapter.json'))
  })

  it('skips a directory without a manifest', () => {
    mkdirSync(join(dir, 'empty'))
    const result = discoverAdapters(dir)
    expect(result.adapters).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  it('resolves duplicate ids by lexicographic directory order and skips the later one', () => {
    writeAdapter('a-first', { ...VALID_MANIFEST, id: 'dup' })
    writeAdapter('b-second', { ...VALID_MANIFEST, id: 'dup' })
    const result = discoverAdapters(dir)
    expect(result.adapters).toHaveLength(1)
    expect(result.adapters[0]?.dir).toBe(join(dir, 'a-first'))
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('b-second')
  })

  it('ignores plain files at the top level', () => {
    writeFileSync(join(dir, 'stray.json'), JSON.stringify(VALID_MANIFEST))
    const result = discoverAdapters(dir)
    expect(result.adapters).toEqual([])
  })
})
