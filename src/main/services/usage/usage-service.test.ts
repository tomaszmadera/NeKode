import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  USAGE_REMOVED_ADAPTER_MESSAGE,
  USAGE_STATE_KEY,
  type UsageRefreshResult,
  type UsageRefreshSourceResult,
  type UsageRefreshWindowResult,
  type UsageReportDocument,
  type UsageSettings,
} from '@shared/contracts/usage-contract'
import { AppError } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bundledUsageAdapterDirectories,
  UsageAdapterHost,
  type UsageAdapterResult,
} from './adapter-host'
import { UsageService } from './usage-service'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const adapterResult = (
  document: unknown,
  refresh: UsageRefreshResult | null = null,
): UsageAdapterResult => {
  const value = document as UsageReportDocument
  Object.defineProperty(value, 'refresh', { value: refresh, enumerable: false, configurable: true })
  return value as UsageAdapterResult
}
const refreshWindow = (
  metricId: string,
  status: UsageRefreshWindowResult['status'] = 'succeeded',
  patch: Partial<UsageRefreshWindowResult> = {},
): UsageRefreshWindowResult => ({ metricId, status, ...patch })
const refreshSource = (
  sourceId: string,
  status: UsageRefreshSourceResult['status'],
  windows: UsageRefreshWindowResult[],
  patch: Partial<UsageRefreshSourceResult> = {},
): UsageRefreshSourceResult => ({ sourceId, status, windows, ...patch })
const refreshResult = (
  sources: UsageRefreshResult['sources'],
  patch: Partial<UsageRefreshResult> = {},
): UsageRefreshResult => ({
  status: 'partial',
  requestId: 'request-1',
  measurementId: 'measurement-1',
  reportId: 'report-1',
  sources,
  ...patch,
})
const roots: string[] = [],
  services: UsageService[] = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-test-'))
  roots.push(dir)
  const state = new Map<string, string>([['usage.enabled', 'true']])
  let now = NOW
  // The default source: a user adapter whose (mocked) process returns the input file (spec L1).
  const source = join(dir, 'profile', 'usage-adapters', 'source')
  mkdirSync(source, { recursive: true })
  writeFileSync(
    join(source, 'usage-adapter.json'),
    JSON.stringify({
      id: 'source',
      name: 'Source',
      serviceId: 'fixture',
      protocolVersion: 3,
      invocation: { command: 'node', args: ['fixture.cjs'] },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds: 60,
      configSchema: [{ key: 'path', label: 'Input file', type: 'file', required: true }],
    }),
  )
  const host = new UsageAdapterHost()
  const hostRead = vi.spyOn(host, 'read').mockImplementation(async (_adapter, config) => {
    let text: string
    try {
      text = readFileSync(config.path as string, 'utf8')
    } catch {
      throw new AppError('io', 'Fixture input is missing.')
    }
    try {
      return adapterResult(JSON.parse(text))
    } catch {
      throw new AppError('protocol', 'Usage adapter must return one valid JSON response.')
    }
  })
  const deps = {
    userDataPath: join(dir, 'profile'),
    host,
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
        schemaVersion: 2,
        reports: [
          {
            id: 'account',
            serviceId: 'fixture',
            label: 'Producer label',
            sourceKind: 'file',
            status: 'available',
            subscriptions: [{ id: 'fixture-plan', label: 'Fixture plan' }],
            metrics: [
              {
                id: 'week',
                label: 'Fixture plan 7d',
                subscriptionId: 'fixture-plan',
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
        serviceId: 'fixture',
        adapterId: 'source',
        enabled: true,
        config: { path: input },
      },
    ],
    pin: null,
    export: { enabled: false, path: null },
  }
  /** The input document with every observation at the current clock (a live provider read). */
  const live = (percent = 42) => {
    const document = JSON.parse(readFileSync(input, 'utf8'))
    for (const metric of document.reports[0].metrics) {
      metric.observedAt = new Date(now).toISOString()
      metric.usedPercent = percent
    }
    return document
  }
  return {
    dir,
    state,
    deps,
    hostRead,
    live,
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
      protocolVersion: 3,
      invocation: { command: 'node', args: ['fixture.cjs'] },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds,
      configSchema: [],
    }),
  )
  const host = new UsageAdapterHost()
  const read = vi.spyOn(host, 'read').mockImplementation(async () => adapterResult(f.live()))
  const service = new UsageService({ ...f.deps, host })
  services.push(service)
  service.saveSettings({
    ...f.settings,
    connections: [{ ...f.settings.connections[0], adapterId: 'fixture', config: {} }],
  })
  return { service, read }
}
/** One scheduled poll (spec rule 12): the visible service collects every due source. */
async function poll(service: UsageService) {
  service.setVisible(true)
  await new Promise((resolve) => setImmediate(resolve))
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
    await f.service.refresh({ connectionId: 'account' })
    f.state.delete('usage.connection-revisions')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().connections[0].subscription).toBeNull()
    await restarted.refresh({ connectionId: 'account' })
    const next = new UsageService(f.deps)
    services.push(next)
    expect(next.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  // A label-only save keeps the cache identity (spec rule 2); see the rename test below.
  it('rejects old-account cache after a durable config change even when cache invalidation fails', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const cache = join(f.dir, 'profile', 'usage', 'observations.json')
    const retained = join(f.dir, 'retained-cache.json')
    renameSync(cache, retained)
    mkdirSync(cache)
    const next = f.service.getSettings()
    const other = join(f.dir, 'other-account.json')
    writeFileSync(other, readFileSync(f.input))
    next.connections[0].config.path = other
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
  it.each(['protocol', 'validation_error'] as const)(
    'keeps the scheduled 60/120/240/300-second backoff for %s failures',
    async (code) => {
      const f = fixture(),
        { service, read } = plugin(f)
      read.mockRejectedValue(new AppError(code, 'Fixture failure'))
      await poll(service)
      expect(service.read().connections[0].error?.code).toBe(code)
      for (const delay of [60, 120, 240, 300, 300]) {
        const calls = read.mock.calls.length
        f.advance(delay * 1000 - 1)
        await poll(service)
        expect(read).toHaveBeenCalledTimes(calls)
        f.advance(1)
        await poll(service)
        expect(read).toHaveBeenCalledTimes(calls + 1)
      }
    },
  )
  it('resets scheduled backoff after a success between failures', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const document = JSON.parse(readFileSync(f.input, 'utf8'))
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await poll(service)
    f.advance(60_000)
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await poll(service)
    f.advance(120_000)
    read.mockResolvedValueOnce(adapterResult(document))
    await poll(service)
    expect(service.read().connections[0].error).toBeNull()
    f.advance(60_000)
    read.mockRejectedValueOnce(new AppError('network', 'Fixture failure'))
    await poll(service)
    expect(service.read().connections[0].error?.code).toBe('network')
    const calls = read.mock.calls.length
    read.mockResolvedValue(adapterResult(document))
    f.advance(59_999)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(calls)
    f.advance(1)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(calls + 1)
    expect(service.read().connections[0].error).toBeNull()
  })
  it('ignores the cache after a corrupt connection-revisions store and rebuilds it on refresh', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    f.state.set('usage.connection-revisions', '{corrupt')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().cacheError).toContain('cache identity')
    expect(restarted.read().connections[0].subscription).toBeNull()
    expect(restarted.getSettings().connections[0].id).toBe('account')
    await restarted.refresh({ connectionId: 'account' })
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
    await f.service.refresh({ connectionId: 'account' })
    expect(readFileSync(unowned, 'utf8')).toBe('unowned fixture file')
    // The atomic write names its own temp file `<path>.<uuid>.tmp`; a leaked one
    // would show up here even though the unowned sibling above is never touched.
    const residue = readdirSync(f.dir).filter(
      (name) => name.startsWith('export.json.') && name.endsWith('.tmp'),
    )
    expect(residue).toEqual([`export.json.${process.pid}.tmp`])
  })
  it('reports manual interval skips and reads again at the exact 60-second deadline', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 90)
    expect(service.read().connections[0].nextRefreshAt).toBeNull()
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: ['account'],
      skipped: [],
    })
    const until = new Date(NOW + 60_000).toISOString()
    expect(service.read().connections[0].nextRefreshAt).toBe(until)
    f.advance(59_999)
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: [],
      skipped: [{ connectionId: 'account', until, reason: 'interval' }],
    })
    expect(read).toHaveBeenCalledTimes(1)
    expect(service.read()).not.toHaveProperty('refresh')
    f.advance(1)
    expect(service.read().connections[0].nextRefreshAt).toBeNull()
    expect((await service.refresh({ connectionId: 'account' })).refresh?.read).toEqual(['account'])
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('reports a provider retry deadline as backoff, then the 60-second interval', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockRejectedValue(
      Object.assign(new AppError('rate_limited', 'Fixture deadline'), { retryAfterSeconds: 600 }),
    )
    await service.refresh({ connectionId: 'account' })
    const until = new Date(NOW + 600_000).toISOString()
    expect(service.read().connections[0].nextRefreshAt).toBe(until)
    expect((await service.refresh({ connectionId: 'account' })).refresh?.skipped).toEqual([
      { connectionId: 'account', until, reason: 'backoff' },
    ])
    expect(read).toHaveBeenCalledTimes(1)
    f.advance(600_000)
    read.mockImplementation(async () => adapterResult(f.live()))
    expect((await service.refresh({ connectionId: 'account' })).refresh?.read).toEqual(['account'])
    expect(service.read().connections[0].error).toBeNull()
    expect((await service.refresh({ connectionId: 'account' })).refresh?.skipped[0].reason).toBe(
      'interval',
    )
  })
  it('refreshes one account while another stays inside its 60-second limit (A6)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    await service.refresh({ connectionId: 'account' })
    f.advance(5000)
    service.saveSettings({
      ...service.getSettings(),
      connections: [
        ...service.getSettings().connections,
        { ...f.settings.connections[0], id: 'second', adapterId: 'fixture', config: {} },
      ],
    })
    read.mockImplementation(async (_adapter, _config, id) => {
      const document = f.live()
      document.reports[0].id = id
      return adapterResult(document)
    })
    expect((await service.refresh({ connectionId: 'second' })).refresh).toEqual({
      read: ['second'],
      skipped: [],
    })
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: [],
      skipped: [
        {
          connectionId: 'account',
          until: new Date(NOW + 60_000).toISOString(),
          reason: 'interval',
        },
      ],
    })
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('keeps manual deadlines across a label or enabled save and resets them on a config change (L5)', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    f.advance(5000)
    const account = () => f.service.getSettings().connections[0]
    const save = (change: Partial<UsageSettings['connections'][number]>) =>
      f.service.saveSettings({
        ...f.service.getSettings(),
        connections: [{ ...account(), config: { path: f.input }, ...change }],
      })
    const interval = new Date(NOW + 60_000).toISOString()
    save({ label: 'Renamed account' })
    expect(f.service.read().connections[0].nextRefreshAt).toBe(interval)
    expect((await f.service.refresh({ connectionId: 'account' })).refresh?.skipped).toEqual([
      { connectionId: 'account', until: interval, reason: 'interval' },
    ])
    save({ enabled: false })
    save({ enabled: true })
    expect((await f.service.refresh({ connectionId: 'account' })).refresh?.skipped).toEqual([
      { connectionId: 'account', until: interval, reason: 'interval' },
    ])
    expect(f.hostRead).toHaveBeenCalledTimes(1)
    // A provider retry deadline survives a label save too.
    f.advance(55_000)
    f.hostRead.mockRejectedValueOnce(
      Object.assign(new AppError('rate_limited', 'Fixture deadline'), { retryAfterSeconds: 600 }),
    )
    await f.service.refresh({ connectionId: 'account' })
    const backoff = new Date(NOW + 60_000 + 600_000).toISOString()
    save({ label: 'Renamed again' })
    expect((await f.service.refresh({ connectionId: 'account' })).refresh?.skipped).toEqual([
      { connectionId: 'account', until: backoff, reason: 'backoff' },
    ])
    // A changed configuration is a new source: both deadlines reset.
    const other = join(f.dir, 'other-input.json')
    writeFileSync(other, readFileSync(f.input))
    save({ config: { path: other } })
    expect(f.service.read().connections[0].nextRefreshAt).toBeNull()
    expect((await f.service.refresh({ connectionId: 'account' })).refresh?.read).toEqual([
      'account',
    ])
    expect(f.hostRead).toHaveBeenCalledTimes(3)
  })
  it('keeps scheduled deadlines across a visible label or enabled save and resets them on a source change (L5)', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 120)
    const settle = () => new Promise((resolve) => setImmediate(resolve))
    const save = (change: Partial<UsageSettings['connections'][number]>) =>
      service.saveSettings({
        ...service.getSettings(),
        connections: [{ ...service.getSettings().connections[0], config: {}, ...change }],
      })
    const saves = async () => {
      save({ label: `Renamed ${read.mock.calls.length}` })
      await settle()
      save({ enabled: false })
      save({ enabled: true })
      await settle()
    }
    await poll(service)
    expect(read).toHaveBeenCalledTimes(1)
    // Past the 60-second manual limit, inside the adapter's 120-second scheduled interval.
    f.advance(90_000)
    await saves()
    expect(read).toHaveBeenCalledTimes(1)
    f.advance(30_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    // A pending provider retry deadline survives the same saves.
    read.mockRejectedValueOnce(
      Object.assign(new AppError('rate_limited', 'Fixture deadline'), { retryAfterSeconds: 600 }),
    )
    f.advance(120_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(3)
    f.advance(300_000)
    await saves()
    expect(read).toHaveBeenCalledTimes(3)
    expect((await service.refresh({ connectionId: 'account' })).refresh?.skipped[0]?.reason).toBe(
      'backoff',
    )
    f.advance(300_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(4)
    // A changed source resets every deadline and reads at once (rule 23: replace the account).
    f.advance(10_000)
    service.saveSettings({
      ...service.getSettings(),
      connections: [
        {
          id: 'replaced-account',
          label: 'Replaced account',
          serviceId: 'fixture',
          adapterId: 'source',
          enabled: true,
          config: { path: f.input },
        },
      ],
    })
    await settle()
    expect(read).toHaveBeenCalledTimes(5)
  })
  it('keeps the subscription, cache, pin and an in-flight read across a rename (rules 2 and 9)', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 300)
    const settle = () => new Promise((resolve) => setImmediate(resolve))
    const rename = (label: string) =>
      service.saveSettings({
        ...service.getSettings(),
        connections: [{ ...service.getSettings().connections[0], config: {}, label }],
      })
    await poll(service)
    service.saveSettings({
      ...service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    f.advance(90_000)
    rename('Renamed account')
    await settle()
    const snapshot = service.read()
    expect(snapshot.pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(snapshot.connections[0].subscription?.label).toBe('Renamed account')
    expect(snapshot.connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    expect(read).toHaveBeenCalledTimes(1)
    // The cache entry keeps its identity, so a restart shows the values under the new label.
    const restarted = new UsageService({ ...f.deps, host: new UsageAdapterHost() })
    services.push(restarted)
    expect(restarted.read().connections[0].subscription?.label).toBe('Renamed account')
    expect(restarted.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    // A rename while a read is in flight keeps that read and shows its result under the new label.
    f.advance(300_000)
    let finish: (value: UsageAdapterResult) => void = () => {}
    read.mockImplementationOnce(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = resolve
        }),
    )
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    rename('Renamed in flight')
    expect(service.read().connections[0].refreshing).toBe(true)
    finish(adapterResult(f.live(50)))
    await settle()
    const after = service.read().connections[0]
    expect(after.refreshing).toBe(false)
    expect(after.subscription?.label).toBe('Renamed in flight')
    expect(after.subscription?.metrics[0].usedPercent).toBe(50)
    expect(service.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('does not delay the next read after disable and re-enable abort an in-flight read (L5)', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 120)
    const settle = () => new Promise((resolve) => setImmediate(resolve))
    const save = (enabled: boolean) =>
      service.saveSettings({
        ...service.getSettings(),
        connections: [{ ...service.getSettings().connections[0], config: {}, enabled }],
      })
    await poll(service)
    f.advance(120_000)
    read.mockImplementationOnce(() => new Promise(() => {}))
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    save(false)
    save(true)
    await settle()
    // The aborted read never completed, so neither its interval nor its 60-second limit applies.
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('starts one refresh for clicks during an automatic read and reports both as read', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let finish: (value: UsageAdapterResult) => void = () => {}
    read.mockImplementationOnce(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = resolve
        }),
    )
    service.setVisible(true)
    const first = service.refresh({ connectionId: 'account' }),
      second = service.refresh({ connectionId: 'account' })
    expect(read).toHaveBeenCalledTimes(1)
    finish(adapterResult(f.live()))
    for (const result of await Promise.all([first, second]))
      expect(result.refresh).toEqual({ read: ['account'], skipped: [] })
    expect(read.mock.calls.map((call) => call[4])).toEqual(['read', 'refresh'])
  })
  it('keeps the completed read outcome when a cached metric is pinned during refresh', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    await service.refresh({ connectionId: 'account' })
    f.advance(60_000)
    let finish: (value: UsageAdapterResult) => void = () => {}
    read.mockImplementation(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = resolve
        }),
    )
    const pending = service.refresh({ connectionId: 'account' })
    service.saveSettings({
      ...service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    finish(adapterResult(f.live()))
    const result = await pending
    expect(result.refresh).toEqual({ read: ['account'], skipped: [] })
    expect(result.pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('pauses hidden polling and polls once when visible with the adapter minimum cadence', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 90)
    expect(read).not.toHaveBeenCalled()
    await poll(service)
    expect(read).toHaveBeenCalledTimes(1)
    service.setVisible(false)
    f.advance(90_000)
    expect(read).toHaveBeenCalledTimes(1)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(89_999)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(1)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('polls with exponential network backoff, rate-limit deadlines and auth suspension', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockRejectedValue(new AppError('network', 'Fixture network failure'))
    await poll(service)
    for (const delay of [60, 120, 240, 300]) {
      const calls = read.mock.calls.length
      f.advance(delay * 1000 - 1)
      await poll(service)
      expect(read).toHaveBeenCalledTimes(calls)
      f.advance(1)
      await poll(service)
      expect(read).toHaveBeenCalledTimes(calls + 1)
    }
    read.mockRejectedValue(
      Object.assign(new AppError('rate_limited', 'Fixture deadline'), { retryAfterSeconds: 600 }),
    )
    f.advance(300_000)
    await poll(service)
    const calls = read.mock.calls.length
    f.advance(599_999)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(calls)
    read.mockRejectedValue(new AppError('auth', 'Fixture auth'))
    f.advance(1)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(calls + 1)
    f.advance(3_600_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(calls + 1)
  })
  it('keeps automatic reads, the pin and other accounts working after a failed manual refresh (NEKODE-147)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let refreshFails = true
    read.mockImplementation(async (_adapter, _config, id, _signal, action) => {
      if (id === 'account' && action === 'refresh' && refreshFails)
        throw new AppError(
          'config',
          'Personal Data Hub has no quota source for subscription "claude".',
        )
      const document = f.live(action === 'refresh' ? 50 : 42 + read.mock.calls.length)
      document.reports[0].id = id
      return adapterResult(document)
    })
    service.saveSettings({
      ...service.getSettings(),
      connections: [
        ...service.getSettings().connections,
        { ...f.settings.connections[0], id: 'other', adapterId: 'fixture', config: {} },
      ],
    })
    await poll(service)
    service.saveSettings({
      ...service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const connection = (id: string) =>
      service.read().connections.find((c) => c.connection.id === id)
    f.advance(60_000)
    await service.refresh({ connectionId: 'account' })
    expect(connection('account')?.error?.code).toBe('config')
    expect(connection('other')?.error).toBeNull()
    const automatic = () =>
      read.mock.calls.filter(([, , id, , action]) => id === 'account' && action === 'read').length
    const before = automatic()
    f.advance(60_000)
    await poll(service)
    expect(automatic()).toBe(before + 1)
    expect(connection('account')?.subscription?.metrics[0].receivedAt).toBe(
      new Date(NOW + 120_000).toISOString(),
    )
    // The account keeps showing the refresh failure until a manual refresh succeeds.
    expect(connection('account')?.error?.code).toBe('config')
    expect(service.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    await service.refresh({ connectionId: 'account' })
    expect(
      read.mock.calls.filter(([, , id, , action]) => id === 'account' && action === 'refresh'),
    ).toHaveLength(2)
    expect(connection('account')?.error?.code).toBe('config')
    f.advance(60_000)
    await poll(service)
    expect(automatic()).toBe(before + 2)
    refreshFails = false
    await service.refresh({ connectionId: 'account' })
    expect(connection('account')?.error).toBeNull()
    expect(connection('account')?.subscription?.metrics[0].usedPercent).toBe(50)
  })
  it('keeps a manual refresh retry deadline across a successful automatic read (NEKODE-147)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockImplementation(async (_adapter, _config, _id, _signal, action) => {
      if (action === 'refresh')
        throw Object.assign(new AppError('rate_limited', 'Fixture deadline'), {
          retryAfterSeconds: 600,
        })
      return adapterResult(f.live())
    })
    await service.refresh({ connectionId: 'account' })
    f.advance(60_000)
    await poll(service)
    expect(read.mock.calls.map((call) => call[4])).toEqual(['refresh', 'read'])
    expect(service.read().connections[0].error?.code).toBe('rate_limited')
    f.advance(60_000)
    expect((await service.refresh({ connectionId: 'account' })).refresh?.skipped).toEqual([
      {
        connectionId: 'account',
        until: new Date(NOW + 600_000).toISOString(),
        reason: 'backoff',
      },
    ])
  })
  it('accepts a healthy source while another source is pending, then isolates its failure', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let rejectRead: (reason: Error) => void = () => {}
    read.mockImplementation((_adapter, _config, id) => {
      if (id !== 'healthy')
        return new Promise((_, reject) => {
          rejectRead = reject
        })
      const document = f.live()
      document.reports[0].id = 'healthy'
      return Promise.resolve(adapterResult(document))
    })
    const original = service.getSettings()
    service.saveSettings({
      ...original,
      connections: [
        ...original.connections,
        { ...f.settings.connections[0], id: 'healthy', adapterId: 'fixture', config: {} },
      ],
    })
    const pending = service.refresh({ connectionId: 'account' })
    await service.refresh({ connectionId: 'healthy' })
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
    await f.service.refresh({ connectionId: 'account' })
    const previous = readFileSync(output, 'utf8')
    renameSync(directory, join(f.dir, 'retained-exports'))
    f.advance(60_000)
    f.write(75, '2026-10-20T12:01:00Z')
    await f.service.refresh({ connectionId: 'account' })
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(75)
    expect(f.service.read().exportError).toContain('previous file is retained')
    expect(readFileSync(join(f.dir, 'retained-exports', 'usage.json'), 'utf8')).toBe(previous)
  })
  it('reports cache failure independently and clears a removed pin persistently', async () => {
    const f = fixture()
    mkdirSync(join(f.dir, 'profile'), { recursive: true })
    writeFileSync(join(f.dir, 'profile', 'usage'), 'blocked cache directory')
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    expect(f.service.read().cacheError).toContain('Cannot write usage cache')
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.service.saveSettings({ ...f.settings, pin: { connectionId: 'account', metricId: 'week' } })
    f.advance(60_000)
    const document = JSON.parse(readFileSync(f.input, 'utf8'))
    document.reports[0].metrics = []
    writeFileSync(f.input, JSON.stringify(document))
    await f.service.refresh({ connectionId: 'account' })
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
    const reads = f.hostRead
    service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    service.setVisible(true)
    f.advance(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await service.refresh({ connectionId: 'account' })
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
    await service.refresh({ connectionId: 'account' })
    expect(reads).toHaveBeenCalledTimes(1)
    expect(readFileSync(f.output, 'utf8')).toBe(exported)
    expect(service.getSettings().connections).toHaveLength(1)
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })
  it('refuses a connection test while the switch is off without reading files or processes', async () => {
    const f = fixture()
    f.state.set('usage.enabled', 'false')
    const service = new UsageService(f.deps)
    services.push(service)
    await expect(service.test(f.settings.connections[0])).rejects.toMatchObject({
      code: 'config',
      message: 'Turn on Show usage quota to test sources.',
    })
    expect(f.hostRead).not.toHaveBeenCalled()
    service.setEnabled(true)
    await expect(service.test(f.settings.connections[0])).resolves.toBeUndefined()
    expect(f.hostRead).toHaveBeenCalledTimes(1)
    // A connection test is not a manual refresh (spec L2).
    expect(f.hostRead.mock.calls[0][4]).toBe('read')
  })
  it('aborts an in-flight adapter process read when the switch turns off and drops its late result', async () => {
    const f = fixture()
    const { service, read } = plugin(f)
    let finish: (v: UsageAdapterResult) => void = () => {}
    let signal: AbortSignal | undefined
    read.mockImplementation(
      (_adapter, _config, _id, s) =>
        new Promise<UsageAdapterResult>((resolve) => {
          signal = s
          finish = resolve
        }),
    )
    const pending = service.refresh({ connectionId: 'account' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(false)
    service.setEnabled(false)
    expect(signal?.aborted).toBe(true)
    finish(adapterResult(JSON.parse(readFileSync(f.input, 'utf8'))))
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
  it('keeps observation times through repeated reads, export and restart', async () => {
    const f = fixture()
    f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    await f.service.refresh({ connectionId: 'account' })
    f.advance(65 * 60_000)
    // A scheduled read may report an unchanged observation (spec L2).
    await poll(f.service)
    const first = f.service.read().connections[0].subscription?.metrics[0]
    if (!first) throw new Error('Expected accepted fixture metric')
    expect(first.observedAt).toBe('2026-10-20T12:00:00Z')
    expect(first.receivedAt).toBe('2026-10-20T13:05:00.000Z')
    const exported = JSON.parse(readFileSync(f.output, 'utf8'))
    // U9: the export writes schema 2 with reports, serviceId and subscription ids only.
    expect(exported).toMatchObject({
      schemaVersion: 2,
      reports: [
        {
          serviceId: 'fixture',
          subscriptions: [{ id: 'fixture-plan', label: 'Fixture plan' }],
          metrics: [{ subscriptionId: 'fixture-plan' }],
        },
      ],
    })
    expect(JSON.stringify(exported)).not.toMatch(
      /providerId|"agent|"subscriptions":\[\{"id":"account"/,
    )
    expect(exported.reports[0].metrics[0]).toMatchObject(first)
    expect(JSON.stringify(exported)).not.toContain('config')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().connections[0].subscription?.metrics[0].observedAt).toBe(
      first.observedAt,
    )
  })
  it('keeps last accepted metrics on malformed, older and age-unknown scheduled replacements', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await poll(f.service)
    f.advance(60_000)
    f.write(12, '2026-10-20T11:00:00Z')
    await poll(f.service)
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.advance(60_000)
    f.write(13, null)
    await poll(f.service)
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    f.advance(120_000)
    writeFileSync(f.input, '{')
    await poll(f.service)
    expect(f.service.read().connections[0].error?.code).toBe('protocol')
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
  it('invalidates cache and pin after account identity changes', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const s = f.service.getSettings()
    const other = join(f.dir, 'other-account.json')
    writeFileSync(other, readFileSync(f.input))
    s.connections[0].config.path = other
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
        protocolVersion: 3,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'cli',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: [],
      }),
    )
    let finish: (v: UsageAdapterResult) => void = () => {}
    const host = new UsageAdapterHost()
    const read = vi.spyOn(host, 'read').mockImplementation(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = resolve
        }),
    )
    const service = new UsageService({ ...f.deps, host })
    services.push(service)
    service.saveSettings({
      ...f.settings,
      connections: [{ ...f.settings.connections[0], adapterId: 'fixture', config: {} }],
    })
    const first = service.refresh({ connectionId: 'account' }),
      second = service.refresh({ connectionId: 'account' })
    expect(read).toHaveBeenCalledTimes(1)
    service.saveSettings({ ...service.getSettings(), connections: [] })
    finish(adapterResult(JSON.parse(readFileSync(f.input, 'utf8'))))
    const results = await Promise.all([first, second])
    for (const result of results) expect(result.refresh).toEqual({ read: [], skipped: [] })
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
        protocolVersion: 3,
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
    await restarted.refresh({ connectionId: 'account' })
    expect(restarted.read().connections[0].error?.code).toBe('config')
    expect(restarted.read().connections[0].error?.message).toContain('Cannot decrypt')
    expect(read).not.toHaveBeenCalled()
  })
})

