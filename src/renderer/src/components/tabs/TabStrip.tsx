import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { clampMenuPosition } from '../../lib/menu-position'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { KANBAN_TAB, type TabId, TERMINAL_TAB } from './tabs-session'

// Tab strip at the top of the center column (center-layout-tabs-actions spec
// Behaviour 1–3, 8): the project home tab first whenever the strip has a
// project, bound or not (non-closable, project-home spec Behaviour 1), then
// the terminal-chat tab (never closable, label = the active chat's shell
// display name), then one tab per open file in open order (label = file name,
// tooltip = the path relative to the project root), and the Project Settings
// control at the right end. File tabs close on
// middle click and carry a context menu (right click / ContextMenu key /
// Shift+F10) copying the file's relative and absolute path.

interface TabStripProps {
  /**
   * Floating theme: drops the attached bottom hairline border (user decision
   * 2026-10-08, 2026-10-13).
   */
  floating?: boolean
  /** Active chat's shell display name; null shows the neutral "Chat" label. */
  chatName: string | null
  /**
   * Tab-strip project's display name (already cased per the project-name
   * style setting). Non-null renders the home tab first in the strip, labeled
   * with the name shortened by truncateProjectName; null renders no home tab.
   */
  projectName: string | null
  /** Open file tabs of the active project, in open order. */
  openFiles: readonly string[]
  /** Absolute path of the tab-strip project's root; null shows no absolute-path item. */
  projectRoot: string | null
  active: TabId
  onSelectTab: (tab: TabId) => void
  onCloseFile: (relativePath: string) => void
  onSettings: () => void
}

/** Project names longer than this many characters are shortened. */
export const PROJECT_TAB_NAME_MAX = 10

/**
 * Home tab label: names of up to PROJECT_TAB_NAME_MAX characters stay
 * whole; longer names keep the first PROJECT_TAB_NAME_MAX - 1 characters plus
 * an ellipsis. Counts grapheme clusters, so emoji are never split.
 */
export function truncateProjectName(name: string, max: number = PROJECT_TAB_NAME_MAX): string {
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name),
    (part) => part.segment,
  )
  return graphemes.length <= max ? name : `${graphemes.slice(0, max - 1).join('')}…`
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
  floating = false,
  chatName,
  projectName,
  openFiles,
  projectRoot,
  active,
  onSelectTab,
  onCloseFile,
  onSettings,
}: TabStripProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)

  // Escape closes the context menu (the overlay handles pointer dismissal) -
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
      className={cn(
        'nk-tab-strip drag-region flex h-[calc(var(--spacing-control)+0.5rem)] shrink-0 items-stretch gap-1.5 px-2 pt-2',
        floating ? 'bg-app' : 'bg-app border-b border-edge',
      )}
      // The strip shares the action row's metrics (round 4, design doc 26.2):
      // 8px left and top insets so the first tab aligns with the first button
      // below, and a 6px `gap-1.5` between tabs (user request 2026-10-05) -
      // narrower than the action row's 8px group gap, so neighbouring tabs
      // read as one strip while staying distinct. The gap is structural
      // (theme-independent markup), so it holds in both themes. The extra
      // strip height keeps the shared control height. The
      // Windows caption buttons sit in the window title bar above this strip
      // (user decision 2026-10-01), in the floating theme too, so no
      // caption-button inset is needed here. Tabs draw only the top and side
      // edges (user decision 2026-10-06): the hairline under this row runs
      // under inactive tabs and empty space, while the active tab connects
      // seamlessly to the panel below with no bottom line (user request 2026-10-13).
      data-testid={TEST_ID.tabStrip}
    >
      {projectName !== null ? (
        /* Project home tab (spec project-home Behaviour 1-2): non-closable
           (no close control), first tab in the strip for every project, bound
           or not. Icon plus the project name (shortened; full name in the
           tooltip and the accessible name). Selecting it shows the task list
           when a source is bound, otherwise the setup welcome. */
        <button
          type="button"
          className={cn(
            'nk-tab-kanban no-drag flex shrink-0 items-center gap-1.5 rounded-t-md border-x border-t border-edge px-3 text-sm transition-colors duration-fast ease-standard',
            active.kind === 'kanban' ? 'nk-tab-active' : 'nk-tab-inactive',
          )}
          data-testid={TEST_ID.kanbanTab}
          data-selected={active.kind === 'kanban' ? 'true' : 'false'}
          onClick={() => onSelectTab(KANBAN_TAB)}
          title={`Tasks: ${projectName}`}
          aria-label={`Tasks: ${projectName}`}
        >
          <Icon.kanban size={14} aria-hidden className="shrink-0" />
          <span className="whitespace-nowrap">{truncateProjectName(projectName)}</span>
        </button>
      ) : null}
      <button
        type="button"
        className={cn(
          'nk-tab-terminal no-drag flex max-w-48 items-center gap-1 rounded-t-md border-x border-t border-edge px-3 text-sm transition-colors duration-fast ease-standard',
          active.kind === 'terminal' ? 'nk-tab-active' : 'nk-tab-inactive',
        )}
        data-testid={TEST_ID.tabTerminal}
        data-selected={active.kind === 'terminal' ? 'true' : 'false'}
        onClick={() => onSelectTab(TERMINAL_TAB)}
      >
        {/* Same chat mark as the chat rows in the left navigation, so the
            terminal-chat tab reads as the chat surface (user request
            2026-10-01). Themes that use the neon terminal icon (such as
            NeKode Float) show .session-icon instead. */}
        <Icon.chat size={12} aria-hidden className="shrink-0 tab-chat-icon" />
        <Icon.terminal size={14} aria-hidden className="session-icon neon-term shrink-0" />
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
              'no-drag flex shrink-0 items-stretch rounded-t-md border-x border-t border-edge transition-colors duration-fast ease-standard',
              isActive ? 'nk-tab-active' : 'nk-tab-inactive',
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
                'flex max-w-48 items-center px-3 text-sm transition-colors duration-fast ease-standard',
                isActive ? 'text-ink' : 'text-ink-secondary',
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
        className="nk-project-settings no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-t-md text-ink-secondary hover:text-ink transition-colors duration-fast ease-standard"
        aria-label="Project Settings"
        title="Project Settings"
        data-testid={TEST_ID.tabProjectSettings}
        onClick={onSettings}
      >
        <Icon.settings size={16} aria-hidden />
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
 *
 * The overlay is portaled to document.body and marked no-drag: the tab strip
 * is a window drag region (-webkit-app-region: drag), and in Electron a drag
 * region swallows mouse clicks, so a menu rendered inside the strip could not
 * be clicked (the same pattern as the usage panel in UsageToolbar).
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
  const menuRef = useRef<HTMLDivElement | null>(null)
  const position = clampMenuPosition(state.x, state.y, { menuWidth: 200, menuHeight: 120 })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const refined = clampMenuPosition(state.x, state.y, {
        menuWidth: rect.width,
        menuHeight: rect.height,
      })
      el.style.left = `${refined.left}px`
      el.style.top = `${refined.top}px`
    }
  }, [state.x, state.y])

  const copyLabel = fileName(state.relativePath)
  const absolutePath =
    projectRoot === null ? null : absoluteFilePath(projectRoot, state.relativePath)
  return createPortal(
    <div
      role="menu"
      aria-label={`File ${copyLabel}`}
      className="no-drag fixed inset-0 z-40"
      data-testid={TEST_ID.tabContextMenuOverlay}
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
        ref={menuRef}
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: position.left, top: position.top }}
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
    </div>,
    document.body,
  )
}
