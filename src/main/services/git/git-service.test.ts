import { describe, expect, it } from 'vitest'
import type { GitStatusRunner } from './git-service'
import { GitService, parseGitStatus } from './git-service'

// Git status parser fixtures (plan Stage 3): realistic `git status
// --porcelain=v2 --branch` output for clean, dirty, detached HEAD and
// no-commits repositories, plus the degraded non-repo / git-missing paths.

const FIXTURE_CLEAN = `# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
`

const FIXTURE_DIRTY = `# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0
# branch.head feature/meta-pixel
# branch.upstream origin/feature/meta-pixel
# branch.ab +1 -0
1 M. N...100644 100644 100644 1111111111111111 2222222222222222 src/app.ts
1 .D N...100644 100644 000000 3333333333333333 4444444444444444 old.ts
? untracked.txt
`

const FIXTURE_DETACHED = `# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0
# branch.head (detached)
`

const FIXTURE_NO_COMMITS_DIRTY = `# branch.oid (initial)
# branch.head main
? hello.txt
`

const FIXTURE_NO_COMMITS_CLEAN = `# branch.oid (initial)
# branch.head main
`

const FIXTURE_UNMERGED = `# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0
# branch.head main
u UU N...100644 100644 100644 100644 1111111111111111 2222222222222222 3333333333333333 conflict.txt
`

describe('parseGitStatus fixtures', () => {
  it('clean repository on main', () => {
    expect(parseGitStatus(FIXTURE_CLEAN)).toEqual({ branch: 'main', dirty: false })
  })

  it('dirty feature branch (modified, deleted and untracked entries)', () => {
    expect(parseGitStatus(FIXTURE_DIRTY)).toEqual({ branch: 'feature/meta-pixel', dirty: true })
  })

  it('detached HEAD', () => {
    expect(parseGitStatus(FIXTURE_DETACHED)).toEqual({ branch: 'HEAD (detached)', dirty: false })
  })

  it('no commits yet: branch still resolves, untracked files mark dirty', () => {
    expect(parseGitStatus(FIXTURE_NO_COMMITS_DIRTY)).toEqual({ branch: 'main', dirty: true })
    expect(parseGitStatus(FIXTURE_NO_COMMITS_CLEAN)).toEqual({ branch: 'main', dirty: false })
  })

  it('unmerged (conflict) entries mark the worktree dirty', () => {
    expect(parseGitStatus(FIXTURE_UNMERGED)).toEqual({ branch: 'main', dirty: true })
  })

  it('empty or unusable output degrades to the no-git state', () => {
    expect(parseGitStatus('')).toEqual({ branch: null, dirty: false })
    expect(parseGitStatus('fatal: not a git repository')).toEqual({ branch: null, dirty: false })
    expect(parseGitStatus('# branch.oid abc\n')).toEqual({ branch: null, dirty: false })
  })

  it('tolerates CRLF output from the Windows git CLI', () => {
    const crlf = FIXTURE_CLEAN.replace(/\n/g, '\r\n')
    expect(parseGitStatus(crlf)).toEqual({ branch: 'main', dirty: false })
  })
})

describe('GitService (injected runner)', () => {
  const gitArgs = ['status', '--porcelain=v2', '--branch']

  function runnerWith(result: { stdout: string; stderr: string; exitCode: number }): {
    runner: GitStatusRunner
    calls: Array<{ args: string[]; cwd: string }>
  } {
    const calls: Array<{ args: string[]; cwd: string }> = []
    const runner: GitStatusRunner = (args, cwd) => {
      calls.push({ args, cwd })
      return Promise.resolve(result)
    }
    return { runner, calls }
  }

  it('runs the read-only porcelain command in the project directory', async () => {
    const { runner, calls } = runnerWith({ stdout: FIXTURE_CLEAN, stderr: '', exitCode: 0 })
    const service = new GitService({ run: runner })
    await expect(service.getStatus('D:/code/demo')).resolves.toEqual({
      branch: 'main',
      dirty: false,
    })
    expect(calls).toEqual([{ args: gitArgs, cwd: 'D:/code/demo' }])
  })

  it('non-repo exit degrades to "no git" instead of failing', async () => {
    const { runner } = runnerWith({
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      exitCode: 128,
    })
    const service = new GitService({ run: runner })
    await expect(service.getStatus('D:/code/demo')).resolves.toEqual({
      branch: null,
      dirty: false,
    })
  })

  it('git missing (runner rejects) degrades to "no git"', async () => {
    const service = new GitService({
      run: () => Promise.reject(new Error('spawn git ENOENT')),
    })
    await expect(service.getStatus('D:/code/demo')).resolves.toEqual({
      branch: null,
      dirty: false,
    })
  })
})
