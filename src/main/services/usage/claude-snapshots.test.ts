import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseUsageDocument, type UsageSettings } from '../../../shared/usage-contract'
import { readClaudeSnapshots } from './claude-snapshots'
import { UsageService } from './usage-service'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const RESET_5H = 1_792_500_000,
  RESET_7D = 1_792_900_000
/** A 5-hour reset still in the future at NOW (RESET_5H has already passed). */
const LIVE_5H = NOW / 1000 + 3 * 3600
const roots: string[] = [],
  services: UsageService[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.shutdown()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-claude-snapshots-'))
  roots.push(dir)
  const snapshots = join(dir, 'claude')
  mkdirSync(snapshots)
  let order = 0
  /** Write a file whose modification time increases with each call (newest last). */
  const put = (name: string, content: unknown, mtimeOffsetSeconds?: number) => {
    const path = join(snapshots, name)
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
    const time = NOW / 1000 - 3600 + (mtimeOffsetSeconds ?? order++)
    utimesSync(path, time, time)
    return path
  }
  return { dir, snapshots, put }
}
// Agent Harness format: Claude Code's raw status-line stdin JSON.
const harness = (sessionId: string, rateLimits: unknown) => ({
  session_id: sessionId,
  transcript_path: 'C:/fixture-private/transcript.jsonl',
  cwd: 'C:/fixture-private-project',
  model: { id: 'fixture-model', display_name: 'Fixture' },
  context_window: { used_percentage: 99, remaining_percentage: 1 },
  cost: { total_cost_usd: 12.5 },
  rate_limits: rateLimits,
})
// NeKode writer format: only session_id and the raw rate_limits object.
const reduced = (sessionId: string, rateLimits: unknown) => ({
  session_id: sessionId,
  rate_limits: rateLimits,
})
const window = (percent: unknown, reset: unknown) => ({
  used_percentage: percent,
  resets_at: reset,
})
const connection = { id: 'claude-max', providerId: 'claude', label: 'Claude Max' }
const read = (snapshots: string) => {
  const document = parseUsageDocument(readClaudeSnapshots(snapshots, connection, NOW), NOW)
  const sub = document.subscriptions[0]
  return { sub, metric: (id: string) => sub.metrics.find((m) => m.id === id) }
}

