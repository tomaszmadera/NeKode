import type React from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { clampMenuPosition } from '../../lib/menu-position'
import { TEST_ID } from '../../lib/test-ids'

interface Props {
  /** Viewport coordinates of the triggering right-click. */
  x: number
  y: number
  /** Copy is enabled only while the xterm view holds a selection. */
  hasSelection: boolean
  /** Raw Ctrl+V is safe only while a full-screen program owns the terminal. */
  canPasteThroughProgram: boolean
  onCopy: () => void
  onPaste: () => void
  onPasteThroughProgram: () => void
  onSelectAll: () => void
  onClose: () => void
}

/**
 * Right-click menu: Copy / Paste text / Paste through program / Select All. Same
 * backdrop-dismiss pattern as the project context menu (LeftNavigation):
 * a full-viewport fixed overlay closes on backdrop click, Escape or a second
 * right-click; menu-item clicks run their own action and close through it.
 */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  canPasteThroughProgram,
  onCopy,
  onPaste,
  onPasteThroughProgram,
  onSelectAll,
  onClose,
}: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 220, menuHeight: 150 })

  // Escape closes the menu and all keystrokes typed outside the menu are
  // swallowed in the capture phase so they do not leak into the PTY behind
  // the overlay (NEKODE-60 / review 5.2).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      const isInsideMenu =
        event.target instanceof Node && (menuRef.current?.contains(event.target) ?? false)
      if (!isInsideMenu) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  // Refine viewport clamping once the rendered menu dimensions are known.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const refined = clampMenuPosition(x, y, { menuWidth: rect.width, menuHeight: rect.height })
      el.style.left = `${refined.left}px`
      el.style.top = `${refined.top}px`
    }
  }, [x, y])

  return (
    <div
      role="menu"
      aria-label="Terminal"
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
        ref={menuRef}
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: position.left, top: position.top }}
        data-testid={TEST_ID.terminalContextMenu}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!hasSelection}
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent"
          data-testid={TEST_ID.terminalContextCopy}
          onClick={onCopy}
        >
          Copy
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.terminalContextPaste}
          onClick={onPaste}
        >
          Paste text (Ctrl+Shift+V)
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canPasteThroughProgram}
          title={canPasteThroughProgram ? undefined : 'Available in full-screen programs'}
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent"
          data-testid={TEST_ID.terminalContextPasteThroughProgram}
          onClick={onPasteThroughProgram}
        >
          Paste through program (Ctrl+V)
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.terminalContextSelectAll}
          onClick={onSelectAll}
        >
          Select All
        </button>
      </div>
    </div>
  )
}
