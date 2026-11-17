import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskProgressHost, type TaskProgressRequest } from './adapter-host'
import {
  bundledTaskProgressAdapterDirectories,
  discoverTaskProgressAdapters,
} from './adapter-manifest'
import { validateTaskProgressSnapshot } from './snapshot'

const APP_ROOT = resolve(__dirname, '../../../..')
const ADAPTER_DIR = join(APP_ROOT, 'adapters/task-progress-agent-harness')
const require = createRequire(import.meta.url)
const childProcess = require('node:child_process') as typeof import('node:child_process')
const adapterModule = () =>
  require(join(ADAPTER_DIR, 'adapter.cjs')) as {
    handle(request: TaskProgressRequest): unknown
    mapSnapshot(source: unknown, root: string): { tasks: Record<string, unknown>[] }
  }
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-harness-progress-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})
function write(relative: string, content = 'opaque record') {
  const file = join(root, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}
function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo-live',
    title: 'Fixture work',
    status: 'active',
    record_state: 'valid',
    activity: 'working',
    errors: [],
    path: '.agents/tasks/demo-live/task.md',
    phases: [
      {
        number: 2,
        name: 'Implementation',
        steps: [
          { id: 'Phase 2.1', label: 'Implement fixture', checked: true },
          { id: 'Phase 2.2', label: 'Verify fixture', checked: false },
        ],
      },
    ],
    current_step: 'Phase 2.2',
    next_action: 'Run the check',
    blockers: 'none',
    timing: { checkpoints: [{ step: 'Phase 2.1', phase: 2, completed: '2026-01-01T00:30:00Z' }] },
    ...overrides,
  }
}
function source(tasks: unknown[] = [task()]) {
  return { schema_version: 2, tasks }
}
function request(action: 'test' | 'snapshot' = 'snapshot'): TaskProgressRequest {
  return { protocolVersion: 1, action, config: {}, project: { root, environment: 'local' } }
}
function producer(payload: unknown) {
  write(
    '.agents/scripts/task-status',
    `import json, os, sys\nassert sys.argv[1:] == ['--json']\nassert os.path.isfile('.agents/scripts/task-status')\nprint(${JSON.stringify(JSON.stringify(payload))})\n`,
  )
}
async function invoke(action: 'test' | 'snapshot' = 'snapshot', directory = ADAPTER_DIR) {
  const adapter = discoverTaskProgressAdapters(join(root, 'user'), [directory]).adapters[0]
  if (!adapter) throw new Error('bundled Agent Harness adapter missing')
  return new TaskProgressHost().invoke(
    { ...adapter, id: adapter.info.id, bundled: true },
    request(action),
  )
}

