import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/ipc-error'
import { USAGE_STATE_KEY, type UsageSettings } from '../../../shared/usage-contract'
import { UsageAdapterHost } from './adapter-host'
import { UsageService } from './usage-service'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const roots: string[] = [],
  services: UsageService[] = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-test-'))
  roots.push(dir)
  const state = new Map<string, string>([['usage.enabled', 'true']])
  let now = NOW
  const deps = {
    userDataPath: join(dir, 'profile'),
    state: {
      get: (key: string) => state.get(key) ?? null,
      set: (key: string, v: string) => {
        state.set(key, v)
      },
      transaction: <T>(fn: () => T) => fn(),
    },
    now: () => now,
    startTimer: false,
  }
  const service = new UsageService(deps)
  services.push(service)
  const input = join(dir, 'input.json'),
    output = join(dir, 'export.json')
  const write = (percent = 42, observedAt: string | null = '2026-10-20T12:00:00Z') =>
    writeFileSync(
      input,
      JSON.stringify({
        schemaVersion: 1,
        subscriptions: [
          {
            id: 'account',
            providerId: 'fixture',
            label: 'Producer label',
            sourceKind: 'file',
            status: 'available',
            metrics: [
              {
                id: 'week',
                label: '7d',
                kind: 'window',
                state: 'available',
                observedAt,
                usedPercent: percent,
                resetsAt: '2026-10-25T00:00:00Z',
              },
            ],
          },
        ],
      }),
    )
  write()
  const settings: UsageSettings = {
    connections: [
      {
        id: 'account',
        label: 'Fixture account',
        providerId: 'fixture',
        adapterId: 'usage-file',
        enabled: true,
        config: { path: input },
      },
    ],
    pin: null,
    export: { enabled: false, path: null },
  }
  return {
    dir,
    state,
    deps,
    service,
    input,
    output,
    write,
    settings,
    advance: (ms: number) => {
      now += ms
    },
  }
}
function plugin(f: ReturnType<typeof fixture>, minimumRefreshSeconds = 60) {
  const directory = join(f.deps.userDataPath, 'usage-adapters', 'fixture')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'usage-adapter.json'),
    JSON.stringify({
      id: 'fixture',
      name: 'Fixture',
      protocolVersion: 1,
      invocation: { command: 'node', args: ['fixture.cjs'] },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds,
      configSchema: [],
    }),
  )
  const host = new UsageAdapterHost()
  const read = vi.spyOn(host, 'read').mockResolvedValue(JSON.parse(readFileSync(f.input, 'utf8')))
  const service = new UsageService({ ...f.deps, host })
  services.push(service)
  service.saveSettings({
    ...f.settings,
    connections: [{ ...f.settings.connections[0], adapterId: 'fixture', config: {} }],
  })
  return { service, read }
}
afterEach(() => {
  for (const service of services.splice(0)) service.shutdown()
  vi.useRealTimers()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
describe('global usage service', () => {
  it('loads settings saved with the removed adapters directory and saves without it', () => {
    const f = fixture()
    f.state.set(USAGE_STATE_KEY, JSON.stringify({ ...f.settings, adaptersDirectory: 'D:/old' }))
    const service = new UsageService(f.deps)
    services.push(service)
    expect(service.read().cacheError).toBeNull()
    expect(service.getSettings().connections.map((c) => c.id)).toEqual(['account'])
    f.write()
    service.saveSettings(service.getSettings())
    expect(f.state.get(USAGE_STATE_KEY)).not.toContain('adaptersDirectory')
  })
  it('ignores cache without durable identity and restores restart persistence after a new read', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.state.delete('usage.connection-revisions')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().connections[0].subscription).toBeNull()
    await restarted.refresh()
    const next = new UsageService(f.deps)
    services.push(next)
    expect(next.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it.each(['label', 'config'] as const)(
    'rejects old-account cache after a durable %s change even when cache invalidation fails',
    async (field) => {
      const f = fixture()
      f.service.saveSettings(f.settings)
      await f.service.refresh()
      f.service.saveSettings({
        ...f.service.getSettings(),
        pin: { connectionId: 'account', metricId: 'week' },
      })
      const cache = join(f.dir, 'profile', 'usage', 'observations.json')
      const retained = join(f.dir, 'retained-cache.json')
      renameSync(cache, retained)
      mkdirSync(cache)
      const next = f.service.getSettings()
      if (field === 'label') next.connections[0].label = 'Other account'
      else {
        const other = join(f.dir, 'other-account.json')
        writeFileSync(other, readFileSync(f.input))
        next.connections[0].config.path = other
      }
      f.service.saveSettings(next)
      expect(f.service.read().cacheError).toContain('Cannot write usage cache')
      expect(f.service.read().connections[0].subscription).toBeNull()
      rmSync(cache, { recursive: true })
      renameSync(retained, cache)
      const restarted = new UsageService(f.deps)
      services.push(restarted)
      expect(restarted.getSettings().connections[0]).toEqual(next.connections[0])
      expect(restarted.read().pin).toBeNull()
      expect(restarted.read().connections[0].subscription).toBeNull()
    },
  )
  function scheduled(f: ReturnType<typeof fixture>) {
    vi.useFakeTimers()
    const service = new UsageService({ ...f.deps, startTimer: true })
    services.push(service)
    service.saveSettings(f.settings)
    service.setVisible(true)
    const step = async (ms: number) => {
      f.advance(ms)
      await vi.advanceTimersByTimeAsync(ms)
    }
    return { service, step }
  }
  it.each([
    ['protocol', '{'],
    ['validation_error', JSON.stringify({ schemaVersion: 1, subscriptions: 'partial' })],
  ])(
    'retries %s file data at the 5-second cadence without growing backoff',
    async (code, partial) => {
      const f = fixture(),
        { service, step } = scheduled(f)
      await Promise.resolve()
      expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
      const reads = vi.spyOn(service as unknown as { readDocument: () => unknown }, 'readDocument')
      writeFileSync(f.input, partial)
      for (let attempt = 1; attempt <= 4; attempt++) {
        await step(4000)
        expect(reads).toHaveBeenCalledTimes(attempt - 1)
        await step(1000)
        expect(reads).toHaveBeenCalledTimes(attempt)
        expect(service.read().connections[0].error?.code).toBe(code)
        expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
      }
      f.write(75, '2026-10-20T12:00:05Z')
      await step(5000)
      expect(service.read().connections[0].error).toBeNull()
      expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(75)
    },
  )
  it('treats a missing input file as transient and recovers without suspension', async () => {
    const f = fixture(),
      { service, step } = scheduled(f)
    await Promise.resolve()
    rmSync(f.input)
    await step(5000)
    expect(service.read().connections[0].error).toMatchObject({
      code: 'io',
      message: expect.stringContaining('Cannot read usage file'),
    })
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    await step(5000)
    expect(service.read().connections[0].error?.code).toBe('io')
    f.write(64, '2026-10-20T12:00:10Z')
    await step(5000)
    expect(service.read().connections[0].error).toBeNull()
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(64)
  })
  it('saves a file connection whose input does not exist yet in an existing folder', () => {
    const f = fixture()
    rmSync(f.input)
    expect(() => f.service.saveSettings(f.settings)).not.toThrow()
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        connections: [
          { ...f.settings.connections[0], config: { path: join(f.dir, 'absent', 'input.json') } },
        ],
      }),
    ).toThrow('folder')
  })
  it('lets manual refresh read a repaired file after 5 seconds while keeping single-flight', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.advance(5000)
    writeFileSync(f.input, '{')
    await f.service.refresh()
    expect(f.service.read().connections[0].error?.code).toBe('protocol')
    f.write(81, '2026-10-20T12:00:05Z')
    f.advance(4999)
    await f.service.refresh()
    expect(f.service.read().connections[0].error?.code).toBe('protocol')
    f.advance(1)
    const reads = vi.spyOn(f.service as unknown as { readDocument: () => unknown }, 'readDocument')
    await Promise.all([f.service.refresh(), f.service.refresh()])
    expect(reads).toHaveBeenCalledTimes(1)
    expect(f.service.read().connections[0].error).toBeNull()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(81)
  })
  it.each(['protocol', 'validation_error'] as const)(
    'keeps the 60/120/240/300-second schedule for %s failures of a command source',
    async (code) => {
      const f = fixture(),
        { service, read } = plugin(f)
      read.mockRejectedValue(new AppError(code, 'Fixture failure'))
      await service.refresh()
      expect(service.read().connections[0].error?.code).toBe(code)
      for (const delay of [60, 120, 240, 300, 300]) {
        const calls = read.mock.calls.length
        f.advance(delay * 1000 - 1)
        await service.refresh()
        expect(read).toHaveBeenCalledTimes(calls)
        f.advance(1)
        await service.refresh()
        expect(read).toHaveBeenCalledTimes(calls + 1)
      }
    },
  )
  it('resets command backoff after a success between failures', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const document = JSON.parse(readFileSync(f.input, 'utf8'))
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await service.refresh()
    f.advance(60_000)
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await service.refresh()
    f.advance(120_000)
    read.mockResolvedValueOnce(document)
    await service.refresh()
    expect(service.read().connections[0].error).toBeNull()
    f.advance(60_000)
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await service.refresh()
    expect(service.read().connections[0].error?.code).toBe('network')
    const calls = read.mock.calls.length
    read.mockResolvedValue(document)
    f.advance(59_999)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(calls)
    f.advance(1)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(calls + 1)
    expect(service.read().connections[0].error).toBeNull()
  })
  it('ignores the cache after a corrupt connection-revisions store and rebuilds it on refresh', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.state.set('usage.connection-revisions', '{corrupt')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().cacheError).toContain('cache identity')
    expect(restarted.read().connections[0].subscription).toBeNull()
    expect(restarted.getSettings().connections[0].id).toBe('account')
    await restarted.refresh()
    expect(restarted.read().cacheError).toBeNull()
    expect(() => JSON.parse(f.state.get('usage.connection-revisions') ?? '')).not.toThrow()
    const next = new UsageService(f.deps)
    services.push(next)
    expect(next.read().cacheError).toBeNull()
    expect(next.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it('never removes an existing temporary sibling it did not create', async () => {
    const f = fixture()
    f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    const unowned = `${f.output}.${process.pid}.tmp`
    writeFileSync(unowned, 'unowned fixture file')
    await f.service.refresh()
    expect(readFileSync(unowned, 'utf8')).toBe('unowned fixture file')
  })
  it('pauses hidden polling and refreshes once when visible with the adapter minimum cadence', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 90)
    expect(read).not.toHaveBeenCalled()
    service.setVisible(true)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    service.setVisible(false)
    f.advance(90_000)
    expect(read).toHaveBeenCalledTimes(1)
    service.setVisible(true)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(89_999)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(1)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('obeys exponential network backoff, rate-limit deadlines and explicit auth retry cadence', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockRejectedValue(new AppError('network', 'Fixture network failure'))
    await service.refresh()
    for (const delay of [60, 120, 240, 300]) {
      const calls = read.mock.calls.length
      f.advance(delay * 1000 - 1)
      await service.refresh()
      expect(read).toHaveBeenCalledTimes(calls)
      f.advance(1)
      await service.refresh()
      expect(read).toHaveBeenCalledTimes(calls + 1)
    }
    read.mockRejectedValue(
      Object.assign(new AppError('rate_limited', 'Fixture deadline'), { retryAfterSeconds: 600 }),
    )
    f.advance(300_000)
    await service.refresh()
    const calls = read.mock.calls.length
    f.advance(599_999)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(calls)
    read.mockRejectedValue(new AppError('auth', 'Fixture auth'))
    f.advance(1)
    await service.refresh()
    f.advance(60_000)
    service.setVisible(true)
    expect(read).toHaveBeenCalledTimes(calls + 1)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(calls + 2)
    await service.refresh()
    expect(read).toHaveBeenCalledTimes(calls + 2)
  })
  it('accepts a healthy source while another source is pending, then isolates its failure', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let rejectRead: (reason: Error) => void = () => {}
    read.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRead = reject
        }),
    )
    const original = service.getSettings()
    const document = JSON.parse(readFileSync(f.input, 'utf8'))
    document.subscriptions[0].id = 'healthy'
    writeFileSync(join(f.dir, 'healthy.json'), JSON.stringify(document))
    service.saveSettings({
      ...original,
      connections: [
        ...original.connections,
        {
          ...f.settings.connections[0],
          id: 'healthy',
          config: { path: join(f.dir, 'healthy.json') },
        },
      ],
    })
    const pending = service.refresh()
    await Promise.resolve()
    expect(
      service.read().connections.find((c) => c.connection.id === 'healthy')?.subscription
        ?.metrics[0].usedPercent,
    ).toBe(42)
    expect(service.read().connections.find((c) => c.connection.id === 'account')?.refreshing).toBe(
      true,
    )
    rejectRead(new AppError('network', 'Fixture failure'))
    await pending
    expect(service.read().connections.find((c) => c.connection.id === 'healthy')?.error).toBeNull()
    expect(service.read().connections.find((c) => c.connection.id === 'account')?.error?.code).toBe(
      'network',
    )
  })
  it('rejects hard-link, junction and cache output aliases before changing state', () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    const alias = join(f.dir, 'alias.json')
    linkSync(f.input, alias)
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        export: { enabled: true, path: alias, replaceExisting: true },
      }),
    ).toThrow('differ')
    const junction = join(f.dir, 'junction')
    symlinkSync(join(f.dir, 'profile'), junction, 'junction')
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        export: { enabled: true, path: join(junction, 'out.json') },
      }),
    ).toThrow('junction')
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        export: { enabled: true, path: join(f.dir, 'profile', 'usage', 'export.json') },
      }),
    ).toThrow('differ')
    expect(f.service.getSettings().export.enabled).toBe(false)
  })
  it('keeps accepted data and the previous export when its output directory becomes unavailable', async () => {
    const f = fixture(),
      directory = join(f.dir, 'exports')
    mkdirSync(directory)
    const output = join(directory, 'usage.json')
    f.service.saveSettings({ ...f.settings, export: { enabled: true, path: output } })
    await f.service.refresh()
    const previous = readFileSync(output, 'utf8')
    renameSync(directory, join(f.dir, 'retained-exports'))
    f.advance(5000)
    f.write(75, '2026-10-20T12:00:05Z')
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(75)
    expect(f.service.read().exportError).toContain('previous file is retained')
    expect(readFileSync(join(f.dir, 'retained-exports', 'usage.json'), 'utf8')).toBe(previous)
  })
  it('reports cache failure independently and clears a removed pin persistently', async () => {
    const f = fixture()
    mkdirSync(join(f.dir, 'profile'))
    writeFileSync(join(f.dir, 'profile', 'usage'), 'blocked cache directory')
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    expect(f.service.read().cacheError).toContain('Cannot write usage cache')
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.service.saveSettings({ ...f.settings, pin: { connectionId: 'account', metricId: 'week' } })
    f.advance(5000)
    const document = JSON.parse(readFileSync(f.input, 'utf8'))
    document.subscriptions[0].metrics = []
    writeFileSync(f.input, JSON.stringify(document))
    await f.service.refresh()
    expect(f.service.read().pin).toBeNull()
    expect(f.service.getSettings().pin).toBeNull()
  })
  it('stays off by default and does no reads, scheduling or export writes while off', async () => {
    const f = fixture()
    f.state.delete('usage.enabled')
    vi.useFakeTimers()
    const service = new UsageService({ ...f.deps, startTimer: true })
    services.push(service)
    expect(service.getEnabled()).toBe(false)
    const reads = vi.spyOn(service as unknown as { readDocument: () => unknown }, 'readDocument')
    service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    service.setVisible(true)
    f.advance(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await service.refresh()
    expect(reads).not.toHaveBeenCalled()
    expect(existsSync(f.output)).toBe(false)
    expect(service.read().connections[0].subscription).toBeNull()
    expect(service.setEnabled(true)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toHaveBeenCalledTimes(1)
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    expect(f.state.get('usage.enabled')).toBe('true')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.getEnabled()).toBe(true)
    service.setEnabled(false)
    expect(f.state.get('usage.enabled')).toBe('false')
    const exported = readFileSync(f.output, 'utf8')
    f.write(75, '2026-10-20T12:00:05Z')
    f.advance(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await service.refresh()
    expect(reads).toHaveBeenCalledTimes(1)
    expect(readFileSync(f.output, 'utf8')).toBe(exported)
    expect(service.getSettings().connections).toHaveLength(1)
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it('refuses a connection test while the switch is off without reading files or processes', async () => {
    const f = fixture()
    f.state.set('usage.enabled', 'false')
    const host = new UsageAdapterHost()
    const hostRead = vi.spyOn(host, 'read')
    const service = new UsageService({ ...f.deps, host })
    services.push(service)
    const reads = vi.spyOn(service as unknown as { readDocument: () => unknown }, 'readDocument')
    await expect(service.test(f.settings.connections[0])).rejects.toMatchObject({
      code: 'config',
      message: 'Turn on Show usage quota to test connections.',
    })
    expect(reads).not.toHaveBeenCalled()
    expect(hostRead).not.toHaveBeenCalled()
    service.setEnabled(true)
    await expect(service.test(f.settings.connections[0])).resolves.toBeUndefined()
    expect(reads).toHaveBeenCalledTimes(1)
  })
  it('aborts an in-flight adapter process read when the switch turns off and drops its late result', async () => {
    const f = fixture()
    const { service, read } = plugin(f)
    let finish: (v: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    read.mockImplementation(
      (_adapter, _config, _id, s) =>
        new Promise((resolve) => {
          signal = s
          finish = resolve
        }),
    )
    const pending = service.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(false)
    service.setEnabled(false)
    expect(signal?.aborted).toBe(true)
    finish(JSON.parse(readFileSync(f.input, 'utf8')))
    await pending
    const c = service.read().connections[0]
    expect(c.subscription).toBeNull()
    expect(c.error).toBeNull()
  })
  it('rejects a dangling symbolic link at a not-yet-existing input path', async () => {
    const f = fixture()
    const dangling = join(f.dir, 'dangling-input')
    symlinkSync(join(f.dir, 'missing-target'), dangling, 'junction')
    const settings = {
      ...f.settings,
      connections: [{ ...f.settings.connections[0], config: { path: dangling } }],
    }
    expect(() => f.service.saveSettings(settings)).toThrow('symbolic links')
    await expect(f.service.test(settings.connections[0])).rejects.toMatchObject({ code: 'config' })
  })
  it('does no collection without enabled connections', async () => {
    const f = fixture()
    f.service.setVisible(true)
    expect((await f.service.refresh()).connections).toEqual([])
  })
  it('keeps observation times through repeated reads, export and restart', async () => {
    const f = fixture()
    f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    await f.service.refresh()
    f.advance(65 * 60_000)
    await f.service.refresh()
    const first = f.service.read().connections[0].subscription?.metrics[0]
    if (!first) throw new Error('Expected accepted fixture metric')
    expect(first.observedAt).toBe('2026-10-20T12:00:00Z')
    expect(first.receivedAt).toBe('2026-10-20T13:05:00.000Z')
    const exported = JSON.parse(readFileSync(f.output, 'utf8'))
    expect(exported.subscriptions[0].metrics[0]).toEqual(first)
    expect(JSON.stringify(exported)).not.toContain('config')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().connections[0].subscription?.metrics[0].observedAt).toBe(
      first.observedAt,
    )
  })
  it('keeps last accepted metrics on malformed, older and age-unknown replacements', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.advance(5000)
    f.write(12, '2026-10-20T11:00:00Z')
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.advance(5000)
    f.write(13, null)
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.advance(5000)
    writeFileSync(f.input, '{')
    await f.service.refresh()
    expect(f.service.read().connections[0].error?.code).toBe('protocol')
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it('does not reset source cadence when pinning a metric', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.write(77)
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it('rejects input/output overlap and existing non-export files without changing settings', () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        export: { enabled: true, path: f.input, replaceExisting: true },
      }),
    ).toThrow('differ')
    writeFileSync(f.output, 'personal notes')
    expect(() =>
      f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } }),
    ).toThrow('already exists')
    expect(readFileSync(f.output, 'utf8')).toBe('personal notes')
    expect(f.service.getSettings().export.enabled).toBe(false)
  })
  it('requires an explicit replace decision even for an existing normalized input document', () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    writeFileSync(f.output, readFileSync(f.input))
    expect(() =>
      f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } }),
    ).toThrow('already exists')
  })
  it('invalidates cache and pin after account identity changes', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh()
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const s = f.service.getSettings()
    s.connections[0].label = 'Other account'
    f.service.saveSettings(s)
    expect(f.service.read().pin).toBeNull()
    expect(f.service.read().connections[0].subscription).toBeNull()
  })
  it('keeps sources single-flight and ignores obsolete results', async () => {
    const f = fixture(),
      dir = join(f.deps.userDataPath, 'usage-adapters', 'fixture')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'usage-adapter.json'),
      JSON.stringify({
        id: 'fixture',
        name: 'Fixture',
        protocolVersion: 1,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'cli',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: [],
      }),
    )
    let finish: (v: unknown) => void = () => {}
    const host = new UsageAdapterHost()
    const read = vi.spyOn(host, 'read').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const service = new UsageService({ ...f.deps, host })
    services.push(service)
    service.saveSettings({
      ...f.settings,
      connections: [{ ...f.settings.connections[0], adapterId: 'fixture', config: {} }],
    })
    const first = service.refresh(),
      second = service.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    service.saveSettings({ ...service.getSettings(), connections: [] })
    finish(JSON.parse(readFileSync(f.input, 'utf8')))
    await Promise.all([first, second])
    expect(service.read().connections).toEqual([])
  })
  it('blocks secret saving and use when encryption fails and never exposes stored values', async () => {
    const f = fixture(),
      dir = join(f.deps.userDataPath, 'usage-adapters', 'secret')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'usage-adapter.json'),
      JSON.stringify({
        id: 'secret',
        name: 'Secret fixture',
        protocolVersion: 1,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'api',
        capabilities: ['balance'],
        minimumRefreshSeconds: 60,
        configSchema: [{ key: 'key', label: 'API key', type: 'secret', required: true }],
      }),
    )
    const s = {
      ...f.settings,
      connections: [
        { ...f.settings.connections[0], adapterId: 'secret', config: { key: 'fixture-secret' } },
      ],
    }
    expect(() => f.service.saveSettings(s)).toThrow('encryption')
    expect([...f.state.keys()]).toEqual(['usage.enabled'])
    const service = new UsageService({
      ...f.deps,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (v: string) => Buffer.from(v),
        decryptString: (v: Buffer) => v.toString(),
      },
    })
    services.push(service)
    service.saveSettings(s)
    expect(service.getSettings().connections[0].config).toEqual({})
    expect(service.getSettings().connections[0].secretKeys).toEqual(['key'])
    // Renaming keeps the stored secret when the field is left blank.
    service.saveSettings({
      ...service.getSettings(),
      connections: [{ ...service.getSettings().connections[0], label: 'Renamed secret account' }],
    })
    expect(service.getSettings().connections[0].secretKeys).toEqual(['key'])
    expect(JSON.stringify(service.read())).not.toContain('fixture-secret')
    const host = new UsageAdapterHost()
    const read = vi.spyOn(host, 'read')
    const restarted = new UsageService({
      ...f.deps,
      host,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (v) => Buffer.from(v),
        decryptString: () => {
          throw new Error('fixture decryption failed')
        },
      },
    })
    services.push(restarted)
    await restarted.refresh()
    expect(restarted.read().connections[0].error?.code).toBe('config')
    expect(restarted.read().connections[0].error?.message).toContain('Cannot decrypt')
    expect(read).not.toHaveBeenCalled()
  })
})

