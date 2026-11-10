// One decision about where a project lives and runs (spec
// project-environment-clarity Scope 1). Only the persisted project path is
// input: no filesystem, process or credential access lives here.
//
// The two existing parsers keep their own outcomes and this module exposes the
// difference instead of hiding it: `projectEnvironment` never throws and
// reports a rejected path as `malformed`, while `projectWslLocation` keeps the
// throwing outcome every current WSL call site has.

import { DEFAULT_SSH_PORT, parseSshTarget, type SshTarget, sshDestination } from './ssh-target'
import { parseWslPath, type WslLocation } from './wsl-path'

export type ProjectEnvironment =
  | { kind: 'local' }
  | { kind: 'wsl'; distribution: string; linuxPath: string }
  | { kind: 'ssh'; target: SshTarget }
  /** A path that claims an environment but fails its parser's rules. */
  | { kind: 'malformed'; transport: 'wsl' | 'ssh'; path: string; message: string | null }

/** Classifies a stored project path. Never throws. */
export function projectEnvironment(path: string): ProjectEnvironment {
  const target = parseSshTarget(path)
  if (target !== null) return { kind: 'ssh', target }
  if (path.startsWith('ssh://')) return { kind: 'malformed', transport: 'ssh', path, message: null }
  try {
    const wsl = parseWslPath(path)
    if (wsl !== null)
      return { kind: 'wsl', distribution: wsl.distribution, linuxPath: wsl.linuxPath }
  } catch (error) {
    return {
      kind: 'malformed',
      transport: 'wsl',
      path,
      message: error instanceof Error ? error.message : 'Invalid WSL project path.',
    }
  }
  return { kind: 'local' }
}

/**
 * WSL location of a project path, or null for a Local or SSH project. A
 * malformed WSL UNC path throws the error `parseWslPath` raises, which is the
 * outcome the existing WSL call sites already have.
 */
export function projectWslLocation(path: string): WslLocation | null {
  const environment = projectEnvironment(path)
  if (environment.kind === 'malformed') {
    if (environment.transport === 'wsl')
      throw new Error(environment.message ?? 'Invalid WSL project path.')
    return null
  }
  return environment.kind === 'wsl'
    ? { distribution: environment.distribution, linuxPath: environment.linuxPath }
    : null
}

/** `[user@]host[:port]`, the port shown only when it is not 22. */
export function sshEnvironmentTarget(target: SshTarget): string {
  const destination = sshDestination(target)
  return target.port === DEFAULT_SSH_PORT ? destination : `${destination}:${target.port}`
}
