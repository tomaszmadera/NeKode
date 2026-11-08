import { emptyGitWorktree, type GitStatus } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { describe, expect, it, vi } from 'vitest'
import {
  type GitRemoteRequest,
  type GitRemoteRunner,
  GitService,
  type GitStatusRunner,
} from './git-service'
import { createSshGitRunner, SSH_GIT_SCRIPT } from './git-ssh-runner'

// Read-only Git over SSH (spec ssh-projects Behaviour 12 and Required tests):
// one invocation per call, the remote project directory, GIT_OPTIONAL_LOCKS=0,
// the unchanged porcelain parsers, the no-git fallback and sanitized logging.
// Nothing is spawned: the remote runner is a fake.

const SSH_PATH = 'ssh://tomek@minipc/srv/app'
const REMOTE_ARGS = ['status', '--porcelain=v2', '--branch']
const REMOTE_FILE_ARGS = ['status', '--porcelain=v2', '--ignored=traditional']

const FIXTURE_STATUS = [
  '# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0',
  '# branch.head main',
  '# branch.ab +1 -2',
  '1 .M N... 100644 100644 100644 1111111111111111 2222222222222222 src/app.ts',
  '? an-untracked.txt',
].join('\n')

function target(value = SSH_PATH): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

function sshProjectLookup(): { get: (id: string) => { path: string } | null } {
  return { get: (id) => (id === 'ssh-1' ? { path: SSH_PATH } : null) }
}

function remoteWith(result: { stdout: string; stderr: string; exitCode: number }): {
  remote: GitRemoteRunner
  calls: GitRemoteRequest[]
} {
  const calls: GitRemoteRequest[] = []
  const remote: GitRemoteRunner = (request) => {
    calls.push(request)
    return Promise.resolve(result)
  }
  return { remote, calls }
}

describe('GitService over SSH', () => {
  it('reads status in one remote invocation in the project directory', async () => {
    const { remote, calls } = remoteWith({ stdout: FIXTURE_STATUS, stderr: '', exitCode: 0 })
    const service = new GitService({ projects: sshProjectLookup(), remote })
    const status: GitStatus = await service.getStatus('ssh-1')
    expect(status).toMatchObject({ branch: 'main', dirty: true })
    expect(status.worktree).toMatchObject({ modified: 1, untracked: 1, ahead: 1, behind: 2 })
    expect(calls).toEqual([{ target: target(), cwd: '/srv/app', args: REMOTE_ARGS }])
  })

  it('reads file decorations in one remote invocation with the unchanged parser', async () => {
    const { remote, calls } = remoteWith({
      stdout: ['1 M. N... 100644 100644 100644 a b src/app.ts', '? new.txt'].join('\n'),
      stderr: '',
      exitCode: 0,
    })
    const service = new GitService({ projects: sshProjectLookup(), remote })
    await expect(service.getFileStatuses('ssh-1')).resolves.toEqual({
      'src/app.ts': 'modified',
      'new.txt': 'untracked',
    })
    expect(calls).toEqual([{ target: target(), cwd: '/srv/app', args: REMOTE_FILE_ARGS }])
  })

  it('degrades to the no-git state on a failed remote exit, a rejected runner or a missing runner', async () => {
    const degraded = { branch: null, dirty: false, worktree: emptyGitWorktree() }
    const failed = new GitService({
      projects: sshProjectLookup(),
      remote: async () => ({ stdout: '', stderr: 'fatal: not a git repository', exitCode: 128 }),
    })
    await expect(failed.getStatus('ssh-1')).resolves.toEqual(degraded)
    await expect(failed.getFileStatuses('ssh-1')).resolves.toEqual({})

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rejected = new GitService({
      projects: sshProjectLookup(),
      remote: () => Promise.reject(new AppError('auth', 'The SSH host key is not trusted.')),
    })
    await expect(rejected.getStatus('ssh-1')).resolves.toEqual(degraded)
    await expect(rejected.getFileStatuses('ssh-1')).resolves.toEqual({})
    // GitService never logs a remote path or a command line.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()

    const run = vi.fn<GitStatusRunner>(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    const noRemote = new GitService({ projects: sshProjectLookup(), run })
    expect(await noRemote.getStatus('ssh-1')).toEqual(degraded)
    // The absent remote runner means no-git: the local runner is never used.
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps git:sync unsupported and runs no remote git', async () => {
    const { remote, calls } = remoteWith({ stdout: '', stderr: '', exitCode: 0 })
    const service = new GitService({ projects: sshProjectLookup(), remote })
    await expect(service.sync('ssh-1')).rejects.toMatchObject({
      code: 'unsupported',
      message: 'This action is not available for SSH projects.',
    })
    expect(calls).toEqual([])
  })
})

describe('createSshGitRunner', () => {
  function scriptClient(result: { exitCode: number; fields: string[] } | Error) {
    const runScript = vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    })
    return { runScript, client: { runScript, runScriptBytes: vi.fn() } }
  }

  it('runs one non-interactive script with optional locks disabled and positional argv', async () => {
    const { client, runScript } = scriptClient({ exitCode: 0, fields: ['# branch.head main\n'] })
    const remote = createSshGitRunner(client, () => undefined)
    const result = await remote({ target: target(), cwd: '/srv/app', args: REMOTE_ARGS })

    expect(result).toEqual({ stdout: '# branch.head main\n', stderr: '', exitCode: 0 })
    expect(runScript).toHaveBeenCalledTimes(1)
    const [calledTarget, script, args] = runScript.mock.calls[0] as unknown as [
      SshTarget,
      string,
      string[],
    ]
    expect(calledTarget.path).toBe('/srv/app')
    expect(script).toBe(SSH_GIT_SCRIPT)
    expect(script).toContain('GIT_OPTIONAL_LOCKS=0')
    expect(script).toContain('git "$@"')
    expect(script).toContain('exit 111')
    expect(args).toEqual(['/srv/app', ...REMOTE_ARGS])
  })

  it('logs a sanitized reason and reports a failed exit without raw stderr or paths', async () => {
    const logs: string[] = []
    const failing = scriptClient(
      new AppError('auth', 'The SSH host key is not trusted. Verify the host key in known_hosts.'),
    )
    const result = await createSshGitRunner(failing.client, (message) => logs.push(message))({
      target: target(),
      cwd: '/srv/app',
      args: REMOTE_ARGS,
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('auth')
    expect(logs[0]).not.toContain('/srv/app')
    expect(logs[0]).not.toContain('status')
    expect(logs[0]).not.toContain('known_hosts')
  })
})
