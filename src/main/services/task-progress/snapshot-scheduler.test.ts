import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TaskProgressChangedEvent,
  TaskProgressErrorCode,
  TaskProgressSnapshot,
} from '../../../shared/ipc-contract'
import type { ValidatedTaskProgressSnapshot } from './snapshot'
import {
  type TaskProgressReadOutcome,
  TaskProgressScheduler,
  type TaskProgressTarget,
} from './snapshot-scheduler'

// Refresh scheduler (spec task-progress-adapters Behaviour 12, 13, 15-21,
// Required tests "Harmonogram"). Fake clock (vitest timers), fake read (the
// host seam), fake directory watcher.

interface PendingRead {
  projectId: string
  target: TaskProgressTarget
  signal: AbortSignal
  resolve(outcome: TaskProgressReadOutcome): void
  reject(error: unknown): void
}

interface FakeWatcher {
  path: string
  recursive: boolean
  change(): void
  fail(error: Error): void
  closed: boolean
}

const LOCAL: TaskProgressTarget = { adapterId: 'demo', root: 'D:/code/p1', environment: 'local' }

function task(id: string) {
  return {
    id,
    ref: null,
    title: null,
    state: 'active' as const,
    location: 'live' as const,
    recordState: 'valid' as const,
    errors: [],
    activity: null,
    phases: [{ name: 'A', steps: [{ id: '1', label: 'one', done: false }] }],
    currentStepId: null,
    currentLabel: null,
    corrections: 0,
    reviews: 0,
    nextAction: null,
    blockers: null,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    checkpoints: [],
    path: null,
  }
}

function ok(
  ids: string[] = ['t1'],
  watch: ValidatedTaskProgressSnapshot['watch'] = [{ path: '.agents/tasks', recursive: true }],
): TaskProgressReadOutcome {
  return {
    ok: true,
    snapshot: { generatedAt: '2026-10-23T09:00:00Z', watch, tasks: ids.map(task) },
  }
}

function failed(code: TaskProgressErrorCode, message = `${code} failure`): TaskProgressReadOutcome {
  return { ok: false, error: { code, message } }
}