describe('accounts settings flow (spec rules 21-28)', () => {
  function report(id: string, serviceId: string, percent: number) {
    return {
      id,
      serviceId,
      label: `Label ${id}`,
      sourceKind: 'file',
      status: 'available',
      subscriptions: [{ id: 'fixture-plan', label: 'Fixture plan' }],
      metrics: [
        {
          id: 'week',
          label: 'Fixture plan 7d',
          subscriptionId: 'fixture-plan',
          kind: 'window',
          state: 'available',
          observedAt: '2026-10-20T12:00:00Z',
          usedPercent: percent,
          resetsAt: '2026-10-25T00:00:00Z',
        },
      ],
    }
  }
  function adapter(f: ReturnType<typeof fixture>, serviceId?: string) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'declared')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'declared',
        name: 'Declared',
        ...(serviceId ? { serviceId } : {}),
        summary: 'Fixture service.',
        protocolVersion: 3,
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
  const account = (adapterId: string, serviceId = '') => ({
    id: 'account',
    label: 'Fixture account',
    serviceId,
    adapterId,
    enabled: true,
    config: {} as Record<string, string | boolean>,
  })

  it('assigns the declared service id and ignores the one sent by the renderer', async () => {
    const f = fixture()
    const { service, read } = adapter(f, 'declared-service')
    service.saveSettings({ ...f.settings, connections: [account('declared', 'typed')] })
    expect(service.getSettings().connections[0].serviceId).toBe('declared-service')
    read.mockResolvedValue(
      adapterResult({ schemaVersion: 2, reports: [report('account', 'other-service', 10)] }),
    )
    service.setVisible(true)
    await service.refresh({ connectionId: 'account' })
    expect(service.read().connections[0].error?.message).toContain('its service')
    read.mockResolvedValue(
      adapterResult({ schemaVersion: 2, reports: [report('account', 'declared-service', 10)] }),
    )
    await service.test(service.getSettings().connections[0])
  })
  it('uses the adapter id without a declared service and accepts any reported service', async () => {
    const f = fixture()
    const { service, read } = adapter(f)
    service.saveSettings({ ...f.settings, connections: [account('declared')] })
    expect(service.getSettings().connections[0].serviceId).toBe('declared')
    read.mockResolvedValue(
      adapterResult({ schemaVersion: 2, reports: [report('account', 'reported', 20)] }),
    )
    service.setVisible(true)
    await service.refresh({ connectionId: 'account' })
    const source = service.read().connections[0]
    expect(source.error).toBeNull()
    expect(source.subscription?.serviceId).toBe('declared')
  })
  it('replaces a saved service id that differs from the declared one', () => {
    const f = fixture()
    const { host } = adapter(f, 'declared-service')
    f.state.set(
      USAGE_STATE_KEY,
      JSON.stringify({
        ...f.settings,
        connections: [account('declared', 'legacy')],
      }),
    )
    const legacy = new UsageService({ ...f.deps, host })
    services.push(legacy)
    expect(legacy.getSettings().connections[0].serviceId).toBe('legacy')
    // Saving another account leaves the legacy one unchanged (criterion 15).
    const added = legacy.saveSettings({
      ...legacy.getSettings(),
      connections: [
        ...legacy.getSettings().connections,
        { ...account('declared', 'typed'), id: 'other', label: 'Other account' },
      ],
    })
    expect(added.connections.map((c) => c.serviceId)).toEqual(['legacy', 'declared-service'])
    // Editing the legacy account assigns the declared id.
    const edited = legacy.saveSettings({
      ...added,
      connections: added.connections.map((c) =>
        c.id === 'account' ? { ...c, label: 'Renamed account' } : c,
      ),
    })
    expect(edited.connections[0].serviceId).toBe('declared-service')
  })
  it('rejects changing the adapter of a saved source (rule 23)', async () => {
    const f = fixture()
    const { service } = adapter(f, 'declared-service')
    plugin(f)
    service.saveSettings({ ...f.settings, connections: [account('declared')] })
    expect(service.getSettings().connections[0].adapterId).toBe('declared')

    expect(() =>
      service.saveSettings({
        ...f.settings,
        connections: [{ ...account('fixture'), id: 'account' }],
      }),
    ).toThrow(
      new AppError(
        'validation_error',
        'The adapter of a saved source cannot change. Remove the source and add another.',
      ),
    )
    expect(service.getSettings().connections[0].adapterId).toBe('declared')

    await expect(service.test({ ...account('fixture'), id: 'account' })).rejects.toMatchObject({
      code: 'validation_error',
      message: 'The adapter of a saved source cannot change. Remove the source and add another.',
    })
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

describe('partial refresh merge and retry (PDH-13)', () => {
  const plan = { id: 'fixture-plan', label: 'Fixture plan' }
  const doc = (
    metrics: Array<Record<string, unknown>>,
    subscriptions: Array<{ id: string; label: string }> = [plan],
  ) => ({
    schemaVersion: 2,
    reports: [
      {
        id: 'account',
        serviceId: 'fixture',
        label: 'Producer label',
        sourceKind: 'api',
        status: 'available',
        subscriptions,
        metrics,
      },
    ],
  })
  const metric = (id: string, usedPercent: number, observedAt: string) => ({
    id,
    label: `Fixture plan ${id}`,
    subscriptionId: 'fixture-plan',
    kind: 'window',
    state: 'available',
    observedAt,
    usedPercent,
    resetsAt: '2026-11-01T00:00:00Z',
  })

  it('merges succeeded windows and keeps a failed window with every date and the pin', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const at0 = new Date(NOW).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(doc([metric('week', 40, at0), metric('month', 20, at0)])),
    )
    await service.refresh({ connectionId: 'account' })
    const before = service.read().connections[0].subscription?.metrics.find((m) => m.id === 'month')
    if (!before) throw new Error('Expected a seeded metric')
    service.saveSettings({
      ...service.getSettings(),
      pin: { connectionId: 'account', metricId: 'month' },
    })
    f.advance(60_000)
    const at1 = new Date(NOW + 60_000).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('week', 55, at1)]),
        refreshResult([
          refreshSource('source', 'succeeded', [
            refreshWindow('week'),
            refreshWindow('month', 'failed', {
              errorCode: 'network',
              nextAllowedAt: new Date(NOW + 360_000).toISOString(),
            }),
          ]),
        ]),
      ),
    )
    const result = await service.refresh({ connectionId: 'account' })
    const source = result.connections[0]
    expect(source.error).toBeNull()
    expect(source.refreshResult).toMatchObject({ status: 'partial', requestId: 'request-1' })
    const metrics = source.subscription?.metrics ?? []
    const week = metrics.find((m) => m.id === 'week')
    expect(week).toMatchObject({ usedPercent: 55, observedAt: at1 })
    // The failed window keeps its original observation, receipt time and value.
    expect(metrics.find((m) => m.id === 'month')).toEqual(before)
    expect(source.subscription?.status).toBe('available')
    expect(result.pin).toEqual({ connectionId: 'account', metricId: 'month' })
  })

  it('shows explicit unavailable without numbers when a failed window has no history', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockResolvedValueOnce(
      adapterResult(
        doc([]),
        refreshResult(
          [
            refreshSource('source', 'rate_limited', [
              refreshWindow('month', 'rate_limited', {
                errorCode: 'rate_limited',
                nextAllowedAt: new Date(NOW + 600_000).toISOString(),
              }),
            ]),
          ],
          { status: 'failed', measurementId: undefined, reportId: undefined },
        ),
      ),
    )
    const result = await service.refresh({ connectionId: 'account' })
    const source = result.connections[0]
    expect(source.error).toBeNull()
    expect(source.refreshResult?.status).toBe('failed')
    const month = source.subscription?.metrics.find((m) => m.id === 'month')
    // The only declared subscription owns the window; its label names it (U4).
    expect(month).toMatchObject({
      id: 'month',
      label: 'Fixture plan month',
      subscriptionId: 'fixture-plan',
      state: 'unavailable',
      observedAt: null,
      reason: 'rate_limited',
    })
    expect(month).not.toHaveProperty('usedPercent')
    expect(source.subscription?.status).toBe('unavailable')
  })

  it('labels an unavailable window without history from its declared subscription (U4)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockResolvedValueOnce(
      adapterResult(
        doc(
          [],
          [
            { id: 'claude', label: 'Claude' },
            { id: 'command-code', label: 'Command Code' },
          ],
        ),
        refreshResult(
          [
            refreshSource('source', 'failed', [
              refreshWindow('claude-weekly', 'failed', { errorCode: 'network' }),
              refreshWindow('command-code-5h', 'unavailable', { errorCode: 'auth' }),
              refreshWindow('month', 'unavailable'),
            ]),
          ],
          { status: 'failed', measurementId: undefined, reportId: undefined },
        ),
      ),
    )
    const result = await service.refresh({ connectionId: 'account' })
    const source = result.connections[0]
    const metrics = source.subscription?.metrics ?? []
    // A window of no declared subscription gets no row; its typed result still names it.
    expect(metrics.map((metric) => [metric.id, metric.label, metric.subscriptionId])).toEqual([
      ['claude-weekly', 'Claude weekly', 'claude'],
      ['command-code-5h', 'Command Code 5h', 'command-code'],
    ])
    expect(metrics.every((metric) => metric.state === 'unavailable')).toBe(true)
    expect(source.subscription?.subscriptions.map((declaration) => declaration.id)).toEqual([
      'claude',
      'command-code',
    ])
    expect(source.refreshResult?.sources[0].windows.map((window) => window.metricId)).toContain(
      'month',
    )
  })

  it('gives no row to a failed window naming an undeclared subscription (U3, U11)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockResolvedValueOnce(
      adapterResult(
        doc([]),
        refreshResult(
          [
            refreshSource('source', 'failed', [
              refreshWindow('opencode-go-5h', 'failed', { errorCode: 'network' }),
              refreshWindow('month', 'unavailable'),
            ]),
          ],
          { status: 'failed', measurementId: undefined, reportId: undefined },
        ),
      ),
    )
    const result = await service.refresh({ connectionId: 'account' })
    const source = result.connections[0]
    // Only an id without the `<subscription>-<window>` shape falls back to the one declaration.
    expect(source.subscription?.metrics.map((m) => [m.id, m.label, m.subscriptionId])).toEqual([
      ['month', 'Fixture plan month', 'fixture-plan'],
    ])
    expect(source.refreshResult?.sources[0].windows.map((w) => w.metricId)).toContain(
      'opencode-go-5h',
    )
  })

  it('refreshes only sources whose retry deadline passed and keeps the others', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const at0 = new Date(NOW).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(doc([metric('claude-5h', 10, at0), metric('codex-weekly', 20, at0)])),
    )
    await service.refresh({ connectionId: 'account' })
    f.advance(60_000)
    const at1 = new Date(NOW + 60_000).toISOString()
    const deadline = new Date(NOW + 360_000).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('codex-weekly', 25, at1)]),
        refreshResult([
          refreshSource(
            'claude',
            'rate_limited',
            [
              refreshWindow('claude-5h', 'rate_limited', {
                errorCode: 'rate_limited',
                nextAllowedAt: deadline,
              }),
            ],
            { errorCode: 'rate_limited', nextAllowedAt: deadline },
          ),
          refreshSource('codex', 'succeeded', [refreshWindow('codex-weekly')]),
        ]),
      ),
    )
    const partial = await service.refresh({ connectionId: 'account' })
    expect(partial.connections[0].refreshResult?.status).toBe('partial')
    expect(
      partial.connections[0].subscription?.metrics.find((m) => m.id === 'claude-5h')?.usedPercent,
    ).toBe(10)
    // The account's 60-second minimum passed, but the claude source is still in backoff.
    f.advance(60_000)
    const at2 = new Date(NOW + 120_000).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('codex-weekly', 30, at2)]),
        refreshResult([refreshSource('codex', 'succeeded', [refreshWindow('codex-weekly')])], {
          status: 'success',
        }),
      ),
    )
    const second = await service.refresh({ connectionId: 'account' })
    expect(read.mock.calls.at(-1)?.[5]).toEqual({ refreshSources: ['codex'] })
    expect(second.connections[0].refreshResult?.status).toBe('partial')
    expect(
      second.connections[0].refreshResult?.sources.find((s) => s.sourceId === 'claude')
        ?.nextAllowedAt,
    ).toBe(deadline)
    expect(
      second.connections[0].subscription?.metrics.find((m) => m.id === 'claude-5h')?.usedPercent,
    ).toBe(10)
    // After the provider deadline both sources are selected again.
    f.advance(240_000)
    const at3 = new Date(NOW + 360_000).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('claude-5h', 15, at3), metric('codex-weekly', 35, at3)]),
        refreshResult(
          [
            refreshSource('claude', 'succeeded', [refreshWindow('claude-5h')]),
            refreshSource('codex', 'succeeded', [refreshWindow('codex-weekly')]),
          ],
          { status: 'success' },
        ),
      ),
    )
    const third = await service.refresh({ connectionId: 'account' })
    expect(read.mock.calls.at(-1)?.[5]).toEqual({})
    expect(third.connections[0].refreshResult?.status).toBe('success')
    expect(
      third.connections[0].subscription?.metrics.find((m) => m.id === 'claude-5h')?.usedPercent,
    ).toBe(15)
  })

  it('persists the typed result and its per-source retry across a restart', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const at0 = new Date(NOW).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(doc([metric('claude-5h', 10, at0), metric('codex-weekly', 20, at0)])),
    )
    await service.refresh({ connectionId: 'account' })
    f.advance(60_000)
    const at1 = new Date(NOW + 60_000).toISOString()
    const deadline = new Date(NOW + 360_000).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('codex-weekly', 25, at1)]),
        refreshResult([
          refreshSource('claude', 'rate_limited', [refreshWindow('claude-5h', 'rate_limited')], {
            nextAllowedAt: deadline,
          }),
          refreshSource('codex', 'succeeded', [refreshWindow('codex-weekly')]),
        ]),
      ),
    )
    await service.refresh({ connectionId: 'account' })
    const before = service.read().connections[0].refreshResult
    const host = new UsageAdapterHost()
    const restartedRead = vi
      .spyOn(host, 'read')
      .mockResolvedValue(adapterResult(doc([metric('codex-weekly', 30, at1)])))
    const restarted = new UsageService({ ...f.deps, host })
    services.push(restarted)
    expect(restarted.read().connections[0].refreshResult).toEqual(before)
    f.advance(60_000)
    await restarted.refresh({ connectionId: 'account' })
    expect(restartedRead.mock.calls[0][5]).toEqual({ refreshSources: ['codex'] })
  })

  it('keeps the manual result across automatic polls and out of the export', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    const at0 = new Date(NOW).toISOString()
    read.mockResolvedValueOnce(
      adapterResult(
        doc([metric('week', 42, at0)]),
        refreshResult([refreshSource('fixture', 'succeeded', [refreshWindow('week')])], {
          status: 'success',
        }),
      ),
    )
    await service.refresh({ connectionId: 'account' })
    const before = service.read().connections[0].refreshResult
    service.saveSettings({
      ...service.getSettings(),
      export: { enabled: true, path: f.output },
    })
    f.advance(60_000)
    read.mockResolvedValueOnce(adapterResult(doc([metric('week', 42, at0)])))
    await poll(service)
    expect(service.read().connections[0].refreshResult).toEqual(before)
    const exported = readFileSync(f.output, 'utf8')
    expect(exported).not.toContain('refreshResult')
    expect(exported).not.toContain('nextAllowedAt')
  })
})

