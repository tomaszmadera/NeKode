import { describe, expect, it } from 'vitest'
import {
  canonicalRemotePath,
  formatSshTarget,
  isSshProjectPath,
  parseSshTarget,
  sshDestination,
  sshProjectPathIdentity,
  sshTargetFromInput,
  sshTargetName,
  validateSshLocation,
} from './ssh-target'

// Pure contract of `ssh://` project locations (spec ssh-projects Required
// tests: parsing, formatting, identity, hostile host/user rejection).

describe('parseSshTarget', () => {
  it('parses the canonical forms and lowercases only the host', () => {
    expect(parseSshTarget('ssh://host/path')).toEqual({
      user: null,
      host: 'host',
      port: 22,
      path: '/path',
      ipv6: false,
    })
    expect(parseSshTarget('ssh://User.Name@My-Host.example:2222/Home/My Project')).toEqual({
      user: 'User.Name',
      host: 'my-host.example',
      port: 2222,
      path: '/Home/My Project',
      ipv6: false,
    })
    expect(parseSshTarget('ssh://[2001:DB8::1]:2200/srv/app')).toEqual({
      user: null,
      host: '2001:db8::1',
      port: 2200,
      path: '/srv/app',
      ipv6: true,
    })
  })

  it('drops a trailing slash, repeated slashes and `.` segments', () => {
    expect(parseSshTarget('ssh://host/srv//app/')?.path).toBe('/srv/app')
    expect(parseSshTarget('ssh://host/./srv/./app')?.path).toBe('/srv/app')
  })

  it('keeps spaces, quotes, `$`, backticks, newlines and Unicode in the path', () => {
    const path = '/srv/My $ Project/quote\'"`;dir\nline/ünïcode'
    const target = parseSshTarget(`ssh://host${path}`)
    expect(target?.path).toBe(path)
  })

  it('accepts single-label aliases, IPv4 literals and user names with dots', () => {
    expect(parseSshTarget('ssh://minipc/p')?.host).toBe('minipc')
    expect(parseSshTarget('ssh://192.168.1.5/p')?.host).toBe('192.168.1.5')
    expect(parseSshTarget('ssh://first.last_1-x@host/p')?.user).toBe('first.last_1-x')
  })

  it('returns null for anything that is not an SSH location', () => {
    for (const value of ['', 'D:/code', '\\\\wsl.localhost\\Ubuntu\\home', '/home/user']) {
      expect(parseSshTarget(value)).toBeNull()
      expect(isSshProjectPath(value)).toBe(false)
    }
  })

  it.each([
    ['no host', 'ssh:///srv/app'],
    ['no path', 'ssh://host'],
    ['root path', 'ssh://host/'],
    ['repeated root only', 'ssh://host///'],
    ['traversal', 'ssh://host/srv/../app'],
    ['traversal only', 'ssh://host/..'],
    ['NUL in path', 'ssh://host/srv/\u0000app'],
    ['NUL in host', 'ssh://ho\u0000st/srv'],
    ['empty user', 'ssh://@host/p'],
    ['leading dash user', 'ssh://-oProxyCommand=evil@host/p'],
    ['leading dash host', 'ssh://-oProxyCommand=evil/p'],
    ['whitespace in host', 'ssh://ho st/p'],
    ['tab in host', 'ssh://ho\tst/p'],
    ['control in host', 'ssh://ho\u0007st/p'],
    ['at in host', 'ssh://user@ho@st/p'],
    ['percent in host', 'ssh://ho%2Fst/p'],
    ['colon outside brackets', 'ssh://ho:st/p'],
    ['whitespace in user', 'ssh://to mek@host/p'],
    ['control in user', 'ssh://to\u0001mek@host/p'],
    ['at in user', 'ssh://to@mek@host/p'],
    ['unclosed bracket', 'ssh://[2001:db8::1/p'],
    ['bracketed non-IPv6', 'ssh://[host]/p'],
    ['port zero', 'ssh://host:0/p'],
    ['port too large', 'ssh://host:65536/p'],
    ['port not numeric', 'ssh://host:22a/p'],
    ['negative port', 'ssh://host:-1/p'],
    ['empty port', 'ssh://host:/p'],
    ['junk after IPv6 bracket', 'ssh://[2001:db8::1]x/p'],
  ])('rejects %s', (_label, value) => {
    expect(parseSshTarget(value)).toBeNull()
  })
})

