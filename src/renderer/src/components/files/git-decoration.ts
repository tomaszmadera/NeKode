import type { GitFileStatuses, GitFileStatusKind } from '../../../../shared/ipc-contract'

// Pure decoration logic for the file tree (spec project-files-view Behaviour
// 16-19): which status a tree entry shows and how it is drawn. Kept free of
// React so the precedence, the directory aggregation and the path matching
// are unit-testable on their own.

/** Strongest first: a folder shows the most severe status below it. */
const PRECEDENCE: readonly GitFileStatusKind[] = [
  'conflict',
  'modified',
  'added',
  'untracked',
  'ignored',
]

export interface GitDecoration {
  /** Non-color cue (design system §25: never status by color alone). */
  letter: string
  /** Status word for the entry's accessible name. */
  word: string
  /** Theme text class (existing semantic tokens; no new token). */
  className: string
}

const DECORATION: Readonly<Record<GitFileStatusKind, GitDecoration>> = {
  conflict: { letter: 'C', word: 'conflicted', className: 'text-error' },
  modified: { letter: 'M', word: 'modified', className: 'text-warning' },
  added: { letter: 'A', word: 'added', className: 'text-success' },
  untracked: { letter: 'U', word: 'untracked', className: 'text-success' },
  ignored: { letter: 'I', word: 'ignored', className: 'text-ink-disabled' },
}

/** Narrows an untrusted wire value; an unknown kind stays undecorated. */
function knownKind(kind: unknown): GitFileStatusKind | null {
  return PRECEDENCE.includes(kind as GitFileStatusKind) ? (kind as GitFileStatusKind) : null
}

/** The stronger of two statuses (null loses to any status). */
function worstKind(
  left: GitFileStatusKind | null,
  right: GitFileStatusKind | null,
): GitFileStatusKind | null {
  if (left === null) {
    return right
  }
  if (right === null) {
    return left
  }
  return PRECEDENCE.indexOf(left) <= PRECEDENCE.indexOf(right) ? left : right
}

export interface TreeStatusIndex {
  /**
   * Status of a file entry: its own status, or the nearest ancestor
   * directory key (an untracked or ignored directory covers its subtree).
   */
  file(relativePath: string): GitFileStatusKind | null
  /**
   * Status of a directory entry: the stronger of its own status and every
   * status below it, at any depth (Behaviour 17).
   */
  directory(relativePath: string): GitFileStatusKind | null
}

/**
 * Indexes one status map for tree lookups: the directory aggregates are
 * computed once, so rendering a deep tree stays linear.
 */
export function buildStatusIndex(statuses: GitFileStatuses): TreeStatusIndex {
  const directories: Record<string, GitFileStatusKind> = {}
  for (const [path, kind] of Object.entries(statuses)) {
    const known = knownKind(kind)
    if (known === null) {
      continue
    }
    const segments = path.split('/')
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join('/')
      directories[ancestor] = worstKind(directories[ancestor] ?? null, known) ?? known
    }
  }
  return {
    file(relativePath) {
      let best = knownKind(statuses[relativePath])
      const segments = relativePath.split('/')
      for (let depth = segments.length - 1; depth > 0; depth -= 1) {
        best = worstKind(best, knownKind(statuses[segments.slice(0, depth).join('/')]))
      }
      return best
    },
    directory(relativePath) {
      // Its own status, everything below it, and (like `file`) every
      // ancestor directory key: an untracked or ignored directory key covers
      // its whole subtree, nested folders included (Behaviour 18).
      let best = worstKind(knownKind(statuses[relativePath]), directories[relativePath] ?? null)
      const segments = relativePath.split('/')
      for (let depth = segments.length - 1; depth > 0; depth -= 1) {
        best = worstKind(best, knownKind(statuses[segments.slice(0, depth).join('/')]))
      }
      return best
    },
  }
}

/** The badge and text class for one status (null: no decoration at all). */
export function decorationFor(kind: GitFileStatusKind | null): GitDecoration | null {
  return kind === null ? null : (DECORATION[kind] ?? null)
}