function setup(targets: Record<string, TaskProgressTarget | null> = { p1: LOCAL }) {
  const reads: PendingRead[] = []
  const watchers: FakeWatcher[] = []
  const unwatchable = new Set<string>()
  const events: TaskProgressChangedEvent[] = []
  const log = vi.fn()
  const read = vi.fn(
    (projectId: string, target: TaskProgressTarget, signal: AbortSignal) =>
      new Promise<TaskProgressReadOutcome>((resolve, reject) => {
        reads.push({ projectId, target, signal, resolve, reject })
      }),
  )
  const watch = vi.fn(
    (path: string, recursive: boolean, onChange: () => void, onError: (error: Error) => void) => {
      if (unwatchable.has(path)) {
        throw new Error(`ENOENT: ${path}`)
      }
      const watcher: FakeWatcher = {
        path,
        recursive,
        change: onChange,
        fail: onError,
        closed: false,
      }
      watchers.push(watcher)
      return {
        close: () => {
          watcher.closed = true
        },
      }
    },
  )
  const scheduler = new TaskProgressScheduler({
    target: (projectId) => targets[projectId] ?? null,
    read,
    watch,
    emit: (event) => events.push(event),
    log,
  })
  scheduler.setVisible(true)
  const snapshots = () =>
    events.filter((event): event is TaskProgressSnapshot => !('cleared' in event))
  /** Resolves the newest pending read and lets the scheduler apply it. */
  async function answer(outcome: TaskProgressReadOutcome): Promise<void> {
    const pending = reads.at(-1)
    if (pending === undefined) throw new Error('no read is pending')
    pending.resolve(outcome)
    await vi.advanceTimersByTimeAsync(0)
  }
  return { scheduler, reads, read, watchers, unwatchable, events, snapshots, log, answer, targets }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('TaskProgressScheduler observation', () => {
  it('reads once when a bound project becomes visible and never touches unbound ones', async () => {
    const h = setup({ p1: LOCAL, p2: null })
    h.scheduler.observe(['p1', 'p2'])
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.reads[0].projectId).toBe('p1')
    await h.answer(ok(['t1']))
    expect(h.snapshots()).toEqual([
      {
        projectId: 'p1',
        adapterId: 'demo',
        status: 'ok',
        tasks: [task('t1')],
        receivedAt: '2026-10-23T10:00:00.000Z',
      },
    ])
    expect(h.scheduler.get('p1')).toEqual(h.snapshots()[0])
    expect(h.scheduler.get('p2')).toBeNull()
    expect(h.watchers.map((w) => [w.path, w.recursive])).toEqual([
      [expect.stringMatching(/p1[\\/]\.agents[\\/]tasks$/), true],
    ])
  })

  it('does not restart a project that stays in the visible set', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    h.scheduler.observe(['p1'])
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('stops a project leaving the visible set: kills the read, clears, discards the late result', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    await advance(60_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    const inFlight = h.reads[1]
    h.scheduler.observe([])
    expect(inFlight.signal.aborted).toBe(true)
    expect(h.watchers.every((w) => w.closed)).toBe(true)
    expect(h.events.at(-1)).toEqual({ projectId: 'p1', cleared: true })
    const count = h.events.length
    inFlight.resolve(ok(['late']))
    await advance(10 * 60_000)
    expect(h.events).toHaveLength(count)
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.scheduler.get('p1')).toBeNull()
  })

  it('project removal kills the read and emits nothing for the removed project', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    const inFlight = h.reads[0]
    h.scheduler.remove('p1')
    expect(inFlight.signal.aborted).toBe(true)
    inFlight.resolve(ok())
    await advance(60_000)
    expect(h.events).toEqual([])
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('binding change drops the snapshot, stops the old read, and starts a fresh one', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok(['old']))
    await advance(60_000)
    const oldRead = h.reads[1]
    h.targets.p1 = { ...LOCAL, adapterId: 'other' }
    h.scheduler.rebind('p1')
    expect(oldRead.signal.aborted).toBe(true)
    expect(h.watchers.every((w) => w.closed)).toBe(true)
    expect(h.events.at(-1)).toEqual({ projectId: 'p1', cleared: true })
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(3)
    expect(h.reads[2].target.adapterId).toBe('other')
    oldRead.resolve(ok(['late-old']))
    await advance(0)
    expect(h.scheduler.get('p1')).toBeNull()
    await h.answer(ok(['new']))
    expect(h.scheduler.get('p1')).toMatchObject({ adapterId: 'other', tasks: [task('new')] })
  })

  it('binding removed (None) stops observation without a new read', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    h.targets.p1 = null
    h.scheduler.rebind('p1')
    await advance(10 * 60_000)
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.scheduler.get('p1')).toBeNull()
    expect(h.watchers.every((w) => w.closed)).toBe(true)
  })

  it('a project from another set never receives a result read for another project', async () => {
    const h = setup({ p1: LOCAL, p2: { ...LOCAL, root: 'D:/code/p2' } })
    h.scheduler.observe(['p1', 'p2'])
    await advance(0)
    const [first, second] = h.reads
    second.resolve(ok(['p2-task']))
    await advance(0)
    first.resolve(ok(['p1-task']))
    await advance(0)
    expect(h.scheduler.get('p1')?.tasks.map((t) => t.id)).toEqual(['p1-task'])
    expect(h.scheduler.get('p2')?.tasks.map((t) => t.id)).toEqual(['p2-task'])
  })

  it('app shutdown kills reads, closes watchers, and schedules nothing more', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    await advance(60_000)
    const inFlight = h.reads[1]
    h.scheduler.shutdown()
    expect(inFlight.signal.aborted).toBe(true)
    expect(h.watchers.every((w) => w.closed)).toBe(true)
    h.scheduler.observe(['p1'])
    await advance(10 * 60_000)
    expect(h.read).toHaveBeenCalledTimes(2)
  })
})

