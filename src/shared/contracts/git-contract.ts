// Worktree/change counts behind the UX-UI §16 status forms and hover details.
export interface GitWorktreeStatus {
  modified: number
  added: number
  deleted: number
  untracked: number
  conflicts: number
  ahead: number
  behind: number
}

export function emptyGitWorktree(): GitWorktreeStatus {
  return { modified: 0, added: 0, deleted: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 }
}

export interface GitStatus {
  branch: string | null
  dirty: boolean
  worktree: GitWorktreeStatus
}

// Per-path Git status behind the file-tree decoration (spec
// project-files-view Behaviour 16-19). `modified` also covers a deletion, a
// rename and a type change; an untracked or ignored directory is keyed
// without its trailing slash and covers its whole subtree.
export type GitFileStatusKind = 'modified' | 'added' | 'untracked' | 'conflict' | 'ignored'

/** Project-root-relative path to decoration kind; empty when git is absent. */
export type GitFileStatuses = Readonly<Record<string, GitFileStatusKind>>
