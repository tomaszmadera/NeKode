import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/ipc-error'
import type { PtyFactory, PtyProcessLike, PtySpawnOptions } from './terminal-service'
import { TerminalService } from './terminal-service'

// Terminal service unit tests with a fake PTY injected (plan Stage 3): no
// real processes are spawned in vitest. Covers lazy spawn keyed by chatId,
// write/resize/data/exit routing, terminate-all on quit, idempotent cleanup
// and spawn-error handling.

class FakePty implements PtyProcessLike {
  readonly pid: number
  readonly options: PtySpawnOptions
  readonly killEmitsExit: boolean
  readonly writes: string[] = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  killCount = 0
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(pid: number, options: PtySpawnOptions, killEmitsExit = false) {
    this.pid = pid
    this.options = options
    this.killEmitsExit = killEmitsExit
  }

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  kill(): void {
    this.killCount += 1
    // ConPTY-style teardown: a kill can raise an exit event afterwards. The
    // service must swallow it while quitting (no chat-close flow on quit).
    if (this.killEmitsExit) {
      this.emitExit(0)
    }
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return {
      dispose: () => {
        this.exitListeners.delete(listener)
      },
    }
  }

  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(data)
    }
  }

  emitExit(exitCode: number): void {
    for (const listener of [...this.exitListeners]) {
      listener({ exitCode })
    }
  }
}

interface Harness {
  service: TerminalService
  ptys: FakePty[]
  spawn: ReturnType<typeof vi.fn>
}

function createHarness(
  options: {
    spawnError?: Error
    isDirectory?: (path: string) => boolean
    killEmitsExit?: boolean
  } = {},
): Harness {
  const ptys: FakePty[] = []
  const spawn = vi.fn((spawnOptions: PtySpawnOptions) => {
    if (options.spawnError !== undefined) {
      throw options.spawnError
    }
    const pty = new FakePty(1000 + ptys.length, spawnOptions, options.killEmitsExit ?? false)
    ptys.push(pty)
    return pty
  })
  const service = new TerminalService({
    createPty: spawn as unknown as PtyFactory,
    isDirectory: options.isDirectory ?? (() => true),
    shell: { file: 'powershell.exe', args: ['-NoLogo'] },
    cols: 80,
    rows: 24,
  })
  return { service, ptys, spawn }
}

