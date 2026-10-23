import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseUsageDocument, type UsageAdapter, usagePercent } from '../../../shared/usage-contract'
import {
  assertLiveRefresh,
  bundledUsageAdapterDirectories,
  discoverUsageAdapters,
  UsageAdapterHost,
} from './adapter-host'
import { UsageService } from './usage-service'

const adapters = resolve(__dirname, '../../../../adapters')
// The shipped adapters as an unpackaged app resolves them (spec rule 17).
const bundled = bundledUsageAdapterDirectories(false, resolve(__dirname, '../../../..'), '')
const load = createRequire(__filename)
interface ProviderModule {
  TOTAL_DEADLINE_MS: number
  collect(options: Record<string, unknown>): Promise<unknown>
}
const elevenlabs = load(join(adapters, 'usage-elevenlabs', 'index.cjs')) as ProviderModule
const openrouter = load(join(adapters, 'usage-openrouter', 'index.cjs')) as ProviderModule

// Sanitized fixtures: no real account values or credentials.
const KEY = 'fixture-secret-key-0123456789'
const NOW = new Date('2026-10-21T12:00:00.000Z')
const RESET = 1_793_000_000
const SUBSCRIPTION = {
  tier: 'creator',
  character_count: 25_000,
  character_limit: 100_000,
  status: 'active',
  next_character_count_reset_unix: RESET,
  currency: 'usd',
  billing_period: 'monthly_period',
  character_refresh_period: 'monthly_period',
  open_invoices: [{ amount_due_cents: 2200 }],
  next_invoice: { amount_due_cents: 2200 },
}
const CREDITS = { data: { total_credits: 100.5, total_usage: 25.75 } }

interface Call {
  url: string
  init: { method?: string; headers?: Record<string, string>; redirect?: string; signal?: unknown }
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
const run = (module: ProviderModule, options: Record<string, unknown>) =>
  module.collect({
    connectionId: 'account',
    config: { apiKey: KEY },
    now: () => NOW,
    env: {},
    ...options,
  })
const metricsOf = (document: unknown) =>
  parseUsageDocument(document, NOW.getTime()).subscriptions[0].metrics

describe('ElevenLabs subscription adapter', () => {
  it('maps the documented character count and limit to a credits metric', async () => {
    const calls: Call[] = []
    const document = await run(elevenlabs, { fetch: fakeFetch(200, SUBSCRIPTION, {}, calls) })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/user/subscription')
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(calls[0].init.headers).toMatchObject({ 'xi-api-key': KEY })
    const parsed = parseUsageDocument(document, NOW.getTime())
    expect(parsed.subscriptions[0]).toMatchObject({
      id: 'account',
      providerId: 'elevenlabs',
      sourceKind: 'api',
      status: 'available',
    })
    const [metric] = parsed.subscriptions[0].metrics
    expect(metric).toMatchObject({
      id: 'characters',
      kind: 'credits',
      state: 'available',
      used: 25_000,
      limit: 100_000,
      unit: 'characters',
      resetsAt: new Date(RESET * 1000).toISOString(),
      periodStart: null,
      observedAt: NOW.toISOString(),
    })
    expect(usagePercent(metric)).toBe(25)
    const text = JSON.stringify(document)
    for (const leaked of ['creator', 'invoice', 'amount_due', KEY])
      expect(text).not.toContain(leaked)
  })
  it('keeps a zero limit without a percentage and an unknown reset as null', async () => {
    const document = await run(elevenlabs, {
      fetch: fakeFetch(200, {
        ...SUBSCRIPTION,
        character_count: 0,
        character_limit: 0,
        next_character_count_reset_unix: null,
      }),
    })
    const [metric] = metricsOf(document)
    expect(metric).toMatchObject({ state: 'available', used: 0, limit: 0, resetsAt: null })
    expect(metric.periodStart ?? null).toBeNull()
    expect(usagePercent(metric)).toBeNull()
  })
  it('reports a missing limit as unavailable instead of zero', async () => {
    const {
      character_limit: _limit,
      next_character_count_reset_unix: _reset,
      ...rest
    } = SUBSCRIPTION
    const document = await run(elevenlabs, { fetch: fakeFetch(200, rest) })
    const [metric] = metricsOf(document)
    expect(metric).toMatchObject({ state: 'unavailable', reason: 'limit_not_reported' })
    expect(metric.used ?? null).toBeNull()
    expect(parseUsageDocument(document, NOW.getTime()).subscriptions[0].status).toBe('unavailable')
  })
  it('uses a documented regional base URL', async () => {
    const calls: Call[] = []
    await run(elevenlabs, {
      config: { apiKey: KEY, region: 'eu' },
      fetch: fakeFetch(200, SUBSCRIPTION, {}, calls),
    })
    expect(calls[0].url).toBe('https://api.eu.residency.elevenlabs.io/v1/user/subscription')
    expect(
      await failure(
        run(elevenlabs, { config: { apiKey: KEY, region: 'mars' }, fetch: fakeFetch(200, {}) }),
      ),
    ).toMatchObject({ code: 'config' })
  })
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'unsupported'],
    [422, 'protocol'],
    [500, 'network'],
    [503, 'network'],
  ])('maps HTTP %s to %s without echoing the key or body', async (status, code) => {
    const error = await failure(
      run(elevenlabs, { fetch: fakeFetch(status, { detail: { message: `bad key ${KEY}` } }) }),
    )
    expect(error).toMatchObject({ code })
    expect(JSON.stringify(error)).not.toContain(KEY)
    expect(error?.message).not.toContain('bad key')
  })
  it.each([
    [{ ...SUBSCRIPTION, character_count: '25' }],
    [{ ...SUBSCRIPTION, character_count: -1 }],
    [{ ...SUBSCRIPTION, character_limit: 1.5 }],
    [{ ...SUBSCRIPTION, next_character_count_reset_unix: 'soon' }],
    [[]],
    ['not json'],
  ])('rejects an invalid response body as protocol', async (body) => {
    expect(await failure(run(elevenlabs, { fetch: fakeFetch(200, body) }))).toMatchObject({
      code: 'protocol',
    })
  })
  it('requires a configured key', async () => {
    for (const config of [{}, { apiKey: '' }, { apiKey: 'a\nb' }])
      expect(
        await failure(run(elevenlabs, { config, fetch: fakeFetch(200, SUBSCRIPTION) })),
      ).toMatchObject({ code: 'config' })
  })
})

