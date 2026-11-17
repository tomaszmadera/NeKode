import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskProgressHost, type TaskProgressRequest } from './adapter-host'
import {
  BUNDLED_TASK_PROGRESS_ADAPTERS,
  bundledTaskProgressAdapterDirectories,
  discoverTaskProgressAdapters,
} from './adapter-manifest'
import { validateTaskProgressSnapshot } from './snapshot'
import { TaskProgressService } from './task-progress-service'

const APP_ROOT = resolve(__dirname, '../../../..')
const ADAPTER_DIR = join(APP_ROOT, 'adapters/task-progress-nekode-work-record')
const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
const adapterModule = () =>
  require(join(ADAPTER_DIR, 'adapter.cjs')) as {
    parseRecord(text: string): Record<string, unknown>
    handle(request: TaskProgressRequest): unknown
  }
const STATE = {
  schemaVersion: 1,
  status: 'active',
  phases: [
    {
      name: 'Implementation',
      steps: [
        { id: '1.1', label: 'Add the parser', done: true },
        { id: '1.2', label: 'Wire the UI', done: false },
      ],
    },
  ],
  currentStepId: '1.2',
  nextAction: 'Add the renderer test',
  updatedAt: '2026-11-16T12:00:00Z',
}
const block = (state: unknown = STATE) =>
  `# Context\n\n\`\`\`nekode-state\n${JSON.stringify(state)}\n\`\`\`\n`
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-work-record-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})
function record(path: string, text = block()) {
  const file = join(root, path, 'progress.md')
  mkdirSync(join(root, path), { recursive: true })
  writeFileSync(file, text)
  return file
}
function request(action: 'test' | 'snapshot' = 'snapshot'): TaskProgressRequest {
  return { protocolVersion: 1, action, config: {}, project: { root, environment: 'local' } }
}
async function invoke(action: 'test' | 'snapshot' = 'snapshot') {
  const discovered = discoverTaskProgressAdapters(join(root, 'user'), [ADAPTER_DIR]).adapters[0]
  if (!discovered) throw new Error('bundled adapter missing')
  return new TaskProgressHost().invoke(
    { ...discovered, id: discovered.info.id, bundled: true },
    request(action),
  )
}

describe('nekode-state block', () => {
  it('maps valid state and ignores unknown fields', () => {
    expect(adapterModule().parseRecord(block({ ...STATE, future: true }))).toMatchObject({
      recordState: 'valid',
      state: 'active',
      phases: STATE.phases,
      currentStepId: '1.2',
      currentLabel: 'Wire the UI',
      nextAction: STATE.nextAction,
    })
  })
  it.each([
    ['missing', '# Context only', 'missing nekode-state block'],
    ['invalid JSON', '```nekode-state\n{bad\n```', 'invalid JSON'],
    ['multiple', block() + block(), 'exactly one'],
    ['unclosed', '```nekode-state\n{}', 'closing fence'],
    [
      'duplicate ids',
      block({
        ...STATE,
        phases: [{ name: 'A', steps: [STATE.phases[0].steps[0], STATE.phases[0].steps[0]] }],
      }),
      'duplicate step id',
    ],
    ['missing current step', block({ ...STATE, currentStepId: 'absent' }), 'currentStepId'],
    ['blank phase', block({ ...STATE, phases: [{ name: ' ', steps: [] }] }), 'name'],
    [
      'blank label',
      block({ ...STATE, phases: [{ name: 'A', steps: [{ id: '1', label: ' ', done: false }] }] }),
      'label',
    ],
    [
      'wrong done',
      block({ ...STATE, phases: [{ name: 'A', steps: [{ id: '1', label: 'A', done: 1 }] }] }),
      'done',
    ],
    ['bad optional field', block({ ...STATE, nextAction: false }), 'nextAction'],
    ['bad timestamp', block({ ...STATE, updatedAt: 'yesterday' }), 'updatedAt'],
    ['oversized block', `\`\`\`nekode-state\n${' '.repeat(65537)}\n\`\`\``, '64 KiB'],
    ['oversized record', 'x'.repeat(1048577), '1 MiB'],
  ])('returns an invalid record for %s', (_name, text, error) => {
    expect(adapterModule().parseRecord(text)).toMatchObject({
      recordState: 'invalid',
      phases: [],
      errors: [expect.stringContaining(error)],
    })
  })
  it('marks an unknown version unsupported', () => {
    expect(adapterModule().parseRecord(block({ ...STATE, schemaVersion: 2 }))).toMatchObject({
      recordState: 'unsupported',
      errors: [expect.stringContaining('schemaVersion')],
    })
  })
  it('accepts empty phases and bounds only the projected current label', () => {
    expect(
      adapterModule().parseRecord(block({ schemaVersion: 1, status: 'active', phases: [] })),
    ).toMatchObject({ recordState: 'valid', phases: [] })
    const label = 'x'.repeat(80)
    expect(
      adapterModule().parseRecord(
        block({ ...STATE, phases: [{ name: 'A', steps: [{ id: '1.2', label, done: false }] }] }),
      ),
    ).toMatchObject({ currentLabel: 'x'.repeat(40), phases: [{ name: 'A', steps: [{ label }] }] })
  })
  it('does not read a nested example inside another fenced block as state', () => {
    expect(adapterModule().parseRecord(`\`\`\`\`markdown\n${block()}\`\`\`\`\n`)).toMatchObject({
      recordState: 'invalid',
      errors: ['missing nekode-state block'],
    })
  })
})

