import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  parseUsageDocument,
  type UsageAdapter,
  usageSlices,
} from '@shared/contracts/usage-contract'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertLiveRefresh,
  bundledUsageAdapterDirectories,
  discoverUsageAdapters,
  UsageAdapterHost,
} from './adapter-host'
import { UsageService } from './usage-service'

// Claude Code usage adapter (usage-quota spec L10-L14, acceptance LA5). Every credential here is a
// sanitized fixture in a temporary config directory; no test reads a real ~/.claude directory or
// calls api.anthropic.com.
const directory = resolve(__dirname, '../../../../adapters/usage-claude')
const bundled = bundledUsageAdapterDirectories(false, resolve(__dirname, '../../../..'), '')
const claude = createRequire(__filename)(join(directory, 'index.cjs')) as {
  TOTAL_DEADLINE_MS: number
  collect(options: Record<string, unknown>): Promise<unknown>
}

const TOKEN = 'fixture-access-token-0123456789'
const REFRESH = 'fixture-refresh-token-9876543210'
const NOW = new Date('2026-10-23T12:00:00.000Z')
// Valid for the fixed NOW and for process tests that run on the real clock.
const FUTURE = Math.max(NOW.getTime(), Date.now()) + 86_400_000
const BODY = {
  five_hour: { utilization: 37, resets_at: '2026-10-23T14:59:59.943648+00:00' },
  seven_day: { utilization: 12.5, resets_at: '2026-10-27T09:00:00.123456+00:00' },
  seven_day_opus: { utilization: 99, resets_at: null },
  extra_usage: { is_enabled: false },
}

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function configDir(
  oauth: unknown = { accessToken: TOKEN, refreshToken: REFRESH, expiresAt: FUTURE },
) {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-claude-config-'))
  roots.push(dir)
  if (oauth !== null)
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }))
  return dir
}

interface Call {
  url: string
  init: { method?: string; headers?: Record<string, string>; redirect?: string }
}
function fakeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  calls: Call[] = [],
) {
  return async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }
}
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e as { code: string; message: string; retryAfterSeconds?: number },
  )
const run = (options: Record<string, unknown>) =>
  claude.collect({
    connectionId: 'claude-account',
    config: { configDirectory: configDir() },
    now: () => NOW,
    env: {},
    homedir: () => join(tmpdir(), 'nekode-no-claude-home'),
    ...options,
  })

