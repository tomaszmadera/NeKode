import type React from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
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
      className="drag-region flex h-9 shrink-0 items-stretch bg-app px-1 pt-1"
      // Keep `+ New chat` clear of the native caption buttons: the Windows
      // window-controls overlay reserves the top-right corner (design doc
      // 26.2). Without the overlay env() falls back to 100vw, i.e. no inset.
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw))' }}
      data-testid={TEST_ID.tabStrip}
    >
      <button
        type="button"
        className={cn(
          'no-drag flex max-w-48 items-center gap-1 rounded-t-md px-3 text-xs text-ink-secondary hover:text-ink',
          active.kind === 'terminal'
            ? 'bg-button text-ink'
            : 'border border-edge bg-tab-inactive hover:bg-highlight',
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
              'no-drag group flex shrink-0 items-stretch rounded-t-md',
              isActive ? 'bg-button' : 'border border-edge bg-tab-inactive hover:bg-highlight',
            )}
            data-testid={testIdFor.tabFile(path)}
            data-selected={isActive ? 'true' : 'false'}
            title={fileTooltip(path)}
          >
            <button
              type="button"
              className={cn(
                'flex max-w-48 items-center px-3 text-xs text-ink-secondary hover:text-ink',
                isActive && 'text-ink',
              )}
              onClick={() => onSelectTab({ kind: 'file', path })}
            >
              <span className="truncate">{fileName(path)}</span>
            </button>
            <button
              type="button"
              className="flex items-center px-2 text-ink-muted hover:text-ink"
              data-testid={testIdFor.tabFileClose(path)}
              aria-label={`Close ${fileName(path)}`}
              onClick={() => onCloseFile(path)}
            >
              <Icon.close size={12} aria-hidden />
            </button>
          </div>
        )
      })}
      <div className="flex-1" />
      <button
        type="button"
        className="no-drag flex shrink-0 items-center gap-1.5 rounded-t-md px-3 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
        data-testid={TEST_ID.tabNewChat}
        onClick={onNewChat}
      >
        <Icon.plus size={14} aria-hidden />
        New chat
      </button>
    </nav>
  )
}
