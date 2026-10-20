import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AdapterError,
  AdapterHost,
  type AdapterHostError,
  type AdapterRequest,
  killTree,
  MAX_STDOUT_BYTES,
} from './adapter-host'

// Adapter host protocol matrix (spec kanban-adapter-interface Required tests,
// Acceptance criteria 10–11). Real child processes run node fixture scripts
// from a temp adapter dir; no shell, no mocking of the transport.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nekode-host-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fixture(
  name: string,
  body: string,
): { id: string; dir: string; invocation: { command: string; args: string[] } } {
  const file = join(dir, name)
  writeFileSync(file, body)
  return {
    id: 'fixture-adapter',
    dir,
    invocation: { command: process.execPath, args: [file] },
  }
}

/** Probes whether a pid is still present in the process table. */
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

/** Waits for a killed pid to leave the process table (kill is async). */
async function waitForProcessExit(pid: number, attempts = 20): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isProcessAlive(pid))) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

const request: AdapterRequest = {
  protocolVersion: 1,
  action: 'test',
  config: { api_key: 'sekret' },
  params: {},
}

const failBody = `process.stdin.once('data', () => {}); process.stdin.resume(); console.log(JSON.stringify({ ok: false, error: { code: 'auth', message: 'bad token' } })); process.exit(1)`