describe('terminal service (fake PTY)', () => {
  it('spawns lazily and keeps exactly one PTY per chat', () => {
    const { service, ptys, spawn } = createHarness()
    expect(spawn).not.toHaveBeenCalled()

    const id = service.create('t1', 'D:/code/demo')
    expect(id).toBe('t1')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(ptys[0].options.cwd).toBe('D:/code/demo')
    expect(ptys[0].options.file).toBe('powershell.exe')

    // Idempotent while the session is alive (one PTY per chat, spec rules).
    service.create('t1', 'D:/code/demo')
    service.create('t1', 'D:/code/other')
    expect(spawn).toHaveBeenCalledTimes(1)

    // A second chat gets its own process.
    service.create('t2', 'D:/code/demo')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys).toHaveLength(2)
  })

  it("routes write and resize to the chat's own PTY", () => {
    const { service, ptys } = createHarness()
    service.create('t1', 'D:/a')
    service.create('t2', 'D:/b')

    service.write('t1', 'dir\r')
    service.write('t2', 'git status\r')
    service.resize('t2', 120, 40)

    expect(ptys[0].writes).toEqual(['dir\r'])
    expect(ptys[1].writes).toEqual(['git status\r'])
    expect(ptys[0].resizes).toEqual([])
    expect(ptys[1].resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  it('routes PTY data and exit events by chatId (no cross-chat bleed)', () => {
    const { service, ptys } = createHarness()
    const dataEvents: Array<[string, string]> = []
    const exitEvents: Array<[string, number]> = []
    service.onData((chatId, data) => dataEvents.push([chatId, data]))
    service.onExit((chatId, exitCode) => exitEvents.push([chatId, exitCode]))

    service.create('t1', 'D:/a')
    service.create('t2', 'D:/b')

    ptys[0].emitData('hello from t1')
    ptys[1].emitData('hello from t2')
    ptys[1].emitExit(3)

    expect(dataEvents).toEqual([
      ['t1', 'hello from t1'],
      ['t2', 'hello from t2'],
    ])
    expect(exitEvents).toEqual([['t2', 3]])
  })

  it('replaces an exited session with a fresh PTY on the next create', () => {
    const { service, ptys, spawn } = createHarness()
    service.create('t1', 'D:/a')
    ptys[0].emitExit(0)
    expect(service.hasRunningSession('t1')).toBe(false)

    service.create('t1', 'D:/a')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys[1].pid).not.toBe(ptys[0].pid)
    expect(service.hasRunningSession('t1')).toBe(true)
  })

  it('writes to unknown chats reject as not_found; writes to ended sessions reject as a typed conflict', () => {
    const { service, ptys } = createHarness()
    service.create('t1', 'D:/a')
    ptys[0].emitExit(0)

    expect(() => service.write('ghost', 'x')).toThrow(AppError)
    try {
      service.write('ghost', 'x')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    // An exit/write race must not fail the renderer: the write is rejected as
    // a conflict (typed) and the PTY receives nothing.
    expect(() => service.write('t1', 'x')).toThrow(AppError)
    expect(ptys[0].writes).toEqual([])
  })

  it('spawn failure rejects with a typed error and leaves no half session', () => {
    const { service, spawn } = createHarness({ spawnError: new Error('conpty failed') })
    expect(() => service.create('t1', 'D:/a')).toThrow(AppError)
    try {
      service.create('t1', 'D:/a')
    } catch (error) {
      expect((error as AppError).code).toBe('unknown')
    }
    expect(service.hasRunningSession('t1')).toBe(false)

    // A later attempt retries the spawn instead of caching the failure.
    const retry = createHarness()
    retry.service.create('t1', 'D:/a')
    expect(retry.spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('missing project directory rejects as not_found without spawning', () => {
    const { service, spawn } = createHarness({ isDirectory: () => false })
    expect(() => service.create('t1', 'D:/gone')).toThrow(AppError)
    try {
      service.create('t1', 'D:/gone')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('terminateAll kills every PTY (app-quit teardown) and is idempotent', () => {
    const { service, ptys } = createHarness()
    service.create('t1', 'D:/a')
    service.create('t2', 'D:/b')
    service.create('t3', 'D:/c')

    service.terminateAll()
    service.terminateAll()
    service.terminate('t1')

    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 1, 1])
    expect(service.hasRunningSession('t1')).toBe(false)
    expect(service.hasRunningSession('t2')).toBe(false)
    expect(service.hasRunningSession('t3')).toBe(false)
  })

  it('quit teardown emits no exit events (chat removal is suppressed during quit)', () => {
    // ConPTY-style kill raises an exit event afterwards; the chat-close flow
    // (renderer-driven chat removal, spec Behaviour 11) must never start while
    // the application quits — chats stay in the tree and the database.
    const { service, ptys } = createHarness({ killEmitsExit: true })
    const exitEvents: Array<[string, number]> = []
    service.onExit((chatId, exitCode) => exitEvents.push([chatId, exitCode]))
    service.create('t1', 'D:/a')
    service.create('t2', 'D:/b')

    service.terminateAll()

    expect(ptys.map((pty) => pty.killCount)).toEqual([1, 1])
    expect(exitEvents).toEqual([])
    expect(service.hasRunningSession('t1')).toBe(false)
    expect(service.hasRunningSession('t2')).toBe(false)

    // Late exit events after the teardown are dropped as well.
    ptys[0].emitExit(3)
    ptys[1].emitExit(3)
    expect(exitEvents).toEqual([])
  })

  it('terminate on an unknown chat is a safe no-op', () => {
    const { service } = createHarness()
    expect(() => service.terminate('ghost')).not.toThrow()
  })

  it('unsubscribing stops data/exit delivery', () => {
    const { service, ptys } = createHarness()
    const seen: string[] = []
    const unsubscribe = service.onData((chatId, data) => seen.push(`${chatId}:${data}`))
    service.create('t1', 'D:/a')
    ptys[0].emitData('a')
    unsubscribe()
    ptys[0].emitData('b')
    expect(seen).toEqual(['t1:a'])
  })
})
