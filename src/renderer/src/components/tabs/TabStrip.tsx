import type React from 'react'
import { cn } from '../../lib/cn'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { type TabId, TERMINAL_TAB } from './tabs-session'

// Tab strip at the top of the center column (center-layout-tabs-actions spec
// Behaviour 1–3, 8): the terminal-chat tab first (never closable, label = the
// active chat's shell display name), then one tab per open file in open order
// (label = file name, tooltip = the path relative to the project root), and
// the `+ New chat` control at the right end (the existing new-chat flow).

interface TabStripProps {
  /** Active chat's shell display name; null shows the neutral "Chat" label. */
  chatName: string | null
  /** Open file tabs of the active project, in open order. */
  openFiles: readonly string[]
  active: TabId
  onSelectTab: (tab: TabId) => void
  onCloseFile: (relativePath: string) => void
  onNewChat: () => void
}

/** File name = the last path segment (spec Behaviour 3). */
export function fileName(relativePath: string): string {
  const segments = relativePath.split('/')
  return segments[segments.length - 1]
}

/** Tooltip = the path relative to the project root (spec Behaviour 7 form). */
export function fileTooltip(relativePath: string): string {
  return relativePath.split('/').join(' / ')
}

export function TabStrip({
  chatName,
  openFiles,
  active,
  onSelectTab,
  onCloseFile,
  onNewChat,
}: TabStripProps): React.JSX.Element {
  return (
    <nav
      className="flex h-9 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-900/60"
      data-testid={TEST_ID.tabStrip}
    >
      <button
        type="button"
        className={cn(
          'flex max-w-48 items-center gap-1 border-r border-neutral-800 px-3 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
          active.kind === 'terminal' && 'bg-neutral-800/70 text-neutral-100',
        )}
        data-testid={TEST_ID.tabTerminal}
        data-selected={active.kind === 'terminal' ? 'true' : 'false'}
        onClick={() => onSelectTab(TERMINAL_TAB)}
      >
        <span className="truncate">{chatName ?? 'Chat'}</span>
      </button>
      {openFiles.map((path) => {
        const isActive = active.kind === 'file' && active.path === path
        return (
          <div
            key={path}
            className={cn(
              'group flex shrink-0 items-stretch border-r border-neutral-800',
              isActive && 'bg-neutral-800/70',
            )}
            data-testid={testIdFor.tabFile(path)}
            data-selected={isActive ? 'true' : 'false'}
            title={fileTooltip(path)}
          >
            <button
              type="button"
              className={cn(
                'flex max-w-48 items-center px-3 text-xs text-neutral-400 hover:text-neutral-100',
                isActive && 'text-neutral-100',
              )}
              onClick={() => onSelectTab({ kind: 'file', path })}
            >
              <span className="truncate">{fileName(path)}</span>
            </button>
            <button
              type="button"
              className="px-2 text-xs text-neutral-500 hover:text-neutral-100"
              data-testid={testIdFor.tabFileClose(path)}
              aria-label={`Close ${fileName(path)}`}
              onClick={() => onCloseFile(path)}
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="flex-1" />
      <button
        type="button"
        className="flex shrink-0 items-center px-3 text-xs text-neutral-400 hover:text-neutral-100"
        data-testid={TEST_ID.tabNewChat}
        onClick={onNewChat}
      >
        + New chat
      </button>
    </nav>
  )
}