describe('Claude Code usage adapter', () => {
  it('maps both windows with one GET carrying only the two headers (L12, L13)', async () => {
    const calls: Call[] = []
    const document = await run({ fetch: fakeFetch(200, BODY, {}, calls) })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(calls[0].init.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'anthropic-beta': 'oauth-2025-04-20',
    })
    const parsed = parseUsageDocument(document, NOW.getTime())
    expect(parsed.subscriptions).toHaveLength(1)
    expect(parsed.subscriptions[0]).toMatchObject({
      id: 'claude-account',
      providerId: 'claude',
      sourceKind: 'api',
      status: 'available',
    })
    const [five, seven] = parsed.subscriptions[0].metrics
    expect(parsed.subscriptions[0].metrics).toHaveLength(2)
    expect(five).toMatchObject({
      id: 'five_hour',
      label: '5-hour window',
      kind: 'window',
      state: 'available',
      usedPercent: 37,
      windowDurationSeconds: 18_000,
      resetsAt: '2026-10-23T14:59:59.943Z',
      periodStart: '2026-10-23T09:59:59.943Z',
      observedAt: NOW.toISOString(),
    })
    expect(seven).toMatchObject({
      id: 'seven_day',
      label: '7-day window',
      usedPercent: 12.5,
      windowDurationSeconds: 604_800,
      resetsAt: '2026-10-27T09:00:00.123Z',
      periodStart: '2026-10-20T09:00:00.123Z',
    })
    expect(usageSlices(seven, NOW.getTime())?.shares).toHaveLength(7)
    expect(usageSlices(five, NOW.getTime())).toBeNull()
    const text = JSON.stringify(document)
    for (const leaked of [TOKEN, REFRESH, 'opus', 'extra_usage']) expect(text).not.toContain(leaked)
  })

  it('reports missing windows as not reported and keeps a percentage without a reset', async () => {
    const document = await run({
      fetch: fakeFetch(200, { five_hour: null, seven_day: { utilization: 40, resets_at: null } }),
    })
    const parsed = parseUsageDocument(document, NOW.getTime())
    const [five, seven] = parsed.subscriptions[0].metrics
    expect(five).toMatchObject({ id: 'five_hour', state: 'unavailable', reason: 'not_reported' })
    expect(seven).toMatchObject({ id: 'seven_day', state: 'available', usedPercent: 40 })
    expect(seven.resetsAt ?? null).toBeNull()
    expect(seven.periodStart ?? null).toBeNull()
    const nullUse = await run({
      fetch: fakeFetch(200, { seven_day: { utilization: null, resets_at: null } }),
    })
    const metrics = parseUsageDocument(nullUse, NOW.getTime()).subscriptions[0].metrics
    expect(metrics.map((m) => [m.id, m.state, m.reason])).toEqual([
      ['five_hour', 'unavailable', 'not_reported'],
      ['seven_day', 'unavailable', 'not_reported'],
    ])
    expect(parseUsageDocument(nullUse, NOW.getTime()).subscriptions[0].status).toBe('unavailable')
  })

  it('resolves the config directory from the field, CLAUDE_CONFIG_DIR, then the home directory (L11)', async () => {
    const fromEnv = configDir()
    const home = mkdtempSync(join(tmpdir(), 'nekode-claude-home-'))
    roots.push(home)
    mkdirSync(join(home, '.claude'))
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-home-token', expiresAt: FUTURE } }),
    )
    const header = async (options: Record<string, unknown>) => {
      const calls: Call[] = []
      await run({ fetch: fakeFetch(200, BODY, {}, calls), ...options })
      return calls[0].init.headers?.Authorization
    }
    expect(await header({ env: { CLAUDE_CONFIG_DIR: fromEnv }, homedir: () => home })).toBe(
      `Bearer ${TOKEN}`,
    )
    expect(await header({ config: {}, env: {}, homedir: () => home })).toBe(
      'Bearer fixture-home-token',
    )
    expect(
      await header({ config: { configDirectory: '  ' }, env: { CLAUDE_CONFIG_DIR: fromEnv } }),
    ).toBe(`Bearer ${TOKEN}`)
    const calls: Call[] = []
    expect(
      await failure(
        run({
          config: { configDirectory: 'relative/.claude' },
          fetch: fakeFetch(200, BODY, {}, calls),
        }),
      ),
    ).toMatchObject({ code: 'config' })
    expect(
      await failure(
        run({
          config: {},
          env: { CLAUDE_CONFIG_DIR: 'relative/.claude' },
          fetch: fakeFetch(200, BODY, {}, calls),
        }),
      ),
    ).toMatchObject({
      code: 'config',
      message: 'CLAUDE_CONFIG_DIR must be an absolute path.',
    })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['a missing credentials file', null],
    ['a missing token', { expiresAt: FUTURE }],
    ['an expired token', { accessToken: TOKEN, expiresAt: NOW.getTime() - 1 }],
    ['a missing expiry', { accessToken: TOKEN }],
  ])('fails %s as auth without a request (L12)', async (_name, oauth) => {
    const calls: Call[] = []
    const error = await failure(
      run({
        config: { configDirectory: configDir(oauth) },
        fetch: fakeFetch(200, BODY, {}, calls),
      }),
    )
    expect(error).toMatchObject({ code: 'auth' })
    expect(calls).toHaveLength(0)
    expect(JSON.stringify(error)).not.toContain(TOKEN)
  })

  it('refuses a credentials file over 64 KiB without a request', async () => {
    const dir = configDir(null)
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: { accessToken: TOKEN, expiresAt: FUTURE },
        padding: 'x'.repeat(64 * 1024),
      }),
    )
    const calls: Call[] = []
    const error = await failure(
      run({ config: { configDirectory: dir }, fetch: fakeFetch(200, BODY, {}, calls) }),
    )
    expect(error).toMatchObject({ code: 'auth' })
    expect(calls).toHaveLength(0)
  })

  it('never writes the credentials file and never sends the refresh token', async () => {
    const dir = configDir()
    const file = join(dir, '.credentials.json')
    const before = { text: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }
    const calls: Call[] = []
    await run({ config: { configDirectory: dir }, fetch: fakeFetch(200, BODY, {}, calls) })
    await failure(run({ config: { configDirectory: dir }, fetch: fakeFetch(401, {}) }))
    expect(readFileSync(file, 'utf8')).toBe(before.text)
    expect(statSync(file).mtimeMs).toBe(before.mtime)
    expect(JSON.stringify(calls)).not.toContain(REFRESH)
  })

  it.each([
    [401, {}, 'auth', undefined],
    [403, {}, 'auth', undefined],
    [429, { 'retry-after': '120' }, 'rate_limited', 120],
    [429, {}, 'rate_limited', 300],
    [429, { 'retry-after': '999999' }, 'rate_limited', 86_400],
    [500, {}, 'protocol', undefined],
    [404, {}, 'protocol', undefined],
  ])('maps HTTP %i as L14', async (status, headers, code, retryAfterSeconds) => {
    const error = await failure(
      run({ fetch: fakeFetch(status, { error: { message: `body ${TOKEN}` } }, headers) }),
    )
    expect(error).toMatchObject({ code })
    expect(error?.retryAfterSeconds).toBe(retryAfterSeconds)
    expect(error?.message).not.toContain('body')
    expect(JSON.stringify(error)).not.toContain(TOKEN)
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['an array', '[]'],
    ['a non-numeric utilization', { five_hour: { utilization: '37', resets_at: null } }],
    ['a negative utilization', { five_hour: { utilization: -1, resets_at: null } }],
    ['an invalid reset time', { seven_day: { utilization: 1, resets_at: 'tomorrow' } }],
    ['a window that is not an object', { seven_day: 5 }],
  ])('fails %s as protocol', async (_name, body) => {
    expect(await failure(run({ fetch: fakeFetch(200, body) }))).toMatchObject({
      code: 'protocol',
    })
  })

  it('maps a connection failure to network and a silent server to timeout', async () => {
    const network = await failure(
      run({
        fetch: async () => {
          throw new TypeError(`fetch failed ${TOKEN}`)
        },
      }),
    )
    expect(network).toMatchObject({ code: 'network' })
    expect(JSON.stringify(network)).not.toContain(TOKEN)
    const timeout = await failure(
      run({
        timeoutMs: 20,
        fetch: (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      }),
    )
    expect(timeout).toMatchObject({ code: 'timeout' })
  })

  it('keeps a 10-second deadline and ignores a non-loopback base URL override', async () => {
    expect(claude.TOTAL_DEADLINE_MS).toBe(10_000)
    const calls: Call[] = []
    await run({
      env: { NEKODE_USAGE_TEST_BASE_URL: 'https://attacker.example' },
      fetch: fakeFetch(200, BODY, {}, calls),
    })
    expect(calls[0].url).toBe('https://api.anthropic.com/api/oauth/usage')
  })
})

