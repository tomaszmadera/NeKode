import {
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
import type { UsageSettings } from '../../../shared/usage-contract'
import { UsageAdapterHost } from './adapter-host'
import { UsageService } from './usage-service'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const roots: string[] = [],
  services: UsageService[] = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-test-'))
  roots.push(dir)
  const state = new Map<string, string>()
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
    adaptersDirectory: null,
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
  const directory = join(f.dir, 'adapters', 'fixture')
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
    adaptersDirectory: join(f.dir, 'adapters'),
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
      dir = join(f.dir, 'adapters', 'fixture')
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
      adaptersDirectory: join(f.dir, 'adapters'),
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
      dir = join(f.dir, 'adapters', 'secret')
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
      adaptersDirectory: join(f.dir, 'adapters'),
      connections: [
        { ...f.settings.connections[0], adapterId: 'secret', config: { key: 'fixture-secret' } },
      ],
    }
    expect(() => f.service.saveSettings(s)).toThrow('encryption')
    expect(f.state.size).toBe(0)
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
