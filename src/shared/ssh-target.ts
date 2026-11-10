// Pure SSH project location: parse, format, validate and identity of
// `ssh://[user@]host[:port]/absolute/path` (spec ssh-projects Data/API).
// Shared by main and renderer: the renderer validates the dialog fields with
// the same rules main enforces, and main stores the canonical form. No
// filesystem, process or credential access lives here.

const SSH_SCHEME = 'ssh://'
export const DEFAULT_SSH_PORT = 22

/** Letters, digits, `.`, `_`, `-`: DNS labels, IPv4 and ssh_config aliases. */
const HOST_BODY = /^[A-Za-z0-9._-]+$/u
/** Bracketed IPv6 literal: hex digits, `:` and embedded IPv4 dots. */
const IPV6_BODY = /^[0-9A-Fa-f:.]+$/u
/** The user may also carry dots, underscores and hyphens. */
const USER_BODY = /^[A-Za-z0-9._-]+$/u
const PORT_BODY = /^[0-9]+$/u

export type SshField = 'host' | 'user' | 'port' | 'path'

export interface SshTarget {
  /** Preserved case; null when the location has no user. */
  user: string | null
  /** Lower case, without IPv6 brackets. */
  host: string
  /** 1 to 65535; 22 when the location omitted the port. */
  port: number
  /** Absolute POSIX path without a trailing slash, `.` or `..` segments. */
  path: string
  /** True for a bracketed IPv6 literal host. */
  ipv6: boolean
}

/** Dialog input as the renderer and the IPC payload carry it. */
export interface SshLocationInput {
  host: string
  user: string | null
  port: number | null
  path: string
}

export interface SshLocationError {
  field: SshField
  message: string
}

/** True for anything shaped like an SSH project location, valid or not. */
export function isSshProjectPath(value: string): boolean {
  return value.startsWith(SSH_SCHEME)
}

export function isValidHost(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false
  if (value.startsWith('-')) return false
  return HOST_BODY.test(value)
}

function isValidIpv6Host(value: string): boolean {
  return value.length > 0 && value.includes(':') && IPV6_BODY.test(value)
}

export function isValidSshUser(value: string): boolean {
  return value.length > 0 && !value.startsWith('-') && USER_BODY.test(value)
}