describe('Agent Harness schema 2 mapping', () => {
  it('maps phases, current step, checkpoints, mtime and optional fields', () => {
    const file = write(task().path)
    const mapped = adapterModule().mapSnapshot(source(), root)
    expect(mapped.tasks[0]).toMatchObject({
      id: 'demo-live',
      ref: 'demo-live',
      title: 'Fixture work',
      state: 'active',
      recordState: 'valid',
      activity: 'working',
      phases: [{ number: 2, name: 'Implementation', steps: [{ done: true }, { done: false }] }],
      currentStepId: 'Phase 2.2',
      currentLabel: 'Verify fixture',
      nextAction: 'Run the check',
      blockers: null,
      corrections: 0,
      reviews: 0,
      updatedAt: statSync(file).mtime.toISOString(),
      checkpoints: [{ stepId: 'Phase 2.1', completedAt: '2026-01-01T00:30:00Z' }],
      path: task().path,
    })
    expect(validateTaskProgressSnapshot(mapped, 'fixture', root).tasks).toHaveLength(1)
  })
  it('preserves invalid and unsupported records, including identity-only producer fields', () => {
    write(task().path)
    for (const record_state of ['invalid', 'unsupported']) {
      const mapped = adapterModule().mapSnapshot(
        source([
          task({
            record_state,
            title: '',
            activity: undefined,
            phases: [],
            current_step: '',
            next_action: '',
            errors: ['Producer record error'],
            timing: { checkpoints: [] },
          }),
        ]),
        root,
      )
      expect(validateTaskProgressSnapshot(mapped, 'fixture', root).tasks[0]).toMatchObject({
        recordState: record_state,
        errors: ['Producer record error'],
        title: null,
        activity: null,
        phases: [],
        currentStepId: null,
        currentLabel: null,
        nextAction: null,
      })
    }
  })
  it('keeps full labels and bounds the protocol currentLabel', () => {
    write(task().path)
    const label = 'x'.repeat(80)
    const mapped = adapterModule().mapSnapshot(
      source([
        task({
          phases: [
            { number: 0, name: 'Intake', steps: [{ id: 'Phase 2.2', label, checked: false }] },
          ],
        }),
      ]),
      root,
    )
    expect(mapped.tasks[0]).toMatchObject({
      currentLabel: 'x'.repeat(40),
      phases: [{ steps: [{ label }] }],
    })
  })
  it.each([
    ['non-object source', null, 'protocol'],
    ['unsupported schema', { schema_version: 3, tasks: [] }, 'unsupported_source'],
    ['missing tasks', { schema_version: 2 }, 'protocol'],
    ['duplicate ids', source([task(), task()]), 'protocol'],
    ['non-object task', source([null]), 'protocol'],
    ['wrong status', source([task({ status: 'waiting' })]), 'protocol'],
    ['wrong record state', source([task({ record_state: 'broken' })]), 'protocol'],
    ['wrong activity', source([task({ activity: 'busy' })]), 'protocol'],
    ['wrong errors', source([task({ errors: [1] })]), 'protocol'],
    ['wrong title', source([task({ title: 1 })]), 'protocol'],
    ['wrong next action', source([task({ next_action: false })]), 'protocol'],
    ['missing phases', source([task({ phases: null })]), 'protocol'],
    [
      'wrong phase number',
      source([task({ phases: [{ number: '2', name: 'A', steps: [] }] })]),
      'protocol',
    ],
    [
      'wrong checked flag',
      source([
        task({
          phases: [{ number: 2, name: 'A', steps: [{ id: 'a', label: 'A', checked: 'false' }] }],
        }),
      ]),
      'protocol',
    ],
    [
      'duplicate step ids',
      source([task({ phases: [task().phases[0], task().phases[0]] })]),
      'protocol',
    ],
    ['unknown current step', source([task({ current_step: 'absent' })]), 'protocol'],
    [
      'bad checkpoint',
      source([task({ timing: { checkpoints: [{ step: 'Phase 2.1', completed: 'bad' }] } })]),
      'protocol',
    ],
    ['outside path', source([task({ path: '../outside/task.md' })]), 'protocol'],
    ['absolute path', source([task({ path: 'C:/outside/task.md' })]), 'protocol'],
  ])('rejects %s with a typed error', (_name, payload, code) => {
    write(task().path)
    expect(() => adapterModule().mapSnapshot(payload, root)).toThrow(
      expect.objectContaining({ code }),
    )
  })
  it('reports disappearing files and rejects linked records outside the root', () => {
    expect(() => adapterModule().mapSnapshot(source(), root)).toThrow(
      expect.objectContaining({ code: 'transient' }),
    )
    const outside = mkdtempSync(join(tmpdir(), 'nekode-harness-outside-'))
    try {
      writeFileSync(join(outside, 'task.md'), 'outside')
      mkdirSync(join(root, '.agents/tasks'), { recursive: true })
      symlinkSync(outside, join(root, '.agents/tasks/demo-live'), 'junction')
      expect(() => adapterModule().mapSnapshot(source(), root)).toThrow(
        expect.objectContaining({ code: 'protocol' }),
      )
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('bundled Agent Harness process adapter', () => {
  it('reads the real task-status producer without changing fixture project files', async () => {
    for (const relative of [
      '.agents/scripts/task-status',
      '.agents/scripts/common.py',
      '.agents/skills/task-record/scripts/verification_subject.py',
    ]) {
      write(relative, readFileSync(join(APP_ROOT, relative), 'utf8'))
    }
    write('.agents/project-profile.yaml', 'project:\n  name: Adapter fixtures\n')
    for (const [id, status, archived] of [
      ['demo-live', 'active', false],
      ['demo-archived', 'blocked', true],
      ['demo-completed', 'completed', false],
    ] as const) {
      const completed = status === 'completed'
      write(
        `.agents/tasks/${archived ? 'archive/' : ''}${id}/task.md`,
        `---
id: ${id}
schema_version: 4
status: ${status}
intent: analysis
complexity: small
durability: recorded
created: 2026-01-01T00:00:00Z
completed: ${completed ? '2026-01-01T01:00:00Z' : 'none'}
current_phase: Phase 0
current_step: ${completed ? 'none' : 'Phase 0.1'}
updated: 2026-01-01
branch: main
worktree: current
next_action: ${completed ? 'none' : 'Inspect fixture'}
blockers: ${status === 'blocked' ? 'Await approval' : 'none'}
---
# ${id}
## Objective
Read the fixture.
## Scope
Fixture only.
## Phase 0 - Intake
- [${completed ? 'x' : ' '}] Phase 0.1 - Inspect the repository and refine the provisional classification
## Decisions
Fixture only.
## Changed files
No product changes.
## Verification
Informational result with no final check.
## Timing
| Element | Kind | Started | Ended |
|---|---|---|---|
## Checkpoints
| Step | Completed |
|---|---|
${completed ? '| Phase 0.1 | 2026-01-01T00:30:00Z |\n' : ''}
## Risks and blockers
None.
## Resume instructions
${completed ? 'Complete.' : 'Inspect fixture.'}
`,
      )
    }
    write(
      '.agents/tasks/demo-unsupported/task.md',
      '---\nid: demo-unsupported\nschema_version: 999\nstatus: active\n---\n',
    )
    write(
      '.agents/tasks/demo-invalid/task.md',
      readFileSync(join(root, '.agents/tasks/demo-live/task.md'), 'utf8')
        .replace('id: demo-live', 'id: demo-invalid')
        .replace('## Objective', '## Missing objective'),
    )
    const files = () => readdirSync(root, { recursive: true }).map(String).sort()
    const before = files()
    const bytes = before
      .filter((relative) => statSync(join(root, relative)).isFile())
      .map((relative) => [relative, readFileSync(join(root, relative))] as const)
    const snapshot = validateTaskProgressSnapshot(await invoke(), 'real task-status fixture', root)
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'demo-live',
          state: 'active',
          location: 'live',
          recordState: 'valid',
          currentStepId: 'Phase 0.1',
        }),
        expect.objectContaining({
          id: 'demo-archived',
          state: 'blocked',
          location: 'archived',
          recordState: 'valid',
          blockers: 'Await approval',
        }),
        expect.objectContaining({
          id: 'demo-completed',
          state: 'completed',
          location: 'live',
          recordState: 'valid',
          currentStepId: null,
          nextAction: null,
          checkpoints: [{ stepId: 'Phase 0.1', completedAt: '2026-01-01T00:30:00Z' }],
        }),
        expect.objectContaining({
          id: 'demo-unsupported',
          state: 'active',
          recordState: 'unsupported',
          phases: [],
          currentStepId: null,
          errors: [expect.stringContaining('unsupported task record schema_version')],
        }),
        expect.objectContaining({
          id: 'demo-invalid',
          recordState: 'invalid',
          errors: expect.arrayContaining([expect.stringContaining('Objective')]),
        }),
      ]),
    )
    expect(await invoke('test')).toEqual({ summary: '5 task records, 1 completed' })
    expect(files()).toEqual(before)
    for (const [relative, content] of bytes)
      expect(readFileSync(join(root, relative))).toEqual(content)
  })
  it('returns live, archived unfinished and completed fixtures through the packaged layout', async () => {
    const tasks = [
      task(),
      task({
        id: 'demo-archived',
        path: '.agents/tasks/archive/demo-archived/task.md',
        status: 'blocked',
        blockers: 'Await approval',
      }),
      task({
        id: 'demo-completed',
        path: '.agents/tasks/demo-completed/task.md',
        status: 'completed',
        current_step: 'none',
        next_action: 'none',
      }),
    ]
    for (const entry of tasks) write(entry.path)
    producer(source(tasks))
    const packaged = join(root, 'resources/task-progress-adapters/task-progress-agent-harness')
    mkdirSync(packaged, { recursive: true })
    for (const name of ['adapter.json', 'adapter.cjs'])
      copyFileSync(join(ADAPTER_DIR, name), join(packaged, name))
    const before = tasks.map((entry) => readFileSync(join(root, entry.path), 'utf8'))
    const snapshot = validateTaskProgressSnapshot(
      await invoke('snapshot', packaged),
      'fixture',
      root,
    )
    expect(snapshot.watch).toEqual([{ path: '.agents/tasks', recursive: true }])
    expect(snapshot.tasks).toMatchObject([
      { id: 'demo-live', state: 'active', location: 'live' },
      { id: 'demo-archived', state: 'blocked', location: 'archived', blockers: 'Await approval' },
      { id: 'demo-completed', state: 'completed', currentStepId: null, nextAction: null },
    ])
    expect(await invoke('test', packaged)).toEqual({ summary: '3 task records, 1 completed' })
    expect(tasks.map((entry) => readFileSync(join(root, entry.path), 'utf8'))).toEqual(before)
    const found = discoverTaskProgressAdapters(
      join(root, 'user'),
      bundledTaskProgressAdapterDirectories(false, APP_ROOT, root),
    )
    expect(found.warnings).toEqual([])
    expect(found.adapters.map((entry) => entry.info.id)).toEqual([
      'nekode-work-record',
      'agent-harness',
    ])
    expect(found.adapters[1]?.info).toMatchObject({
      name: 'Agent Harness',
      bundled: true,
      environments: ['local'],
      configSchema: [],
    })
  })
  it.each([
    ['invalid JSON', "print('not json')", 'protocol', 'JSON'],
    [
      'unsupported schema',
      'print(\'{"schema_version":3,"tasks":[]}\')',
      'unsupported_source',
      'schema_version',
    ],
    [
      'non-zero exit',
      'import sys; print("secret diagnostic", file=sys.stderr); sys.exit(7)',
      'runtime',
      '7',
    ],
  ])('reports %s through the host with producer detail', async (_name, script, code, message) => {
    write('.agents/scripts/task-status', script)
    await expect(invoke()).rejects.toMatchObject({
      code,
      message: expect.stringContaining(message),
    })
  })
  it('returns an actionable missing script error', async () => {
    await expect(invoke()).rejects.toMatchObject({
      code: 'runtime',
      message: expect.stringContaining('.agents/scripts/task-status'),
    })
  })
  it('returns an actionable missing Python error without trying a replacement', () => {
    producer(source([]))
    const spy = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: null,
      error: Object.assign(new Error('missing'), { code: 'ENOENT' }),
    })
    expect(() => adapterModule().handle(request())).toThrow(
      expect.objectContaining({
        code: 'runtime',
        message: expect.stringContaining('Install Python'),
      }),
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      'python',
      ['.agents/scripts/task-status', '--json'],
      expect.objectContaining({
        cwd: root,
        shell: false,
        windowsHide: true,
        env: expect.objectContaining({ PYTHONIOENCODING: 'utf-8' }),
      }),
    )
  })
  it('rejects nonlocal projects before executing Python', () => {
    const spy = vi.spyOn(childProcess, 'spawnSync')
    expect(() =>
      adapterModule().handle({ ...request(), project: { root, environment: 'wsl' } }),
    ).toThrow(expect.objectContaining({ code: 'config' }))
    expect(spy).not.toHaveBeenCalled()
  })
})
