import { AppError } from '@shared/ipc-error'
import type { SshTarget } from '@shared/ssh-target'
import type { SshClient } from '../ssh/ssh-client'
import type { ShellSpec } from './terminal-service'

// Terminal runtime for an SSH project (spec ssh-projects Behaviour 6-8): the
// local OpenSSH client runs under the PTY, changes to the remote project
// directory and executes the remote login shell (or the agent command). The
// local working directory is the local user home, never the SSH URL.

export interface SshTerminalDeps {
  client: SshClient
  /** Existing local directory for the PTY; never the SSH URL. */
  localCwd: string
}

export interface SshTerminalSpec {
  file: string
  args: string[]
  /** Local PTY working directory. */
  cwd: string
  target: SshTarget
}

/**
 * Prepares the local ssh spawn of one SSH project path. `command` is the
 * agent executable and argv; absent means the remote login shell.
 */
export function prepareSshTerminal(
  target: SshTarget,
  deps: SshTerminalDeps | undefined,
  command?: ShellSpec,
): SshTerminalSpec {
  if (deps === undefined) {
    throw new AppError('unknown', 'The SSH client is not available on this machine.')
  }
  const spawn = deps.client.terminalCommand(target, command)
  return { file: spawn.file, args: spawn.args, cwd: deps.localCwd, target }
}