describe('OpenRouter account balance adapter', () => {
  it('computes the account balance in USD from the documented credits endpoint', async () => {
    const calls: Call[] = []
    const document = await run(openrouter, { fetch: fakeFetch(200, CREDITS, {}, calls) })
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/credits')
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` })
    const parsed = parseUsageDocument(document, NOW.getTime())
    expect(parsed.subscriptions[0]).toMatchObject({
      providerId: 'openrouter',
      sourceKind: 'api',
      status: 'available',
    })
    expect(parsed.subscriptions[0].metrics).toEqual([
      expect.objectContaining({
        id: 'balance',
        kind: 'balance',
        state: 'available',
        amount: 74.75,
        currency: 'USD',
        observedAt: NOW.toISOString(),
      }),
    ])
    const [metric] = parsed.subscriptions[0].metrics
    expect(metric.periodStart ?? null).toBeNull()
    expect(metric.resetsAt ?? null).toBeNull()
    expect(JSON.stringify(document)).not.toContain(KEY)
  })
  it.each([
    [10, 12.5, -2.5],
    [0.3, 0.1, 0.2],
    [0, 0, 0],
  ])('balance of %s credits minus %s usage is %s', async (credits, usage, amount) => {
    const document = await run(openrouter, {
      fetch: fakeFetch(200, { data: { total_credits: credits, total_usage: usage } }),
    })
    expect(metricsOf(document)[0].amount).toBe(amount)
  })
  it('maps an ordinary-key denial to config, never to a per-key value', async () => {
    const calls: Call[] = []
    const error = await failure(
      run(openrouter, {
        fetch: fakeFetch(
          403,
          { error: { code: 403, message: 'Only management keys can perform this operation' } },
          {},
          calls,
        ),
      }),
    )
    expect(error).toMatchObject({ code: 'config' })
    expect(error?.message).toContain('Management key')
    // Exactly one documented metadata GET; no fallback to /key or another endpoint.
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', 'https://openrouter.ai/api/v1/credits'],
    ])
  })
  it.each([
    [401, 'auth'],
    [404, 'unsupported'],
    [500, 'network'],
  ])('maps HTTP %s to %s', async (status, code) => {
    expect(await failure(run(openrouter, { fetch: fakeFetch(status, {}) }))).toMatchObject({ code })
  })
  it.each([
    [{}],
    [{ data: { total_credits: 1 } }],
    [{ data: { total_credits: '1', total_usage: 0 } }],
    [{ data: { total_credits: -1, total_usage: 0 } }],
    [{ data: null }],
  ])('rejects an invalid response body as protocol', async (body) => {
    expect(await failure(run(openrouter, { fetch: fakeFetch(200, body) }))).toMatchObject({
      code: 'protocol',
    })
  })
})

describe.each([
  ['ElevenLabs', elevenlabs, SUBSCRIPTION],
  ['OpenRouter', openrouter, CREDITS],
])('%s request bounds', (_name, module, body) => {
  it('keeps its deadline below the 30-second host limit', () => {
    expect(module.TOTAL_DEADLINE_MS).toBeLessThanOrEqual(20_000)
  })
  it.each([
    [{ 'retry-after': '120' }, 120],
    [{ 'retry-after': new Date(NOW.getTime() + 90_000).toUTCString() }, 90],
    [{ 'retry-after': '999999' }, 86_400],
    [{}, 60],
    [{ 'retry-after': 'soon' }, 60],
  ])('maps 429 %j to rate_limited with retryAfterSeconds %s', async (headers, seconds) => {
    expect(
      await failure(run(module, { fetch: fakeFetch(429, { error: 'slow down' }, headers) })),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: seconds })
  })
  it('reports a network failure without the key', async () => {
    const error = await failure(
      run(module, {
        fetch: async () => {
          throw new TypeError(`fetch failed for ${KEY}`)
        },
      }),
    )
    expect(error).toMatchObject({ code: 'network' })
    expect(JSON.stringify(error)).not.toContain(KEY)
    expect(error?.message).not.toContain('fetch failed')
  })
  it('times out a silent server within its own deadline', async () => {
    const started = Date.now()
    const error = await failure(
      run(module, {
        timeoutMs: 300,
        fetch: (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(init.signal.reason)),
          ),
      }),
    )
    expect(error).toMatchObject({ code: 'timeout' })
    expect(Date.now() - started).toBeLessThan(1500)
  })
  it('rejects an oversized response body', async () => {
    expect(
      await failure(run(module, { fetch: fakeFetch(200, `"${'x'.repeat(1024 * 1024)}"`) })),
    ).toMatchObject({ code: 'protocol' })
  })
  it('ignores a base URL override that is not loopback HTTP', async () => {
    const calls: Call[] = []
    await run(module, {
      env: { NEKODE_USAGE_TEST_BASE_URL: 'https://attacker.example' },
      fetch: fakeFetch(200, body, {}, calls),
    })
    expect(calls[0].url).not.toContain('attacker')
  })
})

describe('provider adapters through the process host', () => {
  let server: Server | undefined
  const previous = process.env.NEKODE_USAGE_TEST_BASE_URL
  const roots: string[] = []
  afterEach(async () => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
    if (previous === undefined) delete process.env.NEKODE_USAGE_TEST_BASE_URL
    else process.env.NEKODE_USAGE_TEST_BASE_URL = previous
    if (server) await new Promise((r) => server?.close(r))
    server = undefined
  })
  async function serve(
    handler: (path: string, headers: IncomingHttpHeaders) => [number, unknown],
  ): Promise<{ requests: { method?: string; path?: string; headers: IncomingHttpHeaders }[] }> {
    const requests: { method?: string; path?: string; headers: IncomingHttpHeaders }[] = []
    server = createServer((request, response) => {
      requests.push({ method: request.method, path: request.url, headers: request.headers })
      const [status, body] = handler(request.url ?? '', request.headers)
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
    process.env.NEKODE_USAGE_TEST_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { requests }
  }
  function manifest(name: string): UsageAdapter {
    const found = discoverUsageAdapters(join(tmpdir(), 'nekode-no-user-adapters'), bundled).find(
      (a) => a.directory?.endsWith(name),
    )
    if (!found || found.error) throw new Error(`Invalid manifest ${name}`)
    return { ...found, invocation: { command: process.execPath, args: found.invocation.args } }
  }
  it('declares secret keys, API source kind and no secret in the invocation', () => {
    for (const name of ['usage-elevenlabs', 'usage-openrouter']) {
      const raw = JSON.parse(readFileSync(join(adapters, name, 'usage-adapter.json'), 'utf8'))
      const a = manifest(name)
      expect(a.sourceKind).toBe('api')
      expect(a.minimumRefreshSeconds).toBeGreaterThanOrEqual(60)
      expect(a.configSchema.find((f) => f.key === 'apiKey')).toMatchObject({
        type: 'secret',
        required: true,
      })
      expect(raw.invocation.args).toEqual(['index.cjs'])
    }
    expect(manifest('usage-openrouter').description).toContain('Management key')
  })
  it('reads ElevenLabs over stdin with the key only in the request header', async () => {
    const fake = await serve(() => [200, SUBSCRIPTION])
    const data = await new UsageAdapterHost().read(
      manifest('usage-elevenlabs'),
      { apiKey: KEY },
      'account',
      new AbortController().signal,
    )
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ method: 'GET', path: '/v1/user/subscription' })
    expect(fake.requests[0].headers['xi-api-key']).toBe(KEY)
    expect(parseUsageDocument(data).subscriptions[0].metrics[0]).toMatchObject({
      used: 25_000,
      limit: 100_000,
    })
    expect(JSON.stringify(data)).not.toContain(KEY)
  })
  it.each([
    ['usage-elevenlabs', SUBSCRIPTION, '/v1/user/subscription'],
    ['usage-openrouter', CREDITS, '/api/v1/credits'],
  ])(
    'answers a refresh of %s with one provider request made during it (L2)',
    async (name, body, path) => {
      const fake = await serve(() => [200, body])
      const startedAt = Date.now()
      const data = await new UsageAdapterHost().read(
        manifest(name),
        { apiKey: KEY },
        'account',
        new AbortController().signal,
        'refresh',
      )
      expect(fake.requests).toEqual([expect.objectContaining({ method: 'GET', path })])
      expect(() => assertLiveRefresh(parseUsageDocument(data), startedAt)).not.toThrow()
    },
  )
  it('surfaces the OpenRouter ordinary-key denial with the manifest next action', async () => {
    const fake = await serve(() => [
      403,
      { error: { code: 403, message: `Only management keys can perform this operation ${KEY}` } },
    ])
    const error = await failure(
      new UsageAdapterHost().read(
        manifest('usage-openrouter'),
        { apiKey: KEY },
        'account',
        new AbortController().signal,
      ),
    )
    expect(fake.requests[0]).toMatchObject({ method: 'GET', path: '/api/v1/credits' })
    expect(fake.requests[0].headers.authorization).toBe(`Bearer ${KEY}`)
    expect(error).toMatchObject({ code: 'config' })
    expect(error?.message).toContain('Management key')
    expect(JSON.stringify(error)).not.toContain(KEY)
  })
  it('stores the key encrypted, shows the balance, exports no key and suspends on denial', async () => {
    let status = 200
    const fake = await serve(() => [status, status === 200 ? CREDITS : {}])
    const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-provider-'))
    roots.push(dir)
    const state = new Map<string, string>([['usage.enabled', 'true']])
    let now = Date.now()
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
      // Fixture cipher: reversed bytes, so a stored plaintext key would be detectable.
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (v) => Buffer.from(v).reverse(),
        decryptString: (v) => Buffer.from(v).reverse().toString(),
      },
      now: () => now,
      startTimer: false,
    })
    const output = join(dir, 'export.json')
    service.saveSettings({
      connections: [
        {
          id: 'openrouter-account',
          label: 'OpenRouter',
          providerId: 'openrouter',
          adapterId: 'openrouter-credits',
          enabled: true,
          config: { apiKey: KEY },
        },
      ],
      pin: null,
      export: { enabled: true, path: output },
    })
    try {
      await service.refresh()
      const connection = service.read().connections[0]
      expect(connection.error).toBeNull()
      expect(connection.subscription?.metrics[0]).toMatchObject({
        kind: 'balance',
        amount: 74.75,
        currency: 'USD',
      })
      for (const text of [
        JSON.stringify([...state.values()]),
        JSON.stringify(service.read()),
        JSON.stringify(service.getSettings()),
        readFileSync(output, 'utf8'),
        readFileSync(join(dir, 'profile', 'usage', 'observations.json'), 'utf8'),
      ])
        expect(text).not.toContain(KEY)
      expect(readFileSync(output, 'utf8')).toContain('74.75')
      status = 403
      now += 300_000
      await service.refresh()
      const denied = service.read().connections[0]
      expect(denied.error).toMatchObject({ code: 'config' })
      expect(denied.error?.message).toContain('Management key')
      // The last balance stays visible with the error; automatic polls stay suspended.
      expect(denied.subscription?.metrics[0].amount).toBe(74.75)
      const requests = fake.requests.length
      now += 3_600_000
      service.setVisible(true)
      await new Promise((r) => setTimeout(r, 200))
      expect(fake.requests).toHaveLength(requests)
      expect(fake.requests.every((r) => r.path === '/api/v1/credits')).toBe(true)
    } finally {
      service.shutdown()
    }
  })
  it('passes a provider retry deadline through the host', async () => {
    await serve(() => [429, {}])
    expect(
      await failure(
        new UsageAdapterHost().read(
          manifest('usage-openrouter'),
          { apiKey: KEY },
          'account',
          new AbortController().signal,
        ),
      ),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 })
  })
})