describe('TaskProgressScheduler refresh timing', () => {
  async function started() {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    return h
  }

  it('debounces a burst of changes into one read after 300 ms of quiet', async () => {
    const h = await started()
    await advance(5000)
    const watcher = h.watchers[0]
    watcher.change()
    await advance(200)
    watcher.change()
    await advance(200)
    watcher.change()
    await advance(299)
    expect(h.read).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('keeps 2 s between read starts', async () => {
    const h = await started()
    h.watchers[0].change()
    await advance(300)
    expect(h.read).toHaveBeenCalledTimes(1)
    await advance(1699)
    expect(h.read).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('single-flight: changes during a read give exactly one follow-up read after it', async () => {
    const h = await started()
    await advance(5000)
    h.watchers[0].change()
    await advance(300)
    expect(h.read).toHaveBeenCalledTimes(2)
    for (let index = 0; index < 5; index += 1) {
      h.watchers[0].change()
      await advance(400)
    }
    expect(h.read).toHaveBeenCalledTimes(2)
    await h.answer(ok())
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(3)
    await h.answer(ok())
    await advance(5000)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('polls every 60 s while directory watching works', async () => {
    const h = await started()
    await advance(59_999)
    expect(h.read).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('polls every 10 s when a watched directory cannot be watched, and retries the watch', async () => {
    const h = setup()
    h.unwatchable.add(resolve('D:/code/p1', '.agents/tasks'))
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
    await advance(9_999)
    expect(h.read).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(2)
    h.unwatchable.clear()
    await h.answer(ok())
    expect(h.watchers).toHaveLength(1)
    await advance(10_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    await advance(50_000)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('polls every 10 s with an empty watch list', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok(['t1'], []))
    await advance(10_000)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('never watches WSL projects and polls them every 10 s', async () => {
    const h = setup({
      p1: { adapterId: 'demo', root: '\\\\wsl.localhost\\Ubuntu\\home\\me\\p', environment: 'wsl' },
    })
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok())
    expect(h.watchers).toEqual([])
    await advance(10_000)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('falls back to 10 s polling after a watcher error', async () => {
    const h = await started()
    h.watchers[0].fail(new Error('EPERM'))
    expect(h.watchers[0].closed).toBe(true)
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('EPERM'))
    await advance(10_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    await h.answer(ok())
    expect(h.watchers).toHaveLength(2)
    expect(h.watchers[1].closed).toBe(false)
  })

  it('renews watching only when the watch list changes', async () => {
    const h = await started()
    await advance(60_000)
    await h.answer(ok())
    expect(h.watchers).toHaveLength(1)
    await advance(60_000)
    await h.answer(ok(['t1'], [{ path: 'records', recursive: false }]))
    expect(h.watchers).toHaveLength(2)
    expect(h.watchers[0].closed).toBe(true)
    expect(h.watchers[1]).toMatchObject({ recursive: false, closed: false })
  })

  it('a hidden window pauses reads and polling; showing it runs one overdue read', async () => {
    const h = await started()
    h.scheduler.setVisible(false)
    await advance(5 * 60_000)
    h.watchers[0].change()
    await advance(1000)
    expect(h.read).toHaveBeenCalledTimes(1)
    h.scheduler.setVisible(true)
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(2)
    await h.answer(ok())
    await advance(59_999)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('observation that starts while hidden reads when the window is shown', async () => {
    const h = setup()
    h.scheduler.setVisible(false)
    h.scheduler.observe(['p1'])
    await advance(30_000)
    expect(h.read).not.toHaveBeenCalled()
    h.scheduler.setVisible(true)
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(1)
  })
})

describe('TaskProgressScheduler errors', () => {
  async function started() {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok(['t1']))
    return h
  }

  it.each(['transient', 'protocol', 'timeout'] as const)(
    'retries %s after 1, 2 and 4 s keeping the snapshot fresh, then marks it stale',
    async (code) => {
      const h = await started()
      await advance(60_000)
      await h.answer(failed(code))
      expect(h.scheduler.get('p1')).toMatchObject({ status: 'ok', error: { code } })
      await advance(1999)
      expect(h.read).toHaveBeenCalledTimes(2)
      await advance(1)
      expect(h.read).toHaveBeenCalledTimes(3)
      await h.answer(failed(code))
      await advance(2000)
      expect(h.read).toHaveBeenCalledTimes(4)
      await h.answer(failed(code))
      await advance(4000)
      expect(h.read).toHaveBeenCalledTimes(5)
      expect(h.scheduler.get('p1')?.status).toBe('ok')
      await h.answer(failed(code, 'still broken'))
      expect(h.scheduler.get('p1')).toEqual({
        projectId: 'p1',
        adapterId: 'demo',
        status: 'stale',
        tasks: [task('t1')],
        receivedAt: '2026-10-23T10:00:00.000Z',
        error: { code, message: 'still broken' },
      })
      // Retries are exhausted; regular polling continues and a success clears the error.
      await advance(60_000)
      expect(h.read).toHaveBeenCalledTimes(6)
      await h.answer(ok(['t1']))
      expect(h.scheduler.get('p1')).toMatchObject({ status: 'ok' })
      expect(h.scheduler.get('p1')).not.toHaveProperty('error')
    },
  )

  it('a first read failing after all retries shows a stale state without tasks', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    for (const delay of [2000, 2000, 4000]) {
      await h.answer(failed('transient'))
      await advance(delay)
    }
    await h.answer(failed('transient'))
    expect(h.scheduler.get('p1')).toEqual({
      projectId: 'p1',
      adapterId: 'demo',
      status: 'stale',
      tasks: [],
      receivedAt: null,
      error: { code: 'transient', message: 'transient failure' },
    })
  })

  it.each([
    'config',
    'runtime',
    'unsupported_source',
    'environment_unsupported',
    'adapter_missing',
    'spawn',
  ] as const)('%s marks stale at once and pauses until a watched change', async (code) => {
    const h = await started()
    await advance(60_000)
    await h.answer(failed(code))
    expect(h.scheduler.get('p1')).toMatchObject({
      status: 'stale',
      tasks: [task('t1')],
      error: { code },
    })
    await advance(10 * 60_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    h.watchers[0].change()
    await advance(300)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('a manual Test resumes paused reads', async () => {
    const h = await started()
    await advance(60_000)
    await h.answer(failed('config'))
    await advance(10 * 60_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    h.scheduler.resume('p1')
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(3)
    await h.answer(ok())
    expect(h.scheduler.get('p1')?.status).toBe('ok')
  })

  it('a configuration failure cancels a follow-up queued during the read', async () => {
    const h = await started()
    await advance(60_000)
    h.watchers[0].change()
    await advance(300)
    await h.answer(failed('config'))
    await advance(60_000)
    expect(h.read).toHaveBeenCalledTimes(2)
    h.scheduler.resume('p1')
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('resume does nothing for a project that is not paused', async () => {
    const h = await started()
    h.scheduler.resume('p1')
    await advance(0)
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('internal marks stale at once and keeps regular polling', async () => {
    const h = await started()
    await advance(60_000)
    await h.answer(failed('internal'))
    expect(h.scheduler.get('p1')).toMatchObject({ status: 'stale', error: { code: 'internal' } })
    await advance(59_999)
    expect(h.read).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('an unexpected read rejection becomes a visible internal error and is logged', async () => {
    const h = await started()
    await advance(60_000)
    h.reads[1].reject(new Error('boom'))
    await advance(0)
    expect(h.scheduler.get('p1')).toMatchObject({
      status: 'stale',
      error: { code: 'internal', message: expect.stringContaining('boom') },
    })
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})

describe('TaskProgressScheduler task disappearance', () => {
  it.each([0, 1500])(
    'does not confirm disappearance with an immediate follow-up that completes %i ms later',
    async (followUpDuration) => {
      const h = setup()
      h.scheduler.observe(['p1'])
      await h.answer(ok(['a', 'b']))
      await advance(60_000)
      h.watchers[0].change()
      await advance(3000)
      await h.answer(ok(['a']))
      expect(h.read).toHaveBeenCalledTimes(3)
      await advance(followUpDuration)
      await h.answer(ok(['a']))
      expect(h.scheduler.get('p1')?.tasks.map((item) => item.id)).toEqual(['a', 'b'])
      await advance(1999 - followUpDuration)
      expect(h.read).toHaveBeenCalledTimes(3)
      await advance(1)
      expect(h.read).toHaveBeenCalledTimes(4)
      await h.answer(ok(['a']))
      expect(h.scheduler.get('p1')?.tasks.map((item) => item.id)).toEqual(['a'])
    },
  )

  it('keeps a vanished task until confirmation, respecting the 2 s minimum gap', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok(['a', 'b']))
    await advance(60_000)
    await h.answer(ok(['a']))
    expect(h.scheduler.get('p1')?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    await advance(1999)
    expect(h.read).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(h.read).toHaveBeenCalledTimes(3)
    await h.answer(ok(['a']))
    expect(h.scheduler.get('p1')?.tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('a task that reappears in the confirming read stays with its new data', async () => {
    const h = setup()
    h.scheduler.observe(['p1'])
    await advance(0)
    await h.answer(ok(['a', 'b']))
    await advance(60_000)
    await h.answer(ok(['a']))
    await advance(2000)
    await h.answer(ok(['a', 'b']))
    expect(h.scheduler.get('p1')?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    await advance(60_000)
    await h.answer(ok(['a']))
    // A fresh disappearance needs its own confirmation.
    expect(h.scheduler.get('p1')?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })
})