describe('accounts settings flow (spec rules 21-28)', () => {
  function subscription(id: string, providerId: string, percent: number) {
    return {
      id,
      providerId,
      label: `Label ${id}`,
      sourceKind: 'file',
      status: 'available',
      metrics: [
        {
          id: 'week',
          label: '7d',
          kind: 'window',
          state: 'available',
          observedAt: '2026-10-20T12:00:00Z',
          usedPercent: percent,
          resetsAt: '2026-10-25T00:00:00Z',
        },
      ],
    }
  }
  function writeSubscriptions(path: string, subs: unknown[]) {
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, subscriptions: subs }))
  }
  function adapter(f: ReturnType<typeof fixture>, providerId?: string) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'declared')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'declared',
        name: 'Declared',
        ...(providerId ? { providerId } : {}),
        summary: 'Fixture service.',
        protocolVersion: 1,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'api',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: [],
      }),
    )
    const host = new UsageAdapterHost()
    const read = vi.spyOn(host, 'read')
    const service = new UsageService({ ...f.deps, host })
    services.push(service)
    return { service, read, host }
  }
  const account = (adapterId: string, providerId = '') => ({
    id: 'account',
    label: 'Fixture account',
    providerId,
    adapterId,
    enabled: true,
    config: {} as Record<string, string | boolean>,
  })

  it('assigns the declared provider id and ignores the one sent by the renderer', async () => {
    const f = fixture()
    const { service, read } = adapter(f, 'declared-provider')
    service.saveSettings({ ...f.settings, connections: [account('declared', 'typed')] })
    expect(service.getSettings().connections[0].providerId).toBe('declared-provider')
    read.mockResolvedValue({
      schemaVersion: 1,
      subscriptions: [subscription('account', 'other-provider', 10)],
    })
    service.setVisible(true)
    await service.refresh()
    expect(service.read().connections[0].error?.message).toContain('its provider')
    read.mockResolvedValue({
      schemaVersion: 1,
      subscriptions: [subscription('account', 'declared-provider', 10)],
    })
    await service.test(service.getSettings().connections[0])
  })
  it('uses the adapter id without a declared provider and accepts any reported provider', async () => {
    const f = fixture()
    const { service, read } = adapter(f)
    service.saveSettings({ ...f.settings, connections: [account('declared')] })
    expect(service.getSettings().connections[0].providerId).toBe('declared')
    read.mockResolvedValue({
      schemaVersion: 1,
      subscriptions: [subscription('account', 'reported', 20)],
    })
    service.setVisible(true)
    await service.refresh()
    const source = service.read().connections[0]
    expect(source.error).toBeNull()
    expect(source.subscription?.providerId).toBe('declared')
  })
  it('replaces a saved provider id that differs from the declared one', () => {
    const f = fixture()
    const { host } = adapter(f, 'declared-provider')
    f.state.set(
      USAGE_STATE_KEY,
      JSON.stringify({
        ...f.settings,
        connections: [account('declared', 'legacy')],
      }),
    )
    const legacy = new UsageService({ ...f.deps, host })
    services.push(legacy)
    expect(legacy.getSettings().connections[0].providerId).toBe('legacy')
    // Saving another account leaves the legacy one unchanged (criterion 15).
    const added = legacy.saveSettings({
      ...legacy.getSettings(),
      connections: [
        ...legacy.getSettings().connections,
        { ...account('declared', 'typed'), id: 'other', label: 'Other account' },
      ],
    })
    expect(added.connections.map((c) => c.providerId)).toEqual(['legacy', 'declared-provider'])
    // Editing the legacy account assigns the declared id.
    const edited = legacy.saveSettings({
      ...added,
      connections: added.connections.map((c) =>
        c.id === 'account' ? { ...c, label: 'Renamed account' } : c,
      ),
    })
    expect(edited.connections[0].providerId).toBe('declared-provider')
  })
  it('takes the provider id of a re-chosen file subscription whose provider changed', () => {
    const f = fixture()
    writeSubscriptions(f.input, [subscription('b', 'pb', 22)])
    const file = { ...account('usage-file', 'pb'), config: { path: f.input, subscriptionId: 'b' } }
    f.service.saveSettings({ ...f.settings, connections: [file] })
    writeSubscriptions(f.input, [subscription('b', 'pb2', 22)])
    const saved = f.service.saveSettings({
      ...f.service.getSettings(),
      connections: [{ ...file, providerId: 'pb2' }],
    })
    expect(saved.connections[0].providerId).toBe('pb2')
  })
  it('binds a JSON file account to the chosen subscription, ignores others and never rebinds', async () => {
    const f = fixture()
    writeSubscriptions(f.input, [subscription('a', 'pa', 11), subscription('b', 'pb', 22)])
    f.service.saveSettings({
      ...f.settings,
      connections: [
        { ...account('usage-file', 'pb'), config: { path: f.input, subscriptionId: 'b' } },
      ],
    })
    f.service.setVisible(true)
    await f.service.refresh()
    const source = f.service.read().connections[0]
    expect(source.error).toBeNull()
    expect(source.subscription).toMatchObject({ id: 'account', providerId: 'pb' })
    expect(source.subscription?.metrics[0].usedPercent).toBe(22)
    writeSubscriptions(f.input, [subscription('a', 'pa', 33)])
    f.advance(6000)
    await f.service.refresh()
    const missing = f.service.read().connections[0]
    expect(missing.error).toMatchObject({ code: 'io' })
    expect(missing.error?.message).toContain('has no subscription "b"')
    expect(missing.subscription?.metrics[0].usedPercent).toBe(22)
  })
  it('rejects two accounts bound to one file subscription and a file account without a provider', () => {
    const f = fixture()
    writeSubscriptions(f.input, [subscription('a', 'pa', 11)])
    const one = { ...account('usage-file', 'pa'), config: { path: f.input, subscriptionId: 'a' } }
    expect(() =>
      f.service.saveSettings({
        ...f.settings,
        connections: [one, { ...one, id: 'second', label: 'Second' }],
      }),
    ).toThrow('already tracked by the account "Fixture account"')
    expect(() =>
      f.service.saveSettings({ ...f.settings, connections: [{ ...one, providerId: '' }] }),
    ).toThrow('Choose the JSON file again')
    expect(f.state.get(USAGE_STATE_KEY)).toBeUndefined()
  })
  it('inspects a JSON file only while the switch is on', () => {
    const f = fixture()
    writeSubscriptions(f.input, [subscription('a', 'pa', 11), subscription('b', 'pb', 22)])
    expect(f.service.inspectFile(f.input)).toEqual([
      { id: 'a', providerId: 'pa', label: 'Label a' },
      { id: 'b', providerId: 'pb', label: 'Label b' },
    ])
    expect(() => f.service.inspectFile(join(f.dir, 'missing.json'))).toThrow(
      'Usage file does not exist',
    )
    f.service.setEnabled(false)
    expect(() => f.service.inspectFile(f.input)).toThrow('Turn on Show usage quota')
  })
  it('proposes a Claude directory and setup command and creates the directory on save', () => {
    const f = fixture()
    const script = join(f.dir, 'resources', 'setup.cjs')
    const service = new UsageService({
      ...f.deps,
      claudeSetupScript: script,
      homeDirectory: join(f.dir, 'home'),
    })
    services.push(service)
    const proposed = join(f.deps.userDataPath, 'claude-code-usage', 'account-1')
    const setup = service.claudeSetup('account-1', null)
    expect(setup.directory).toBe(proposed)
    expect(service.claudeSetup('account-1', proposed).directory).toBe(proposed)
    expect(setup.command).toBe(
      `node "${script}" --settings "${join(f.dir, 'home', '.claude', 'settings.json')}" --dir "${proposed}"`,
    )
    expect(() => service.claudeSetup('../escape', null)).toThrow('cannot name a Claude directory')
    expect(() => service.claudeSetup('account-1', join(f.dir, '$x'))).toThrow('cannot contain')
    expect(() => service.claudeSetup('account-1', join(f.dir, 'x\u201D ; calc ; \u201Cy'))).toThrow(
      'cannot contain',
    )
    expect(() => f.service.claudeSetup('account-1', null)).toThrow('writer is missing')
    expect(existsSync(proposed)).toBe(false)
    const claude = { ...account('claude-code-snapshots'), id: 'account-1' }
    service.saveSettings({
      ...f.settings,
      connections: [{ ...claude, config: { directory: proposed } }],
    })
    expect(existsSync(proposed)).toBe(true)
    expect(service.getSettings().connections[0].providerId).toBe('claude')
    mkdirSync(join(f.dir, 'elsewhere'))
    const other = join(f.dir, 'elsewhere', 'claude')
    service.saveSettings({
      ...f.settings,
      connections: [{ ...claude, config: { directory: other } }],
    })
    expect(existsSync(other)).toBe(false)
  })
  it('creates and opens the user adapters folder', async () => {
    const f = fixture()
    const openPath = vi.fn(async (_path: string) => '')
    const service = new UsageService({ ...f.deps, openPath })
    services.push(service)
    const folder = join(f.deps.userDataPath, 'usage-adapters')
    await service.openAdaptersFolder()
    expect(existsSync(folder)).toBe(true)
    expect(openPath).toHaveBeenCalledExactlyOnceWith(folder)
    openPath.mockResolvedValueOnce('Access denied')
    await expect(service.openAdaptersFolder()).rejects.toMatchObject({ code: 'io' })
    await expect(f.service.openAdaptersFolder()).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('pinning a metric of an external adapter (NEKODE-120)', () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (v: Buffer) => v.toString(),
  }
  // Mirrors the Personal Data Hub manifest: the secret is declared between two text fields.
  function hub(f: ReturnType<typeof fixture>, keys = ['hubUrl', 'token', 'agents']) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'hub')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'hub',
        name: 'Hub',
        providerId: 'hub',
        protocolVersion: 1,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'api',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: keys.map((key) => ({
          key,
          label: key,
          type: key === 'token' ? 'secret' : 'text',
          required: key !== 'agents',
        })),
      }),
    )
    const host = new UsageAdapterHost()
    vi.spyOn(host, 'read').mockResolvedValue({
      schemaVersion: 1,
      subscriptions: [
        {
          id: 'hub-account',
          providerId: 'hub',
          label: 'Hub',
          sourceKind: 'api',
          status: 'available',
          metrics: ['claude-5h', 'codex-weekly'].map((id) => ({
            id,
            label: id,
            providerId: id.split('-')[0],
            kind: 'window',
            state: 'available',
            observedAt: '2026-10-20T12:00:00Z',
            usedPercent: 30,
            resetsAt: '2026-10-25T00:00:00Z',
          })),
        },
      ],
    })
    const service = new UsageService({ ...f.deps, host, safeStorage })
    services.push(service)
    return { service, host }
  }
  const pin = { connectionId: 'hub-account', metricId: 'codex-weekly' }
  const connection = (config: Record<string, string | boolean>) => ({
    id: 'hub-account',
    label: 'PDH',
    providerId: '',
    adapterId: 'hub',
    enabled: true,
    config,
  })

  it('keeps the pin through the toolbar settings roundtrip, refresh, and restart', async () => {
    const f = fixture()
    const { service, host } = hub(f)
    service.saveSettings({
      ...f.settings,
      connections: [connection({ hubUrl: 'https://hub.test', token: 't', agents: '' })],
    })
    await service.refresh()
    // UsageToolbar.pin(): getSettings, then saveSettings with the pin.
    service.saveSettings({ ...service.getSettings(), pin })
    expect(service.read().pin).toEqual(pin)
    expect(service.read().connections[0].subscription?.metrics).toHaveLength(2)
    await service.refresh()
    expect(service.read().pin).toEqual(pin)
    const restarted = new UsageService({ ...f.deps, host, safeStorage })
    services.push(restarted)
    expect(restarted.read().pin).toEqual(pin)
    await restarted.refresh()
    expect(restarted.read().pin).toEqual(pin)
  })
  it('pins an account saved under an older adapter manifest that declared other fields', async () => {
    const f = fixture()
    const old = hub(f, ['token', 'hubUrl', 'agent'])
    old.service.saveSettings({
      ...f.settings,
      connections: [connection({ token: 't', hubUrl: 'https://hub.test', agent: 'agy' })],
    })
    const { service } = hub(f)
    await service.refresh()
    service.saveSettings({ ...service.getSettings(), pin })
    expect(service.read().pin).toEqual(pin)
    expect(service.getSettings().connections[0].config).toEqual({ hubUrl: 'https://hub.test' })
    const added = service.getSettings()
    added.connections[0].config.region = 'eu'
    expect(() => service.saveSettings(added)).toThrow('field "region"')
  })
  it('reports why a requested pin is refused and keeps the current pin', async () => {
    const f = fixture()
    const { service } = hub(f)
    service.saveSettings({
      ...f.settings,
      connections: [connection({ hubUrl: 'https://hub.test', token: 't' })],
    })
    expect(() =>
      service.saveSettings({ ...service.getSettings(), pin: { ...pin, metricId: 'claude-5h' } }),
    ).toThrow('reports no value for it')
    await service.refresh()
    service.saveSettings({ ...service.getSettings(), pin })
    expect(() =>
      service.saveSettings({ ...service.getSettings(), pin: { ...pin, metricId: 'grok-weekly' } }),
    ).toThrow('reports no value for it')
    expect(service.read().pin).toEqual(pin)
  })
})
