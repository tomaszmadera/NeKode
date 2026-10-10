import type React from 'react'
import { useMemo } from 'react'
import type { FileEntry, GitFileStatuses } from '../../../../shared/ipc-contract'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
  buildStatusIndex,
  decorationFor,
  type GitDecoration,
  type TreeStatusIndex,
} from './git-decoration'

// Lazy file tree (spec Behaviour 5–6): directories first, then files, in
// case-insensitive alphabetical order (main pre-sorts and pre-filters the
// listings). Expanding a folder reveals its already-loaded children — the
// directory read happens once per expansion and is cached for the session.
// Each entry also carries its Git status as a text color plus a letter badge
// (spec Behaviour 16-18, NEKODE-31), aggregated up to folders whether or not
// they are expanded.

interface FileTreeProps {
  /** Loaded children by directory relative path ('' = project root). */
  childrenByPath: Record<string, FileEntry[]>
  expandedPaths: ReadonlySet<string>
  selectedPath: string | null
  /** Per-path Git status decoration; empty means no decoration at all. */
  statuses: GitFileStatuses
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
}

interface FileTreeLevelProps {
  childrenByPath: Record<string, FileEntry[]>
  expandedPaths: ReadonlySet<string>
  selectedPath: string | null
  /** Status lookups, precomputed once for the whole tree. */
  statusIndex: TreeStatusIndex
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
}

export function FileTree({
  childrenByPath,
  expandedPaths,
  selectedPath,
  statuses,
  onToggleDirectory,
  onSelectFile,
}: FileTreeProps): React.JSX.Element {
  // One index per status map: the folder aggregates are precomputed, so a
  // deep or widely expanded tree stays linear to render.
  const statusIndex = useMemo(() => buildStatusIndex(statuses), [statuses])
  return (
    <FileTreeLevel
      parentPath=""
      depth={0}
      childrenByPath={childrenByPath}
      expandedPaths={expandedPaths}
      selectedPath={selectedPath}
      statusIndex={statusIndex}
      onToggleDirectory={onToggleDirectory}
      onSelectFile={onSelectFile}
    />
  )
}

/**
 * The letter badge beside an entry name. It carries the status without color
 * (design system §25) and the screen-reader word puts the status into the
 * entry's accessible name.
 */
function GitStatusBadge({
  decoration,
}: {
  decoration: GitDecoration | null
}): React.JSX.Element | null {
  if (decoration === null) {
    return null
  }
  return (
    <>
      <span
        aria-hidden="true"
        data-testid={TEST_ID.fileTreeGitBadge}
        className={cn(
          'ml-auto shrink-0 pl-1 font-mono text-[10px] leading-none',
          decoration.className,
        )}
      >
        {decoration.letter}
      </span>
      <span className="sr-only">{decoration.word}</span>
    </>
  )
}

function FileTreeLevel({
  parentPath,
  depth,
  childrenByPath,
  expandedPaths,
  selectedPath,
  statusIndex,
  onToggleDirectory,
  onSelectFile,
}: FileTreeLevelProps & { parentPath: string; depth: number }): React.JSX.Element {
  const entries = childrenByPath[parentPath] ?? []
  return (
    <ul>
      {entries.map((entry) => {
        const isSelected = entry.relativePath === selectedPath
        if (entry.kind === 'directory') {
          const isExpanded = expandedPaths.has(entry.relativePath)
          const decoration = decorationFor(statusIndex.directory(entry.relativePath))
          return (
            <li key={entry.relativePath}>
              <button
                type="button"
                className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-sm text-ink-secondary hover:bg-highlight hover:text-ink"
                style={{ paddingLeft: 4 + depth * 12 }}
                data-testid={testIdFor.fileEntry(entry.relativePath)}
                data-kind="directory"
                data-git-status={decoration?.word}
                aria-expanded={isExpanded}
                onClick={() => onToggleDirectory(entry.relativePath)}
              >
                <span aria-hidden="true" className="flex shrink-0 text-ink-muted">
                  {isExpanded ? <Icon.chevronDown size={12} /> : <Icon.chevronRight size={12} />}
                </span>
                <span className={cn('min-w-0 truncate', decoration?.className)}>{entry.name}</span>
                <GitStatusBadge decoration={decoration} />
              </button>
              {isExpanded ? (
                <FileTreeLevel
                  parentPath={entry.relativePath}
                  depth={depth + 1}
                  childrenByPath={childrenByPath}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  statusIndex={statusIndex}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                />
              ) : null}
            </li>
          )
        }
        const decoration = decorationFor(statusIndex.file(entry.relativePath))
        return (
          <li key={entry.relativePath}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-sm text-ink-secondary hover:bg-highlight hover:text-ink',
                isSelected && 'bg-highlight text-ink',
              )}
              style={{ paddingLeft: 18 + depth * 12 }}
              data-testid={testIdFor.fileEntry(entry.relativePath)}
              data-kind="file"
              data-selected={isSelected ? 'true' : 'false'}
              data-git-status={decoration?.word}
              onClick={() => onSelectFile(entry.relativePath)}
            >
              <span className={cn('min-w-0 truncate', decoration?.className)}>{entry.name}</span>
              <GitStatusBadge decoration={decoration} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