describe('live refresh and removed passive sources (spec L1-L7)', () => {
  it('sends read on schedule and refresh on a manual click right after it (LA2)', async () => {
    const f = fixture(),
      { service, read } = plugin(f, 300)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][4]).toBe('read')
    // Spec L5: a scheduled read only reads stored data and never starts the manual limit.
    expect(service.read().connections[0].nextRefreshAt).toBeNull()
    f.advance(1000)
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: ['account'],
      skipped: [],
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1][4]).toBe('refresh')
    expect(service.read().connections[0].error).toBeNull()
    // The manual refresh starts its own 60-second limit.
    const until = new Date(NOW + 61_000).toISOString()
    expect(service.read().connections[0].nextRefreshAt).toBe(until)
    f.advance(59_999)
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: [],
      skipped: [{ connectionId: 'account', until, reason: 'interval' }],
    })
    // The next scheduled read is due the adapter minimum after the manual read started.
    f.advance(240_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(1)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(3)
    expect(read.mock.calls[2][4]).toBe('read')
    // A scheduled read inside the manual limit leaves that limit unchanged.
    expect(service.read().connections[0].nextRefreshAt).toBeNull()
  })
  it('starts a refresh after a scheduled read in flight instead of joining it (L5)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let finish: () => void = () => {}
    read.mockImplementationOnce(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = () => resolve(adapterResult(f.live()))
        }),
    )
    await poll(service)
    expect(read).toHaveBeenCalledTimes(1)
    const manual = service.refresh({ connectionId: 'account' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(read).toHaveBeenCalledTimes(1)
    finish()
    expect((await manual).refresh).toEqual({ read: ['account'], skipped: [] })
    expect(read.mock.calls.map((call) => call[4])).toEqual(['read', 'refresh'])
    expect(service.read().connections[0].nextRefreshAt).toBe(new Date(NOW + 60_000).toISOString())
  })
  it('ends a manual wait for an automatic read when the service shuts down', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    let finish: () => void = () => {}
    read.mockImplementationOnce(
      () =>
        new Promise<UsageAdapterResult>((resolve) => {
          finish = () => resolve(adapterResult(f.live()))
        }),
    )
    await poll(service)
    const manual = service.refresh({ connectionId: 'account' })
    service.shutdown()
    finish()
    expect((await manual).refresh).toEqual({ read: [], skipped: [] })
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('lets a manual refresh ignore growing backoff and suspension (LA2)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    read.mockRejectedValue(new AppError('network', 'Fixture network failure'))
    await service.refresh({ connectionId: 'account' })
    for (let attempt = 2; attempt <= 5; attempt++) {
      f.advance(60_000)
      expect((await service.refresh({ connectionId: 'account' })).refresh?.read).toEqual([
        'account',
      ])
      expect(read).toHaveBeenCalledTimes(attempt)
    }
    // Only an automatic read failure suspends polling (NEKODE-147).
    read.mockRejectedValue(new AppError('auth', 'Fixture auth'))
    f.advance(60_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(6)
    expect(read.mock.calls[5][4]).toBe('read')
    expect(service.read().connections[0].error?.code).toBe('auth')
    f.advance(3_600_000)
    await poll(service)
    expect(read).toHaveBeenCalledTimes(6)
    read.mockImplementation(async () => adapterResult(f.live(55)))
    expect((await service.refresh({ connectionId: 'account' })).refresh?.read).toEqual(['account'])
    expect(read).toHaveBeenCalledTimes(7)
    expect(service.read().connections[0].error).toBeNull()
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(55)
  })
  it.each([
    ['an older', '2026-10-20T12:00:59Z'],
    ['no', null],
  ])(
    'fails a refresh with %s observation time as protocol and keeps the previous one (LA3)',
    async (_name, observedAt) => {
      const f = fixture(),
        { service, read } = plugin(f)
      await service.refresh({ connectionId: 'account' })
      const previous = service.read().connections[0].subscription?.metrics[0]
      f.advance(60_500)
      const stale = f.live(77)
      stale.reports[0].metrics[0].observedAt = observedAt
      read.mockResolvedValueOnce(adapterResult(stale))
      expect((await service.refresh({ connectionId: 'account' })).refresh?.read).toEqual([
        'account',
      ])
      expect(service.read().connections[0].error).toMatchObject({
        code: 'protocol',
        message: 'Usage adapter did not return a live refresh.',
      })
      expect(service.read().connections[0].subscription?.metrics[0]).toEqual(previous)
    },
  )
  it('accepts a refresh observed in the request second and exempts unavailable metrics (L3)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    await service.refresh({ connectionId: 'account' })
    f.advance(60_500)
    const document = f.live(77)
    document.reports[0].metrics[0].observedAt = '2026-10-20T12:01:00Z'
    document.reports[0].metrics.push({
      id: 'credits',
      label: 'Fixture plan credits',
      subscriptionId: 'fixture-plan',
      kind: 'credits',
      state: 'unavailable',
      observedAt: null,
      reason: 'not_reported',
    })
    read.mockResolvedValueOnce(adapterResult(document))
    await service.refresh({ connectionId: 'account' })
    expect(service.read().connections[0].error).toBeNull()
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(77)
  })
  it('keeps stored accounts of removed sources listed, uncollected, cached and pinned (LA4)', async () => {
    const f = fixture()
    f.service.saveSettings({ ...f.settings, export: { enabled: true, path: f.output } })
    await f.service.refresh({ connectionId: 'account' })
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    // Stored before the passive sources were removed (spec L7).
    const stored = JSON.parse(f.state.get(USAGE_STATE_KEY) ?? '')
    stored.connections[0].adapterId = 'usage-file'
    stored.connections.push({
      id: 'claude',
      label: 'Claude account',
      serviceId: 'claude',
      adapterId: 'claude-code-snapshots',
      enabled: true,
      config: { directory: join(f.dir, 'claude') },
    })
    f.state.set(USAGE_STATE_KEY, JSON.stringify(stored))
    f.hostRead.mockClear()
    const service = new UsageService(f.deps)
    services.push(service)
    expect(service.read().cacheError).toBeNull()
    expect(service.getSettings().connections.map((c) => c.adapterId)).toEqual([
      'usage-file',
      'claude-code-snapshots',
    ])
    const ids = service.listAdapters().map((a) => a.id)
    expect(ids).not.toContain('usage-file')
    expect(ids).not.toContain('claude-code-snapshots')
    const removed = { code: 'config', message: USAGE_REMOVED_ADAPTER_MESSAGE }
    for (const c of service.read().connections) {
      expect(c.error).toEqual(removed)
      expect(c.nextRefreshAt).toBeNull()
    }
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    expect(service.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    f.advance(3_600_000)
    expect((await service.refresh({ connectionId: 'account' })).refresh).toEqual({
      read: [],
      skipped: [],
    })
    await poll(service)
    expect(f.hostRead).not.toHaveBeenCalled()
    await expect(service.test(service.getSettings().connections[0])).rejects.toMatchObject(removed)
    // Saving other changes keeps both accounts, their cache and the pin; export still works.
    const saved = service.saveSettings({
      ...service.getSettings(),
      export: { enabled: true, path: f.output },
    })
    expect(saved.connections.map((c) => [c.adapterId, c.serviceId, c.config])).toEqual([
      ['usage-file', 'fixture', { path: f.input }],
      ['claude-code-snapshots', 'claude', { directory: join(f.dir, 'claude') }],
    ])
    expect(service.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
    expect(JSON.parse(readFileSync(f.output, 'utf8')).reports).toMatchObject([
      { id: 'account', status: 'error', metrics: [{ id: 'week', usedPercent: 42 }] },
      { id: 'claude', status: 'error', sourceKind: 'file', subscriptions: [], metrics: [] },
    ])
    // Removing the account is the only way to drop its cache and pin.
    service.saveSettings({
      ...service.getSettings(),
      connections: service.getSettings().connections.slice(1),
      pin: null,
    })
    expect(service.read().connections.map((c) => c.connection.id)).toEqual(['claude'])
    expect(f.hostRead).not.toHaveBeenCalled()
  })
  it('refuses a new account of a removed source (L7)', () => {
    const f = fixture()
    for (const adapterId of ['usage-file', 'claude-code-snapshots'])
      expect(() =>
        f.service.saveSettings({
          ...f.settings,
          connections: [{ ...f.settings.connections[0], adapterId }],
        }),
      ).toThrow(USAGE_REMOVED_ADAPTER_MESSAGE)
    expect(f.state.get(USAGE_STATE_KEY)).toBeUndefined()
  })
})

