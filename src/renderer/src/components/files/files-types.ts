import type { FileEntry, GitFileStatuses } from '../../../../shared/ipc-contract'

// Per-project file-tree session state (spec Behaviour 14): expansion state
// and the last selected file live for the app session only — never in the
// database. Held by App; components stay presentational.

export interface ProjectFilesSession {
  /** Loaded directory children by relative path ('' = project root). */
  childrenByPath: Record<string, FileEntry[]>
  expandedPaths: ReadonlySet<string>
  selectedPath: string | null
  /**
   * Per-path Git status for the tree decoration (NEKODE-31, spec Behaviour
   * 19): read once when the mode is entered, empty before that read and after
   * a failed one.
   */
  gitStatuses: GitFileStatuses
  /** Inline error shown in the tree area (spec Errors: localized failure). */
  treeError: string | null
}

export function emptyProjectFilesSession(): ProjectFilesSession {
  return {
    childrenByPath: {},
    expandedPaths: new Set(),
    selectedPath: null,
    gitStatuses: {},
    treeError: null,
  }
}
