import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { TaskProgressErrorCode } from '@shared/ipc-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TASK_PROGRESS_MAX_STDOUT_BYTES,
  TASK_PROGRESS_TIMEOUT_MS,
  TaskProgressAdapterError,
  TaskProgressCancelledError,
  TaskProgressHost,
  type TaskProgressRequest,
} from './adapter-host'

// Task progress host protocol matrix (spec task-progress-adapters Behaviour 3-6,
// Required tests "Host"). Real child processes run node fixture scripts.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nekode-progress-host-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fixture(name: string, body: string) {
  const file = join(dir, name)
  writeFileSync(file, body)
  return { id: 'fixture-progress', dir, invocation: { command: process.execPath, args: [file] } }
}

const request: TaskProgressRequest = {
  protocolVersion: 1,
  action: 'test',
  config: { path: 'sekret-value.json' },
  project: { root: 'D:/code/demo', environment: 'local' },
}

function isProcessAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(process.execPath, ['-e', `process.kill(${pid}, 0); console.log('alive')`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    check.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    check.once('exit', (code) => resolve(code === 0 && out.includes('alive')))
  })
}

async function waitForProcessExit(pid: number, attempts = 30): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isProcessAlive(pid))) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function failure(promise: Promise<unknown>): Promise<TaskProgressAdapterError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the invocation to fail')
    },
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(TaskProgressAdapterError)
  return error as TaskProgressAdapterError
}

