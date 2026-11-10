import { describe, expect, it } from 'vitest'
import { projectEnvironment, projectWslLocation, sshEnvironmentTarget } from './project-environment'
import { parseSshTarget } from './ssh-target'
import { parseWslPath } from './wsl-path'

// Characterization table of the resolver (spec project-environment-clarity
// Required tests): the same recognition `parseWslPath` and `parseSshTarget`
// perform, plus the outcome each parser gives for a rejected value.

const LOCAL_PATHS = [
  'C:\\code\\app',
  'D:/code/app',
  '/home/user/app',
  '',
  '\\\\server\\share\\app',
  'C:\\wsl and ssh notes\\app',
]

const WSL_PATHS = [
  ['\\\\wsl$\\Ubuntu\\home\\u', 'Ubuntu', '/home/u'],
  ['\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\My Project', 'Ubuntu-24.04', '/home/u/My Project'],
  ['//WSL.LOCALHOST/Ubuntu/home/u', 'Ubuntu', '/home/u'],
] as const

const SSH_PATHS = [
  'ssh://host/srv/app',
  'ssh://User@Host:2222/srv/app',
  'ssh://[2001:db8::1]:2200/srv/app',
]

const MALFORMED_WSL_PATHS = [
  '\\\\wsl$\\Ubuntu',
  '\\\\wsl$\\Ubuntu\\home\\..\\u',
  '\\\\wsl.localhost\\',
]

const MALFORMED_SSH_PATHS = [
  'ssh://host',
  'ssh://host/',
  'ssh:///srv/app',
  'ssh://host/srv/../app',
  'ssh://-oProxyCommand=evil/p',
  'ssh://ho st/p',
  'ssh://host:0/p',
  'ssh://[2001:db8::1/p',
]

describe('projectEnvironment', () => {
  it.each(LOCAL_PATHS)('classifies %j as local', (path) => {
    expect(projectEnvironment(path)).toEqual({ kind: 'local' })
  })

  it.each(WSL_PATHS)('classifies %j as the WSL distribution', (path, distribution, linuxPath) => {
    expect(projectEnvironment(path)).toEqual({ kind: 'wsl', distribution, linuxPath })
  })

  it.each(SSH_PATHS)('classifies %j as SSH with the parsed target', (path) => {
    expect(projectEnvironment(path)).toEqual({ kind: 'ssh', target: parseSshTarget(path) })
  })

  it.each(MALFORMED_SSH_PATHS)('reports %j as a malformed SSH location, not local', (path) => {
    expect(projectEnvironment(path)).toEqual({
      kind: 'malformed',
      transport: 'ssh',
      path,
      message: null,
    })
  })

  it.each(MALFORMED_WSL_PATHS)('reports %j as a malformed WSL location, not local', (path) => {
    let parserMessage = ''
    try {
      parseWslPath(path)
    } catch (error) {
      parserMessage = (error as Error).message
    }
    expect(parserMessage).not.toBe('')
    expect(projectEnvironment(path)).toEqual({
      kind: 'malformed',
      transport: 'wsl',
      path,
      message: parserMessage,
    })
  })

  it('agrees with the parser it wraps for every accepted path', () => {
    for (const path of [...LOCAL_PATHS, ...WSL_PATHS.map(([value]) => value), ...SSH_PATHS]) {
      const environment = projectEnvironment(path)
      if (environment.kind === 'wsl') {
        expect(parseWslPath(path)).toEqual({
          distribution: environment.distribution,
          linuxPath: environment.linuxPath,
        })
      } else if (environment.kind === 'ssh') {
        expect(parseSshTarget(path)).toEqual(environment.target)
      } else {
        expect(parseSshTarget(path)).toBeNull()
        expect(parseWslPath(path)).toBeNull()
      }
    }
  })
})

describe('projectWslLocation', () => {
  it('matches parseWslPath for every accepted path', () => {
    for (const path of [...LOCAL_PATHS, ...WSL_PATHS.map(([value]) => value), ...SSH_PATHS]) {
      expect(projectWslLocation(path)).toEqual(parseWslPath(path))
    }
  })

  it.each(MALFORMED_WSL_PATHS)('throws the parser error for %j, as today', (path) => {
    expect(() => parseWslPath(path)).toThrow()
    expect(() => projectWslLocation(path)).toThrow()
    let parserMessage = ''
    try {
      parseWslPath(path)
    } catch (error) {
      parserMessage = (error as Error).message
    }
    expect(() => projectWslLocation(path)).toThrow(parserMessage)
  })

  it('returns null for a malformed SSH location instead of throwing', () => {
    expect(projectWslLocation('ssh://host')).toBeNull()
    expect(projectWslLocation('ssh://-oProxyCommand=evil/p')).toBeNull()
  })
})

describe('sshEnvironmentTarget', () => {
  it('omits the port when it is 22 and brackets an IPv6 host', () => {
    expect(
      sshEnvironmentTarget({ user: null, host: 'minipc', port: 22, path: '/p', ipv6: false }),
    ).toBe('minipc')
    expect(
      sshEnvironmentTarget({ user: 'tomek', host: 'minipc', port: 22, path: '/p', ipv6: false }),
    ).toBe('tomek@minipc')
    expect(
      sshEnvironmentTarget({
        user: 'tomek',
        host: '2001:db8::1',
        port: 2222,
        path: '/p',
        ipv6: true,
      }),
    ).toBe('tomek@[2001:db8::1]:2222')
  })
})
