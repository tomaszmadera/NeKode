import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { afterEach, describe, expect, it } from 'vitest'
import { SshClient } from '../ssh/ssh-client'
import { createNodePty } from './node-pty-factory'
import type { PtyProcessLike } from './terminal-service'

// Production PTY encoding of a remote agent launch (spec ssh-projects
// Behaviour 7 and Required tests): the ssh argv leaves main through node-pty,
// not through execFile, so the local process command line is the third quoting
// layer. This case spawns the real PTY factory with the fake ssh harness as the
// executable and asserts that every hostile agent word arrives unchanged.

const HARNESS = fileURLToPath(new URL('../../test-support/fake-ssh.cjs', import.meta.url))

function hasPosixShell(): boolean {
  const result = spawnSync('sh', ['-c', 'true'])
  return result.error === undefined || result.error === null
}

const shellAvailable = hasPosixShell()

const WORDS = [
  'a b',
  "it's",
  '$HOME',
  '`id`',
  'zażółć gęślą',
  'x;y',
  '',
  'trailing ',
  'a"b',
  'back\\slash',
  '-oProxyCommand=evil',
]

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function target(value: string): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

/** Collects PTY output until the child exits. */
function collect(pty: PtyProcessLike, timeoutMs = 20_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    let settled = false
    const dataSub = pty.onData((data) => {
      output += data
    })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      dataSub.dispose()
      exitSub.dispose()
      if (error === undefined) resolve(output)
      else reject(error)
    }
    const timer = setTimeout(() => finish(new Error('PTY output timed out.')), timeoutMs)
    const exitSub = pty.onExit(() => finish())
  })
}

describe('node-pty remote agent launch', () => {
  it.skipIf(!shellAvailable)(
    'delivers every agent argv word unchanged through the PTY and the fake ssh harness',
    async () => {
      const base = mkdtempSync(join(tmpdir(), 'nekode-pty-'))
      tempDirs.push(base)
      mkdirSync(join(base, 'project'))
      // A POSIX form of the temp directory: MSYS maps the Windows temp dir to
      // /tmp, so the same fixture path works on both host platforms.
      const posixBase = `/tmp/${base.slice(tmpdir().length + 1).replace(/\\/g, '/')}`
      const ssh = new SshClient({ platform: 'linux' })
      // The remote command records its argv in a file: a terminal screen drops
      // blank lines and trailing spaces, so only a file proves the exact bytes
      // that survived the local command line.
      const spawn = ssh.terminalCommand(target(`ssh://host${posixBase}/project`), {
        file: 'sh',
        args: [
          '-c',
          'for w in "$@"; do printf "%s\\n" "$w"; done > "$0"',
          `${posixBase}/argv.txt`,
          ...WORDS,
        ],
      })

      const pty = createNodePty({
        file: process.execPath,
        args: [HARNESS, ...spawn.args],
        cwd: base,
        cols: 120,
        rows: 40,
        env: { ...process.env } as Record<string, string>,
      })
      await collect(pty)

      // Each word is written on its own line: a lost quote, an expanded `$`,
      // a command substitution or a dropped trailing space fails here.
      expect(readFileSync(join(base, 'argv.txt'), 'utf8')).toBe(`${WORDS.join('\n')}\n`)
    },
    30_000,
  )
})
