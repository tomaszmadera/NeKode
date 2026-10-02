import { execFile } from 'node:child_process'
import {
  emptyGitWorktree,
  type GitStatus,
  type GitWorktreeStatus,
} from '../../../shared/ipc-contract'

// Read-only git status for the status bar (UX-UI §14–16): branch, worktree
// status and change counts via the git CLI. No watchers, no mutations. Any
// failure (not a repo, git missing, permission errors) degrades to the "no
// git" state instead of failing the workspace (spec Errors).

export interface GitStatusRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Injectable command runner so tests never spawn real processes. */
export type GitStatusRunner = (args: string[], cwd: string) => Promise<GitStatusRunResult>

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)

/** The no-git degraded state: no branch, neutral status, zero counts. */
export function degradedGitStatus(): GitStatus {
  return { branch: null, dirty: false, worktree: emptyGitWorktree() }
}

/**
 * Parses `git status --porcelain=v2 --branch` output into the wire shape:
 * branch name, dirty flag and the worktree counts behind the UX-UI §16 forms
 * (ordinary 1/2 entries by their XY status, u = conflicts, ? = untracked) plus
 * the ahead/behind counts from the branch.ab header.
 *
 * Fixtures covered in tests: clean, dirty, detached HEAD, no commits yet,
 * unmerged entries, empty/garbage output (non-repo fallback).
 */
export function parseGitStatus(output: string): GitStatus {
  const lines = output
    .split(LF)
    .map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
  let branch: string | null = null
  let dirty = false
  const worktree: GitWorktreeStatus = emptyGitWorktree()
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (value === '(detached)') {
        // Porcelain v2 reports detached HEADs as "(detached)".
        branch = 'HEAD (detached)'
      } else if (value.length > 0) {
        branch = value
      }
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const values = line.slice('# branch.ab '.length).trim().split(' ')
      for (const value of values) {
        const amount = Number.parseInt(value.slice(1), 10)
        if (!Number.isFinite(amount)) {
          continue
        }
        if (value.startsWith('+')) {
          worktree.ahead = amount
        } else if (value.startsWith('-')) {
          worktree.behind = amount
        }
      }
      continue
    }
    if (line.startsWith('#')) {
      continue
    }
    // 1/2 (changed), u (unmerged), ? (untracked), ! (ignored) entries.
    dirty = true
    if (line.startsWith('u ')) {
      worktree.conflicts += 1
    } else if (line.startsWith('? ')) {
      worktree.untracked += 1
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // The XY status field: X = staged, Y = unstaged. Deletes win over
      // other marks (a staged delete is XY D.), adds next, everything else
      // (modified/renamed/copied) counts as modified.
      const xy = line.split(' ')[1] ?? ''
      if (xy.includes('D')) {
        worktree.deleted += 1
      } else if (xy.startsWith('A')) {
        worktree.added += 1
      } else {
        worktree.modified += 1
      }
    }
  }
  if (branch === null) {
    // No branch header: not usable git output — the honest "no git" state.
    return degradedGitStatus()
  }
  return { branch, dirty, worktree }
}

export interface GitServiceOptions {
  run?: GitStatusRunner
}

export class GitService {
  readonly #run: GitStatusRunner

  constructor(options: GitServiceOptions = {}) {
    this.#run = options.run ?? execFileRunner
  }

  async getStatus(projectPath: string): Promise<GitStatus> {
    try {
      const result = await this.#run(['status', '--porcelain=v2', '--branch'], projectPath)
      if (result.exitCode !== 0) {
        return degradedGitStatus()
      }
      return parseGitStatus(result.stdout)
    } catch {
      // git missing, not a repository, or any other failure: degrade quietly.
      return degradedGitStatus()
    }
  }
}

function execFileRunner(args: string[], cwd: string): Promise<GitStatusRunResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
      const exitCode =
        error !== null && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : error !== null
            ? 1
            : 0
      resolve({ stdout, stderr, exitCode })
    })
  })
}
