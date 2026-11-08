import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SSH_MAX_BUFFER_BYTES,
  SshClient,
  type SshRunResult,
  type SshScriptClient,
} from '../ssh/ssh-client'
import { PREVIEW_MAX_BYTES } from './files-service'
import { SshFilesAdapter } from './ssh-files-adapter'

// Remote files adapter (spec ssh-projects Behaviour 10 and Required tests):
// one invocation per request, the nonce marker, NUL-delimited fields, kinds,
// symlink classification, canonical-path containment, the 2 MB read cap, `:`
// names and error mapping. Payload parsing is exercised with a fake script
// client; the scripts themselves run through the fake ssh harness against a
// real POSIX shell and a real fixture tree.

const HARNESS = fileURLToPath(new URL('../../test-support/fake-ssh.cjs', import.meta.url))

function hasPosixShell(): boolean {
  const result = spawnSync('sh', ['-c', 'true'])
  return result.error === undefined || result.error === null
}

/**
 * Probe for symlink creation, which needs a Windows developer-mode privilege.
 * The symlink test skips explicitly on this result, so a missing capability
 * cannot turn into a green test that asserts nothing.
 */
function hasSymlinkSupport(): boolean {
  const base = mkdtempSync(join(tmpdir(), 'nekode-ssh-link-'))
  try {
    writeFileSync(join(base, 'target.txt'), 'target\n')
    symlinkSync(join(base, 'target.txt'), join(base, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

const shellAvailable = hasPosixShell()
const symlinksAvailable = hasSymlinkSupport()

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function target(value = 'ssh://tomek@minipc/srv/app'): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

/**
 * The symlink probe guarantees the fixture can create links, so a missing link
 * is a fixture failure, never a silently skipped assertion.
 */
function requireLink(value: string | null): string {
  if (value === null) throw new Error('the fixture did not create its symlink')
  return value
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

function fakeClient(): {
  client: SshScriptClient
  runScript: ReturnType<typeof vi.fn>
  runScriptBytes: ReturnType<typeof vi.fn>
} {
  const runScript = vi.fn(async () => ({ exitCode: 0, fields: [] as string[] }))
  const runScriptBytes = vi.fn(async () => ({ exitCode: 0, fields: [] as Uint8Array[] }))
  return { client: { runScript, runScriptBytes }, runScript, runScriptBytes }
}

function listingFields(root: string, dir: string, records: Array<[string, string]>): string[] {
  return [root, dir, ...records.flat(), '']
}

describe('SshFilesAdapter payload parsing', () => {
  it('sends the portable listing script with the project root and the directory', async () => {
    const { client, runScript } = fakeClient()
    runScript.mockResolvedValue({
      exitCode: 0,
      fields: listingFields('/srv/app', '/srv/app/src', [['app.ts', 'f']]),
    })
    const adapter = new SshFilesAdapter(client, target())
    const listing = await adapter.list('/srv/app/src')

    expect(listing).toEqual({
      realRoot: '/srv/app',
      realTarget: '/srv/app/src',
      entries: [{ name: 'app.ts', kind: 'file' }],
    })
    expect(runScript).toHaveBeenCalledTimes(1)
    const [calledTarget, script, args] = runScript.mock.calls[0] as unknown as [
      SshTarget,
      string,
      string[],
    ]
    expect(calledTarget.path).toBe('/srv/app')
    expect(args).toEqual(['/srv/app', '/srv/app/src'])
    expect(script).toContain('cd "$1" || exit 111')
    expect(script).toContain('pwd -P')
    expect(script).toContain('test -d')
    expect(script).toContain('test -f')
    expect(script).toContain('test -L')
  })

  it('maps directory, file and broken-symlink kinds and keeps NUL-free hostile names', async () => {
    const { client, runScript } = fakeClient()
    runScript.mockResolvedValue({
      exitCode: 0,
      fields: listingFields('/srv/app', '/srv/app', [
        ['src', 'd'],
        ['with space.txt', 'f'],
        ["it's $HOME `id`.txt", 'f'],
        ['a:b.txt', 'f'],
        ['broken', 'l'],
      ]),
    })
    const listing = await new SshFilesAdapter(client, target()).list('/srv/app')
    expect(listing?.entries).toEqual([
      { name: 'src', kind: 'directory' },
      { name: 'with space.txt', kind: 'file' },
      { name: "it's $HOME `id`.txt", kind: 'file' },
      { name: 'a:b.txt', kind: 'file' },
      { name: 'broken', kind: 'symlink' },
    ])
  })

  it('reports a failed remote directory read as missing', async () => {
    const { client, runScript } = fakeClient()
    runScript.mockResolvedValue({ exitCode: 111, fields: [] })
    await expect(new SshFilesAdapter(client, target()).list('/srv/app/gone')).resolves.toBeNull()

    runScript.mockResolvedValue({ exitCode: 0, fields: [] })
    await expect(new SshFilesAdapter(client, target()).list('/srv/app')).resolves.toBeNull()
  })

  it('reads the capped payload as bytes and joins content split by NUL', async () => {
    const { client, runScriptBytes } = fakeClient()
    runScriptBytes.mockResolvedValue({
      exitCode: 0,
      fields: [
        bytes('/srv/app'),
        bytes('/srv/app/data.bin'),
        bytes('f'),
        bytes('5'),
        bytes('a\u0000b'),
      ],
    })
    const file = await new SshFilesAdapter(client, target()).read('/srv/app/data.bin')

    expect(file?.realRoot).toBe('/srv/app')
    expect(file?.realTarget).toBe('/srv/app/data.bin')
    expect(file?.size).toBe(5)
    expect(file?.content).toEqual(bytes('a\u0000b'))
    expect(decoder.decode(file?.content)).toBe('a\u0000b')
  })

  it('sends the read script with the remote 2 MB plus one byte cap and readlink resolution', async () => {
    const { client, runScriptBytes } = fakeClient()
    runScriptBytes.mockResolvedValue({
      exitCode: 0,
      fields: [bytes('/srv/app'), bytes('/srv/app/a.txt'), bytes('f'), bytes('1'), bytes('x')],
    })
    await new SshFilesAdapter(client, target()).read('/srv/app/a.txt')
    const [, script, args] = runScriptBytes.mock.calls[0] as unknown as [
      SshTarget,
      string,
      string[],
    ]
    expect(args).toEqual(['/srv/app', '/srv/app/a.txt'])
    expect(script).toContain(`head -c ${PREVIEW_MAX_BYTES + 1}`)
    expect(script).toContain('wc -c')
    expect(script).toContain('readlink')
    expect(script).toContain('exit 111')
  })

  it('treats a non-file target and a failed read as missing', async () => {
    const { client, runScriptBytes } = fakeClient()
    runScriptBytes.mockResolvedValue({
      exitCode: 0,
      fields: [bytes('/srv/app'), bytes('/srv/app/src'), bytes('d')],
    })
    await expect(new SshFilesAdapter(client, target()).read('/srv/app/src')).resolves.toBeNull()

    runScriptBytes.mockResolvedValue({ exitCode: 111, fields: [] })
    await expect(new SshFilesAdapter(client, target()).read('/srv/app/gone')).resolves.toBeNull()
  })
})

// Harness-backed fixtures: a real POSIX shell runs the scripts, so quoting,
// globbing, `pwd -P`, `readlink`, `wc` and `head` are all exercised.

function harnessClient(env: Record<string, string> = {}): SshClient {
  return new SshClient({
    platform: 'linux',
    marker: () => 'nekode-files',
    run: async (_file, args) => {
      const result = spawnSync(process.execPath, [HARNESS, ...args], {
        encoding: 'buffer',
        maxBuffer: SSH_MAX_BUFFER_BYTES,
        env: { ...process.env, ...env },
      })
      const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
      return {
        stdout: stdout.toString('utf8'),
        stderr: result.stderr.toString('utf8'),
        exitCode: result.status ?? 1,
        stdoutBytes: new Uint8Array(stdout),
      } satisfies SshRunResult
    },
  })
}

/** MSYS maps the Windows temp directory to /tmp; fixture paths stay POSIX. */
function posixPathOf(windowsPath: string): string {
  const base = tmpdir()
  return `/tmp/${windowsPath.slice(base.length + 1).replace(/\\/g, '/')}`
}

interface Fixture {
  /** POSIX project root. */
  root: string
  /** POSIX directory outside the project root. */
  outside: string
  /** Absolute POSIX path of a symlink leaving the root, when created. */
  escapeLink: string | null
  /** Absolute POSIX path of a symlink staying inside the root, when created. */
  insideLink: string | null
  /** NTFS cannot create a `:` name, so the colon fixture exists off Windows only. */
  colonName: boolean
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'nekode-ssh-files-'))
  tempDirs.push(base)
  const rootDir = join(base, 'project')
  const outsideDir = join(base, 'outside')
  mkdirSync(join(rootDir, 'src'), { recursive: true })
  mkdirSync(join(rootDir, 'node_modules'), { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(join(rootDir, 'notes.md'), '# notes\n')
  writeFileSync(join(rootDir, 'src', 'app.ts'), 'const a = 1\n')
  writeFileSync(join(rootDir, 'src', 'nested.txt'), 'nested\n')
  writeFileSync(join(rootDir, 'node_modules', 'pkg.js'), 'pkg\n')
  writeFileSync(join(rootDir, "it's $HOME `id`.txt"), 'hostile\n')
  writeFileSync(join(rootDir, 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]))
  writeFileSync(join(rootDir, 'huge.bin'), Buffer.alloc(PREVIEW_MAX_BYTES + 2, 0x41))
  writeFileSync(join(outsideDir, 'secret.txt'), 'top secret\n')
  // A `:` is a valid POSIX name; NTFS would treat it as an alternate data
  // stream, so the real-file fixture exists only where the host allows it.
  const colonName = process.platform !== 'win32'
  if (colonName) writeFileSync(join(rootDir, 'a:b.txt'), 'colon\n')

  let escapeLink: string | null = null
  let insideLink: string | null = null
  try {
    const escapePath = join(rootDir, 'escape')
    symlinkSync(join(outsideDir, 'secret.txt'), escapePath)
    escapeLink = posixPathOf(escapePath)
    const inside = join(rootDir, 'alias')
    symlinkSync(join(rootDir, 'src'), inside)
    insideLink = posixPathOf(inside)
  } catch {
    // Creating symlinks needs a Windows privilege; the escape cases then rely
    // on the unit tests and the real-host smoke.
  }

  return {
    root: posixPathOf(rootDir),
    outside: posixPathOf(outsideDir),
    escapeLink,
    insideLink,
    colonName,
  }
}

describe('SshFilesAdapter through a real shell', () => {
  it.skipIf(!shellAvailable)('lists one level with kinds', async () => {
    const fixture = createFixture()
    const adapter = new SshFilesAdapter(harnessClient(), target(`ssh://host${fixture.root}`))
    const listing = await adapter.list(fixture.root)
    expect(listing?.realRoot).toBe(fixture.root)
    expect(listing?.realTarget).toBe(fixture.root)
    const names = listing?.entries.map((entry) => entry.name) ?? []
    expect(names).toContain('src')
    expect(names).toContain('notes.md')
    expect(names).toContain("it's $HOME `id`.txt")
    if (fixture.colonName) expect(names).toContain('a:b.txt')
    // The adapter mirrors readdir: exclusion filtering belongs to the service
    // (spec ssh-projects Behaviour 10, files contract Behaviour 5), which is
    // covered at service level in files-service.test.ts.
    expect(listing?.entries.find((entry) => entry.name === 'node_modules')?.kind).toBe('directory')
    const src = await adapter.list(`${fixture.root}/src`)
    expect(src?.entries.map((entry) => entry.name).sort()).toEqual(['app.ts', 'nested.txt'])
    expect(src?.entries.find((entry) => entry.name === 'app.ts')?.kind).toBe('file')
  })

  it.skipIf(!shellAvailable)(
    'reads text and binary content with the exact byte count',
    async () => {
      const fixture = createFixture()
      const adapter = new SshFilesAdapter(harnessClient(), target(`ssh://host${fixture.root}`))
      const text = await adapter.read(`${fixture.root}/notes.md`)
      expect(decoder.decode(text?.content)).toBe('# notes\n')
      expect(text?.size).toBe(8)

      const binary = await adapter.read(`${fixture.root}/binary.bin`)
      expect(binary?.content).toEqual(Uint8Array.from([0x41, 0x00, 0x42]))
      expect(binary?.size).toBe(3)

      const hostile = await adapter.read(`${fixture.root}/it's $HOME \`id\`.txt`)
      expect(decoder.decode(hostile?.content)).toBe('hostile\n')

      // NTFS cannot hold a `:` in a name, so the fixture exists only where the
      // host filesystem allows it.
      if (fixture.colonName) {
        const colon = await adapter.read(`${fixture.root}/a:b.txt`)
        expect(decoder.decode(colon?.content)).toBe('colon\n')
      }
    },
  )

  it.skipIf(!shellAvailable)('caps the remote read at 2 MB plus one byte', async () => {
    const fixture = createFixture()
    const adapter = new SshFilesAdapter(harnessClient(), target(`ssh://host${fixture.root}`))
    const huge = await adapter.read(`${fixture.root}/huge.bin`)
    expect(huge?.size).toBe(PREVIEW_MAX_BYTES + 2)
    expect(huge?.content.byteLength).toBe(PREVIEW_MAX_BYTES + 1)
  })

  it.skipIf(!shellAvailable)(
    'refuses a request that resolves outside the project root',
    async () => {
      const fixture = createFixture()
      const adapter = new SshFilesAdapter(harnessClient(), target(`ssh://host${fixture.root}`))
      expect(await adapter.list(`${fixture.root}/../outside`)).toBeNull()
      expect(await adapter.read(`${fixture.outside}/secret.txt`)).toBeNull()
      expect(await adapter.read(`${fixture.root}/../outside/secret.txt`)).toBeNull()
    },
  )

  it.skipIf(!shellAvailable || !symlinksAvailable)(
    'refuses a symlink that leaves the root and follows one that stays inside',
    async () => {
      const fixture = createFixture()
      const escapeLink = requireLink(fixture.escapeLink)
      const insideLink = requireLink(fixture.insideLink)
      const adapter = new SshFilesAdapter(harnessClient(), target(`ssh://host${fixture.root}`))
      expect(await adapter.list(escapeLink)).toBeNull()
      expect(await adapter.read(escapeLink)).toBeNull()
      const inside = await adapter.list(insideLink)
      expect(inside?.realTarget).toBe(`${fixture.root}/src`)
      expect(inside?.entries.map((entry) => entry.name).sort()).toEqual(['app.ts', 'nested.txt'])
    },
  )

  it.skipIf(!shellAvailable)('ignores login chatter before the marker', async () => {
    const fixture = createFixture()
    const adapter = new SshFilesAdapter(
      harnessClient({ FAKE_SSH_CHATTER: '1' }),
      target(`ssh://host${fixture.root}`),
    )
    const listing = await adapter.list(fixture.root)
    expect(listing?.realTarget).toBe(fixture.root)
    expect(listing?.entries.map((entry) => entry.name)).toContain('notes.md')
  })
})