describe('pinning a metric of an external adapter (NEKODE-120)', () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (v: Buffer) => v.toString(),
  }
  // Mirrors the Personal Data Hub manifest: the secret is declared between two text fields.
  function hub(f: ReturnType<typeof fixture>, keys = ['hubUrl', 'token', 'subscriptions']) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'hub')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'hub',
        name: 'Hub',
        serviceId: 'hub',
        protocolVersion: 3,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'api',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: keys.map((key) => ({
          key,
          label: key,
          type: key === 'token' ? 'secret' : 'text',
          required: key !== 'subscriptions',
        })),
      }),
    )
    const host = new UsageAdapterHost()
    vi.spyOn(host, 'read').mockResolvedValue(
      adapterResult({
        schemaVersion: 2,
        reports: [
          {
            id: 'hub-account',
            serviceId: 'hub',
            label: 'Hub',
            sourceKind: 'api',
            status: 'available',
            subscriptions: [
              { id: 'claude', label: 'Claude' },
              { id: 'chatgpt', label: 'ChatGPT' },
            ],
            metrics: [
              ['claude-5h', 'Claude 5h', 'claude'],
              ['chatgpt-weekly', 'ChatGPT weekly', 'chatgpt'],
            ].map(([id, label, subscriptionId]) => ({
              id,
              label,
              subscriptionId,
              kind: 'window',
              state: 'available',
              observedAt: '2026-10-20T12:00:00Z',
              usedPercent: 30,
              resetsAt: '2026-10-25T00:00:00Z',
            })),
          },
        ],
      }),
    )
    const service = new UsageService({ ...f.deps, host, safeStorage })
    services.push(service)
    return { service, host }
  }
  const pin = { connectionId: 'hub-account', metricId: 'chatgpt-weekly' }
  const connection = (config: Record<string, string | boolean>) => ({
    id: 'hub-account',
    label: 'PDH',
    serviceId: '',
    adapterId: 'hub',
    enabled: true,
    config,
  })

  it('keeps the pin through the toolbar settings roundtrip, refresh, and restart', async () => {
    const f = fixture()
    const { service, host } = hub(f)
    service.saveSettings({
      ...f.settings,
      connections: [connection({ hubUrl: 'https://hub.test', token: 't', subscriptions: '' })],
    })
    await service.refresh({ connectionId: 'hub-account' })
    // UsageToolbar.pin(): getSettings, then saveSettings with the pin.
    service.saveSettings({ ...service.getSettings(), pin })
    expect(service.read().pin).toEqual(pin)
    expect(service.read().connections[0].subscription?.metrics).toHaveLength(2)
    await service.refresh({ connectionId: 'hub-account' })
    expect(service.read().pin).toEqual(pin)
    const restarted = new UsageService({ ...f.deps, host, safeStorage })
    services.push(restarted)
    expect(restarted.read().pin).toEqual(pin)
    await restarted.refresh({ connectionId: 'hub-account' })
    expect(restarted.read().pin).toEqual(pin)
  })
  it('pins an account saved under an older adapter manifest that declared other fields', async () => {
    const f = fixture()
    // The manifest before PDH-47 named its field `agents`; the stored value is dropped.
    const old = hub(f, ['token', 'hubUrl', 'agents'])
    old.service.saveSettings({
      ...f.settings,
      connections: [connection({ token: 't', hubUrl: 'https://hub.test', agents: 'agy' })],
    })
    const { service } = hub(f)
    await service.refresh({ connectionId: 'hub-account' })
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
    await service.refresh({ connectionId: 'hub-account' })
    service.saveSettings({ ...service.getSettings(), pin })
    expect(() =>
      service.saveSettings({ ...service.getSettings(), pin: { ...pin, metricId: 'grok-weekly' } }),
    ).toThrow('reports no value for it')
    expect(service.read().pin).toEqual(pin)
  })
})

