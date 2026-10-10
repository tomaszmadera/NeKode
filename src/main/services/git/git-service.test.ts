import { describe, expect, it } from 'vitest'
import { emptyGitWorktree } from '../../../shared/ipc-contract'
import type { GitStatusRunner } from './git-service'
import { GitService, parseGitFileStatuses, parseGitStatus } from './git-service'

// Git status parser fixtures (plan Stage 3): realistic `git status
// --porcelain=v2 --branch` output for clean, dirty, detached HEAD and
// no-commits repositories, plus the degraded non-repo / git-missing paths.
// Counts cover the UX-UI §16 status forms and hover details.

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)

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

// A mixed worktree for the per-category counts behind the §16 hover details:
// modified 4 (incl. one rename), added 2, deleted 1, untracked 1, conflicts 1,
// ahead 3, behind 0.
const FIXTURE_COUNTS = `# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0
# branch.head main
# branch.upstream origin/main
# branch.ab +3 -0
1 M. N...100644 100644 100644 1111111111111111 2222222222222222 one.ts
1 MM N...100644 100644 100644 1111111111111111 2222222222222222 two.ts
1 .M N...100644 100644 100644 1111111111111111 2222222222222222 three.ts
2 R. N...100644 100644 100644 1111111111111111 2222222222222222 R100 four.ts	five.ts
1 A. N...100644 000000 000000 0000000000000000 2222222222222222 six.ts
1 A. N...100644 000000 000000 0000000000000000 2222222222222222 seven.ts
1 D. N...100644 100644 000000 1111111111111111 0000000000000000 eight.ts
? nine.txt
u UU N...100644 100644 100644 100644 1111111111111111 2222222222222222 3333333333333333 ten.txt
`

const expectedWorktree = (values: Partial<ReturnType<typeof emptyGitWorktree>>) => ({
  ...emptyGitWorktree(),
  ...values,
})

describe('parseGitStatus fixtures', () => {
  it('clean repository on main', () => {
    expect(parseGitStatus(FIXTURE_CLEAN)).toEqual({
      branch: 'main',
      dirty: false,
      worktree: expectedWorktree({}),
    })
  })

  it('dirty feature branch (modified, deleted and untracked entries)', () => {
    expect(parseGitStatus(FIXTURE_DIRTY)).toEqual({
      branch: 'feature/meta-pixel',
      dirty: true,
      worktree: expectedWorktree({ modified: 1, deleted: 1, untracked: 1, ahead: 1 }),
    })
  })

  it('detached HEAD', () => {
    expect(parseGitStatus(FIXTURE_DETACHED)).toEqual({
      branch: 'HEAD (detached)',
      dirty: false,
      worktree: expectedWorktree({}),
    })
  })

  it('no commits yet: branch still resolves, untracked files mark dirty', () => {
    expect(parseGitStatus(FIXTURE_NO_COMMITS_DIRTY)).toEqual({
      branch: 'main',
      dirty: true,
      worktree: expectedWorktree({ untracked: 1 }),
    })
    expect(parseGitStatus(FIXTURE_NO_COMMITS_CLEAN)).toEqual({
      branch: 'main',
      dirty: false,
      worktree: expectedWorktree({}),
    })
  })

  it('unmerged (conflict) entries mark the worktree dirty and count as conflicts', () => {
    expect(parseGitStatus(FIXTURE_UNMERGED)).toEqual({
      branch: 'main',
      dirty: true,
      worktree: expectedWorktree({ conflicts: 1 }),
    })
  })

  it('counts per category and ahead/behind (UX-UI §16 hover details)', () => {
    expect(parseGitStatus(FIXTURE_COUNTS)).toEqual({
      branch: 'main',
      dirty: true,
      worktree: expectedWorktree({
        modified: 4,
        added: 2,
        deleted: 1,
        untracked: 1,
        conflicts: 1,
        ahead: 3,
        behind: 0,
      }),
    })
  })

  it('empty or unusable output degrades to the no-git state', () => {
    const degraded = { branch: null, dirty: false, worktree: expectedWorktree({}) }
    expect(parseGitStatus('')).toEqual(degraded)
    expect(parseGitStatus('fatal: not a git repository')).toEqual(degraded)
    expect(parseGitStatus(`# branch.oid abc${LF}`)).toEqual(degraded)
  })

  it('tolerates CRLF output from the Windows git CLI', () => {
    const crlf = FIXTURE_CLEAN.split(LF).join(CR + LF)
    expect(parseGitStatus(crlf)).toEqual({
      branch: 'main',
      dirty: false,
      worktree: expectedWorktree({}),
    })
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
      worktree: expectedWorktree({}),
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
      worktree: expectedWorktree({}),
    })
  })

  it('git missing (runner rejects) degrades to "no git"', async () => {
    const service = new GitService({
      run: () => Promise.reject(new Error('spawn git ENOENT')),
    })
    await expect(service.getStatus('D:/code/demo')).resolves.toEqual({
      branch: null,
      dirty: false,
      worktree: expectedWorktree({}),
    })
  })
})

