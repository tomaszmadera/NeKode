import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TaskProgressChangedEvent } from '@shared/ipc-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskProgressHost } from './adapter-host'
import { discoverTaskProgressAdapters } from './adapter-manifest'
import { TaskProgressService } from './task-progress-service'

// Integration (spec task-progress-adapters Required tests): the shipped example
// adapter is copied into a temp adapters directory, discovered through its real
// manifest, and run as a real `node` process through the host.

const EXAMPLE_DIR = resolve(__dirname, '../../../../adapters/task-progress-example')

let root: string
let adaptersDir: string
let projectDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-progress-example-'))
  adaptersDir = join(root, 'task-progress-adapters')
  projectDir = join(root, 'project with spaces')
  cpSync(EXAMPLE_DIR, join(adaptersDir, 'example'), { recursive: true })
  mkdirSync(join(projectDir, '.nekode'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function createService(): TaskProgressService {
  const store = new Map<string, string>()
  return new TaskProgressService({
    projects: { get: (id) => (id === 'p1' ? { path: projectDir } : null) },
    state: {
      get: (key) => store.get(key) ?? null,
      set: (key, value) => {
        store.set(key, value)
      },
      delete: (key) => {
        store.delete(key)
      },
    },
    adaptersDir,
  })
}

function writeSnapshot(content: string): void {
  writeFileSync(join(projectDir, '.nekode', 'task-progress.json'), content)
}

describe('example task progress adapter', () => {
  it('is discovered from its real manifest', () => {
    const { adapters, warnings } = discoverTaskProgressAdapters(adaptersDir)
    expect(warnings).toEqual([])
    expect(adapters.map((adapter) => adapter.info)).toEqual([
      {
        id: 'task-progress-example',
        name: 'Example: JSON snapshot file',
        environments: ['local', 'wsl'],
        configSchema: [
          {
            key: 'path',
            label: 'Snapshot file (relative to the project root)',
            type: 'string',
            required: true,
            default: '.nekode/task-progress.json',
          },
        ],
      },
    ])
  })

  it('passes Test with the bundled example snapshot', async () => {
    writeSnapshot(readFileSync(join(EXAMPLE_DIR, 'example-snapshot.json'), 'utf8'))
    const result = await createService().test('p1', 'task-progress-example', {
      path: '.nekode/task-progress.json',
    })
    expect(result).toEqual({ ok: true, summary: 'Found 1 task in .nekode/task-progress.json.' })
  })

  it('reports a missing snapshot file as a config error', async () => {
    const result = await createService().test('p1', 'task-progress-example', {
      path: '.nekode/missing.json',
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'config',
        message:
          'Adapter "task-progress-example" (test): Snapshot file not found: .nekode/missing.json',
      },
    })
  })

  it('reports a path outside the project as a config error', async () => {
    const result = await createService().test('p1', 'task-progress-example', { path: '../x.json' })
    expect(result).toMatchObject({ ok: false, error: { code: 'config' } })
  })

  it('reports a file of another format as unsupported_source', async () => {
    writeSnapshot('{"tasks": "nope"}')
    const result = await createService().test('p1', 'task-progress-example', {
      path: '.nekode/task-progress.json',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_source' } })
  })

  it('answers the snapshot action with the file and a default watch entry', async () => {
    const { schemaVersion, generatedAt, tasks } = JSON.parse(
      readFileSync(join(EXAMPLE_DIR, 'example-snapshot.json'), 'utf8'),
    ) as Record<string, unknown>
    writeSnapshot(JSON.stringify({ schemaVersion, generatedAt, tasks }))
    const adapter = discoverTaskProgressAdapters(adaptersDir).adapters[0]
    if (adapter === undefined) throw new Error('example adapter not discovered')
    const data = await new TaskProgressHost().invoke(
      { id: adapter.info.id, dir: adapter.dir, invocation: adapter.invocation },
      {
        protocolVersion: 1,
        action: 'snapshot',
        config: { path: '.nekode/task-progress.json' },
        project: { root: projectDir, environment: 'local' },
      },
    )
    expect(data).toEqual({
      schemaVersion,
      generatedAt,
      tasks,
      watch: [{ path: '.nekode', recursive: false }],
    })
  })
})

describe('example task progress adapter observed through the service', () => {
  it('reads the snapshot as a real process and refreshes after a watched file change', async () => {
    const snapshot = JSON.parse(
      readFileSync(join(EXAMPLE_DIR, 'example-snapshot.json'), 'utf8'),
    ) as { tasks: Record<string, unknown>[] }
    writeSnapshot(JSON.stringify(snapshot))
    const service = createService()
    const events: TaskProgressChangedEvent[] = []
    service.onChanged((event) => events.push(event))
    service.setVisible(true)
    service.saveBinding('p1', 'task-progress-example', { path: '.nekode/task-progress.json' })
    service.observe(['p1'])
    try {
      await vi.waitFor(() => expect(service.get('p1')?.status).toBe('ok'), { timeout: 10_000 })
      expect(service.get('p1')?.tasks.map((task) => task.id)).toEqual(['demo-1-first-task'])
      // The minimum gap between reads is 2 s; wait it out so the change read is not throttled.
      await new Promise((resolve) => setTimeout(resolve, 2_100))
      writeSnapshot(
        JSON.stringify({
          ...snapshot,
          tasks: [...snapshot.tasks, { ...snapshot.tasks[0], id: 'demo-2-second-task' }],
        }),
      )
      await vi.waitFor(
        () =>
          expect(service.get('p1')?.tasks.map((task) => task.id)).toEqual([
            'demo-1-first-task',
            'demo-2-second-task',
          ]),
        { timeout: 3_000, interval: 50 },
      )
      expect(events.every((event) => event.projectId === 'p1')).toBe(true)
    } finally {
      service.shutdown()
    }
  }, 20_000)
})