describe('TaskProgressHost', () => {
  it('uses the 15 s limit by default', () => {
    expect(TASK_PROGRESS_TIMEOUT_MS).toBe(15_000)
    expect(TASK_PROGRESS_MAX_STDOUT_BYTES).toBe(10 * 1024 * 1024)
  })

  it('writes the request on stdin, closes it, and resolves the ok:true data', async () => {
    const echo = `let raw=''; process.stdin.on('data', (c) => { raw += c }); process.stdin.on('end', () => { console.log(JSON.stringify({ ok: true, data: { received: JSON.parse(raw), cwd: process.cwd() } })) })`
    const data = await new TaskProgressHost().invoke(fixture('echo.cjs', echo), request)
    expect(data).toEqual({ received: request, cwd: dir })
  })

  it('keeps config values out of argv and the environment', async () => {
    const probe = `process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ ok: true, data: { argv: process.argv.join(' '), env: JSON.stringify(process.env) } })) })`
    const data = (await new TaskProgressHost().invoke(fixture('probe.cjs', probe), request)) as {
      argv: string
      env: string
    }
    expect(data.argv).not.toContain('sekret-value')
    expect(data.env).not.toContain('sekret-value')
  })

  it.each<TaskProgressErrorCode>([
    'config',
    'runtime',
    'unsupported_source',
    'transient',
    'internal',
  ])('maps ok:false code %s to a typed error naming the adapter and action', async (code) => {
    const body = `console.log(JSON.stringify({ ok: false, error: { code: '${code}', message: 'detail' } })); process.exit(1)`
    const error = await failure(new TaskProgressHost().invoke(fixture('fail.cjs', body), request))
    expect(error.code).toBe(code)
    expect(error.message).toContain('fixture-progress')
    expect(error.message).toContain('test')
    expect(error.message).toContain('detail')
  })

  it('treats an unknown adapter error code as a protocol error', async () => {
    const body = `console.log(JSON.stringify({ ok: false, error: { code: 'auth', message: 'x' } })); process.exit(1)`
    const error = await failure(new TaskProgressHost().invoke(fixture('odd.cjs', body), request))
    expect(error.code).toBe('protocol')
  })

  it('treats ok:false without a message as a protocol error', async () => {
    const body = `console.log(JSON.stringify({ ok: false, error: { code: 'config' } })); process.exit(1)`
    const error = await failure(new TaskProgressHost().invoke(fixture('nomsg.cjs', body), request))
    expect(error.code).toBe('protocol')
  })

  it.each([
    ['ok:true with exit 1', `console.log(JSON.stringify({ ok: true, data: {} })); process.exit(1)`],
    [
      'ok:false with exit 0',
      `console.log(JSON.stringify({ ok: false, error: { code: 'config', message: 'x' } }))`,
    ],
    [
      'ok:false with exit 2',
      `console.log(JSON.stringify({ ok: false, error: { code: 'config', message: 'x' } })); process.exit(2)`,
    ],
  ])('rejects %s as a protocol error', async (_name, body) => {
    const error = await failure(new TaskProgressHost().invoke(fixture('exit.cjs', body), request))
    expect(error.code).toBe('protocol')
    expect(error.message).toContain('exited with code')
  })

  it.each([
    ['invalid JSON', `console.log('not json')`],
    [
      'two JSON objects',
      `console.log('{"ok":true,"data":1}'); console.log('{"ok":true,"data":2}')`,
    ],
    ['no output', `process.exit(0)`],
    ['a non-object value', `console.log('[1]')`],
    ['a missing ok flag', `console.log('{"data":1}')`],
    ['invalid UTF-8', `process.stdout.write(Buffer.from([0x7b, 0xff, 0xfe, 0x0a]))`],
  ])('rejects %s as a protocol error', async (_name, body) => {
    const error = await failure(new TaskProgressHost().invoke(fixture('bad.cjs', body), request))
    expect(error.code).toBe('protocol')
    expect(error.message).toContain('fixture-progress')
  })

  it('rejects stdout above 10 MB as a protocol error', async () => {
    const size = TASK_PROGRESS_MAX_STDOUT_BYTES + 64 * 1024
    const body = `process.stdout.write(Buffer.alloc(${size}, 0x61), () => process.exit(0))`
    const error = await failure(new TaskProgressHost().invoke(fixture('huge.cjs', body), request))
    expect(error.code).toBe('protocol')
    expect(error.message).toContain('10485760')
  })

  it('maps a start failure to the spawn code naming the command', async () => {
    const adapter = {
      id: 'missing-command',
      dir,
      invocation: { command: 'definitely-not-a-real-command-xyz', args: [] },
    }
    const error = await failure(new TaskProgressHost().invoke(adapter, request))
    expect(error.code).toBe('spawn')
    expect(error.message).toContain('missing-command')
    expect(error.message).toContain('definitely-not-a-real-command-xyz')
  })

  it('logs the stderr tail and keeps it out of the error message', async () => {
    const log = vi.fn()
    const body = `console.error('SECRET-DIAGNOSTIC'); console.log('garbage')`
    const error = await failure(
      new TaskProgressHost({ log }).invoke(fixture('err.cjs', body), request),
    )
    expect(error.message).not.toContain('SECRET-DIAGNOSTIC')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SECRET-DIAGNOSTIC'))
  })

  it('times out and kills the whole process tree (grandchild pid probe)', async () => {
    const tree = [
      `const { spawn } = require('node:child_process')`,
      `const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })`,
      `console.error('GRANDCHILD:' + g.pid)`,
      `setInterval(() => {}, 1000)`,
    ].join('\n')
    let grandchildPid: number | null = null
    const wrappedSpawn = ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      const child = spawn(command, args, options)
      child.stderr?.on('data', (chunk: Buffer) => {
        const match = /GRANDCHILD:(\d+)/.exec(chunk.toString('utf8'))
        if (match) grandchildPid = Number(match[1])
      })
      return child
    }) as typeof spawn
    const host = new TaskProgressHost({ timeoutMs: 1000, spawnProcess: wrappedSpawn })
    try {
      const error = await failure(host.invoke(fixture('tree.cjs', tree), request))
      expect(error.code).toBe('timeout')
      expect(error.message).toContain('fixture-progress')
      expect(error.message).toContain('test')
      expect(grandchildPid).not.toBeNull()
      expect(await waitForProcessExit(grandchildPid as unknown as number)).toBe(true)
    } finally {
      const leaked = grandchildPid as number | null
      if (leaked !== null) {
        try {
          process.kill(leaked, 'SIGKILL')
        } catch {
          // Already gone: the expected outcome.
        }
      }
    }
  })

  it('kills the process tree when the signal aborts and rejects as cancelled', async () => {
    const tree = [
      `const { spawn } = require('node:child_process')`,
      `const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })`,
      `console.error('GRANDCHILD:' + g.pid)`,
      `setInterval(() => {}, 1000)`,
    ].join('\n')
    let grandchildPid: number | null = null
    const controller = new AbortController()
    const wrappedSpawn = ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      const child = spawn(command, args, options)
      child.stderr?.on('data', (chunk: Buffer) => {
        const match = /GRANDCHILD:(\d+)/.exec(chunk.toString('utf8'))
        if (match) {
          grandchildPid = Number(match[1])
          controller.abort()
        }
      })
      return child
    }) as typeof spawn
    const host = new TaskProgressHost({ spawnProcess: wrappedSpawn })
    try {
      const outcome = await host
        .invoke(fixture('abort.cjs', tree), { ...request, action: 'snapshot' }, controller.signal)
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(outcome).toBeInstanceOf(TaskProgressCancelledError)
      expect((outcome as Error).message).toContain('fixture-progress')
      expect(grandchildPid).not.toBeNull()
      expect(await waitForProcessExit(grandchildPid as unknown as number)).toBe(true)
    } finally {
      const leaked = grandchildPid as number | null
      if (leaked !== null) {
        try {
          process.kill(leaked, 'SIGKILL')
        } catch {
          // Already gone: the expected outcome.
        }
      }
    }
  })

  it.each(['timeout', 'cancellation'] as const)(
    'settles after %s when the child never closes and cleans up',
    async (reason) => {
      vi.useFakeTimers()
      try {
        const child = Object.assign(new EventEmitter(), {
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          pid: 123456,
          exitCode: null,
          kill: vi.fn(),
        }) as unknown as ChildProcess
        const killer = Object.assign(new EventEmitter(), { unref: vi.fn() })
        const spawnMock = vi.fn((command: string) => (command === 'taskkill' ? killer : child))
        const spawnProcess = spawnMock as unknown as typeof spawn
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
        const controller = new AbortController()
        const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
        const pending = new TaskProgressHost({ timeoutMs: 100, spawnProcess })
          .invoke(fixture('stalled.cjs', ''), request, controller.signal)
          .then(
            () => null,
            (error: unknown) => error,
          )
        let settled = false
        void pending.then(() => {
          settled = true
        })

        if (reason === 'timeout') {
          await vi.advanceTimersByTimeAsync(100)
          controller.abort()
        } else controller.abort()
        expect(settled).toBe(false)
        if (process.platform === 'win32')
          expect(spawnMock).toHaveBeenCalledWith('taskkill', expect.any(Array), expect.any(Object))
        else expect(kill).toHaveBeenCalledWith(-123456, 'SIGKILL')
        await vi.advanceTimersByTimeAsync(1000)
        expect(settled).toBe(true)
        const error = await pending
        if (reason === 'timeout') {
          expect(error).toBeInstanceOf(TaskProgressAdapterError)
          expect((error as TaskProgressAdapterError).code).toBe('timeout')
        } else {
          expect(error).toBeInstanceOf(TaskProgressCancelledError)
        }
        expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
        expect(vi.getTimerCount()).toBe(0)
        expect(child.stdout?.listenerCount('data')).toBe(0)
        expect(child.stderr?.listenerCount('data')).toBe(0)
        child.emit('error', new Error('late child error'))
        child.emit('close', null)
        expect(child.listenerCount('error')).toBe(0)
        expect(child.listenerCount('close')).toBe(0)
      } finally {
        vi.restoreAllMocks()
        vi.useRealTimers()
      }
    },
  )

  it('does not retain listeners on stdin closed before termination grace expires', async () => {
    vi.useFakeTimers()
    try {
      const stdin = new PassThrough()
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 123456,
        exitCode: null,
        kill: vi.fn(),
      }) as unknown as ChildProcess
      const killer = Object.assign(new EventEmitter(), { unref: vi.fn() })
      const spawnProcess = vi.fn((command: string) =>
        command === 'taskkill' ? killer : child,
      ) as unknown as typeof spawn
      vi.spyOn(process, 'kill').mockImplementation(() => true)
      const pending = failure(
        new TaskProgressHost({ timeoutMs: 100, spawnProcess }).invoke(
          fixture('closed-stdin.cjs', ''),
          request,
        ),
      )
      await vi.advanceTimersByTimeAsync(100)
      stdin.destroy()
      await vi.advanceTimersByTimeAsync(0)
      expect(stdin.closed).toBe(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect((await pending).code).toBe('timeout')
      expect(stdin.listenerCount('error')).toBe(0)
      expect(stdin.listenerCount('close')).toBe(0)
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it('does not start a process for an already aborted signal', async () => {
    const spawnProcess = vi.fn() as unknown as typeof spawn
    const controller = new AbortController()
    controller.abort()
    await expect(
      new TaskProgressHost({ spawnProcess }).invoke(
        fixture('never.cjs', ''),
        request,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(TaskProgressCancelledError)
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
