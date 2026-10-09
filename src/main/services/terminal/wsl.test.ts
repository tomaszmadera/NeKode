import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listWslDirectories,
  listWslDistributions,
  prepareWslTerminal,
  validatedWslProjectPath,
} from './wsl'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

beforeEach(() => vi.mocked(execFileSync).mockReset())

describe('WSL directory suggestions', () => {
  it.each(['', 'home/user'])('does not invoke WSL for non-absolute query %j', (query) => {
    expect(listWslDirectories('Ubuntu', query)).toEqual([])
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it.each([
    ['-Ubuntu', '/home/'],
    ['Ubuntu.', '/home/'],
    ['Ubuntu', '/home//user'],
    ['Ubuntu', '/home/../user'],
    ['Ubuntu', '/home/./user'],
    ['Ubuntu', '/home\\user'],
    ['Ubuntu', '/home/\0'],
  ])('rejects invalid distribution/query %j %j before invoking WSL', (distribution, query) => {
    expect(() => listWslDirectories(distribution, query)).toThrow()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it.each([
    ['/', '/', '', ['/alpha', '/beta']],
    ['/home/', '/home', '', ['/home/alpha', '/home/beta']],
    ['/home/al', '/home', 'al', ['/home/alpha']],
    ['/home/AL', '/home', 'AL', []],
  ])(
    'splits query %j and sorts immediate matching children',
    (query, parent, _prefix, expected) => {
      const root = parent === '/' ? '' : parent
      vi.mocked(execFileSync)
        .mockReturnValueOnce('')
        .mockReturnValueOnce(
          `${root}/beta\0${root}/alpha\0${root}/alpha/nested\0/elsewhere/alpha\0`,
        )
      expect(listWslDirectories('Ubuntu', query)).toEqual(expected)
      expect(execFileSync).toHaveBeenNthCalledWith(
        1,
        'wsl.exe',
        ['--distribution', 'Ubuntu', '--exec', '/usr/bin/test', '-d', parent],
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
      )
      expect(execFileSync).toHaveBeenLastCalledWith(
        'wsl.exe',
        [
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
        ],
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
      )
    },
  )

  it('preserves spaces, Unicode and shell metacharacters, dropping invalid candidates', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('')
      .mockReturnValueOnce(
        '/home/My $ Project\0/home/ą\0/home/line\nbreak\0/home/back\\slash\0/home/..\0',
      )
    expect(listWslDirectories('Ubuntu', '/home/')).toEqual(['/home/My $ Project', '/home/ą'])
  })

  it('caps results at 100 after sorting, not before filtering', () => {
    const paths = Array.from(
      { length: 110 },
      (_, index) => `/home/p${String(index).padStart(3, '0')}`,
    )
    vi.mocked(execFileSync)
      .mockReturnValueOnce('')
      .mockReturnValueOnce(`${paths.reverse().join('\0')}\0`)
    const result = listWslDirectories('Ubuntu', '/home/p')
    expect(result).toHaveLength(100)
    expect(result[0]).toBe('/home/p000')
    expect(result[99]).toBe('/home/p099')
  })

  it('keeps an empty listing distinct from a missing parent or failed listing', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('').mockReturnValueOnce('')
    expect(listWslDirectories('Ubuntu', '/empty/')).toEqual([])
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('missing parent or distribution')
    })
    expect(() => listWslDirectories('Ubuntu', '/missing/')).toThrow(/unavailable/)
    vi.mocked(execFileSync)
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw new Error('permission denied')
      })
    expect(() => listWslDirectories('Ubuntu', '/denied/')).toThrow(/unavailable/)
  })
})

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
