import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseUsageDocument, type UsageDocument } from '../../../shared/usage-contract'

const packageDirectory = resolve(__dirname, '../../../../adapters/usage-claude-code')
const load = createRequire(__filename)
const collector = load(join(packageDirectory, 'collector.cjs')) as {
  collect(payload: unknown, options: Options, now?: Date): 'written' | 'unchanged'
  mapStatusLine(payload: unknown, options: Options, now?: Date): UsageDocument | null
}
const setup = load(join(packageDirectory, 'setup.cjs')) as {
  apply(options: Record<string, string>): { proposed: { command: string } }
  plan(options: Record<string, string>): {
    proposed: Record<string, unknown> & { command: string }
    warnings: string[]
  }
  remove(options: Record<string, string>): unknown
}
interface Options {
  output: string
  connectionId: string
  providerId: string
}

// Sanitized documented status-line payload; session fields stand in for private metadata.
const RESET_5H = 1_792_500_000,
  RESET_7D = 1_792_900_000
const payload = (rateLimits?: unknown) => ({
  session_id: 'fixture-session-secret',
  cwd: 'C:/fixture-private-project',
  model: { id: 'fixture-model', display_name: 'Fixture' },
  context_window: { used_percentage: 99, remaining_percentage: 1 },
  ...(rateLimits === undefined ? {} : { rate_limits: rateLimits }),
})
const BOTH = {
  five_hour: { used_percentage: 23.5, resets_at: RESET_5H },
  seven_day: { used_percentage: 41.2, resets_at: RESET_7D },
}
const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-claude-'))
  roots.push(dir)
  const options: Options = {
    output: join(dir, 'claude-usage.json'),
    connectionId: 'claude-max',
    providerId: 'claude',
  }
  const read = () => JSON.parse(readFileSync(options.output, 'utf8')) as UsageDocument
  return { dir, options, read }
}
const NOW = new Date('2026-10-20T12:00:00.000Z')

describe('Claude Code status-line collector', () => {
  it('maps only documented rate-limit windows, age unknown, with documented durations', () => {
    const { options } = temp()
    const document = collector.mapStatusLine(payload(BOTH), options, NOW)
    const parsed = parseUsageDocument(document, NOW.getTime())
    const [five, seven] = parsed.subscriptions[0].metrics
    expect(parsed.subscriptions[0]).toMatchObject({ id: 'claude-max', providerId: 'claude' })
    expect(five).toMatchObject({
      id: 'five_hour',
      label: '5h',
      state: 'available',
      usedPercent: 23.5,
      observedAt: null,
      collectedAt: NOW.toISOString(),
      resetsAt: new Date(RESET_5H * 1000).toISOString(),
      periodStart: new Date((RESET_5H - 18_000) * 1000).toISOString(),
      windowDurationSeconds: 18_000,
    })
    expect(seven).toMatchObject({
      id: 'seven_day',
      usedPercent: 41.2,
      windowDurationSeconds: 604_800,
    })
    expect(parsed.subscriptions[0].metrics).toHaveLength(2)
    const text = JSON.stringify(document)
    for (const leaked of ['fixture-session-secret', 'fixture-private-project', '99'])
      expect(text).not.toContain(leaked)
  })
  it('marks absent or invalid windows unavailable and maps a present spend limit', () => {
    const { options } = temp()
    const document = collector.mapStatusLine(
      payload({
        five_hour: { used_percentage: 'high', resets_at: RESET_5H },
        spend_limit: { used_percentage: 120, resets_at: RESET_7D, used_usd: 12 },
      }),
      options,
      NOW,
    )
    const metrics = parseUsageDocument(document, NOW.getTime()).subscriptions[0].metrics
    expect(metrics.map((m) => [m.id, m.state, m.reason ?? null])).toEqual([
      ['five_hour', 'unavailable', 'invalid_value'],
      ['seven_day', 'unavailable', 'not_reported'],
      ['spend_limit', 'available', null],
    ])
    expect(metrics[2]).toMatchObject({
      usedPercent: 120,
      windowDurationSeconds: null,
      periodStart: null,
    })
    expect(metrics.slice(0, 2).every((m) => m.usedPercent == null)).toBe(true)
  })
  it('keeps repeated payloads conservatively old and writes only on change', () => {
    const { options, read } = temp()
    expect(collector.collect(payload(BOTH), options, NOW)).toBe('written')
    const later = new Date(NOW.getTime() + 10 * 60_000)
    expect(collector.collect(payload(BOTH), options, later)).toBe('unchanged')
    expect(read().subscriptions[0].metrics[0]).toMatchObject({
      observedAt: null,
      collectedAt: NOW.toISOString(),
    })
    const changed = { ...BOTH, five_hour: { used_percentage: 30, resets_at: RESET_5H } }
    expect(collector.collect(payload(changed), options, later)).toBe('written')
    expect(read().subscriptions[0].metrics[0]).toMatchObject({
      observedAt: null,
      usedPercent: 30,
      collectedAt: later.toISOString(),
    })
  })
  it('does not erase known values when a new session has not reported limits yet', () => {
    const { options, read } = temp()
    expect(collector.collect(payload(), options, NOW)).toBe('written')
    expect(read().subscriptions[0].metrics.map((m) => m.reason)).toEqual([
      'not_reported',
      'not_reported',
    ])
    collector.collect(payload(BOTH), options, NOW)
    expect(collector.collect(payload(), options, NOW)).toBe('unchanged')
    expect(read().subscriptions[0].metrics[0].usedPercent).toBe(23.5)
    expect(collector.collect(payload({ seven_day: BOTH.seven_day }), options, NOW)).toBe('written')
    expect(read().subscriptions[0].metrics[0]).toMatchObject({
      state: 'unavailable',
      reason: 'not_reported',
    })
  })
  it('passes the raw input through and never prints payload content on failure', () => {
    const { options } = temp()
    const script = join(packageDirectory, 'collector.cjs')
    const args = [script, '--output', options.output, '--connection-id', 'claude-max']
    const input = JSON.stringify(payload(BOTH))
    const ok = spawnSync(process.execPath, [...args, '--pass-through'], { input })
    expect(ok.status).toBe(0)
    expect(ok.stdout.toString()).toBe(input)
    expect(existsSync(options.output)).toBe(true)
    const broken = '{"session_id":"fixture-session-secret",'
    const failed = spawnSync(process.execPath, [...args, '--pass-through'], { input: broken })
    expect(failed.status).toBe(1)
    expect(failed.stdout.toString()).toBe(broken)
    expect(failed.stderr.toString()).toContain('not JSON')
    expect(failed.stderr.toString()).not.toContain('fixture-session-secret')
  })
})

