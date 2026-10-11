import type { FileEntry, GitFileStatuses } from '../../../../shared/ipc-contract'
import type { ProjectFilesSession } from './files-types'

// Applies one manual Refresh (spec Behaviour 25) to the cached tree.
// The caller has already read the root and the directories that were
// expanded when the refresh started. Listings for directories that are
// collapsed at apply time are dropped, so the next expansion reads them.

export type DirectoryRefreshResult =
  | { relativePath: string; ok: true; entries: FileEntry[] }
  | { relativePath: string; ok: false; message: string }

export interface TreeRefreshOutcome {
  session: ProjectFilesSession
  /** Set when the root succeeded and an expanded directory did not. */
  notice: string | null
}

function parentRelativePath(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

function directoryDepth(relativePath: string): number {
  return relativePath === '' ? 0 : relativePath.split('/').length
}

function listsDirectory(entries: readonly FileEntry[], relativePath: string): boolean {
  return entries.some((entry) => entry.kind === 'directory' && entry.relativePath === relativePath)
}

export function applyDirectoryRefresh(
  session: ProjectFilesSession,
  results: readonly DirectoryRefreshResult[],
  gitStatuses: GitFileStatuses | null,
): TreeRefreshOutcome {
  const root = results.find((result) => result.relativePath === '')
  const next: ProjectFilesSession = {
    ...session,
    gitStatuses: gitStatuses ?? session.gitStatuses,
    refreshing: false,
  }

  if (root === undefined || !root.ok) {
    return {
      session: {
        ...next,
        treeError: root !== undefined && !root.ok ? root.message : 'Failed to load project files.',
      },
      notice: null,
    }
  }

  const loaded = new Map<string, FileEntry[]>()
  const failed = new Map<string, string>()
  for (const result of results) {
    if (result.ok) {
      loaded.set(result.relativePath, result.entries)
    } else {
      failed.set(result.relativePath, result.message)
    }
  }

  const childrenByPath: Record<string, FileEntry[]> = { '': root.entries }
  const expandedPaths = new Set<string>()
  const candidates = [...session.expandedPaths].sort(
    (left, right) => directoryDepth(left) - directoryDepth(right) || (left < right ? -1 : 1),
  )

  for (const path of candidates) {
    const parent = parentRelativePath(path)
    if (parent !== '' && !expandedPaths.has(parent)) {
      continue
    }
    const parentEntries = childrenByPath[parent]
    if (parentEntries === undefined || !listsDirectory(parentEntries, path)) {
      continue
    }
    if (failed.has(path)) {
      continue
    }
    const fresh = loaded.get(path)
    if (fresh !== undefined) {
      childrenByPath[path] = fresh
    } else {
      const cached = session.childrenByPath[path]
      if (cached !== undefined) {
        childrenByPath[path] = cached
      }
    }
    expandedPaths.add(path)
  }

  const firstFailure = candidates.find((path) => failed.has(path))
  return {
    session: {
      ...next,
      childrenByPath,
      expandedPaths,
      treeError: null,
    },
    notice: firstFailure === undefined ? null : (failed.get(firstFailure) ?? null),
  }
}