describe('account and subscription refresh (NEKODE-148, NEKODE-191)', () => {
  /** A hub adapter that reports two subscriptions and declares subscription refresh (A7, U6). */
  function subscriptionHub(
    f: ReturnType<typeof fixture>,
    refreshOptions: string[] | null = ['subscriptions'],
    refreshableSubscriptions?: string[],
  ) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'subscriptions')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'subscriptions',
        name: 'Subscriptions',
        serviceId: 'hub',
        protocolVersion: 3,
        invocation: { command: 'node', args: ['fixture.cjs'] },
        sourceKind: 'api',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: [{ key: 'mode', label: 'Mode', type: 'text' }],
        ...(refreshOptions ? { refreshOptions } : {}),
      }),
    )
    let now = NOW
    let refreshable = refreshableSubscriptions
    const percent: Record<string, number> = { claude: 30, chatgpt: 30 }
    const labels: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT' }
    const label = (id: string) => labels[id] ?? id
    const metric = (id: string) => ({
      id: `${id}-5h`,
      label: `${label(id)} 5h`,
      subscriptionId: id,
      kind: 'window',
      state: 'available',
      observedAt: new Date(now).toISOString(),
      usedPercent: percent[id],
      resetsAt: '2026-10-25T00:00:00Z',
    })
    const document = (ids: string[]) => ({
      schemaVersion: 2,
      reports: [
        {
          id: 'hub-account',
          serviceId: 'hub',
          label: 'Hub',
          sourceKind: 'api',
          status: 'available',
          subscriptions: ids.map((id) => ({ id, label: label(id) })),
          metrics: ids.map(metric),
        },
      ],
    })
    const host = new UsageAdapterHost()
    const read = vi
      .spyOn(host, 'read')
      .mockImplementation(async (_adapter, _config, _id, _signal, _action, options = {}) => {
        const result = adapterResult(
          document(options.refreshSubscriptions ?? ['claude', 'chatgpt']),
        )
        if (refreshable !== undefined)
          Object.defineProperty(result, 'refreshableSubscriptions', { value: refreshable })
        return result
      })
    const service = new UsageService({ ...f.deps, host, now: () => now })
    services.push(service)
    service.saveSettings({
      ...f.settings,
      connections: [
        {
          id: 'hub-account',
          label: 'PDH',
          serviceId: '',
          adapterId: 'subscriptions',
          enabled: true,
          config: {},
        },
      ],
    })
    return {
      service,
      read,
      document,
      percent,
      labels,
      setRefreshable: (next: string[] | undefined) => {
        refreshable = next
      },
      advance: (ms: number) => {
        now += ms
      },
      at: (ms: number) => new Date(NOW + ms).toISOString(),
    }
  }
  const account = { connectionId: 'hub-account' }
  const claude = { connectionId: 'hub-account', subscriptionId: 'claude' }
  const chatgpt = { connectionId: 'hub-account', subscriptionId: 'chatgpt' }
  const values = (service: UsageService) =>
    Object.fromEntries(
      (service.read().connections[0].subscription?.metrics ?? []).map((m) => [
        m.id,
        [m.usedPercent, m.observedAt],
      ]),
    )

  it('refreshes one subscription and keeps the other, its dates and the pin (A7, A11)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    expect(h.read.mock.calls[0][5]).toEqual({})
    h.service.saveSettings({
      ...h.service.getSettings(),
      pin: { connectionId: 'hub-account', metricId: 'chatgpt-5h' },
    })
    h.advance(60_000)
    h.percent.claude = 50
    h.percent.chatgpt = 99
    const result = await h.service.refresh(claude)
    expect(h.read.mock.calls[1][4]).toBe('refresh')
    expect(h.read.mock.calls[1][5]).toEqual({ refreshSubscriptions: ['claude'] })
    expect(result.refresh).toEqual({ read: ['hub-account'], skipped: [] })
    expect(values(h.service)).toEqual({
      'claude-5h': [50, h.at(60_000)],
      'chatgpt-5h': [30, h.at(0)],
    })
    expect(h.service.read().pin).toEqual({ connectionId: 'hub-account', metricId: 'chatgpt-5h' })
    expect(h.service.read().connections[0].subscriptions).toEqual([
      { subscriptionId: 'claude', nextRefreshAt: h.at(120_000) },
      { subscriptionId: 'chatgpt', nextRefreshAt: null },
    ])
  })
  it('writes cache and export when a retained metric keeps a label from before a rename (U4)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    h.service.saveSettings({
      ...h.service.getSettings(),
      export: { enabled: true, path: f.output },
    })
    h.labels['opencode-go'] = 'Opencode Go'
    h.percent['opencode-go'] = 10
    h.read.mockImplementationOnce(async () => adapterResult(h.document(['chatgpt', 'opencode-go'])))
    await h.service.refresh(account)
    // The Hub renames the subscription; a ChatGPT-only refresh re-declares it with the new label.
    h.labels['opencode-go'] = 'OpenCode Go'
    h.advance(60_000)
    h.percent.chatgpt = 70
    h.read.mockImplementationOnce(async () => {
      const document = h.document(['chatgpt', 'opencode-go'])
      document.reports[0].metrics = document.reports[0].metrics.filter(
        (metric) => metric.subscriptionId === 'chatgpt',
      )
      return adapterResult(document)
    })
    await h.service.refresh(chatgpt)
    const snapshot = h.service.read()
    expect(snapshot.cacheError).toBeNull()
    expect(snapshot.exportError).toBeNull()
    const report = snapshot.connections[0].subscription
    expect(report?.subscriptions).toEqual([
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'opencode-go', label: 'OpenCode Go' },
    ])
    expect(report?.metrics.map((m) => [m.id, m.label, m.usedPercent])).toEqual([
      ['chatgpt-5h', 'ChatGPT 5h', 70],
      ['opencode-go-5h', 'Opencode Go 5h', 10],
    ])
    expect(readFileSync(f.output, 'utf8')).toContain('"usedPercent": 70')
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().cacheError).toBeNull()
    expect(restarted.read().connections[0].subscription?.metrics).toHaveLength(2)
  })
  it('orders declarations by the response on a refresh without a selection (U3)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(60_000)
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document(['chatgpt', 'claude']),
        refreshResult([
          refreshSource('hub', 'succeeded', [
            refreshWindow('chatgpt-5h'),
            refreshWindow('claude-5h'),
          ]),
        ]),
      ),
    )
    await h.service.refresh(account)
    expect(h.service.read().connections[0].subscription?.subscriptions.map((s) => s.id)).toEqual([
      'chatgpt',
      'claude',
    ])
  })
  it('keeps the 60-second limit per account and subscription (A9)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(59_999)
    expect((await h.service.refresh(claude)).refresh?.skipped).toEqual([
      { ...claude, until: h.at(60_000), reason: 'interval' },
    ])
    h.advance(1)
    expect((await h.service.refresh(claude)).refresh?.read).toEqual(['hub-account'])
    // Another subscription of the same account reads 10 seconds later.
    h.advance(10_000)
    expect((await h.service.refresh(chatgpt)).refresh?.read).toEqual(['hub-account'])
    h.advance(10_000)
    expect((await h.service.refresh(claude)).refresh?.skipped).toEqual([
      { ...claude, until: h.at(120_000), reason: 'interval' },
    ])
    // Both subscriptions are inside their limit: the account waits for the earliest one.
    expect((await h.service.refresh(account)).refresh?.skipped).toEqual([
      { ...account, until: h.at(120_000), reason: 'interval' },
    ])
    expect(h.service.read().connections[0].nextRefreshAt).toBe(h.at(120_000))
    // Only claude's limit passed: the account refresh sends only claude.
    h.advance(45_000)
    expect((await h.service.refresh(account)).refresh?.read).toEqual(['hub-account'])
    expect(h.read.mock.calls.at(-1)?.[5]).toEqual({ refreshSubscriptions: ['claude'] })
    expect(h.read).toHaveBeenCalledTimes(4)
  })
  it('keeps the per-account limit for an adapter without subscription refresh support', async () => {
    const f = fixture()
    const h = subscriptionHub(f, null)
    await h.service.refresh(account)
    expect(h.service.read().connections[0].subscriptions).toBeNull()
    await expect(h.service.refresh(claude)).rejects.toMatchObject({ code: 'validation_error' })
    h.advance(30_000)
    expect((await h.service.refresh(account)).refresh?.skipped).toEqual([
      { ...account, until: h.at(60_000), reason: 'interval' },
    ])
    h.advance(30_000)
    await h.service.refresh(account)
    expect(h.read.mock.calls.map((call) => call[5])).toEqual([{}, {}])
  })
  it('rejects unknown and disabled targets before collection (A6)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await expect(h.service.refresh(claude)).rejects.toMatchObject({ code: 'not_found' })
    await h.service.refresh(account)
    await expect(
      h.service.refresh({ connectionId: 'hub-account', subscriptionId: 'grok' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.service.refresh({ connectionId: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
    })
    const settings = h.service.getSettings()
    settings.connections[0].enabled = false
    h.service.saveSettings(settings)
    await expect(h.service.refresh(account)).rejects.toMatchObject({ code: 'not_found' })
    expect(h.read).toHaveBeenCalledTimes(1)
  })
  it('fails a response with metrics outside the selection and keeps the values (A8)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(60_000)
    h.percent.claude = 70
    h.percent.chatgpt = 70
    h.read.mockImplementationOnce(async () => adapterResult(h.document(['claude', 'chatgpt'])))
    await h.service.refresh(claude)
    expect(h.service.read().connections[0].error).toMatchObject({
      code: 'protocol',
      message: 'Usage adapter returned metrics outside the selected subscriptions.',
    })
    expect(values(h.service)).toEqual({
      'claude-5h': [30, h.at(0)],
      'chatgpt-5h': [30, h.at(0)],
    })
  })
  it('joins a refresh that covers the subscription and waits for one that does not (A10)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(60_000)
    let release: () => void = () => {}
    h.read.mockImplementationOnce(async (_a, _c, _i, _s, _action, options = {}) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return adapterResult(h.document(options.refreshSubscriptions ?? []))
    })
    const first = h.service.refresh(claude)
    const joined = h.service.refresh(claude)
    const other = h.service.refresh(chatgpt)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.read).toHaveBeenCalledTimes(2)
    release()
    expect((await first).refresh?.read).toEqual(['hub-account'])
    expect((await joined).refresh?.read).toEqual(['hub-account'])
    expect((await other).refresh?.read).toEqual(['hub-account'])
    expect(h.read).toHaveBeenCalledTimes(3)
    expect(h.read.mock.calls[2][5]).toEqual({ refreshSubscriptions: ['chatgpt'] })
  })
  it('skips a subscription whose sources wait for a provider deadline (A9 backoff)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document(['claude', 'chatgpt']),
        refreshResult([
          refreshSource(
            'hub-claude',
            'rate_limited',
            [refreshWindow('claude-5h', 'rate_limited')],
            {
              nextAllowedAt: h.at(600_000),
            },
          ),
          refreshSource('hub-chatgpt', 'succeeded', [refreshWindow('chatgpt-5h')]),
        ]),
      ),
    )
    await h.service.refresh(account)
    h.advance(60_000)
    expect((await h.service.refresh(claude)).refresh?.skipped).toEqual([
      { ...claude, until: h.at(600_000), reason: 'backoff' },
    ])
    expect((await h.service.refresh(chatgpt)).refresh?.read).toEqual(['hub-account'])
    expect(h.read.mock.calls[1][5]).toEqual({ refreshSubscriptions: ['chatgpt'] })
  })
  it('uses the earliest combined subscription interval and source deadline for an account (A9)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(60_000)
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document([]),
        refreshResult(
          [
            refreshSource(
              'hub-chatgpt',
              'rate_limited',
              [refreshWindow('chatgpt-5h', 'rate_limited')],
              {
                nextAllowedAt: h.at(600_000),
              },
            ),
          ],
          { status: 'failed' },
        ),
      ),
    )
    await h.service.refresh(chatgpt)
    h.advance(10_000)
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document(['claude']),
        refreshResult([refreshSource('hub-claude', 'succeeded', [refreshWindow('claude-5h')])], {
          status: 'success',
        }),
      ),
    )
    await h.service.refresh(claude)
    h.advance(10_000)
    expect(h.service.read().connections[0].nextRefreshAt).toBe(h.at(130_000))
    expect((await h.service.refresh(account)).refresh?.skipped).toEqual([
      { ...account, until: h.at(130_000), reason: 'interval' },
    ])
    // ChatGPT's interval passes first, but its provider remains blocked longer than Claude.
    h.advance(40_000)
    expect(h.service.read().connections[0].nextRefreshAt).toBe(h.at(130_000))
    expect((await h.service.refresh(account)).refresh?.skipped).toEqual([
      { ...account, until: h.at(130_000), reason: 'interval' },
    ])
    expect(h.read).toHaveBeenCalledTimes(3)
    h.advance(10_000)
    expect((await h.service.refresh(account)).refresh?.read).toEqual(['hub-account'])
    expect(h.read.mock.calls[3][5]).toEqual({ refreshSources: ['hub-claude'] })
  })
  it('returns the current attempt separately from retained results of other subscriptions (A5)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    await h.service.refresh(account)
    h.advance(60_000)
    const failed = refreshResult([refreshSource('hub-claude', 'failed', [])], { status: 'failed' })
    let release: () => void = () => {}
    h.read.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return adapterResult(h.document([]), failed)
    })
    const first = h.service.refresh(claude),
      joined = h.service.refresh(claude)
    release()
    expect((await first).refresh?.result).toEqual(failed)
    expect((await joined).refresh?.result).toEqual(failed)
    const succeeded = refreshResult(
      [refreshSource('hub-chatgpt', 'succeeded', [refreshWindow('chatgpt-5h')])],
      { status: 'success', requestId: 'request-2' },
    )
    h.read.mockImplementationOnce(async () => adapterResult(h.document(['chatgpt']), succeeded))
    const result = await h.service.refresh(chatgpt)
    expect(result.refresh?.result).toEqual(succeeded)
    expect(result.connections[0].refreshResult?.sources).toEqual([
      ...failed.sources,
      ...succeeded.sources,
    ])
    expect(h.service.read().refresh).toBeUndefined()
    expect(h.read).toHaveBeenCalledTimes(3)
  })
  it('drops a retained unsupported source of the subscription a manual refresh covers (E1)', async () => {
    const f = fixture()
    const h = subscriptionHub(f)
    const unsupported = (subscriptionId: string, metricId: string) =>
      refreshSource(
        `unsupported:${subscriptionId}`,
        'unsupported',
        [refreshWindow(metricId, 'unsupported', { errorCode: 'unsupported' })],
        { errorCode: 'unsupported' },
      )
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document(['claude', 'chatgpt']),
        refreshResult([
          unsupported('claude', 'claude-5h'),
          unsupported('grok', 'grok-weekly'),
          refreshSource('hub-chatgpt', 'succeeded', [refreshWindow('chatgpt-5h')]),
        ]),
      ),
    )
    await h.service.refresh(account)
    expect(h.service.read().connections[0].refreshResult?.sources.map((s) => s.sourceId)).toEqual([
      'unsupported:claude',
      'unsupported:grok',
      'hub-chatgpt',
    ])
    h.advance(60_000)
    h.read.mockImplementationOnce(async () =>
      adapterResult(
        h.document(['claude']),
        refreshResult([refreshSource('hub-claude', 'succeeded', [refreshWindow('claude-5h')])]),
      ),
    )
    await h.service.refresh(claude)
    expect(h.service.read().connections[0].refreshResult?.sources.map((s) => s.sourceId)).toEqual([
      'unsupported:grok',
      'hub-chatgpt',
      'hub-claude',
    ])
  })
  it('limits account and subscription actions to the adapter refreshable list (R3, R4)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], ['claude'])
    await h.service.refresh(account)
    h.advance(60_000)
    expect((await h.service.refresh(account)).refresh?.read).toEqual(['hub-account'])
    expect(h.read.mock.calls[1][5]).toEqual({ refreshSubscriptions: ['claude'] })
    expect(h.service.read().connections[0].subscriptions).toEqual([
      { subscriptionId: 'claude', nextRefreshAt: h.at(120_000) },
    ])
    await expect(h.service.refresh(chatgpt)).rejects.toMatchObject({ code: 'not_found' })
    expect(h.read).toHaveBeenCalledTimes(2)
  })
  it('keeps the last known list when a response omits it and clears it on a configuration change (R2)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], ['claude'])
    await h.service.refresh(account)
    h.setRefreshable(undefined)
    h.advance(60_000)
    await h.service.refresh(account)
    expect(
      h.service.read().connections[0].subscriptions?.map((item) => item.subscriptionId),
    ).toEqual(['claude'])
    const settings = h.service.getSettings()
    h.service.saveSettings({
      ...settings,
      connections: settings.connections.map((connection) => ({
        ...connection,
        config: { mode: 'changed' },
      })),
    })
    await h.service.refresh(account)
    expect(
      h.service
        .read()
        .connections[0].subscriptions?.map((item) => item.subscriptionId)
        .sort(),
    ).toEqual(['chatgpt', 'claude'])
  })
  it('shows no refresh action for a known empty list and rejects an account refresh (R3, R5)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], [])
    // The first read learns the list; the next manual account refresh must not start a process.
    await h.service.refresh(account)
    h.advance(60_000)
    await expect(h.service.refresh(account)).rejects.toMatchObject({ code: 'unsupported' })
    expect(h.service.read().connections[0]).toMatchObject({
      nextRefreshAt: null,
      subscriptions: [],
    })
    expect(h.read).toHaveBeenCalledTimes(1)
  })
  it('refreshes a listed subscription before it has any retained metric (R4)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], ['grok'])
    await h.service.refresh(account)
    h.advance(60_000)
    const result = await h.service.refresh({ connectionId: 'hub-account', subscriptionId: 'grok' })
    expect(result.refresh?.read).toEqual(['hub-account'])
    expect(h.read.mock.calls[1][5]).toEqual({ refreshSubscriptions: ['grok'] })
    expect(h.service.read().connections[0].subscriptions).toEqual([
      { subscriptionId: 'grok', nextRefreshAt: h.at(120_000) },
    ])
  })
  it('caps an account selection at 20 listed subscriptions (A7, R4)', async () => {
    const f = fixture()
    const list = Array.from({ length: 21 }, (_, index) => `subscription-${index}`)
    const h = subscriptionHub(f, ['subscriptions'], list)
    await h.service.refresh(account)
    h.advance(60_000)
    await h.service.refresh(account)
    expect(h.read.mock.calls[1][5]).toEqual({ refreshSubscriptions: list.slice(0, 20) })
    // The excluded subscription keeps its deadline and is the only eligible one next time.
    expect(
      h.service
        .read()
        .connections[0].subscriptions?.find((item) => item.subscriptionId === 'subscription-20'),
    ).toEqual({ subscriptionId: 'subscription-20', nextRefreshAt: null })
    await h.service.refresh(account)
    expect(h.read.mock.calls[2][5]).toEqual({ refreshSubscriptions: ['subscription-20'] })
  })
  it('loads a legacy refresh-results file without a refreshable list as unknown (R2)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], ['claude'])
    await h.service.refresh(account)
    const revisions = JSON.parse(f.deps.state.get('usage.connection-revisions') ?? '{}')
    writeFileSync(
      join(f.deps.userDataPath, 'usage', 'refresh-results.json'),
      // Written before NEKODE-191: agent ids under the removed key are not read.
      JSON.stringify({
        connectionRevisions: revisions,
        results: {},
        refreshableProviders: { 'hub-account': ['codex'] },
      }),
    )
    const restarted = new UsageService({ ...f.deps, startTimer: false })
    services.push(restarted)
    const snapshot = restarted.read()
    expect(snapshot.cacheError).toBeNull()
    expect(
      snapshot.connections[0].subscriptions?.map((item) => item.subscriptionId).sort(),
    ).toEqual(['chatgpt', 'claude'])
  })
  it('restores the refreshable list from the persisted attempt metadata (R2)', async () => {
    const f = fixture()
    const h = subscriptionHub(f, ['subscriptions'], ['claude'])
    await h.service.refresh(account)
    const restarted = new UsageService({ ...f.deps, startTimer: false })
    services.push(restarted)
    expect(restarted.read().connections[0].subscriptions).toEqual([
      { subscriptionId: 'claude', nextRefreshAt: null },
    ])
  })
})