describe('formatSshTarget and identity', () => {
  const target = {
    user: 'User',
    host: 'my-host',
    port: 22,
    path: '/srv/My App',
    ipv6: false,
  }

  it('omits port 22 and keeps user and path case', () => {
    expect(formatSshTarget(target)).toBe('ssh://User@my-host/srv/My App')
    expect(formatSshTarget({ ...target, port: 2222 })).toBe('ssh://User@my-host:2222/srv/My App')
  })

  it('brackets an IPv6 host', () => {
    expect(
      formatSshTarget({ user: 'u', host: '2001:db8::1', port: 2222, path: '/p', ipv6: true }),
    ).toBe('ssh://u@[2001:db8::1]:2222/p')
  })

  it('collapses :22, a trailing slash and host case to one identity', () => {
    const identity = sshProjectPathIdentity('ssh://User@Host:22/srv/app')
    expect(identity).toBe('ssh://User@host/srv/app')
    expect(sshProjectPathIdentity('ssh://User@host/srv/app/')).toBe(identity)
    expect(sshProjectPathIdentity('ssh://User@HOST/srv/app')).toBe(identity)
    expect(sshProjectPathIdentity('D:/code/app')).toBeNull()
  })

  it('keeps the user and path case in the identity', () => {
    expect(sshProjectPathIdentity('ssh://user@host/App')).not.toBe(
      sshProjectPathIdentity('ssh://User@host/app'),
    )
  })

  it('round-trips every canonical form', () => {
    for (const value of [
      'ssh://host/p',
      'ssh://user@host/p',
      'ssh://host:2222/p',
      'ssh://user@host:2222/p',
      'ssh://user@[2001:db8::1]:2222/p',
    ]) {
      const parsed = parseSshTarget(value)
      expect(parsed).not.toBeNull()
      expect(formatSshTarget(parsed as NonNullable<typeof parsed>)).toBe(value)
    }
  })
})

describe('name and destination', () => {
  it('derives the name from the last POSIX segment', () => {
    const target = parseSshTarget('ssh://host/srv/My App')
    expect(sshTargetName(target as NonNullable<typeof target>)).toBe('My App')
  })

  it('builds the destination with an optional user and IPv6 brackets', () => {
    expect(sshDestination({ user: null, host: 'h', port: 22, path: '/p', ipv6: false })).toBe('h')
    expect(sshDestination({ user: 'u', host: 'h', port: 22, path: '/p', ipv6: false })).toBe('u@h')
    expect(sshDestination({ user: 'u', host: '::1', port: 22, path: '/p', ipv6: true })).toBe(
      'u@[::1]',
    )
  })

  it('keeps the remote path canonical', () => {
    expect(canonicalRemotePath('/a//b/./c/')).toBe('/a/b/c')
    expect(canonicalRemotePath('/')).toBeNull()
    expect(canonicalRemotePath('relative')).toBeNull()
    expect(canonicalRemotePath('/a/../b')).toBeNull()
  })
})

describe('validateSshLocation', () => {
  const valid = { host: 'minipc', user: null, port: null, path: '/home/tomek/app' }

  it('accepts the optional fields when absent and a bracketed IPv6 host', () => {
    expect(validateSshLocation(valid)).toBeNull()
    expect(
      validateSshLocation({ host: '[2001:db8::1]', user: 'tomek', port: 2222, path: '/p' }),
    ).toBeNull()
  })

  it.each([
    [{ ...valid, host: '' }, 'host', 'Enter a host name.'],
    [{ ...valid, host: '-oProxyCommand=evil' }, 'host', 'The host name is invalid.'],
    [{ ...valid, host: 'ho st' }, 'host', 'The host name is invalid.'],
    [{ ...valid, host: 'ho@st' }, 'host', 'The host name is invalid.'],
    [{ ...valid, user: '-oProxyCommand=evil' }, 'user', 'The user name is invalid.'],
    [{ ...valid, user: 'to mek' }, 'user', 'The user name is invalid.'],
    [{ ...valid, user: 'to/mek' }, 'user', 'The user name is invalid.'],
    [{ ...valid, port: 0 }, 'port', 'The port must be a number from 1 to 65535.'],
    [{ ...valid, port: 65536 }, 'port', 'The port must be a number from 1 to 65535.'],
    [{ ...valid, port: 22.5 }, 'port', 'The port must be a number from 1 to 65535.'],
    [{ ...valid, port: Number.NaN }, 'port', 'The port must be a number from 1 to 65535.'],
    [{ ...valid, path: '' }, 'path', 'Enter the remote directory.'],
    [
      { ...valid, path: 'home/tomek' },
      'path',
      'The remote directory must be an absolute POSIX path.',
    ],
    [
      { ...valid, path: '/home/../tomek' },
      'path',
      'The remote directory must not contain ".." segments.',
    ],
    [{ ...valid, path: '/' }, 'path', 'Cannot add a filesystem root as a project.'],
    [{ ...valid, path: '/home/\u0000app' }, 'path', 'The remote directory is invalid.'],
  ])('reports the field for %j', (input, field, message) => {
    expect(validateSshLocation(input)).toEqual({ field, message })
  })

  it('builds the canonical target from validated input', () => {
    expect(
      sshTargetFromInput({ host: 'My-Host', user: 'Tomek', port: null, path: '/srv/App/' }),
    ).toEqual({ user: 'Tomek', host: 'my-host', port: 22, path: '/srv/App', ipv6: false })
    expect(() => sshTargetFromInput({ ...valid, path: '/' })).toThrow(
      'Cannot add a filesystem root as a project.',
    )
  })
})
