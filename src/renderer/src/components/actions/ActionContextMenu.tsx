import type React from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { clampMenuPosition } from '../../lib/menu-position'
import { TEST_ID } from '../../lib/test-ids'

interface Props {
  x: number
  y: number
  command: string
  onClose: () => void
}

/**
 * Context menu for custom action buttons in the ActionBar.
 * Provides an option to copy the full configured command to the clipboard.
 * Closes on backdrop click, Escape key, or right-click outside.
 */
export function ActionContextMenu({ x, y, command, onClose }: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 180, menuHeight: 50 })

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

  const copyCommand = (): void => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(command).catch(() => {})
    }
    onClose()
  }

  return (
    <div
      role="menu"
      aria-label="Action"
      className="fixed inset-0 z-40"
      onClick={(event) => {
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
        data-testid={TEST_ID.actionContextMenu}
      >
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.actionContextCopyCommand}
          onClick={copyCommand}
        >
          Copy command
        </button>
      </div>
    </div>
  )
}
