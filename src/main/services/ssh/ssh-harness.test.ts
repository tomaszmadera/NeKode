import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { afterEach, describe, expect, it } from 'vitest'
import { SshClient, type SshRunResult } from './ssh-client'

// End-to-end assembly through the fake ssh harness (spec ssh-projects Required
// tests: "Fake SSH harness: an executable that joins its arguments and runs
// them through `sh -c` like `sshd`, used to assert the joined remote command
// line for hostile argv, a login script that prints to stdout"). The harness
// joins the words after `--` exactly as ssh does and runs that string through
// a real POSIX shell, so a quoting defect in any of the three layers fails
// here.

const HARNESS = fileURLToPath(new URL('../../test-support/fake-ssh.cjs', import.meta.url))

function hasPosixShell(): boolean {
  const result = spawnSync('sh', ['-c', 'true'])
  return result.error === undefined || result.error === null
}

const shellAvailable = hasPosixShell()

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function captureFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-ssh-capture-'))
  tempDirs.push(dir)
  return join(dir, 'command-line.txt')
}

function runHarness(args: string[], env: Record<string, string> = {}): SshRunResult {
  const result = spawnSync(process.execPath, [HARNESS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

function target(value: string): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

/** A client whose runner is the harness, so the executable name is irrelevant. */
function harnessClient(): SshClient {
  return new SshClient({
    platform: 'linux',
    marker: () => 'nekode-harness',
    run: async (_file, args) => runHarness(args),
  })
}

describe('fake ssh harness', () => {
  it('records the joined remote command line of a hostile agent launch', () => {
    const capture = captureFile()
    const ssh = new SshClient({ platform: 'linux' })
    const launch = target('ssh://tomek@minipc:2222/srv/My $ Project')
    const command = {
      file: 'codex',
      args: ['--flag', 'a b', "it's", '$(rm -rf /)', '`id`', 'ünïcode', ''],
    }
    const spawn = ssh.terminalCommand(launch, command)
    const result = runHarness(spawn.args, { FAKE_SSH_CAPTURE: capture, FAKE_SSH_EXIT: '0' })

    expect(result.exitCode).toBe(0)
    expect(readFileSync(capture, 'utf8').trimEnd()).toBe(ssh.terminalCommandLine(launch, command))
    const line = readFileSync(capture, 'utf8')
    // Nothing is interpolated into the script text: the argv lives only after
    // the positional boundary and every word is single-quoted.
    expect(line.startsWith('sh -c \'cd "$1" || exit 111; shift; exec "$@"\' nekode ')).toBe(true)
    expect(line).toContain("'codex' '--flag' 'a b' 'it'\\''s' '$(rm -rf /)' '`id`' 'ünïcode' ''")
  })

  it.skipIf(!shellAvailable)(
    'round-trips hostile argv through a real sh and keeps the remote error visible',
    () => {
      const base = mkdtempSync(join(tmpdir(), 'nekode-ssh-run-'))
      tempDirs.push(base)
      const projectDir = join(base, 'My $ Project')
      mkdirSync(projectDir)
      // A POSIX form of the temp directory: MSYS maps the Windows temp dir to
      // /tmp, so the same fixture path works on both host platforms.
      const posixPath = `/tmp/${base.slice(tmpdir().length + 1).replace(/\\/g, '/')}/My $ Project`
      const ssh = new SshClient({ platform: 'linux' })
      const launch = target(`ssh://host${posixPath}`)
      const command = {
        file: 'printf',
        args: ['%s\\n', 'a b', "it's", '$(rm -rf /)', '`id`', 'ünïcode'],
      }
      const spawn = ssh.terminalCommand(launch, command)
      const result = runHarness(spawn.args)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.split('\n').slice(0, -1)).toEqual([
        'a b',
        "it's",
        '$(rm -rf /)',
        '`id`',
        'ünïcode',
      ])
    },
  )

  it.skipIf(!shellAvailable)('reports the dedicated cd-failure exit status', () => {
    const ssh = new SshClient({ platform: 'linux' })
    const result = runHarness(
      ssh.terminalCommand(target('ssh://host/srv/missing'), {
        file: 'printf',
        args: ['%s\\n', 'never'],
      }).args,
    )
    // 111 is the failed-cd state the pane maps to the not_found message.
    expect(result.exitCode).toBe(111)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('No such file or directory')
  })
})

describe('script run through the fake ssh harness', () => {
  it.skipIf(!shellAvailable)(
    'ignores login chatter and returns the marked payload from a real shell',
    async () => {
      const ssh = harnessClient()
      const result = await ssh.runScript(target('ssh://host/srv/app'), 'printf "%s\\n" "$1"', [
        'a b',
      ])
      expect(result.exitCode).toBe(0)
      expect(result.fields).toEqual(['a b\n'])
    },
  )

  it.skipIf(!shellAvailable)(
    'keeps the marker filter when the login script prints to stdout',
    async () => {
      const capture = captureFile()
      const ssh = new SshClient({
        platform: 'linux',
        marker: () => 'nekode-chatter',
        run: async (_file, args) =>
          runHarness(args, { FAKE_SSH_CHATTER: '1', FAKE_SSH_CAPTURE: capture }),
      })
      const result = await ssh.runScript(target('ssh://host/srv/app'), 'printf "%s" "$1"', [
        '/srv/real',
      ])
      expect(result.fields).toEqual(['/srv/real'])
      const line = readFileSync(capture, 'utf8')
      expect(line).toContain("'nekode-chatter'")
      expect(line).toContain('printf')
    },
  )
})
