import { describe, expect, it } from 'vitest'
import { homeDirFromEnv, shortenHomePath } from './home-path'

// Display-only `~` for paths under the user's home directory (status bar and
// Project Files header). Copy, hover, and every path operation keep the full path.

describe('homeDirFromEnv', () => {
  it('uses USERPROFILE on Windows and HOME elsewhere', () => {
    const env = { USERPROFILE: 'C:\\Users\\demo', HOME: '/home/demo' }
    expect(homeDirFromEnv('win32', env)).toBe('C:\\Users\\demo')
    expect(homeDirFromEnv('linux', env)).toBe('/home/demo')
    expect(homeDirFromEnv('darwin', env)).toBe('/home/demo')
  })

  it('treats an unknown platform as Windows, the primary platform', () => {
    expect(homeDirFromEnv(undefined, { USERPROFILE: 'C:\\Users\\demo' })).toBe('C:\\Users\\demo')
  })

  it('returns undefined when the variable is missing or blank', () => {
    expect(homeDirFromEnv('win32', { HOME: '/home/demo' })).toBeUndefined()
    expect(homeDirFromEnv('linux', { HOME: '  ' })).toBeUndefined()
  })
})

describe('shortenHomePath', () => {
  it('replaces the Linux home prefix with ~', () => {
    expect(shortenHomePath('/home/demo/projects/atlas', '/home/demo', 'linux')).toBe(
      '~/projects/atlas',
    )
    expect(shortenHomePath('/home/demo', '/home/demo/', 'linux')).toBe('~')
  })

  it('matches whole path segments only', () => {
    expect(shortenHomePath('/home/demo2/x', '/home/demo', 'linux')).toBe('/home/demo2/x')
    expect(shortenHomePath('C:\\Users\\demo2\\x', 'C:\\Users\\demo', 'win32')).toBe(
      'C:\\Users\\demo2\\x',
    )
  })

  it('is case-sensitive on Linux', () => {
    expect(shortenHomePath('/home/Demo/x', '/home/demo', 'linux')).toBe('/home/Demo/x')
  })

  it('on Windows ignores case and separator style and keeps the path separators', () => {
    expect(shortenHomePath('C:\\Users\\demo\\projects\\atlas', 'C:\\Users\\demo', 'win32')).toBe(
      '~\\projects\\atlas',
    )
    expect(shortenHomePath('c:/users/DEMO/projects/atlas', 'C:\\Users\\demo', 'win32')).toBe(
      '~/projects/atlas',
    )
    expect(shortenHomePath('C:\\Users\\demo', 'C:\\Users\\demo', undefined)).toBe('~')
  })

  it('leaves paths outside home, WSL paths, and a missing home unchanged', () => {
    expect(shortenHomePath('D:\\code\\demo', 'C:\\Users\\demo', 'win32')).toBe('D:\\code\\demo')
    expect(
      shortenHomePath('\\\\wsl.localhost\\Ubuntu\\home\\demo\\x', 'C:\\Users\\demo', 'win32'),
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\demo\\x')
    expect(shortenHomePath('/home/demo/x', undefined, 'linux')).toBe('/home/demo/x')
  })

  it('never shortens when home is a filesystem root', () => {
    expect(shortenHomePath('/etc/hosts', '/', 'linux')).toBe('/etc/hosts')
    expect(shortenHomePath('C:\\code', 'C:\\', 'win32')).toBe('C:\\code')
  })
})