describe('NeKode work record process adapter', () => {
  it('returns a validated fixture snapshot, parent identity, and watch roots', async () => {
    record('work/nested/T-1')
    record('work-completed/T-2', block({ ...STATE, status: 'completed' }))
    const snapshot = validateTaskProgressSnapshot(await invoke(), 'fixture', root)
    expect(snapshot.watch).toEqual([
      { path: 'work', recursive: true },
      { path: 'work-completed', recursive: true },
    ])
    expect(snapshot.tasks).toMatchObject([
      {
        id: 'T-1',
        ref: 'T-1',
        location: 'live',
        recordState: 'valid',
        phases: STATE.phases,
        currentStepId: '1.2',
        nextAction: STATE.nextAction,
        path: 'work/nested/T-1/progress.md',
        updatedAt: STATE.updatedAt,
      },
      { id: 'T-2', location: 'archived', state: 'completed' },
    ])
  })
  it('keeps live over archived duplicates and reports invalid records in Test', async () => {
    record('work/T-1')
    record('work/T-2', 'context only')
    record('work-completed/T-1')
    const snapshot = validateTaskProgressSnapshot(await invoke(), 'fixture', root)
    expect(snapshot.tasks.map((task) => [task.id, task.recordState])).toEqual([
      ['T-1', 'valid'],
      ['T-2', 'invalid'],
    ])
    expect(await invoke('test')).toEqual({
      summary: '2 work records, 1 invalid, 0 unsupported, 1 duplicate ignored',
    })
  })
  it('returns an empty snapshot for missing directories', async () => {
    expect(validateTaskProgressSnapshot(await invoke(), 'fixture', root)).toMatchObject({
      watch: [],
      tasks: [],
    })
  })
  it('uses mtime when updatedAt is absent and accepts empty phases through the host', async () => {
    const file = record('work/T-1', block({ schemaVersion: 1, status: 'completed', phases: [] }))
    const snapshot = validateTaskProgressSnapshot(await invoke(), 'fixture', root)
    expect(snapshot.tasks[0]).toMatchObject({
      recordState: 'valid',
      phases: [],
      updatedAt: fs.statSync(file).mtime.toISOString(),
    })
  })
  it('excludes directory junctions, including a linked watch root', async () => {
    record('outside/T-out')
    mkdirSync(join(root, 'work'))
    symlinkSync(join(root, 'outside'), join(root, 'work/linked'), 'junction')
    symlinkSync(join(root, 'outside'), join(root, 'work-completed'), 'junction')
    expect(validateTaskProgressSnapshot(await invoke(), 'fixture', root)).toMatchObject({
      watch: [{ path: 'work', recursive: true }],
      tasks: [],
    })
  })
  it('excludes a symbolic link named progress.md', () => {
    const file = record('work/T-1')
    const original = fs.lstatSync
    vi.spyOn(fs, 'lstatSync').mockImplementation(((path: Parameters<typeof fs.lstatSync>[0]) => {
      if (path === file) return { isSymbolicLink: () => true }
      return original(path)
    }) as typeof fs.lstatSync)
    expect(adapterModule().handle(request())).toMatchObject({ tasks: [] })
  })
  it('rejects an unreadable directory as config instead of empty success', () => {
    mkdirSync(join(root, 'work'))
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    expect(() => adapterModule().handle(request())).toThrow(
      expect.objectContaining({ code: 'config' }),
    )
  })
  it('reports a missing project root as config through the real host', async () => {
    rmSync(root, { recursive: true })
    await expect(invoke()).rejects.toMatchObject({ code: 'config' })
  })
  it('rejects WSL before invoking a bundled process', async () => {
    const invoke = vi.fn()
    const service = new TaskProgressService({
      projects: { get: () => ({ path: '\\\\wsl.localhost\\Ubuntu\\project' }) },
      state: { get: () => null, set: () => {}, delete: () => {} },
      adaptersDir: join(root, 'user'),
      bundledAdapterDirectories: [ADAPTER_DIR],
      host: { invoke } as unknown as TaskProgressHost,
    })
    try {
      expect(await service.test('p1', 'nekode-work-record', {})).toMatchObject({
        ok: false,
        error: { code: 'environment_unsupported' },
      })
      expect(invoke).not.toHaveBeenCalled()
    } finally {
      service.shutdown()
    }
  })
  it('supports service binding, Test and observation with no user adapter', async () => {
    record('work/T-1')
    const store = new Map<string, string>()
    const service = new TaskProgressService({
      projects: { get: () => ({ path: root }) },
      state: {
        get: (key) => store.get(key) ?? null,
        set: (key, value) => {
          store.set(key, value)
        },
        delete: (key) => {
          store.delete(key)
        },
      },
      adaptersDir: join(root, 'user'),
      bundledAdapterDirectories: [ADAPTER_DIR],
    })
    try {
      expect(service.adaptersList().adapters).toMatchObject([
        { id: 'nekode-work-record', bundled: true },
      ])
      expect(await service.test('p1', 'nekode-work-record', {})).toMatchObject({ ok: true })
      service.saveBinding('p1', 'nekode-work-record', {})
      service.setVisible(true)
      service.observe(['p1'])
      await vi.waitFor(() => expect(service.get('p1')?.tasks[0]?.id).toBe('T-1'))
    } finally {
      service.shutdown()
    }
  })
})

