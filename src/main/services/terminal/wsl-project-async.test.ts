import { execFile } from 'node:child_process'
import { AppError } from '@shared/ipc-error'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listWslDirectoriesAsync,
  listWslDistributionsAsync,
  prepareWslAgentAsync,
  validatedWslProjectPathAsync,
} from './wsl'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn() }))

beforeEach(() => {
  vi.mocked(execFile).mockReset()
})

type ExecCallback = (error: Error | null, stdout: Buffer | string) => void

/** Answers every child immediately; `responder` maps argv to stdout or an error. */
function mockExecFile(responder: (args: string[]) => Buffer | string | Error): void {
  vi.mocked(execFile).mockImplementation(((_file, args, _options, callback) => {
    const output = responder(args as string[])
    queueMicrotask(() => {
      if (output instanceof Error) {
        ;(callback as unknown as (error: Error) => void)(output)
      } else {
        ;(callback as unknown as ExecCallback)(null, output)
      }
    })
    return {} as ReturnType<typeof execFile>
  }) as typeof execFile)
}

/** Every child's argv in call order. */
function wslArgv(): string[][] {
  return vi.mocked(execFile).mock.calls.map(([, args]) => args as string[])
}

const PROBE_OPTIONS = { timeout: 5000, encoding: 'utf8', windowsHide: true }

function probeArgs(parent: string): string[] {
  return ['--distribution', 'Ubuntu', '--exec', '/usr/bin/test', '-d', parent]
}

function findArgs(parent: string): string[] {
  return [
    '--distribution',
    'Ubuntu',
    '--exec',
    'find',
    '-H',
    parent,
    '-mindepth',
    '1',
    '-maxdepth',
    '1',
    '-type',
    'd',
    '-print0',
  ]
}

