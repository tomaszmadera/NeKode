import type React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { type TabId, TERMINAL_TAB } from './tabs-session'

// Tab strip at the top of the center column (center-layout-tabs-actions spec
// Behaviour 1–3, 8): the terminal-chat tab first (never closable, label = the
// active chat's shell display name), then one tab per open file in open order
// (label = file name, tooltip = the path relative to the project root), and
// the `+ New chat` control at the right end (the existing new-chat flow).
// File tabs close on middle click and carry a context menu (right click /
// ContextMenu key / Shift+F10) copying the file's relative and absolute path.

interface TabStripProps {
  /** Active chat's shell display name; null shows the neutral "Chat" label. */
  chatName: string | null
  /** Open file tabs of the active project, in open order. */
  openFiles: readonly string[]
  /** Absolute path of the tab-strip project's root; null shows no absolute-path item. */
  projectRoot: string | null
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

/** Absolute OS path of an open file: project root + '/' + relative path. */
export function absoluteFilePath(projectRoot: string, relativePath: string): string {
  return `${projectRoot.replace(/\/+$/, '')}/${relativePath}`
}

/** State of one file tab's context menu (viewport coordinates of the trigger). */
interface TabContextMenuState {
  relativePath: string
  x: number
  y: number
}

export function TabStrip({
  chatName,
  openFiles,
  projectRoot,
  active,
  onSelectTab,
  onCloseFile,
  onNewChat,
}: TabStripProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)

  // Escape closes the context menu (the overlay handles pointer dismissal) —
  // the same window-level listener pattern as the project context menu.
  useEffect(() => {
    if (contextMenu === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  function openContextMenu(relativePath: string, x: number, y: number): void {
    setContextMenu({ relativePath, x, y })
  }

  return (
    <nav
      className="drag-region flex h-[calc(var(--spacing-control)+0.5rem)] shrink-0 items-stretch bg-app px-2 pt-2"
      // The strip shares the action row's metrics (round 4, design doc 26.2):
      // 8px left and top insets so the first tab aligns with the first button
      // below; the extra strip height keeps the shared control height. The
      // Windows caption buttons sit in the window title bar above this strip
      // (user decision 2026-10-01), in the floating theme too, so no
      // caption-button inset is needed here.
      data-testid={TEST_ID.tabStrip}
    >
      <button
        type="button"
        className={cn(
          'no-drag flex max-w-48 items-center gap-1 rounded-t-md px-3 text-sm text-ink-secondary hover:text-ink',
          active.kind === 'terminal'
            ? 'bg-button text-ink'
            : 'border border-edge bg-tab-inactive hover:bg-highlight',
        )}
        data-testid={TEST_ID.tabTerminal}
        data-selected={active.kind === 'terminal' ? 'true' : 'false'}
        onClick={() => onSelectTab(TERMINAL_TAB)}
      >
        {/* Same chat mark as the chat rows in the left navigation, so the
            terminal-chat tab reads as the chat surface (user request
            2026-10-01). */}
        <Icon.chat size={12} aria-hidden className="shrink-0" />
        <span className="truncate">{chatName ?? 'Chat'}</span>
      </button>
      {openFiles.map((path) => {
        const isActive = active.kind === 'file' && active.path === path
        return (
          /* biome-ignore lint/a11y/noStaticElementInteractions: the tab hosts
              the context-menu gesture (right click / ContextMenu key /
              Shift+F10 — spec Behaviour 20); the menu items are real buttons
              and the menu closes on Escape. */
          <div
            key={path}
            className={cn(
              'no-drag group flex shrink-0 items-stretch rounded-t-md',
              isActive ? 'bg-button' : 'border border-edge bg-tab-inactive hover:bg-highlight',
            )}
            data-testid={testIdFor.tabFile(path)}
            data-selected={isActive ? 'true' : 'false'}
            title={fileTooltip(path)}
            onContextMenu={(event) => {
              event.preventDefault()
              openContextMenu(path, event.clientX, event.clientY)
            }}
            onKeyDown={(event) => {
              // Keyboard context-menu invocation: the ContextMenu key or
              // Shift+F10 opens the menu (same gesture set as the project row).
              if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                openContextMenu(path, rect.left, rect.bottom)
              }
            }}
            onAuxClick={(event) => {
              // Middle click closes the file tab — the editor convention. The
              // close button's stopPropagation is irrelevant here (different
              // event); preventDefault suppresses the autoscroll pip some
              // platforms show on auxclick.
              if (event.button === 1) {
                event.preventDefault()
                onCloseFile(path)
              }
            }}
          >
            <button
              type="button"
              className={cn(
                'flex max-w-48 items-center px-3 text-sm text-ink-secondary hover:text-ink',
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
              onClick={(event) => {
                event.stopPropagation()
                onCloseFile(path)
              }}
              onAuxClick={(event) => {
                // The close control itself stays click-only: middle clicks
                // must not double-close through the container.
                event.stopPropagation()
              }}
            >
              <Icon.close size={12} aria-hidden />
            </button>
          </div>
        )
      })}
      <div className="flex-1" />
      <button
        type="button"
        // Not a tab: no hover background, only the label brightens (user
        // decision 2026-10-04). Keep the top radius for a possible fill.
        className="no-drag flex shrink-0 items-center gap-1.5 rounded-t-md px-3 text-sm text-ink-secondary hover:text-ink"
        data-testid={TEST_ID.tabNewChat}
        onClick={onNewChat}
      >
        <Icon.plus size={14} aria-hidden />
        New chat
      </button>
      {contextMenu !== null ? (
        <TabContextMenuOverlay
          state={contextMenu}
          projectRoot={projectRoot}
          onClose={() => setContextMenu(null)}
          onCloseFile={onCloseFile}
        />
      ) : null}
    </nav>
  )
}

/**
 * Context menu of a file tab (user request 2026-10-01): Copy Relative Path
 * and Copy Absolute Path, plus Close Tab. Same backdrop-dismiss pattern as
 * the project context menu (LeftNavigation): a full-viewport fixed overlay
 * closes on backdrop click, Escape or a second right-click; menu-item clicks
 * run their own action and close through it.
 */
function TabContextMenuOverlay({
  state,
  projectRoot,
  onClose,
  onCloseFile,
}: {
  state: TabContextMenuState
  projectRoot: string | null
  onClose: () => void
  onCloseFile: (relativePath: string) => void
}): React.JSX.Element {
  const copyLabel = fileName(state.relativePath)
  const absolutePath =
    projectRoot === null ? null : absoluteFilePath(projectRoot, state.relativePath)
  return (
    <div
      role="menu"
      aria-label={`File ${copyLabel}`}
      className="fixed inset-0 z-40"
      onClick={(event) => {
        // Only the backdrop dismisses: menu-item clicks run their own action.
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: state.x, top: state.y }}
        data-testid={TEST_ID.tabContextMenu}
      >
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.tabContextCopyRelative}
          onClick={() => {
            void navigator.clipboard.writeText(state.relativePath).catch(() => {})
            onClose()
          }}
        >
          Copy Relative Path
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={absolutePath === null}
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent"
          data-testid={TEST_ID.tabContextCopyAbsolute}
          onClick={() => {
            if (absolutePath !== null) {
              void navigator.clipboard.writeText(absolutePath).catch(() => {})
            }
            onClose()
          }}
        >
          Copy Absolute Path
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          onClick={() => {
            onClose()
            onCloseFile(state.relativePath)
          }}
        >
          Close Tab
        </button>
      </div>
    </div>
  )
}
