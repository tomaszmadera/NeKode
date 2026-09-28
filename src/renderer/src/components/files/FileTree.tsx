import type React from 'react'
import type { FileEntry } from '../../../../shared/ipc-contract'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { testIdFor } from '../../lib/test-ids'

// Lazy file tree (spec Behaviour 5–6): directories first, then files, in
// case-insensitive alphabetical order (main pre-sorts and pre-filters the
// listings). Expanding a folder reveals its already-loaded children — the
// directory read happens once per expansion and is cached for the session.

interface FileTreeProps {
  /** Loaded children by directory relative path ('' = project root). */
  childrenByPath: Record<string, FileEntry[]>
  expandedPaths: ReadonlySet<string>
  selectedPath: string | null
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
}

export function FileTree({
  childrenByPath,
  expandedPaths,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
}: FileTreeProps): React.JSX.Element {
  return (
    <FileTreeLevel
      parentPath=""
      depth={0}
      childrenByPath={childrenByPath}
      expandedPaths={expandedPaths}
      selectedPath={selectedPath}
      onToggleDirectory={onToggleDirectory}
      onSelectFile={onSelectFile}
    />
  )
}

function FileTreeLevel({
  parentPath,
  depth,
  childrenByPath,
  expandedPaths,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
}: FileTreeProps & { parentPath: string; depth: number }): React.JSX.Element {
  const entries = childrenByPath[parentPath] ?? []
  return (
    <ul>
      {entries.map((entry) => {
        const isSelected = entry.relativePath === selectedPath
        if (entry.kind === 'directory') {
          const isExpanded = expandedPaths.has(entry.relativePath)
          return (
            <li key={entry.relativePath}>
              <button
                type="button"
                className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                style={{ paddingLeft: 4 + depth * 12 }}
                data-testid={testIdFor.fileEntry(entry.relativePath)}
                data-kind="directory"
                aria-expanded={isExpanded}
                onClick={() => onToggleDirectory(entry.relativePath)}
              >
                <span aria-hidden="true" className="flex shrink-0 text-ink-muted">
                  {isExpanded ? <Icon.chevronDown size={12} /> : <Icon.chevronRight size={12} />}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
              {isExpanded ? (
                <FileTreeLevel
                  parentPath={entry.relativePath}
                  depth={depth + 1}
                  childrenByPath={childrenByPath}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                />
              ) : null}
            </li>
          )
        }
        return (
          <li key={entry.relativePath}>
            <button
              type="button"
              className={cn(
                'block w-full truncate rounded px-1 py-0.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink',
                isSelected && 'bg-highlight text-ink',
              )}
              style={{ paddingLeft: 18 + depth * 12 }}
              data-testid={testIdFor.fileEntry(entry.relativePath)}
              data-kind="file"
              data-selected={isSelected ? 'true' : 'false'}
              onClick={() => onSelectFile(entry.relativePath)}
            >
              {entry.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