describe('Claude Code usage adapter through the process host', () => {
  let server: Server | undefined
  const previous = process.env.NEKODE_USAGE_TEST_BASE_URL
  afterEach(async () => {
    if (previous === undefined) delete process.env.NEKODE_USAGE_TEST_BASE_URL
    else process.env.NEKODE_USAGE_TEST_BASE_URL = previous
    if (server) await new Promise((r) => server?.close(r))
    server = undefined
  })
  async function serve(status: () => number, body: unknown = BODY) {
    const requests: { method?: string; path?: string; headers: IncomingHttpHeaders }[] = []
    server = createServer((request, response) => {
      requests.push({ method: request.method, path: request.url, headers: request.headers })
      response.writeHead(status(), { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.NEKODE_USAGE_TEST_BASE_URL = origin
    return { requests, origin }
  }
  function manifest(): UsageAdapter {
    const found = discoverUsageAdapters(join(tmpdir(), 'nekode-no-user-adapters'), bundled).find(
      (a) => a.id === 'claude-code-usage',
    )
    if (!found || found.error) throw new Error('Invalid Claude Code manifest')
    return { ...found, invocation: { command: process.execPath, args: found.invocation.args } }
  }

  it('declares the L10 manifest with only an optional config directory field', () => {
    const a = manifest()
    expect(a).toMatchObject({
      name: 'Claude Code',
      providerId: 'claude',
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds: 300,
      experimental: true,
      bundled: true,
      invocation: { args: ['index.cjs'] },
    })
    expect(a.summary).toBeTruthy()
    expect(a.configSchema).toEqual([
      expect.objectContaining({ key: 'configDirectory', type: 'text' }),
    ])
    expect(a.configSchema[0].required ?? false).toBe(false)
    for (const phrase of [
      'Claude Code sign-in',
      'credentials file',
      'api.anthropic.com',
      'not publicly documented',
      'never refreshes',
    ])
      expect(a.description).toContain(phrase)
    expect(a.errorActions?.auth).toBe('Open Claude Code and sign in again, then retry.')
  })

  it('answers a refresh with one live GET carrying both headers (L2, L3)', async () => {
    const fake = await serve(() => 200)
    const startedAt = Date.now()
    const data = await new UsageAdapterHost().read(
      manifest(),
      { configDirectory: configDir() },
      'claude-account',
      new AbortController().signal,
      'refresh',
    )
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ method: 'GET', path: '/api/oauth/usage' })
    expect(fake.requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(fake.requests[0].headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(JSON.stringify(fake.requests)).not.toContain(REFRESH)
    expect(() => assertLiveRefresh(parseUsageDocument(data), startedAt)).not.toThrow()
    expect(JSON.stringify(data)).not.toContain(TOKEN)
  })

  it('writes nothing to stderr and keeps the token out of argv and stdout', async () => {
    let status = 200
    const fake = await serve(() => status)
    const dir = configDir()
    // An async child: a synchronous spawn would block this process's fixture server.
    const spawnAdapter = () =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
        const child = spawn(process.execPath, ['index.cjs'], {
          cwd: directory,
          env: { ...process.env, NEKODE_USAGE_TEST_BASE_URL: fake.origin },
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => {
          stdout += chunk
        })
        child.stderr.on('data', (chunk) => {
          stderr += chunk
        })
        child.on('close', (status) => done({ status, stdout, stderr }))
        child.stdin.end(
          JSON.stringify({
            protocolVersion: 2,
            action: 'refresh',
            config: { configDirectory: dir },
            params: { connectionId: 'claude-account' },
          }),
        )
      })
    const ok = await spawnAdapter()
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({ protocolVersion: 2, ok: true })
    status = 401
    const denied = await spawnAdapter()
    expect(denied.status).toBe(1)
    expect(JSON.parse(denied.stdout)).toMatchObject({ ok: false, error: { code: 'auth' } })
    for (const result of [ok, denied]) {
      expect(result.stderr).toBe('')
      expect(result.stdout).not.toContain(TOKEN)
    }
    expect(manifest().invocation.args.join(' ')).not.toContain(TOKEN)
  })

  it('shows both windows through the service and keeps the token out of cache and export', async () => {
    const fake = await serve(() => 200)
    const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-claude-'))
    roots.push(dir)
    const state = new Map<string, string>([['usage.enabled', 'true']])
    const service = new UsageService({
      userDataPath: join(dir, 'profile'),
      bundledAdapterDirectories: bundled,
      state: {
        get: (key) => state.get(key) ?? null,
        set: (key, value) => {
          state.set(key, value)
        },
        transaction: (fn) => fn(),
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (v) => Buffer.from(v).reverse(),
        decryptString: (v) => Buffer.from(v).reverse().toString(),
      },
      startTimer: false,
    })
    const output = join(dir, 'export.json')
    service.saveSettings({
      connections: [
        {
          id: 'claude-account',
          label: 'Claude',
          providerId: 'claude',
          adapterId: 'claude-code-usage',
          enabled: true,
          config: { configDirectory: configDir() },
        },
      ],
      pin: null,
      export: { enabled: true, path: output },
    })
    try {
      await service.refresh()
      const connection = service.read().connections[0]
      expect(connection.error).toBeNull()
      expect(connection.subscription?.metrics.map((m) => [m.id, m.usedPercent])).toEqual([
        ['five_hour', 37],
        ['seven_day', 12.5],
      ])
      expect(fake.requests).toHaveLength(1)
      for (const text of [
        JSON.stringify([...state.values()]),
        JSON.stringify(service.read()),
        readFileSync(output, 'utf8'),
        readFileSync(join(dir, 'profile', 'usage', 'observations.json'), 'utf8'),
      ]) {
        expect(text).not.toContain(TOKEN)
        expect(text).not.toContain(REFRESH)
      }
    } finally {
      service.shutdown()
    }
  })
})
