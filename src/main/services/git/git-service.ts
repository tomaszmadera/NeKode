import { execFile } from 'node:child_process'
import {
  emptyGitWorktree,
  type GitFileStatuses,
  type GitFileStatusKind,
  type GitStatus,
  type GitWorktreeStatus,
} from '../../../shared/ipc-contract'
import { parseWslPath } from '../../../shared/wsl-path'

// Read-only git status for the status bar (UX-UI §14–16) and, since
// NEKODE-31, the per-path map behind the file-tree decoration (spec
// Behaviour 16-19): branch, worktree status and change counts via the git
// CLI. No watchers, no mutations. Any failure (not a repo, git missing,
// permission errors) degrades to the "no git" state instead of failing the
// workspace (spec Errors).

export interface GitStatusRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Injectable command runner so tests never spawn real processes. */
export type GitStatusRunner = (args: string[], cwd: string) => Promise<GitStatusRunResult>

/** The per-path status read behind the file-tree decoration (NEKODE-31). */
const FILE_STATUS_ARGS = ['status', '--porcelain=v2', '--ignored=traditional']

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const TAB = String.fromCharCode(9)

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

// C-style escapes git uses when it quotes a path (`core.quotePath`, on by
// default). Octal escapes carry UTF-8 bytes, so decoding runs on bytes.
const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '\\': 92,
  '"': 34,
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

/** Undoes git's C-quoting of a path field. */
function unquoteGitPath(value: string): string {
  if (!value.startsWith('"')) {
    return value
  }
  const end = value.endsWith('"') && value.length > 1 ? value.length - 1 : value.length
  const inner = value.slice(1, end)
  const bytes: number[] = []
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? ''
    if (char !== '\\') {
      for (const byte of textEncoder.encode(char)) {
        bytes.push(byte)
      }
      continue
    }
    const escaped = inner[index + 1]
    if (escaped === undefined) {
      break
    }
    const simple = SIMPLE_ESCAPES[escaped]
    if (simple !== undefined) {
      bytes.push(simple)
      index += 1
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(index + 1))?.[0]
    if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8) & 0xff)
      index += octal.length
      continue
    }
    for (const byte of textEncoder.encode(escaped)) {
      bytes.push(byte)
    }
    index += 1
  }
  return textDecoder.decode(new Uint8Array(bytes))
}

/** A directory entry keys without its slash; it covers its whole subtree. */
function withoutTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.replace(/\/+$/, '') : path
}

/** XY status of an ordinary/renamed entry: only a staged add is its own kind. */
function statusKindForXy(xy: string): GitFileStatusKind {
  return xy.startsWith('A') && !xy.includes('D') ? 'added' : 'modified'
}

/** Field count before the path field, by porcelain v2 marker. */
const PATH_FIELD_COUNT: Readonly<Record<'1' | '2' | 'u', number>> = { '1': 8, '2': 9, u: 10 }

/**
 * Cuts the first `count` space-separated fields off a porcelain line and
 * returns them with the untouched remainder. `git status --porcelain=v2`
 * separates its fields with single spaces but leaves a plain space inside a
 * path alone, so the path field is the remainder of the line: a limited
 * `split(' ', count)` would truncate a spaced path to its first word.
 */
function cutFields(line: string, count: number): { fields: string[]; rest: string } | null {
  const fields: string[] = []
  let index = 0
  for (let taken = 0; taken < count; taken += 1) {
    const space = line.indexOf(' ', index)
    if (space === -1) {
      return null
    }
    fields.push(line.slice(index, space))
    index = space + 1
  }
  return { fields, rest: line.slice(index) }
}

function parseFileStatusLine(line: string): [string, GitFileStatusKind] | null {
  const marker = line[0]
  if (marker === '?' || marker === '!') {
    const kind: GitFileStatusKind = marker === '?' ? 'untracked' : 'ignored'
    return [withoutTrailingSlash(unquoteGitPath(line.slice(2))), kind]
  }
  if (marker !== '1' && marker !== '2' && marker !== 'u') {
    return null
  }
  // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
  // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
  // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><TAB><origPath>
  const cut = cutFields(line, PATH_FIELD_COUNT[marker])
  if (cut === null || cut.rest.length === 0) {
    return null
  }
  if (marker === 'u') {
    return [unquoteGitPath(cut.rest), 'conflict']
  }
  // A rename keys its new path (the part before the TAB).
  const path = unquoteGitPath(cut.rest.split(TAB)[0] ?? '')
  return [path, statusKindForXy(cut.fields[1] ?? '')]
}

/**
 * Parses `git status --porcelain=v2 --ignored=traditional` into the per-path
 * map behind the file-tree decoration (spec Behaviour 16-19): ordinary (1),
 * renamed (2), unmerged (u), untracked (?) and ignored (!) entries. Deleted,
 * renamed and type-changed entries read as `modified`; an untracked or
 * ignored directory key loses its trailing slash and covers its subtree.
 * Unusable output yields the empty map.
 */
export function parseGitFileStatuses(output: string): GitFileStatuses {
  const statuses: Record<string, GitFileStatusKind> = {}
  for (const raw of output.split(LF)) {
    const line = raw.endsWith(CR) ? raw.slice(0, -1) : raw
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const entry = parseFileStatusLine(line)
    if (entry !== null && entry[0].length > 0) {
      statuses[entry[0]] = entry[1]
    }
  }
  return statuses
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

  /**
   * Per-path working-tree status for the file-tree decoration (spec
   * Behaviour 16-19). One read-only
   * `git status --porcelain=v2 --ignored=traditional`; `--ignored=traditional`
   * keeps ignored directories collapsed, so a large repository still returns
   * a bounded map. Any failure degrades to the empty map: the tree renders
   * undecorated instead of failing.
   */
  async getFileStatuses(projectPath: string): Promise<GitFileStatuses> {
    try {
      const result = await this.#run(FILE_STATUS_ARGS, projectPath)
      if (result.exitCode !== 0) {
        return {}
      }
      return parseGitFileStatuses(result.stdout)
    } catch {
      return {}
    }
  }
}

function execFileRunner(args: string[], cwd: string): Promise<GitStatusRunResult> {
  return new Promise((resolve) => {
    const location = parseWslPath(cwd)
    const file = location === null ? 'git' : 'wsl.exe'
    const commandArgs =
      location === null
        ? args
        : [
            '--distribution',
            location.distribution,
            '--cd',
            location.linuxPath,
            '--exec',
            'git',
            ...args,
          ]
    execFile(
      file,
      commandArgs,
      { cwd: location === null ? cwd : process.cwd(), timeout: 5000, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode =
          error !== null && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error !== null
              ? 1
              : 0
        resolve({ stdout, stderr, exitCode })
      },
    )
  })
}
