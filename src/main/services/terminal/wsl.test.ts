import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listWslDistributions, prepareWslTerminal, validatedWslProjectPath } from './wsl'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

beforeEach(() => vi.mocked(execFileSync).mockReset())

describe('WSL invocation boundary', () => {
  it('decodes installed distributions with BOM and CRLF', () => {
    vi.mocked(execFileSync).mockReturnValue(
      Buffer.from('\uFEFFUbuntu-24.04\r\nDebian\r\n', 'utf16le'),
    )
    expect(listWslDistributions()).toEqual(['Ubuntu-24.04', 'Debian'])
  })

  it('checks distribution and directory with separate argv before registration', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce(Buffer.from('Ubuntu\r\n', 'utf16le'))
      .mockReturnValueOnce('')
    expect(validatedWslProjectPath('Ubuntu', '/home/user/My $ Project')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user\\My $ Project',
    )
    expect(execFileSync).toHaveBeenLastCalledWith(
      'wsl.exe',
      ['--distribution', 'Ubuntu', '--exec', '/usr/bin/test', '-d', '/home/user/My $ Project'],
      expect.objectContaining({ windowsHide: true, timeout: 5000 }),
    )
  })

  it('rejects malformed input before discovery and unavailable targets visibly', () => {
    expect(() => validatedWslProjectPath('Ubuntu', '/home/../user')).toThrow(/absolute Linux/)
    expect(execFileSync).not.toHaveBeenCalled()
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('Debian', 'utf16le'))
    expect(() => validatedWslProjectPath('Ubuntu', '/home/user')).toThrow(/not installed/)
    vi.mocked(execFileSync)
      .mockReturnValueOnce(Buffer.from('Ubuntu', 'utf16le'))
      .mockImplementationOnce(() => {
        throw new Error('directory unavailable')
      })
    expect(() => validatedWslProjectPath('Ubuntu', '/home/missing')).toThrow(/unavailable/)
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