// NEKODE-31 (spec Behaviour 16-19, Data/API): the per-path status map behind
// the file-tree decoration. Fixtures mirror `git status --porcelain=v2
// --ignored=traditional`: ordinary entries, staged adds, deletions, renames,
// unmerged entries, untracked files and collapsed untracked/ignored
// directories, plus Git's C-quoted paths.

const FIXTURE_FILE_STATUSES = [
  '# branch.oid 3b1075d9a2f1c4d6e8f0a1b2c3d4e5f6a7b8c9d0',
  '1 M. N... 100644 100644 100644 1111111111111111 2222222222222222 src/app.ts',
  '1 A. N... 100644 000000 000000 0000000000000000 2222222222222222 src/new.ts',
  '1 D. N... 100644 100644 000000 1111111111111111 0000000000000000 src/old.ts',
  '1 .M N... 100644 100644 100644 1111111111111111 2222222222222222 docs/readme.md',
  '2 R. N... 100644 100644 100644 1111111111111111 2222222222222222 R100 docs/renamed.md\tdocs/old-name.md',
  'u UU N... 100644 100644 100644 100644 1111111111111111 2222222222222222 3333333333333333 conflict.txt',
  '? an-untracked.txt',
  '? sub/inner/',
  '! debug.log',
  '! node_modules/',
].join(LF)

describe('parseGitFileStatuses fixtures', () => {
  it('maps each porcelain entry to its decoration kind', () => {
    expect(parseGitFileStatuses(FIXTURE_FILE_STATUSES)).toEqual({
      'src/app.ts': 'modified',
      'src/new.ts': 'added',
      'src/old.ts': 'modified',
      'docs/readme.md': 'modified',
      'docs/renamed.md': 'modified',
      'conflict.txt': 'conflict',
      'an-untracked.txt': 'untracked',
      'sub/inner': 'untracked',
      'debug.log': 'ignored',
      node_modules: 'ignored',
    })
  })

  it('unquotes C-quoted paths, treats plain spaces as literal, and strips the directory slash', () => {
    const quoted = [
      '? "quo\\"ted.txt"',
      '! "caf\\303\\251.log"',
      '? "a dir/"',
      '? plain with spaces.txt',
    ].join(LF)
    expect(parseGitFileStatuses(quoted)).toEqual({
      'quo"ted.txt': 'untracked',
      'café.log': 'ignored',
      'a dir': 'untracked',
      'plain with spaces.txt': 'untracked',
    })
  })

  it('keeps the whole path when it contains a space (markers 1, 2 and u)', () => {
    // `git status --porcelain=v2` separates fields with single spaces and
    // does not quote a plain space, so the path is what follows the fixed
    // field run (ten fields for `u`), never `split(' ', N)`.
    const spaced = [
      '1 .M N... 100644 100644 100644 1111111111111111 2222222222222222 my file.txt',
      '2 R. N... 100644 100644 100644 1111111111111111 2222222222222222 R100 new name.txt\tdocs/old name.txt',
      'u UU N... 100644 100644 100644 100644 1111111111111111 2222222222222222 3333333333333333 my conflict.txt',
    ].join(LF)
    expect(parseGitFileStatuses(spaced)).toEqual({
      'my file.txt': 'modified',
      'new name.txt': 'modified',
      'my conflict.txt': 'conflict',
    })
  })

  it('tolerates CRLF output and stays empty on empty or unusable input', () => {
    expect(parseGitFileStatuses(FIXTURE_FILE_STATUSES.split(LF).join(CR + LF))).toEqual(
      parseGitFileStatuses(FIXTURE_FILE_STATUSES),
    )
    expect(parseGitFileStatuses('')).toEqual({})
    expect(parseGitFileStatuses('fatal: not a git repository')).toEqual({})
  })
})

describe('GitService file statuses (injected runner)', () => {
  const fileStatusArgs = ['status', '--porcelain=v2', '--ignored=traditional']

  it('runs the read-only porcelain command in the project directory', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = []
    const service = new GitService({
      run: (args, cwd) => {
        calls.push({ args, cwd })
        return Promise.resolve({ stdout: FIXTURE_FILE_STATUSES, stderr: '', exitCode: 0 })
      },
    })
    await expect(service.getFileStatuses('D:/code/demo')).resolves.toEqual({
      'src/app.ts': 'modified',
      'src/new.ts': 'added',
      'src/old.ts': 'modified',
      'docs/readme.md': 'modified',
      'docs/renamed.md': 'modified',
      'conflict.txt': 'conflict',
      'an-untracked.txt': 'untracked',
      'sub/inner': 'untracked',
      'debug.log': 'ignored',
      node_modules: 'ignored',
    })
    expect(calls).toEqual([{ args: fileStatusArgs, cwd: 'D:/code/demo' }])
  })

  it('degrades to the empty map on a non-repository exit or a rejected runner', async () => {
    const nonRepo = new GitService({
      run: () =>
        Promise.resolve({
          stdout: '',
          stderr: 'fatal: not a git repository',
          exitCode: 128,
        }),
    })
    await expect(nonRepo.getFileStatuses('D:/code/demo')).resolves.toEqual({})
    const missing = new GitService({
      run: () => Promise.reject(new Error('spawn git ENOENT')),
    })
    await expect(missing.getFileStatuses('D:/code/demo')).resolves.toEqual({})
  })
})
