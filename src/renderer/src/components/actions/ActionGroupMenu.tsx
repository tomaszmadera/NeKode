import type { ActionControl, ActionExecution } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { clampMenuPosition } from '../../lib/menu-position'
import { testIdFor } from '../../lib/test-ids'
import { ActionGlyph } from './ActionGlyph'

interface Props {
  /** Group name: the menu title and the trigger label it was opened from. */
  name: string
  x: number
  y: number
  actions: ActionControl[]
  statusOf: (id: string) => ActionExecution['status']
  /** A member the host cannot run now (for example, no live active terminal). */
  disabledOf?: (action: ActionControl) => boolean
  /** Runs one member. The caller closes the menu before executing. */
  onSelect: (action: ActionControl) => void
  /** Copy-command menu for one member, at the pointer or keyboard anchor. */
  onCopy: (action: ActionControl, x: number, y: number) => void
  onClose: () => void
}

/**
 * Menu of one action group in the action row (action-groups spec Behaviour 7-10).
 * Members keep their own run state, confirmation, and copy-command menu. Closes
 * on Escape, backdrop click, item selection, and a right click outside; the menu
 * is capped to the viewport height and scrolls.
 */
export function ActionGroupMenu({
  name,
  x,
  y,
  actions,
  statusOf,
  disabledOf,
  onSelect,
  onCopy,
  onClose,
}: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 220, menuHeight: 34 * actions.length + 12 })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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

  return createPortal(
    <div
      role="menu"
      aria-label={`${name} actions`}
      className="no-drag fixed inset-0 z-40"
      data-testid={testIdFor.actionGroupMenu(name)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="absolute max-h-[60vh] min-w-40 overflow-y-auto rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: position.left, top: position.top }}
      >
        {actions.map((action) => {
          const status = statusOf(action.id)
          const isRunning = status === 'running'
          const isDisabled = isRunning || (disabledOf?.(action) ?? false)
          return (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={isDisabled}
              title={action.command}
              data-status={status}
              data-testid={testIdFor.actionButton(action.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-nowrap',
                status === 'failed'
                  ? 'text-error'
                  : 'text-ink-secondary enabled:hover:bg-highlight enabled:hover:text-ink',
                isRunning && 'text-info',
              )}
              onClick={() => onSelect(action)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onCopy(action, event.clientX, event.clientY)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  onCopy(action, rect.left, rect.bottom)
                }
              }}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                <ActionGlyph action={action} status={status} size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{action.title}</span>
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
