import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareWslTerminal, requireWslSupport, validateWslExecutable, wslSupported } from './wsl'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

beforeEach(() => vi.mocked(execFileSync).mockReset())

describe('WSL invocation boundary', () => {
  it('rejects a missing Linux CLI with its executable and distribution, without forwarding prompts', () => {
    vi.mocked(execFileSync).mockReturnValue('')
    expect(() =>
      validateWslExecutable('\\\\wsl$\\Ubuntu\\tmp\\My Project', {
        file: 'missing-cli',
        args: ['PRIVATE_PROMPT'],
      }),
    ).toThrow(
      'Linux executable "missing-cli" is unavailable or not executable in WSL distribution "Ubuntu".',
    )
    expect(execFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      expect.arrayContaining(['Ubuntu', '/tmp/My Project', 'missing-cli']),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
    )
    expect(JSON.stringify(vi.mocked(execFileSync).mock.calls)).not.toContain('PRIVATE_PROMPT')
  })

  it('accepts an executable found in the login PATH and does not execute profile arguments', () => {
    vi.mocked(execFileSync).mockReturnValue('usable')
    expect(() =>
      validateWslExecutable('\\\\wsl$\\Ubuntu\\tmp', {
        file: 'hermes',
        args: ['PRIVATE_PROMPT'],
      }),
    ).not.toThrow()
    expect(execFileSync).toHaveBeenCalledTimes(1)
  })

  it('names the target on a failed availability check without exposing subprocess output', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('PRIVATE_PROMPT')
    })
    expect(() =>
      validateWslExecutable('\\\\wsl$\\Ubuntu\\tmp', {
        file: 'hermes',
        args: [],
      }),
    ).toThrow('Unable to check Linux executable "hermes" in WSL distribution "Ubuntu".')
  })

  it('keeps distribution, Linux cwd and executable argv distinct from the host cwd', () => {
    expect(
      prepareWslTerminal('\\\\wsl$\\Ubuntu\\home\\user\\My Project', {
        file: '/usr/bin/tool',
        args: ['a b', '$(literal)', ';', 'ą'],
      }),
    ).toEqual({
      file: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu',
        '--cd',
        '/home/user/My Project',
        '--exec',
        'bash',
        '-lc',
        'exec "$@"',
        'bash',
        '/usr/bin/tool',
        'a b',
        '$(literal)',
        ';',
        'ą',
      ],
      cwd: process.cwd(),
    })
    expect(() =>
      prepareWslTerminal('\\\\wsl$\\Ubuntu\\home\\user', {
        file: 'wsl.exe',
        args: ['-d', 'Other'],
      }),
    ).toThrow(/Linux executable/)
    expect(() =>
      prepareWslTerminal('\\\\wsl$\\Ubuntu\\home\\user', { file: 'powershell.exe', args: [] }),
    ).toThrow(/Linux executable/)
  })
})

describe('WSL host support gate', () => {
  it('supports WSL only when NeKode runs on Windows', () => {
    expect(wslSupported('win32')).toBe(true)
    expect(wslSupported('linux')).toBe(false)
    expect(wslSupported('darwin')).toBe(false)
    expect(() => requireWslSupport('win32')).not.toThrow()
    expect(() => requireWslSupport('linux')).toThrow(/only when NeKode runs on Windows/)
  })
})
