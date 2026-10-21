import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseUsageDocument, type UsageAdapter } from '../../../shared/usage-contract'
import { UsageAdapterHost } from './adapter-host'

const adapterDirectory = resolve(__dirname, '../../../../adapters/usage-codex')
const codex = createRequire(__filename)(join(adapterDirectory, 'index.cjs')) as {
  ALLOWED_METHODS: Set<string>
  TOTAL_DEADLINE_MS: number
  collect(options: Record<string, unknown>): Promise<{ version: string; document: unknown }>
  executable(config: Record<string, unknown>): string
  childEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
}

// Sanitized fake app-server: argv and every received message go to a transcript file.
const FAKE_SERVER = `
const fs = require('node:fs')
const s = JSON.parse(process.env.FAKE_SCENARIO)
if (process.argv[2] === '--version') {
  setTimeout(() => { process.stdout.write(s.version + '\\n'); process.exit(0) }, s.versionDelayMs || 0)
  return
}
fs.writeFileSync(s.pidFile, String(process.pid))
fs.appendFileSync(s.transcript, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n')
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
    const m = JSON.parse(line)
    fs.appendFileSync(s.transcript, line + '\\n')
    if (m.method === 'initialize') {
      send({ method: 'configWarning', params: { summary: 'fixture' } })
      send({ id: 900, method: 'account/chatgptAuthTokens/refresh', params: {} })
      send({ id: m.id, result: { userAgent: 'fixture', codexHome: 'C:/Users/fixture-user/.codex', platformFamily: 'windows', platformOs: 'windows' } })
    } else if (m.method === 'account/read') {
      if (s.mode === 'noauth') send({ id: m.id, result: { account: null, requiresOpenaiAuth: true } })
      else if (s.mode === 'apikey') send({ id: m.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } })
      else send({ id: m.id, result: { account: { type: 'chatgpt', email: 'fixture-person@example.com', planType: 'pro' }, requiresOpenaiAuth: true } })
    } else if (m.method === 'account/rateLimits/read') {
      if (s.mode === 'unsupported') send({ id: m.id, error: { code: -32601, message: 'Method not found' } })
      else if (s.mode === 'overloaded') send({ id: m.id, error: { code: -32001, message: 'Server overloaded; retry later.' } })
      else if (s.mode === 'denied') send({ id: m.id, error: { code: -32000, message: 'failed: 401 Unauthorized fixture-token' } })
      else if (s.mode === 'exit') process.exit(3)
      else if (s.mode === 'garbage') process.stdout.write('not json\\n')
      else if (s.mode !== 'hang') {
        send({ method: 'account/rateLimits/updated', params: { rateLimits: {} } })
        send({ id: m.id, result: s.limits })
      }
    }
  }
})
setInterval(() => {}, 1000)
`
const RESET = 1_792_500_000
const MULTI = {
  accountId: 'fixture-account-id',
  rateLimits: {
    limitId: 'codex',
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: RESET },
    secondary: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      limitName: null,
      planType: 'pro',
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: RESET },
      secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: RESET + 86_400 },
    },
    codex_spark: {
      limitId: 'codex_spark',
      limitName: 'Spark',
      primary: { usedPercent: 3, windowDurationMins: 15, resetsAt: null },
      secondary: null,
    },
  },
}
const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scenario(mode: string, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-codex-'))
  roots.push(dir)
  writeFileSync(join(dir, 'fake-codex.cjs'), FAKE_SERVER)
  const s = {
    version: 'codex-cli 0.163.0',
    mode,
    limits: MULTI,
    transcript: join(dir, 'transcript.jsonl'),
    pidFile: join(dir, 'server.pid'),
    ...extra,
  }
  const transcript = () =>
    existsSync(s.transcript)
      ? readFileSync(s.transcript, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
  const run = (options: Record<string, unknown> = {}) =>
    codex.collect({
      connectionId: 'codex-account',
      command: process.execPath,
      prefixArgs: [join(dir, 'fake-codex.cjs')],
      env: { ...process.env, FAKE_SCENARIO: JSON.stringify(s) },
      now: () => new Date('2026-10-20T12:00:00.000Z'),
      ...options,
    })
  const serverAlive = () => {
    if (!existsSync(s.pidFile)) return false
    try {
      process.kill(Number(readFileSync(s.pidFile, 'utf8')), 0)
      return true
    } catch {
      return false
    }
  }
  return { run, transcript, serverAlive }
}
async function eventuallyDead(alive: () => boolean) {
  for (let n = 0; n < 50 && alive(); n++) await new Promise((r) => setTimeout(r, 50))
  expect(alive()).toBe(false)
}

describe('codex child environment', () => {
  it('keeps the environment but never passes Node mode to the Codex CLI', () => {
    const env = codex.childEnv({ PATH: 'C:/bin', ELECTRON_RUN_AS_NODE: '1' })
    expect(env).toEqual({ PATH: 'C:/bin' })
  })
})

describe('experimental Codex app-server usage adapter', () => {
  it('maps every bucket with provider-reported durations and closes app-server', async () => {
    const f = scenario('ok')
    const { version, document } = await f.run()
    expect(version).toBe('0.163.0')
    const parsed = parseUsageDocument(document, Date.parse('2026-10-20T12:00:00Z'))
    const metrics = parsed.subscriptions[0].metrics
    expect(parsed.subscriptions[0]).toMatchObject({ id: 'codex-account', providerId: 'codex' })
    expect(metrics.map((m) => [m.id, m.label, m.state, m.windowDurationSeconds ?? null])).toEqual([
      ['codex.primary', '5h', 'available', 18_000],
      ['codex.secondary', '7d', 'available', 604_800],
      ['codex_spark.primary', 'Spark 15m', 'available', 900],
      ['codex_spark.secondary', 'Spark secondary window', 'unavailable', null],
    ])
    expect(metrics[1]).toMatchObject({
      usedPercent: 40,
      bucketId: 'codex',
      resetsAt: new Date((RESET + 86_400) * 1000).toISOString(),
      periodStart: new Date((RESET + 86_400 - 604_800) * 1000).toISOString(),
      observedAt: '2026-10-20T12:00:00.000Z',
    })
    expect(metrics[2]).toMatchObject({ resetsAt: null, periodStart: null, usedPercent: 3 })
    expect(metrics[3]).toMatchObject({ reason: 'window_not_reported' })
    expect(metrics[3].usedPercent ?? null).toBeNull()
    const text = JSON.stringify(document)
    for (const leaked of ['fixture-person', 'fixture-user', 'fixture-account-id', 'planType'])
      expect(text).not.toContain(leaked)
    await eventuallyDead(f.serverAlive)
  })
  it('sends only initialization and read-only account messages', async () => {
    const f = scenario('ok')
    await f.run()
    const [start, ...messages] = f.transcript()
    expect(start.argv).toEqual(['app-server'])
    expect(messages.map((m) => m.method)).toEqual([
      'initialize',
      'initialized',
      'account/read',
      'account/rateLimits/read',
    ])
    expect(messages[2].params).toEqual({ refreshToken: false })
    expect(messages.some((m) => m.id === 900)).toBe(false)
    expect([...codex.ALLOWED_METHODS].sort()).toEqual([
      'account/rateLimits/read',
      'account/read',
      'initialize',
      'initialized',
    ])
  })
  it('falls back to the single-bucket view when no bucket map is returned', async () => {
    const f = scenario('ok', { limits: { ...MULTI, rateLimitsByLimitId: null } })
    const { document } = await f.run()
    const metrics = parseUsageDocument(document).subscriptions[0].metrics
    expect(metrics.map((m) => [m.id, m.state])).toEqual([
      ['codex.primary', 'available'],
      ['codex.secondary', 'unavailable'],
    ])
  })
  it.each([
    ['noauth', 'auth'],
    ['apikey', 'auth'],
    ['unsupported', 'unsupported'],
    ['denied', 'auth'],
    ['exit', 'protocol'],
    ['garbage', 'protocol'],
  ])('reports %s as an actionable %s failure and cleans up', async (mode, code) => {
    const f = scenario(mode)
    const error = (await f.run().then(
      () => null,
      (e: unknown) => e,
    )) as { code: string; message: string } | null
    expect(error).toMatchObject({ code })
    expect(error?.message).not.toContain('fixture-token')
    await eventuallyDead(f.serverAlive)
  })
  it('honours an overloaded server with a retry deadline', async () => {
    await expect(scenario('overloaded').run()).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 60,
    })
  })
  it('times out a silent app-server and terminates it', async () => {
    const f = scenario('hang')
    await expect(f.run({ timeoutMs: 1500 })).rejects.toMatchObject({ code: 'timeout' })
    await eventuallyDead(f.serverAlive)
  })
  it('bounds the whole read, including the version check and cleanup, by one deadline', async () => {
    expect(codex.TOTAL_DEADLINE_MS).toBeLessThanOrEqual(25_000)
    const f = scenario('hang', { versionDelayMs: 1000 })
    const started = Date.now()
    await expect(f.run({ timeoutMs: 2000 })).rejects.toMatchObject({ code: 'timeout' })
    expect(Date.now() - started).toBeLessThan(2400)
    await eventuallyDead(f.serverAlive)
  })
  it('times out a hanging version check within the same deadline', async () => {
    const f = scenario('ok', { versionDelayMs: 10_000 })
    const started = Date.now()
    await expect(f.run({ timeoutMs: 1500 })).rejects.toMatchObject({ code: 'timeout' })
    expect(Date.now() - started).toBeLessThan(1900)
    expect(f.transcript()).toEqual([])
  })
  it.each(['codex-cli 0.162.9', 'unknown'])(
    'refuses CLI version %s before starting app-server',
    async (version) => {
      const f = scenario('ok', { version })
      await expect(f.run()).rejects.toMatchObject({ code: 'unsupported' })
      expect(f.transcript()).toEqual([])
    },
  )
  it('validates the executable without a shell', async () => {
    expect(codex.executable({})).toBe('codex')
    expect(() => codex.executable({ codexPath: 'codex.exe' })).toThrow('absolute')
    if (process.platform === 'win32')
      expect(() => codex.executable({ codexPath: 'C:\\tools\\codex.cmd' })).toThrow('codex.exe')
    await expect(
      codex.collect({ connectionId: 'a', command: join(tmpdir(), 'missing-codex-binary.exe') }),
    ).rejects.toMatchObject({ code: 'config' })
  })
  it('surfaces an unsupported CLI through the process host with a fixed next action', async () => {
    const manifest = JSON.parse(readFileSync(join(adapterDirectory, 'usage-adapter.json'), 'utf8'))
    const adapter: UsageAdapter = {
      ...manifest,
      invocation: { command: process.execPath, args: ['index.cjs'] },
      directory: adapterDirectory,
    }
    // Node's own `--version` is not a Codex CLI version, so the adapter refuses it.
    await expect(
      new UsageAdapterHost().read(
        adapter,
        { codexPath: process.execPath },
        'codex-account',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'unsupported',
      message:
        'Usage source unsupported. Update the CLI or adapter to a supported version, then retry.',
    })
  })
})