function parsePort(value: string): number | null {
  if (!PORT_BODY.test(value)) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

/**
 * Canonical remote path: absolute, no trailing slash, no empty or `.`
 * segments, no `..` segments, no NUL, and never the filesystem root (it has
 * no usable project name). Returns null when the path is unusable.
 */
export function canonicalRemotePath(value: string): string | null {
  if (!value.startsWith('/') || value.includes('\u0000')) return null
  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  if (segments.length === 0) return null
  return `/${segments.join('/')}`
}

function parseAuthority(
  authority: string,
): { user: string | null; host: string; port: number; ipv6: boolean } | null {
  const at = authority.lastIndexOf('@')
  const userPart = at === -1 ? null : authority.slice(0, at)
  if (userPart !== null && !isValidSshUser(userPart)) return null
  const hostPart = at === -1 ? authority : authority.slice(at + 1)

  let host: string
  let portText: string | null
  let ipv6 = false
  if (hostPart.startsWith('[')) {
    const close = hostPart.indexOf(']')
    if (close === -1) return null
    host = hostPart.slice(1, close)
    const rest = hostPart.slice(close + 1)
    if (rest.length > 0 && !rest.startsWith(':')) return null
    portText = rest.length === 0 ? null : rest.slice(1)
    ipv6 = true
    if (!isValidIpv6Host(host)) return null
  } else {
    const colon = hostPart.lastIndexOf(':')
    host = colon === -1 ? hostPart : hostPart.slice(0, colon)
    portText = colon === -1 ? null : hostPart.slice(colon + 1)
    if (!isValidHost(host)) return null
  }

  let port = DEFAULT_SSH_PORT
  if (portText !== null) {
    const parsed = parsePort(portText)
    if (parsed === null) return null
    port = parsed
  }
  return { user: userPart, host: host.toLowerCase(), port, ipv6 }
}

/**
 * Parses a stored or pasted `ssh://` location. Returns null when the value is
 * not an SSH location at all or fails any rule, so callers can fall through to
 * the local/WSL path rules.
 */
export function parseSshTarget(value: string): SshTarget | null {
  if (!isSshProjectPath(value)) return null
  const rest = value.slice(SSH_SCHEME.length)
  const slash = rest.indexOf('/')
  const authority = slash === -1 ? rest : rest.slice(0, slash)
  const path = canonicalRemotePath(slash === -1 ? '' : rest.slice(slash))
  if (path === null) return null
  const parsed = parseAuthority(authority)
  if (parsed === null) return null
  return { ...parsed, path }
}

/** Canonical stored form; port 22 is omitted and IPv6 hosts are bracketed. */
export function formatSshTarget(target: SshTarget): string {
  const host = target.ipv6 ? `[${target.host}]` : target.host
  const user = target.user === null ? '' : `${target.user}@`
  const port = target.port === DEFAULT_SSH_PORT ? '' : `:${target.port}`
  return `${SSH_SCHEME}${user}${host}${port}${target.path}`
}

/**
 * Identity of an SSH project path for the unique `path_identity` column: the
 * canonical form, so a trailing slash, a mixed-case host and an explicit `:22`
 * collapse to one value. Null when the path is not a valid SSH location.
 */
export function sshProjectPathIdentity(value: string): string | null {
  const target = parseSshTarget(value)
  return target === null ? null : formatSshTarget(target)
}

/** Project name: the last POSIX segment of the remote path. */
export function sshTargetName(target: SshTarget): string {
  return target.path.slice(target.path.lastIndexOf('/') + 1)
}

/** `[user@]host` as ssh expects it on the command line (IPv6 in brackets). */
export function sshDestination(target: SshTarget): string {
  const host = target.ipv6 ? `[${target.host}]` : target.host
  return target.user === null ? host : `${target.user}@${host}`
}

/** Splits an optionally bracketed host into its body and IPv6 marker. */
function bareHost(host: string): { host: string; ipv6: boolean } {
  if (host.startsWith('[') && host.endsWith(']')) {
    return { host: host.slice(1, -1), ipv6: true }
  }
  return { host, ipv6: false }
}

/**
 * Field-specific validation of the dialog payload (spec Behaviour 2 and
 * Errors). The renderer shows the message under the field; main rejects the
 * payload before any connection attempt.
 */
export function validateSshLocation(input: SshLocationInput): SshLocationError | null {
  if (typeof input.host !== 'string' || input.host.length === 0) {
    return { field: 'host', message: 'Enter a host name.' }
  }
  const host = bareHost(input.host)
  if (host.ipv6 ? !isValidIpv6Host(host.host) : !isValidHost(host.host)) {
    return { field: 'host', message: 'The host name is invalid.' }
  }
  if (input.user !== null && !isValidSshUser(input.user)) {
    return { field: 'user', message: 'The user name is invalid.' }
  }
  if (
    input.port !== null &&
    (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
  ) {
    return { field: 'port', message: 'The port must be a number from 1 to 65535.' }
  }
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return { field: 'path', message: 'Enter the remote directory.' }
  }
  if (input.path.includes('\u0000')) {
    return { field: 'path', message: 'The remote directory is invalid.' }
  }
  if (!input.path.startsWith('/')) {
    return { field: 'path', message: 'The remote directory must be an absolute POSIX path.' }
  }
  if (input.path.split('/').includes('..')) {
    return { field: 'path', message: 'The remote directory must not contain ".." segments.' }
  }
  if (canonicalRemotePath(input.path) === null) {
    return { field: 'path', message: 'Cannot add a filesystem root as a project.' }
  }
  return null
}

/**
 * Builds the canonical target from validated dialog input. Throws on invalid
 * input; callers run `validateSshLocation` first to report the field.
 */
export function sshTargetFromInput(input: SshLocationInput): SshTarget {
  const error = validateSshLocation(input)
  if (error !== null) throw new Error(error.message)
  const host = bareHost(input.host)
  const path = canonicalRemotePath(input.path)
  if (path === null) throw new Error('Invalid SSH location.')
  return {
    user: input.user,
    host: host.host.toLowerCase(),
    port: input.port ?? DEFAULT_SSH_PORT,
    path,
    ipv6: host.ipv6,
  }
}