describe('Claude Code snapshot directory reader', () => {
  it('reads harness-format and reduced-format files, only rate limits, age unknown', () => {
    const f = temp()
    f.put('a.json', harness('a', { five_hour: window(23.5, RESET_5H) }))
    f.put('b.json', reduced('b', { seven_day: window(41.2, RESET_7D) }))
    const { sub, metric } = read(f.snapshots)
    expect(sub).toMatchObject({ id: 'claude-max', providerId: 'claude', status: 'available' })
    expect(sub.metrics.map((m) => m.id)).toEqual(['five_hour', 'seven_day'])
    expect(metric('five_hour')).toMatchObject({
      label: '5h',
      state: 'available',
      usedPercent: 23.5,
      observedAt: null,
      collectedAt: new Date(NOW).toISOString(),
      resetsAt: new Date(RESET_5H * 1000).toISOString(),
      periodStart: new Date((RESET_5H - 18_000) * 1000).toISOString(),
      windowDurationSeconds: 18_000,
    })
    expect(metric('seven_day')).toMatchObject({ usedPercent: 41.2, windowDurationSeconds: 604_800 })
    const text = JSON.stringify(sub)
    for (const leaked of ['fixture-private', 'transcript', '99', '12.5'])
      expect(text).not.toContain(leaked)
  })
  it('never lets an interleaved stale session regress newer values', () => {
    const f = temp()
    // Newest session by modification time re-renders older cached values.
    f.put(
      'fresh.json',
      reduced('fresh', {
        five_hour: window(60, RESET_5H),
        seven_day: window(30, RESET_7D),
      }),
    )
    f.put(
      'stale.json',
      harness('stale', {
        five_hour: window(80, RESET_5H - 18_000),
        seven_day: window(10, RESET_7D),
      }),
    )
    const { metric } = read(f.snapshots)
    // Later reset wins even though the stale file is newer and higher.
    expect(metric('five_hour')).toMatchObject({
      usedPercent: 60,
      resetsAt: new Date(RESET_5H * 1000).toISOString(),
    })
    // Same reset keeps the higher value.
    expect(metric('seven_day')?.usedPercent).toBe(30)
  })
  it('does not let an absent or invalid window in one file erase a valid value from another', () => {
    const f = temp()
    f.put(
      'old.json',
      reduced('old', {
        five_hour: window(20, RESET_5H),
        seven_day: window(40, RESET_7D),
        spend_limit: window(120, RESET_7D),
      }),
    )
    f.put('new.json', harness('new', { five_hour: window('high', RESET_5H + 100) }))
    f.put('newest.json', harness('newest', {}))
    const { sub, metric } = read(f.snapshots)
    expect(metric('five_hour')?.usedPercent).toBe(20)
    expect(metric('seven_day')?.usedPercent).toBe(40)
    expect(metric('spend_limit')).toMatchObject({
      state: 'available',
      usedPercent: 120,
      windowDurationSeconds: null,
      periodStart: null,
    })
    expect(sub.metrics).toHaveLength(3)
  })
  it('skips oversized, unparseable, foreign and non-regular entries', () => {
    const f = temp()
    f.put('valid.json', reduced('valid', { five_hour: window(10, RESET_5H) }))
    const padding = 'x'.repeat(256 * 1024)
    f.put('oversized.json', {
      ...reduced('big', { five_hour: window(99, RESET_5H + 9999) }),
      padding,
    })
    f.put('partial.json', '{"session_id":"p","rate_limits":{"five_hour":')
    f.put('foreign.json', { schemaVersion: 1, subscriptions: [] })
    f.put('array.json', [1, 2])
    f.put('notes.txt', JSON.stringify(reduced('txt', { five_hour: window(98, RESET_5H + 9999) })))
    mkdirSync(join(f.snapshots, 'nested.json'))
    const { metric } = read(f.snapshots)
    expect(metric('five_hour')?.usedPercent).toBe(10)
  })
  it('reads only the 256 most recently modified files', () => {
    const f = temp()
    f.put('oldest.json', reduced('oldest', { seven_day: window(90, RESET_7D + 86_400) }), -10)
    for (let n = 0; n < 256; n++)
      f.put(`s${n}.json`, reduced(`s${n}`, { seven_day: window(5, RESET_7D) }), n)
    expect(read(f.snapshots).metric('seven_day')?.usedPercent).toBe(5)
    f.put('oldest.json', reduced('oldest', { seven_day: window(90, RESET_7D + 86_400) }), 1000)
    expect(read(f.snapshots).metric('seven_day')?.usedPercent).toBe(90)
  })
  it('reports not_reported unavailability when no valid window exists', () => {
    const f = temp()
    expect(read(f.snapshots).sub).toMatchObject({ status: 'unavailable' })
    f.put('a.json', harness('a', { five_hour: window(-1, RESET_5H) }))
    f.put('b.json', { session_id: 'b' })
    const { sub } = read(f.snapshots)
    expect(sub.status).toBe('unavailable')
    expect(sub.metrics.map((m) => [m.id, m.state, m.reason])).toEqual([
      ['five_hour', 'unavailable', 'not_reported'],
      ['seven_day', 'unavailable', 'not_reported'],
    ])
  })
  it('lets a future numeric reset beat a null reset regardless of file order or value', () => {
    const f = temp()
    f.put('numeric.json', reduced('numeric', { five_hour: window(15, LIVE_5H) }))
    f.put('unknown.json', reduced('unknown', { five_hour: window(95, null) }))
    expect(read(f.snapshots).metric('five_hour')).toMatchObject({
      usedPercent: 15,
      resetsAt: new Date(LIVE_5H * 1000).toISOString(),
    })
  })
  it('lets a null reset beat an expired numeric reset within one read', () => {
    const f = temp()
    f.put('unknown.json', reduced('unknown', { five_hour: window(12, null) }))
    f.put('expired.json', reduced('expired', { five_hour: window(90, RESET_5H) }))
    expect(read(f.snapshots).metric('five_hour')).toMatchObject({ usedPercent: 12, resetsAt: null })
  })
  it('accepts a file of exactly 256 KiB and skips one of 256 KiB plus one byte', () => {
    const f = temp()
    const sized = (sessionId: string, percent: number, bytes: number) => {
      const base = JSON.stringify({
        ...reduced(sessionId, { seven_day: window(percent, RESET_7D) }),
        padding: '',
      })
      const text = base.replace('"padding":""', `"padding":"${'x'.repeat(bytes - base.length)}"`)
      expect(Buffer.byteLength(text)).toBe(bytes)
      return text
    }
    f.put('exact.json', sized('exact', 30, 256 * 1024))
    expect(read(f.snapshots).metric('seven_day')?.usedPercent).toBe(30)
    f.put('over.json', sized('over', 70, 256 * 1024 + 1))
    expect(read(f.snapshots).metric('seven_day')?.usedPercent).toBe(30)
  })
  it('never writes to the directory', () => {
    const f = temp()
    const path = f.put('a.json', reduced('a', { five_hour: window(10, RESET_5H) }))
    const before = statSync(path).mtimeMs
    read(f.snapshots)
    expect(readdirSync(f.snapshots)).toEqual(['a.json'])
    expect(statSync(path).mtimeMs).toBe(before)
  })
})