describe('AdapterHost', () => {
  it('delivers the request on stdin and resolves the ok:true data', async () => {
    // Echo fixture proves framing: single JSON object on stdin, stdin closed.
    const echo = `let raw=''; process.stdin.on('data', (c) => { raw += c }); process.stdin.on('end', () => { console.log(JSON.stringify({ ok: true, data: { received: JSON.parse(raw) } })) })`
    const adapter = fixture('echo.cjs', echo)
    const host = new AdapterHost()
    const data = await host.invoke<{ received: AdapterRequest }>(adapter, request)
    expect(data.received).toEqual(request)
  })

  it('spawns with cwd set to the adapter directory', async () => {
    const cwdProbe = `console.log(JSON.stringify({ ok: true, data: process.cwd() }))`
    const adapter = fixture('cwd.cjs', cwdProbe)
    const host = new AdapterHost()
    const data = await host.invoke<string>(adapter, request)
    expect(data).toBe(dir)
  })

  it('maps an ok:false response to AdapterError with the adapter code and message', async () => {
    const adapter = fixture('fail.cjs', failBody)
    const host = new AdapterHost()
    const error = await host.invoke(adapter, request).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AdapterError)
    expect((error as AdapterError).code).toBe('auth')
    expect((error as AdapterError).message).toBe('bad token')
  })

  it('normalizes an unknown failure code to internal, keeping the message', async () => {
    const adapter = fixture(
      'oddcode.cjs',
      `console.log(JSON.stringify({ ok: false, error: { code: 'weird', message: 'hm' } })); process.exit(1)`,
    )
    const host = new AdapterHost()
    const error = await host.invoke(adapter, request).catch((caught: unknown) => caught)
    expect((error as AdapterError).code).toBe('internal')
  })

  it('rejects a protocol violation when the adapter exits without output', async () => {
    const adapter = fixture('silent.cjs', `process.exit(0)`)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringContaining('no output'),
    } as Partial<AdapterHostError>)
  })

  it('rejects garbage output as a protocol violation', async () => {
    const adapter = fixture('garbage.cjs', `console.log('this is not json')`)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('rejects two JSON objects as a protocol violation', async () => {
    const adapter = fixture(
      'two.cjs',
      `console.log(JSON.stringify({ ok: true, data: 1 })); console.log(JSON.stringify({ ok: true, data: 2 }))`,
    )
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('rejects invalid UTF-8 on stdout as a typed protocol error', async () => {
    // Raw invalid bytes: chunk.toString('utf8') would silently replace them
    // with U+FFFD; the fatal decoder must surface the typed protocol error.
    const adapter = fixture(
      'badutf8.cjs',
      `process.stdout.write(Buffer.from([0x7b, 0xff, 0xfe, 0x0a]))`,
    )
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringContaining('UTF-8'),
    })
  })

  it('rejects stdout above MAX_STDOUT_BYTES as a typed protocol error', async () => {
    const size = MAX_STDOUT_BYTES + 64 * 1024
    const adapter = fixture(
      'huge.cjs',
      // Exit only once the write is flushed: POSIX pipes are asynchronous, so
      // an immediate process.exit would truncate the output below the cap.
      `process.stdout.write(Buffer.alloc(${size}, 0x61), () => process.exit(0))`,
    )
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringContaining('exceeded'),
    })
  })

  it('maps a stdin write failure on an exited adapter to a typed protocol error', async () => {
    // The adapter closes stdin without reading and exits; a request larger
    // than the pipe buffer makes the write fail (EPIPE). Without the stdin
    // 'error' listener this raises an uncaught exception in the host process.
    const adapter = fixture('noread.cjs', `process.stdin.destroy(); process.exit(0)`)
    const host = new AdapterHost()
    const bigConfig = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`k${index}`, 'x'.repeat(256 * 1024)]),
    )
    const error = await host
      .invoke(adapter, { ...request, config: bigConfig })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as { kind?: string }).kind).toBe('protocol')
    expect((error as Error).message).toContain('stdin')
  })

  it('rejects ok:true with a nonzero exit code', async () => {
    const adapter = fixture(
      'badexit.cjs',
      `console.log(JSON.stringify({ ok: true, data: 1 })); process.exit(3)`,
    )
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      message: expect.stringContaining('exited with code 3'),
    })
  })

  it('rejects ok:false with exit code 0', async () => {
    const adapter = fixture(
      'failzero.cjs',
      `console.log(JSON.stringify({ ok: false, error: { code: 'internal', message: 'x' } }))`,
    )
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      message: expect.stringContaining('exited with code 0'),
    })
  })

  it('maps ENOENT to a protocol error naming the adapter and the command', async () => {
    const host = new AdapterHost()
    const error = await host
      .invoke(
        {
          id: 'missing-adapter',
          dir,
          invocation: { command: 'definitely-not-a-real-command-xyz', args: [] },
        },
        request,
      )
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as { kind?: string }).kind).toBe('protocol')
    expect((error as Error).message).toContain('definitely-not-a-real-command-xyz')
    expect((error as Error).message).toContain('missing-adapter')
  })

  it('times out and rejects quickly when the adapter sleeps past the limit', async () => {
    const sleeper = `setInterval(() => {}, 1000)`
    const adapter = fixture('sleep.cjs', sleeper)
    const host = new AdapterHost({ timeoutMs: 150 })
    const started = Date.now()
    // Behaviour 5: the timeout error names the adapter and the action.
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'timeout',
      message: expect.stringContaining('fixture-adapter'),
    })
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'timeout',
      message: expect.stringContaining('(test)'),
    })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('kills a timed-out adapter so the process actually dies (pid probe)', async () => {
    // The fixture prints its pid, then sleeps until killed.
    const pidSleeper = `console.error('PID:' + process.pid); setInterval(() => {}, 1000)`
    const adapter = fixture('pidsleep.cjs', pidSleeper)
    let adapterPid: number | null = null
    // Wrap spawn to capture the child pid.
    const wrappedSpawn = ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      const child = spawn(command, args, options)
      child.stderr?.on('data', (chunk: Buffer) => {
        const match = /PID:(\d+)/.exec(chunk.toString('utf8'))
        if (match) {
          adapterPid = Number(match[1])
        }
      })
      return child
    }) as typeof spawn
    const host = new AdapterHost({ timeoutMs: 200, spawnProcess: wrappedSpawn })
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({ kind: 'timeout' })
    expect(adapterPid).not.toBeNull()
    // The killed pid must disappear from the process table.
    expect(await waitForProcessExit(adapterPid as unknown as number)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'kills the whole adapter process group on POSIX timeout (grandchild pid probe)',
    async () => {
      // The adapter starts a sleeping grandchild, reports its pid, then hangs.
      // SIGKILL on the direct child alone would leave the grandchild running.
      const tree = [
        `const { spawn } = require('node:child_process')`,
        `const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })`,
        `console.error('GRANDCHILD:' + g.pid)`,
        `setInterval(() => {}, 1000)`,
      ].join('\n')
      const adapter = fixture('tree.cjs', tree)
      let grandchildPid: number | null = null
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
          }
        })
        return child
      }) as typeof spawn
      const host = new AdapterHost({ timeoutMs: 500, spawnProcess: wrappedSpawn })
      try {
        await expect(host.invoke(adapter, request)).rejects.toMatchObject({ kind: 'timeout' })
        expect(grandchildPid).not.toBeNull()
        expect(await waitForProcessExit(grandchildPid as unknown as number)).toBe(true)
      } finally {
        // A failing run must not leak the sleeping grandchild.
        const leaked = grandchildPid as number | null
        if (leaked !== null) {
          try {
            process.kill(leaked, 'SIGKILL')
          } catch {
            // Already gone: the expected outcome.
          }
        }
      }
    },
  )

  it('reports the typed timeout for a large request to a hanging adapter (stdin EPIPE must not mask it)', async () => {
    // Regression (finding 1): a request larger than the OS pipe buffer leaves
    // stdin.write pending; when the host's own timeout kills the tree, closing
    // stdin raises EPIPE on that pending write. The stdin error must not mask
    // the typed `timeout` error Behaviour 5 requires (adapter + action named).
    const pidSleeper = `console.error('PID:' + process.pid); setInterval(() => {}, 1000)`
    const adapter = fixture('bigsleep.cjs', pidSleeper)
    let adapterPid: number | null = null
    const wrappedSpawn = ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      const child = spawn(command, args, options)
      child.stderr?.on('data', (chunk: Buffer) => {
        const match = /PID:(\d+)/.exec(chunk.toString('utf8'))
        if (match) {
          adapterPid = Number(match[1])
        }
      })
      return child
    }) as typeof spawn
    const host = new AdapterHost({ timeoutMs: 200, spawnProcess: wrappedSpawn })
    // ~2 MB: comfortably beyond any pipe buffer, so the write pends until the
    // timeout's killTree closes stdin and the pending write fails.
    const bigConfig = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`k${index}`, 'x'.repeat(256 * 1024)]),
    )
    const error = await host
      .invoke(adapter, { ...request, config: bigConfig })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as { kind?: string }).kind).toBe('timeout')
    expect((error as Error).message).toContain('fixture-adapter')
    expect((error as Error).message).toContain('(test)')
    expect(adapterPid).not.toBeNull()
    // No orphaned process: the timeout kill must take the whole tree.
    expect(await waitForProcessExit(adapterPid as unknown as number)).toBe(true)
  })

  it('never leaks config values onto the command line (argv assertion)', async () => {
    const argvProbe = `console.log(JSON.stringify({ ok: true, data: process.argv }))`
    const adapter = fixture('argv.cjs', argvProbe)
    const host = new AdapterHost()
    const argv = await host.invoke<string[]>(adapter, {
      ...request,
      config: { api_key: 'super-secret-value' },
    })
    expect(argv.join(' ')).not.toContain('super-secret-value')
  })

  it('keeps stderr unparsed but available on failure messages', async () => {
    const noisy = `console.error('adapter diagnostics: boom'); process.exit(1)`
    const adapter = fixture('noisy.cjs', noisy)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringMatching(/no output.*Adapter stderr tail: adapter diagnostics: boom/),
    })
  })

  it('appends stderr tail to invalid JSON protocol errors', async () => {
    const noisy = `console.error('stderr diagnostic details'); console.log('bad json'); process.exit(0)`
    const adapter = fixture('noisy-json.cjs', noisy)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringMatching(
        /not valid JSON.*Adapter stderr tail: stderr diagnostic details/,
      ),
    })
  })

  it('appends stderr tail to non-object response protocol errors', async () => {
    const noisy = `console.error('stderr diagnostic details'); console.log(JSON.stringify([1, 2, 3])); process.exit(0)`
    const adapter = fixture('noisy-array.cjs', noisy)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringMatching(
        /must be a JSON object.*Adapter stderr tail: stderr diagnostic details/,
      ),
    })
  })

  it('appends stderr tail to failure response missing error.message', async () => {
    const noisy = `console.error('stderr diagnostic details'); console.log(JSON.stringify({ ok: false, error: {} })); process.exit(1)`
    const adapter = fixture('noisy-fail-shape.cjs', noisy)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringMatching(
        /must carry error\.message.*Adapter stderr tail: stderr diagnostic details/,
      ),
    })
  })

  it('appends stderr tail to response missing ok boolean', async () => {
    const noisy = `console.error('stderr diagnostic details'); console.log(JSON.stringify({ other: true })); process.exit(0)`
    const adapter = fixture('noisy-no-ok.cjs', noisy)
    const host = new AdapterHost()
    await expect(host.invoke(adapter, request)).rejects.toMatchObject({
      kind: 'protocol',
      message: expect.stringMatching(
        /must carry ok: true or ok: false.*Adapter stderr tail: stderr diagnostic details/,
      ),
    })
  })

  it('drains buffered stdout completely before resolving when adapter exits immediately', async () => {
    const largeData = 'a'.repeat(64 * 1024)
    const script = `process.stdout.write(JSON.stringify({ ok: true, data: '${largeData}' })); process.exit(0)`
    const adapter = fixture('drain.cjs', script)
    const host = new AdapterHost()
    const result = await host.invoke<string>(adapter, request)
    expect(result).toBe(largeData)
  })

  describe('killTree', () => {
    it('attaches a no-op error listener and unrefs spawned taskkill child', () => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
      let unrefCalled = false
      const fakeChild = {
        pid: 1234,
        exitCode: null,
      } as unknown as import('node:child_process').ChildProcess

      const fakeSpawner = ((_command: string, _args: string[]) => {
        const killer = {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = listeners[event] || []
            listeners[event].push(handler)
            return killer
          },
          unref: () => {
            unrefCalled = true
            return killer
          },
        }
        return killer
      }) as unknown as typeof spawn

      const origPlatform = process.platform
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' })
        killTree(fakeChild, fakeSpawner)
        expect(listeners.error).toBeDefined()
        expect(listeners.error.length).toBeGreaterThan(0)
        expect(unrefCalled).toBe(true)
        expect(() => listeners.error[0](new Error('spawn ENOENT'))).not.toThrow()
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform })
      }
    })

    it('handles synchronous spawn error during killTree without throwing', () => {
      const fakeChild = {
        pid: 1234,
        exitCode: null,
      } as unknown as import('node:child_process').ChildProcess

      const throwingSpawner = (() => {
        throw new Error('Immediate spawn failure')
      }) as unknown as typeof spawn

      const origPlatform = process.platform
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' })
        expect(() => killTree(fakeChild, throwingSpawner)).not.toThrow()
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform })
      }
    })
  })
})
