import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readClaudeSnapshots } from './claude-snapshots'

const packageDirectory = resolve(__dirname, '../../../../adapters/usage-claude-code')
const load = createRequire(__filename)
const collector = load(join(packageDirectory, 'collector.cjs')) as {
  collect(payload: unknown, options: Options): 'written' | 'unchanged' | 'skipped'
  defaultDirectory(env: Record<string, string | undefined>, home: string): string
  parseArgs(argv: string[], env?: Record<string, string | undefined>): Options
}
const setup = load(join(packageDirectory, 'setup.cjs')) as {
  apply(options: Record<string, string>): { proposed: { command: string } }
  plan(options: Record<string, string>): {
    proposed: Record<string, unknown> & { command: string }
    warnings: string[]
  }
  remove(options: Record<string, string>): unknown
}
const fs = load('node:fs') as typeof import('node:fs')
interface Options {
  dir: string
}

// Sanitized documented status-line payload; session fields stand in for private metadata.
const RESET_5H = 1_792_500_000,
  RESET_7D = 1_792_900_000
const payload = (rateLimits?: unknown, sessionId = 'fixture-session') => ({
  session_id: sessionId,
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
  vi.restoreAllMocks()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-claude-'))
  roots.push(dir)
  const options: Options = { dir: join(dir, 'snapshots', 'claude') }
  const read = (session = 'fixture-session') =>
    JSON.parse(readFileSync(join(options.dir, `${session}.json`), 'utf8'))
  return { dir, options, read }
}
const NOW = Date.parse('2026-10-21T12:00:00.000Z')
const connection = { id: 'claude-max', providerId: 'claude', label: 'Claude Max' }

describe('Claude Code status-line snapshot writer', () => {
  it('writes only session_id and the raw rate_limits per session, readable by the reader', () => {
    const { options, read } = temp()
    expect(collector.collect(payload(BOTH), options)).toBe('written')
    expect(read()).toEqual({ session_id: 'fixture-session', rate_limits: BOTH })
    expect(readdirSync(options.dir)).toEqual(['fixture-session.json'])
    const metrics = readClaudeSnapshots(options.dir, connection, NOW).subscriptions[0].metrics
    expect(metrics.map((m) => [m.id, m.state, m.usedPercent, m.observedAt])).toEqual([
      ['five_hour', 'available', 23.5, null],
      ['seven_day', 'available', 41.2, null],
    ])
    const text = readFileSync(join(options.dir, 'fixture-session.json'), 'utf8')
    for (const leaked of ['fixture-private-project', 'context_window', 'Fixture'])
      expect(text).not.toContain(leaked)
  })
  it('keeps sessions in separate files and rewrites only on change', () => {
    const { options, read } = temp()
    collector.collect(payload(BOTH, 'one'), options)
    collector.collect(payload({ five_hour: BOTH.five_hour }, 'two'), options)
    expect(readdirSync(options.dir).sort()).toEqual(['one.json', 'two.json'])
    expect(collector.collect(payload(BOTH, 'one'), options)).toBe('unchanged')
    const changed = { ...BOTH, five_hour: { used_percentage: 30, resets_at: RESET_5H } }
    expect(collector.collect(payload(changed, 'one'), options)).toBe('written')
    expect(read('one').rate_limits.five_hour.used_percentage).toBe(30)
  })
  it('does not write before the session reports limits or for unsafe session ids', () => {
    const { options } = temp()
    expect(collector.collect(payload(), options)).toBe('skipped')
    expect(existsSync(options.dir)).toBe(false)
    for (const id of ['..', '../escape', 'a/b', '', '.hidden'])
      expect(() => collector.collect(payload(BOTH, id), options)).toThrow('session_id')
    expect(() => collector.collect(payload([1]), options)).toThrow('rate_limits')
  })
  it('defaults to the Agent Harness snapshot directory', () => {
    const home = join(tmpdir(), 'fixture-home')
    expect(collector.defaultDirectory({}, home)).toBe(
      join(home, '.cache', 'agent-capacity', 'claude'),
    )
    expect(collector.defaultDirectory({ XDG_CACHE_HOME: join(home, 'xdg') }, home)).toBe(
      join(home, 'xdg', 'agent-capacity', 'claude'),
    )
    expect(
      collector.defaultDirectory(
        { AGENT_CAPACITY_SNAPSHOT_DIR: join(home, 'capacity'), XDG_CACHE_HOME: join(home, 'xdg') },
        home,
      ),
    ).toBe(join(home, 'capacity', 'claude'))
    expect(collector.parseArgs(['--dir', join(home, 'd')]).dir).toBe(join(home, 'd'))
    expect(() => collector.parseArgs(['--dir', 'relative'])).toThrow('absolute')
    expect(() => collector.parseArgs(['--output', join(home, 'x.json')])).toThrow('unknown')
  })
  it('passes the raw input through and never prints payload content on failure', () => {
    const { options } = temp()
    const script = join(packageDirectory, 'collector.cjs')
    const args = [script, '--dir', options.dir]
    const input = JSON.stringify(payload(BOTH))
    const ok = spawnSync(process.execPath, [...args, '--pass-through'], { input })
    expect(ok.status).toBe(0)
    expect(ok.stdout.toString()).toBe(input)
    expect(existsSync(join(options.dir, 'fixture-session.json'))).toBe(true)
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
    return { settings, args: { settings, dir: options.dir } }
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
    const proposal = setup.plan({ ...f.args, node: 'node' })
    expect(readFileSync(f.settings, 'utf8')).toBe(before)
    expect(existsSync(`${f.settings}.nekode-usage-backup.json`)).toBe(false)
    expect(proposal.proposed).toMatchObject({ type: 'command', padding: 2, refreshInterval: 5 })
    expect(proposal.proposed.command).toContain('--pass-through')
    expect(proposal.proposed.command).toContain('--dir')
    expect(proposal.proposed.command.endsWith(`| ${ORIGINAL.command}`)).toBe(true)
    expect(proposal.proposed.command).not.toContain('\\')
  })
  it('applies, keeps the previous status line output working, and removes exactly', () => {
    const f = settingsFixture(ORIGINAL)
    const before = readFileSync(f.settings, 'utf8')
    const options = { ...f.args, node: process.execPath }
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
    expect(JSON.parse(readFileSync(join(f.args.dir, 'fixture-session.json'), 'utf8'))).toEqual({
      session_id: 'fixture-session',
      rate_limits: BOTH,
    })
    setup.remove({ settings: f.settings })
    expect(JSON.parse(readFileSync(f.settings, 'utf8'))).toEqual(JSON.parse(before))
    expect(existsSync(`${f.settings}.nekode-usage-backup.json`)).toBe(false)
  })
  it('installs without pass-through when no status line exists and removes the key', () => {
    const f = settingsFixture()
    const { proposed } = setup.apply({ ...f.args, node: 'node' })
    expect(proposed.command).not.toContain('--pass-through')
    setup.remove({ settings: f.settings })
    expect(JSON.parse(readFileSync(f.settings, 'utf8'))).toEqual({
      model: 'fixture',
      hooks: { Stop: [] },
    })
  })
  it('refuses removal after the user changed the status line', () => {
    const f = settingsFixture(ORIGINAL)
    setup.apply({ ...f.args, node: 'node' })
    const changed = JSON.parse(readFileSync(f.settings, 'utf8'))
    changed.statusLine.command = 'echo changed'
    writeFileSync(f.settings, JSON.stringify(changed))
    expect(() => setup.remove({ settings: f.settings })).toThrow('changed after setup')
    expect(JSON.parse(readFileSync(f.settings, 'utf8')).statusLine.command).toBe('echo changed')
  })
  it('removes its backup when the settings write fails, so retry is not blocked', () => {
    const f = settingsFixture(ORIGINAL)
    const before = readFileSync(f.settings, 'utf8')
    const rename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === f.settings)
        throw Object.assign(new Error('fixture write failure'), { code: 'EIO' })
      rename(from, to)
    })
    expect(() => setup.apply({ ...f.args, node: 'node' })).toThrow('fixture write failure')
    spy.mockRestore()
    expect(readFileSync(f.settings, 'utf8')).toBe(before)
    expect(existsSync(`${f.settings}.nekode-usage-backup.json`)).toBe(false)
    expect(() => setup.apply({ ...f.args, node: 'node' })).not.toThrow()
  })
  it('rejects a snapshot directory that contains the settings file', () => {
    const f = settingsFixture(ORIGINAL)
    expect(() =>
      setup.plan({ settings: f.settings, dir: dirname(f.settings), node: 'node' }),
    ).toThrow('settings')
  })
  it('warns about compound commands and rejects unsafe paths', () => {
    const f = settingsFixture({ type: 'command', command: 'a && b' })
    expect(setup.plan({ ...f.args, node: 'node' }).warnings).toHaveLength(1)
    expect(() => setup.plan({ ...f.args, node: 'C:/$bad/node.exe' })).toThrow(
      'Paths cannot contain',
    )
  })
})
