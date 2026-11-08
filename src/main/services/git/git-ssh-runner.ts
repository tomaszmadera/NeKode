import { AppError } from '@shared/ipc-error'
import type { SshScriptClient } from '../ssh/ssh-client'
import type { GitRemoteRunner } from './git-service'

// Read-only Git over SSH (spec ssh-projects Behaviour 12 and Business rules):
// one non-interactive invocation per call, `git` on the remote host in the
// project directory with optional locks disabled, and a fixed positional form
// so no path or argument is interpolated into the script text.
//
// Logging is sanitized here and nowhere else: a failure writes the typed code
// only, never raw stderr, the command line or a remote path.

/** `$1` is the remote project directory, the remaining positional args are git's. */
export const SSH_GIT_SCRIPT = 'cd "$1" || exit 111; shift; GIT_OPTIONAL_LOCKS=0 git "$@"'

/**
 * Builds the remote runner the GitService uses for an SSH project. A failed
 * invocation resolves with a non-zero exit so the caller degrades to the
 * existing no-git state; it never throws into the status read.
 */
export function createSshGitRunner(
  client: SshScriptClient,
  log: (message: string) => void = (message) => console.warn(message),
): GitRemoteRunner {
  return async ({ target, cwd, args }) => {
    try {
      const result = await client.runScript(target, SSH_GIT_SCRIPT, [cwd, ...args])
      // Git output never contains NUL, so the field split cannot alter it.
      return { stdout: result.fields[0] ?? '', stderr: '', exitCode: result.exitCode }
    } catch (error) {
      log(
        `[git] remote read-only call failed (${error instanceof AppError ? error.code : 'unknown'})`,
      )
      return { stdout: '', stderr: '', exitCode: 255 }
    }
  }
}