describe('Claude Code status-line setup', () => {
  function settingsFixture(statusLine?: unknown) {
    const { dir, options } = temp()
    const settings = join(dir, 'settings.json')
    writeFileSync(
      settings,
      JSON.stringify({
        model: 'fixture',
        hooks: { Stop: [] },
        ...(statusLine ? { statusLine } : {}),
      }),
    )
    return { settings, args: { settings, output: options.output, connectionId: 'claude-max' } }
  }
  const ORIGINAL = {
    type: 'command',
    command: `"${process.execPath.replace(/\\/g, '/')}" -e "process.stdin.on('data',d=>process.stdout.write('[' + JSON.parse(d).model.display_name + ']'))"`,
    padding: 2,
    refreshInterval: 5,
  }
  it('previews without writing and retains the existing status line fields', () => {
    const f = settingsFixture(ORIGINAL)
    const before = readFileSync(f.settings, 'utf8')
    const proposal = setup.plan({ ...f.args, providerId: 'claude', node: 'node' })
    expect(readFileSync(f.settings, 'utf8')).toBe(before)
    expect(existsSync(`${f.settings}.nekode-usage-backup.json`)).toBe(false)
    expect(proposal.proposed).toMatchObject({ type: 'command', padding: 2, refreshInterval: 5 })
    expect(proposal.proposed.command).toContain('--pass-through')
    expect(proposal.proposed.command.endsWith(`| ${ORIGINAL.command}`)).toBe(true)
    expect(proposal.proposed.command).not.toContain('\\')
  })
  it('applies, keeps the previous status line output working, and removes exactly', () => {
    const f = settingsFixture(ORIGINAL)
    const before = readFileSync(f.settings, 'utf8')
    const options = { ...f.args, providerId: 'claude', node: process.execPath }
    const { proposed } = setup.apply(options)
    const installed = JSON.parse(readFileSync(f.settings, 'utf8'))
    expect(installed).toMatchObject({ model: 'fixture', hooks: { Stop: [] } })
    expect(installed.statusLine).toMatchObject({ padding: 2, refreshInterval: 5 })
    expect(installed.statusLine.command).toBe(proposed.command)
    expect(() => setup.apply(options)).toThrow('already configured')
    // Claude Code runs the command through a shell; the piped original still renders.
    const run = spawnSync(installed.statusLine.command, {
      shell: true,
      input: JSON.stringify(payload(BOTH)),
    })
    expect(run.stdout.toString().trim()).toBe('[Fixture]')
    expect(JSON.parse(readFileSync(f.args.output, 'utf8')).subscriptions[0].id).toBe('claude-max')
    setup.remove({ settings: f.settings })
    expect(JSON.parse(readFileSync(f.settings, 'utf8'))).toEqual(JSON.parse(before))
    expect(existsSync(`${f.settings}.nekode-usage-backup.json`)).toBe(false)
  })
  it('installs without pass-through when no status line exists and removes the key', () => {
    const f = settingsFixture()
    const { proposed } = setup.apply({ ...f.args, providerId: 'claude', node: 'node' })
    expect(proposed.command).not.toContain('--pass-through')
    setup.remove({ settings: f.settings })
    expect(JSON.parse(readFileSync(f.settings, 'utf8'))).toEqual({
      model: 'fixture',
      hooks: { Stop: [] },
    })
  })
  it('refuses removal after the user changed the status line', () => {
    const f = settingsFixture(ORIGINAL)
    setup.apply({ ...f.args, providerId: 'claude', node: 'node' })
    const changed = JSON.parse(readFileSync(f.settings, 'utf8'))
    changed.statusLine.command = 'echo changed'
    writeFileSync(f.settings, JSON.stringify(changed))
    expect(() => setup.remove({ settings: f.settings })).toThrow('changed after setup')
    expect(JSON.parse(readFileSync(f.settings, 'utf8')).statusLine.command).toBe('echo changed')
  })
  it('warns about compound commands and rejects unsafe paths', () => {
    const f = settingsFixture({ type: 'command', command: 'a && b' })
    expect(setup.plan({ ...f.args, providerId: 'claude', node: 'node' }).warnings).toHaveLength(1)
    expect(() => setup.plan({ ...f.args, providerId: 'claude', node: 'C:/$bad/node.exe' })).toThrow(
      'Paths cannot contain',
    )
  })
})