describe('asynchronous WSL project discovery', () => {
  it('decodes asynchronously listed UTF-16 distributions', async () => {
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      queueMicrotask(() =>
        (callback as (error: null, stdout: Buffer) => void)(
          null,
          Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'),
        ),
      )
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    await expect(listWslDistributionsAsync()).resolves.toEqual(['Ubuntu', 'Debian'])
    expect(execFile).toHaveBeenCalledWith(
      'wsl.exe',
      ['--list', '--quiet'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    )
  })
  it('checks distribution and directory before returning a registration path', async () => {
    vi.mocked(execFile).mockImplementation(((_file, args, _options, callback) => {
      const output = (args as string[]).includes('--list')
        ? Buffer.from('Ubuntu\r\n', 'utf16le')
        : ''
      queueMicrotask(() =>
        (callback as (error: null, stdout: Buffer | string) => void)(null, output),
      )
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    await expect(validatedWslProjectPathAsync('Ubuntu', '/home/user')).resolves.toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user',
    )
    expect(wslArgv().at(-1)).toEqual(probeArgs('/home/user'))
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[2]).toEqual(PROBE_OPTIONS)
  })
  it('does not block while checking and listing the parent directory', async () => {
    const callbacks: Array<(error: Error | null, stdout: string) => void> = []
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      callbacks.push(callback as (error: Error | null, stdout: string) => void)
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    const result = listWslDirectoriesAsync('Ubuntu', '/home/us')
    expect(callbacks).toHaveLength(1)
    callbacks[0](null, '')
    await Promise.resolve()
    expect(callbacks).toHaveLength(2)
    callbacks[1](null, '/home/user\0/home/other\0')
    await expect(result).resolves.toEqual(['/home/user'])
  })
})

const QUERY_CASES: Array<{ distribution: string; query: string; invalid?: boolean }> = [
  { distribution: 'Ubuntu', query: '' },
  { distribution: 'Ubuntu', query: 'home/user' },
  { distribution: '-Ubuntu', query: '/home/', invalid: true },
  { distribution: 'Ubuntu.', query: '/home/', invalid: true },
  { distribution: 'Ubuntu', query: '/home//user', invalid: true },
  { distribution: 'Ubuntu', query: '/home/../user', invalid: true },
  { distribution: 'Ubuntu', query: '/home/./user', invalid: true },
  { distribution: 'Ubuntu', query: '/home\\user', invalid: true },
  { distribution: 'Ubuntu', query: '/home/\0', invalid: true },
]

describe('WSL directory query validation', () => {
  it.each(QUERY_CASES)(
    'validates $distribution/$query before invoking WSL',
    async ({ distribution, query, invalid }) => {
      mockExecFile(() => 'unused')
      if (invalid === true) {
        await expect(listWslDirectoriesAsync(distribution, query)).rejects.toBeInstanceOf(AppError)
      } else {
        await expect(listWslDirectoriesAsync(distribution, query)).resolves.toEqual([])
      }
      expect(execFile).not.toHaveBeenCalled()
    },
  )
})

const CAP_PATHS = Array.from(
  { length: 110 },
  (_, index) => `/home/p${String(index).padStart(3, '0')}`,
)

const LISTING_CASES: Array<{
  query: string
  parent: string
  stdout: string
  expected: string[]
}> = [
  {
    query: '/',
    parent: '/',
    stdout: '/beta\0/alpha\0/alpha/nested\0/elsewhere/alpha\0',
    expected: ['/alpha', '/beta'],
  },
  {
    query: '/home/',
    parent: '/home',
    stdout: '/home/beta\0/home/alpha\0/home/alpha/nested\0/elsewhere/alpha\0',
    expected: ['/home/alpha', '/home/beta'],
  },
  {
    query: '/home/al',
    parent: '/home',
    stdout: '/home/beta\0/home/alpha\0/home/alpha/nested\0/elsewhere/alpha\0',
    expected: ['/home/alpha'],
  },
  {
    query: '/home/AL',
    parent: '/home',
    stdout: '/home/beta\0/home/alpha\0/home/alpha/nested\0/elsewhere/alpha\0',
    expected: [],
  },
  {
    query: '/home/',
    parent: '/home',
    stdout: '/home/My $ Project\0/home/ą\0/home/line\nbreak\0/home/back\\slash\0/home/..\0',
    expected: ['/home/My $ Project', '/home/ą'],
  },
  {
    query: '/home/p',
    parent: '/home',
    stdout: `${[...CAP_PATHS].reverse().join('\0')}\0`,
    expected: CAP_PATHS.slice(0, 100),
  },
]

describe('WSL directory listing', () => {
  it.each(LISTING_CASES)(
    'splits $query under $parent with the /usr/bin/test and find argv',
    async ({ query, parent, stdout, expected }) => {
      mockExecFile((args) => (args.includes('-print0') ? stdout : ''))
      await expect(listWslDirectoriesAsync('Ubuntu', query)).resolves.toEqual(expected)
      expect(wslArgv()).toEqual([probeArgs(parent), findArgs(parent)])
      expect(vi.mocked(execFile).mock.calls.map(([, , options]) => options)).toEqual([
        PROBE_OPTIONS,
        PROBE_OPTIONS,
      ])
    },
  )

  it('keeps an empty listing distinct from a missing parent or failed listing', async () => {
    mockExecFile(() => '')
    await expect(listWslDirectoriesAsync('Ubuntu', '/empty/')).resolves.toEqual([])

    mockExecFile((args) => (args.includes('/usr/bin/test') ? new Error('missing parent') : ''))
    await expect(listWslDirectoriesAsync('Ubuntu', '/missing/')).rejects.toThrow(/unavailable/)

    mockExecFile((args) => (args.includes('-print0') ? new Error('permission denied') : ''))
    await expect(listWslDirectoriesAsync('Ubuntu', '/denied/')).rejects.toThrow(/unavailable/)
  })
})

const REGISTRATION_CASES: Array<{
  name: string
  linuxPath: string
  distributions: string
  findError?: string
  rejects: RegExp
  noCall?: boolean
}> = [
  {
    name: 'malformed Linux paths',
    linuxPath: '/home/../user',
    distributions: 'Ubuntu',
    rejects: /absolute Linux/,
    noCall: true,
  },
  {
    name: 'uninstalled distributions',
    linuxPath: '/home/user',
    distributions: 'Debian',
    rejects: /not installed/,
  },
  {
    name: 'unavailable directories',
    linuxPath: '/home/missing',
    distributions: 'Ubuntu',
    findError: 'directory unavailable',
    rejects: /unavailable/,
  },
]

describe('WSL project registration', () => {
  it.each(REGISTRATION_CASES)('rejects $name visibly', async (row) => {
    mockExecFile((args) => {
      if (args.includes('--list')) return Buffer.from(`${row.distributions}\r\n`, 'utf16le')
      if (row.findError !== undefined) return new Error(row.findError)
      return ''
    })
    await expect(validatedWslProjectPathAsync('Ubuntu', row.linuxPath)).rejects.toThrow(row.rejects)
    if (row.noCall === true) expect(execFile).not.toHaveBeenCalled()
  })
})

const HOST_CHOICES = [null, 'default', 'powershell', 'pwsh', 'gitbash', 'wsl:']

const AGENT_CASES: Array<{
  name: string
  path: string
  shellChoice: string | null
  args: string[]
  calls: number
}> = [
  ...HOST_CHOICES.map((shellChoice) => ({
    name: `a Local profile on the host for shell choice ${String(shellChoice)}`,
    path: 'D:/Project',
    shellChoice,
    args: ['one prompt'],
    calls: 0,
  })),
  {
    name: 'the persisted UNC distribution over a saved host shell choice',
    path: '\\\\wsl.localhost\\Ubuntu\\home\\user',
    shellChoice: 'wsl:Debian',
    args: [],
    calls: 0,
  },
  {
    name: 'wslpath in the selected distribution with the profile argv as data',
    path: 'F:\\My $ Project\\ą',
    shellChoice: 'wsl:Ubuntu',
    args: ['line one\n$(literal) & | ; "quotes"', '', 'ą'],
    calls: 2,
  },
]

describe('WSL agent preparation', () => {
  it.each(AGENT_CASES)('keeps $name', async ({ path, shellChoice, args, calls }) => {
    mockExecFile((argv) =>
      argv.includes('wslpath') ? '/custom-mount/f/My $ Project/ą\n' : 'usable',
    )
    const command = { file: 'codex', args }
    const prepared = await prepareWslAgentAsync(path, command, shellChoice)

    if (calls === 0) {
      expect(prepared).toBe(command)
      expect(execFile).not.toHaveBeenCalled()
      return
    }
    expect(prepared).toEqual({
      file: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu',
        '--cd',
        '/custom-mount/f/My $ Project/ą',
        '--exec',
        'bash',
        '-lc',
        'exec "$@"',
        'bash',
        'codex',
        ...args,
      ],
    })
    expect(wslArgv()).toHaveLength(calls)
    expect(wslArgv()[0]).toEqual([
      '--distribution',
      'Ubuntu',
      '--exec',
      'wslpath',
      '-a',
      '-u',
      path,
    ])
    expect(JSON.stringify(vi.mocked(execFile).mock.calls)).not.toContain('literal')
  })
})
