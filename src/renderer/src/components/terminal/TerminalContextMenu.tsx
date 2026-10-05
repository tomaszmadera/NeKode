import type React from 'react'
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
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: x, top: y }}
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