describe('stored data from 0.40 and invalid v2 adapters (NEKODE-191 U8, U9, U14)', () => {
  const repo = resolve(__dirname, '../../../..')
  /** A Personal Data Hub style user adapter with a secret field (protocol 3). */
  function hubManifest(f: ReturnType<typeof fixture>) {
    const directory = join(f.deps.userDataPath, 'usage-adapters', 'hub')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'usage-adapter.json'),
      JSON.stringify({
        id: 'personal-data-hub',
        name: 'Personal Data Hub',
        serviceId: 'personal-data-hub',
        protocolVersion: 3,
        invocation: { command: 'node', args: ['index.cjs'] },
        sourceKind: 'api',
        capabilities: ['window'],
        minimumRefreshSeconds: 60,
        configSchema: [
          { key: 'hubUrl', label: 'Hub URL', type: 'text', required: true },
          { key: 'token', label: 'Token', type: 'secret', required: true },
          { key: 'subscriptions', label: 'Subscriptions', type: 'text' },
        ],
      }),
    )
  }
  /** Settings exactly as 0.40 stored them: every connection names its service `providerId`. */
  const legacySettings = (f: ReturnType<typeof fixture>) => ({
    connections: [
      {
        id: 'account',
        label: 'Fixture account',
        providerId: 'fixture',
        adapterId: 'source',
        enabled: true,
        config: { path: f.input },
      },
      {
        id: 'codex-account',
        label: 'Codex',
        providerId: 'codex',
        adapterId: 'codex-app-server',
        enabled: true,
        config: {},
      },
      {
        id: 'hub-account',
        label: 'PDH',
        providerId: 'personal-data-hub',
        adapterId: 'personal-data-hub',
        enabled: false,
        config: { hubUrl: 'https://hub.test', token: 'encrypted:c2VjcmV0', agents: 'claude' },
      },
      {
        id: 'snapshots',
        label: 'Old Claude',
        providerId: 'claude',
        adapterId: 'claude-code-snapshots',
        enabled: true,
        config: {},
      },
    ],
    pin: { connectionId: 'account', metricId: 'week' },
    export: { enabled: false, path: null },
  })

  it('migrates providerId to serviceId once and keeps connections, secrets and the pin', () => {
    const f = fixture()
    hubManifest(f)
    const stored = legacySettings(f)
    f.state.set(USAGE_STATE_KEY, JSON.stringify(stored))
    const deps = {
      ...f.deps,
      bundledAdapterDirectories: bundledUsageAdapterDirectories(false, repo, ''),
    }
    const service = new UsageService(deps)
    services.push(service)
    expect(service.read().cacheError).toBeNull()
    const settings = service.getSettings()
    // A bundled service renamed with protocol 3 takes its declared id; others keep theirs.
    expect(settings.connections.map((c) => [c.id, c.adapterId, c.serviceId, c.enabled])).toEqual([
      ['account', 'source', 'fixture', true],
      ['codex-account', 'codex-app-server', 'codex-cli', true],
      ['hub-account', 'personal-data-hub', 'personal-data-hub', false],
      ['snapshots', 'claude-code-snapshots', 'claude', true],
    ])
    expect(settings.connections[2].secretKeys).toEqual(['token'])
    expect(settings.pin).toEqual(stored.pin)
    // Written back at once with serviceId; the encrypted secret is copied unchanged.
    const written = f.state.get(USAGE_STATE_KEY) ?? ''
    expect(written).not.toContain('providerId')
    const document = JSON.parse(written)
    expect(document.connections[2].config).toEqual(stored.connections[2].config)
    expect(document.connections.map((c: { serviceId: string }) => c.serviceId)).toEqual([
      'fixture',
      'codex-cli',
      'personal-data-hub',
      'claude',
    ])
    expect(document.pin).toEqual(stored.pin)
    // No snapshot exposes the removed field.
    expect(JSON.stringify(service.read())).not.toContain('providerId')
    // A restart reads the migrated document as is.
    const restarted = new UsageService(deps)
    services.push(restarted)
    expect(restarted.getSettings()).toEqual(settings)
    expect(f.state.get(USAGE_STATE_KEY)).toBe(written)
  })

  it('keeps the legacy read pending while the adapter is unresolved, then saves its declared id (U8)', () => {
    const f = fixture()
    const stored = {
      connections: [
        {
          id: 'hub-account',
          label: 'PDH',
          providerId: 'old-hub',
          adapterId: 'personal-data-hub',
          enabled: true,
          config: { hubUrl: 'https://hub.test', token: 'encrypted:c2VjcmV0' },
        },
      ],
      pin: null,
      export: { enabled: false, path: null },
    }
    const legacy = JSON.stringify(stored)
    f.state.set(USAGE_STATE_KEY, legacy)
    const service = new UsageService(f.deps)
    services.push(service)
    expect(service.read().cacheError).toBeNull()
    expect(service.getSettings().connections[0].serviceId).toBe('old-hub')
    // The provisional id is not written back; a restart repeats the legacy read.
    expect(f.state.get(USAGE_STATE_KEY)).toBe(legacy)
    hubManifest(f)
    service.saveSettings(service.getSettings())
    const written = f.state.get(USAGE_STATE_KEY) ?? ''
    expect(written).not.toContain('providerId')
    expect(JSON.parse(written).connections[0]).toMatchObject({
      serviceId: 'personal-data-hub',
      config: stored.connections[0].config,
    })
  })

  it('reports a failed migration write-back without dropping the loaded settings (U8)', () => {
    const f = fixture()
    const stored = legacySettings(f)
    f.state.set(
      USAGE_STATE_KEY,
      JSON.stringify({ ...stored, connections: [stored.connections[0]] }),
    )
    const service = new UsageService({
      ...f.deps,
      state: {
        ...f.deps.state,
        transaction: () => {
          throw new Error('disk full')
        },
      },
    })
    services.push(service)
    expect(service.read().cacheError).toBe(
      'Cannot save migrated usage settings. They are migrated again at the next start.',
    )
    expect(service.getSettings().connections.map((c) => [c.id, c.serviceId])).toEqual([
      ['account', 'fixture'],
    ])
    expect(service.getSettings().pin).toEqual(stored.pin)
  })

  it('keeps a pin through a save before the first read after a cache discard (U9)', async () => {
    const f = fixture()
    f.service.saveSettings(f.settings)
    await f.service.refresh({ connectionId: 'account' })
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    rmSync(join(f.deps.userDataPath, 'usage', 'observations.json'))
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    expect(restarted.read().connections[0].subscription).toBeNull()
    restarted.saveSettings(restarted.getSettings())
    expect(restarted.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    // The next read that lacks the metric clears it (rule 9).
    const document = f.live()
    document.reports[0].metrics[0].id = 'month'
    writeFileSync(f.input, JSON.stringify(document))
    await restarted.refresh({ connectionId: 'account' })
    expect(restarted.read().connections[0].subscription?.metrics[0].id).toBe('month')
    expect(restarted.read().pin).toBeNull()
  })

  it('rejects a document that mixes providerId and serviceId instead of guessing', () => {
    const f = fixture()
    const stored = legacySettings(f)
    f.state.set(
      USAGE_STATE_KEY,
      JSON.stringify({
        ...stored,
        connections: [{ ...stored.connections[0], serviceId: 'fixture' }],
      }),
    )
    const service = new UsageService(f.deps)
    services.push(service)
    expect(service.read().cacheError).toBe('Cannot load usage settings. Configure usage again.')
    expect(service.getSettings().connections).toEqual([])
  })

  it.each([
    [
      'schema 1',
      (cache: Record<string, unknown>) => ({
        schemaVersion: 1,
        connectionRevisions: cache.connectionRevisions,
        subscriptions: [
          {
            id: 'account',
            providerId: 'fixture',
            label: 'Fixture account',
            sourceKind: 'api',
            status: 'available',
            metrics: [
              {
                id: 'week',
                label: '7d',
                kind: 'window',
                state: 'available',
                observedAt: '2026-10-20T12:00:00Z',
                usedPercent: 99,
              },
            ],
          },
        ],
      }),
    ],
    [
      'a metric providerId',
      (cache: Record<string, unknown>) => {
        const next = structuredClone(cache) as {
          reports: Array<{ metrics: Array<Record<string, unknown>> }>
        }
        next.reports[0].metrics[0].providerId = 'opencode'
        return next
      },
    ],
  ])('discards a cache with %s instead of relabelling it (U9)', async (_name, legacy) => {
    const f = fixture()
    f.service.saveSettings({ ...f.settings, pin: null })
    await f.service.refresh({ connectionId: 'account' })
    f.service.saveSettings({
      ...f.service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const cachePath = join(f.deps.userDataPath, 'usage', 'observations.json')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    writeFileSync(cachePath, JSON.stringify(legacy(cache)))
    const restarted = new UsageService(f.deps)
    services.push(restarted)
    // Proves the cache was read: a valid copy of the same file restores the report.
    expect(restarted.read().cacheError).toBeNull()
    expect(restarted.read().connections[0].subscription).toBeNull()
    expect(restarted.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    await restarted.refresh({ connectionId: 'account' })
    const report = restarted.read().connections[0].subscription
    expect(report?.subscriptions).toEqual([{ id: 'fixture-plan', label: 'Fixture plan' }])
    expect(report?.metrics[0]).toMatchObject({ id: 'week', usedPercent: 42 })
    expect(restarted.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(readFileSync(cachePath, 'utf8')).not.toContain('providerId')
    writeFileSync(cachePath, JSON.stringify(cache))
    const valid = new UsageService(f.deps)
    services.push(valid)
    expect(valid.read().connections[0].subscription?.metrics[0].usedPercent).toBe(42)
  })

  it('lists a connection whose adapter became protocol 2 with its error, cache and pin, and starts no process (U14)', async () => {
    const f = fixture(),
      { service, read } = plugin(f)
    await service.refresh({ connectionId: 'account' })
    service.saveSettings({
      ...service.getSettings(),
      pin: { connectionId: 'account', metricId: 'week' },
    })
    const manifest = join(f.deps.userDataPath, 'usage-adapters', 'fixture', 'usage-adapter.json')
    writeFileSync(
      manifest,
      JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), protocolVersion: 2 }),
    )
    expect(service.listAdapters().find((a) => a.id === 'invalid:fixture')?.error).toBe(
      'This adapter uses protocol version 2. Update it to protocol version 3, which reports subscriptions.',
    )
    read.mockClear()
    f.advance(60_000)
    await service.refresh({ connectionId: 'account' })
    const source = service.read().connections[0]
    expect(source.connection.id).toBe('account')
    expect(source.error).toMatchObject({ code: 'config' })
    expect(source.subscription?.metrics[0]).toMatchObject({ id: 'week', usedPercent: 42 })
    expect(service.read().pin).toEqual({ connectionId: 'account', metricId: 'week' })
    expect(read).not.toHaveBeenCalled()
  })
})