describe('bundled task progress discovery and packaging', () => {
  it('resolves real checkout and packaged directories with a shared packaging list', () => {
    expect(bundledTaskProgressAdapterDirectories(false, APP_ROOT, 'resources')).toEqual([
      ADAPTER_DIR,
      join(APP_ROOT, 'adapters/task-progress-agent-harness'),
    ])
    expect(bundledTaskProgressAdapterDirectories(true, 'ignored', root)).toEqual(
      BUNDLED_TASK_PROGRESS_ADAPTERS.map((name) => join(root, 'task-progress-adapters', name)),
    )
    const packaging = readFileSync(join(APP_ROOT, 'electron-builder.yml'), 'utf8')
    const copied = [
      ...packaging.matchAll(
        /from: adapters\/(task-progress-[\w-]+)\r?\n\s+to: task-progress-adapters\/\1/g,
      ),
    ].map((match) => match[1])
    expect(copied.sort()).toEqual([...BUNDLED_TASK_PROGRESS_ADAPTERS].sort())
    for (const dir of bundledTaskProgressAdapterDirectories(false, APP_ROOT, root)) {
      expect(fs.statSync(join(dir, 'adapter.cjs')).isFile()).toBe(true)
    }
  })
  it('discovers copied packaged resources and selects the application runtime', async () => {
    const resources = join(root, 'resources')
    const dirs = bundledTaskProgressAdapterDirectories(true, APP_ROOT, resources)
    for (const [index, source] of bundledTaskProgressAdapterDirectories(
      false,
      APP_ROOT,
      resources,
    ).entries()) {
      cpSync(source, dirs[index], { recursive: true })
    }
    const found = discoverTaskProgressAdapters(join(root, 'user'), dirs)
    expect(found.warnings).toEqual([])
    expect(found.adapters[0]).toMatchObject({
      info: { bundled: true },
      invocation: { command: process.execPath, args: ['adapter.cjs'] },
    })
    record('work/T-1')
    const adapter = found.adapters[0]
    if (!adapter) throw new Error('packaged adapter missing')
    expect(
      await new TaskProgressHost().invoke(
        {
          id: adapter.info.id,
          dir: adapter.dir,
          invocation: adapter.invocation,
          bundled: adapter.info.bundled,
        },
        request(),
      ),
    ).toMatchObject({ tasks: [{ id: 'T-1' }] })
  })
  it('allows only a valid user override and preserves first user duplicate ordering', () => {
    const manifest = JSON.parse(readFileSync(join(ADAPTER_DIR, 'adapter.json'), 'utf8'))
    const userDir = join(root, 'user')
    const write = (name: string, body: unknown) => {
      mkdirSync(join(userDir, name), { recursive: true })
      writeFileSync(join(userDir, name, 'adapter.json'), JSON.stringify(body))
    }
    write('a-override', { ...manifest, kind: 'wrong' })
    let found = discoverTaskProgressAdapters(userDir, [ADAPTER_DIR])
    expect(found.adapters[0]?.info).toMatchObject({ bundled: true })
    expect(found.warnings[0]).toContain('a-override')
    write('a-override', { ...manifest, name: 'Custom' })
    write('b-duplicate', manifest)
    found = discoverTaskProgressAdapters(userDir, [ADAPTER_DIR])
    expect(found.adapters).toHaveLength(1)
    expect(found.adapters[0]?.info).toMatchObject({ name: 'Custom' })
    expect(found.adapters[0]?.info.bundled).toBeUndefined()
    expect(found.warnings[0]).toContain('b-duplicate')
  })
})