describe('Claude snapshot connections in the usage service', () => {
  function fixture() {
    const f = temp()
    const state = new Map<string, string>([['usage.enabled', 'true']])
    let now = NOW
    const deps = {
      userDataPath: join(f.dir, 'profile'),
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
    const settings = (directory: string, exportPath: string | null = null): UsageSettings => ({
      connections: [
        {
          id: 'claude-max',
          label: 'Claude Max',
          providerId: 'claude',
          adapterId: 'claude-code-snapshots',
          enabled: true,
          config: { directory },
        },
      ],
      pin: null,
      adaptersDirectory: null,
      export: { enabled: exportPath !== null, path: exportPath },
    })
    return { ...f, service, settings, advance: (ms: number) => (now += ms) }
  }
  it('is listed as a built-in reader and collects with age unknown', async () => {
    const f = fixture()
    expect(f.service.listAdapters().map((a) => a.id)).toContain('claude-code-snapshots')
    f.put('a.json', harness('a', { five_hour: window(33, RESET_5H) }))
    f.service.saveSettings(f.settings(f.snapshots))
    await f.service.refresh()
    const c = f.service.read().connections[0]
    expect(c.error).toBeNull()
    expect(c.subscription).toMatchObject({ label: 'Claude Max', sourceKind: 'file' })
    expect(c.subscription?.metrics[0]).toMatchObject({ usedPercent: 33, observedAt: null })
  })
  it('treats a missing directory with an existing parent as transient io', async () => {
    const f = fixture()
    const missing = join(f.dir, 'not-yet')
    f.service.saveSettings(f.settings(missing))
    await f.service.refresh()
    expect(f.service.read().connections[0].error?.code).toBe('io')
    mkdirSync(missing)
    writeFileSync(
      join(missing, 's.json'),
      JSON.stringify(reduced('s', { five_hour: window(7, RESET_5H) })),
    )
    f.advance(5000)
    await f.service.refresh()
    expect(f.service.read().connections[0].error).toBeNull()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(7)
    expect(() => f.service.saveSettings(f.settings(join(f.dir, 'absent', 'claude')))).toThrow(
      'folder',
    )
  })
  it('does not regress to an older session value across polls when the newest file is deleted', async () => {
    const f = fixture()
    const older = f.put('older.json', reduced('older', { five_hour: window(80, LIVE_5H - 18_000) }))
    const same = f.put('same.json', reduced('same', { seven_day: window(20, RESET_7D) }))
    const newest = f.put(
      'newest.json',
      reduced('newest', { five_hour: window(30, LIVE_5H), seven_day: window(45, RESET_7D) }),
    )
    f.service.saveSettings(f.settings(f.snapshots))
    await f.service.refresh()
    const metric = (id: string) =>
      f.service.read().connections[0].subscription?.metrics.find((m) => m.id === id)
    expect(metric('five_hour')?.usedPercent).toBe(30)
    expect(metric('seven_day')?.usedPercent).toBe(45)
    rmSync(newest)
    f.advance(5000)
    await f.service.refresh()
    // Later reset wins across polls; for the same reset the higher value is kept.
    expect(metric('five_hour')).toMatchObject({
      usedPercent: 30,
      resetsAt: new Date(LIVE_5H * 1000).toISOString(),
    })
    expect(metric('seven_day')?.usedPercent).toBe(45)
    // A genuinely newer value still replaces the kept one.
    f.put('later.json', reduced('later', { five_hour: window(5, LIVE_5H + 18_000) }))
    writeFileSync(same, JSON.stringify(reduced('same', { seven_day: window(50, RESET_7D) })))
    f.advance(5000)
    await f.service.refresh()
    expect(metric('five_hour')?.usedPercent).toBe(5)
    expect(metric('seven_day')?.usedPercent).toBe(50)
    // A configuration change resets runtime state, so the current files are shown as read.
    rmSync(join(f.snapshots, 'later.json'))
    const moved = join(f.dir, 'moved')
    mkdirSync(moved)
    writeFileSync(
      join(moved, 'older.json'),
      JSON.stringify(reduced('older', { five_hour: window(80, LIVE_5H - 18_000) })),
    )
    rmSync(older)
    f.service.saveSettings(f.settings(moved))
    f.advance(5000)
    await f.service.refresh()
    expect(metric('five_hour')?.usedPercent).toBe(80)
  })
  it('keeps a future numeric reset over a null reset across polls', async () => {
    const f = fixture()
    const numeric = f.put('numeric.json', reduced('numeric', { five_hour: window(15, LIVE_5H) }))
    f.put('unknown.json', reduced('unknown', { five_hour: window(95, null) }))
    f.service.saveSettings(f.settings(f.snapshots))
    await f.service.refresh()
    rmSync(numeric)
    f.advance(5000)
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0]).toMatchObject({
      usedPercent: 15,
      resetsAt: new Date(LIVE_5H * 1000).toISOString(),
    })
  })
  it('does not pin an old higher value across polls when both resets are null', async () => {
    const f = fixture()
    const path = f.put('a.json', reduced('a', { five_hour: window(95, null) }))
    f.service.saveSettings(f.settings(f.snapshots))
    await f.service.refresh()
    writeFileSync(path, JSON.stringify(reduced('a', { five_hour: window(40, null) })))
    f.advance(5000)
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0]).toMatchObject({
      usedPercent: 40,
      resetsAt: null,
    })
  })
  it('replaces an expired kept window with a later valid null-reset read', async () => {
    const f = fixture()
    const expired = f.put('expired.json', reduced('expired', { five_hour: window(30, RESET_5H) }))
    f.service.saveSettings(f.settings(f.snapshots))
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0].usedPercent).toBe(30)
    rmSync(expired)
    f.put('current.json', reduced('current', { five_hour: window(10, null) }))
    f.advance(5000)
    await f.service.refresh()
    expect(f.service.read().connections[0].subscription?.metrics[0]).toMatchObject({
      usedPercent: 10,
      resetsAt: null,
    })
  })
  it('rejects an export inside the directory and a junction alias', () => {
    const f = fixture()
    expect(() =>
      f.service.saveSettings(f.settings(f.snapshots, join(f.snapshots, 'export.json'))),
    ).toThrow('differ')
    expect(() => f.service.saveSettings(f.settings(f.snapshots, f.snapshots))).toThrow('differ')
    const junction = join(f.dir, 'junction')
    symlinkSync(f.snapshots, junction, 'junction')
    expect(() => f.service.saveSettings(f.settings(junction))).toThrow('junction')
    expect(f.service.getSettings().connections).toEqual([])
  })
})
