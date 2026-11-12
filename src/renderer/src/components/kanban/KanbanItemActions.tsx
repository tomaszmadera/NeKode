import type { WorkItem } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from '../../lib/icons'
import { clampMenuPosition } from '../../lib/menu-position'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Launch controls shared by the list rows (KanbanListView) and the item review
// (KanbanItemReview): Start, Resume, the Start menu (NEKODE-99), and the Resume
// split control with its menu (user decision 2026-11-12). Neither control opens
// the review or launches from the board; each asks the host.

const ITEM_CONTROL_CLASS =
  'w-fit rounded-md px-1.5 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Hover underline is the click affordance. Resting text stays plain. */
export const ACTION_HOVER_CLASS = 'hover:underline underline-offset-2'

export const COPY_FAILED = 'Could not copy to the clipboard.'

export const MENU_ITEM_CLASS =
  'w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent'

/** Select, input, and textarea style shared by the review fields and the New task form. */
export const KANBAN_FIELD_CLASS =
  'w-full rounded-md border border-edge bg-app px-3 text-[12.6px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Renderer clipboard (typed locally so tests can stub navigator.clipboard). */
export function navigatorClipboard(): { writeText(text: string): Promise<void> } | null {
  return typeof navigator !== 'undefined' && navigator.clipboard !== null
    ? navigator.clipboard
    : null
}

/** Opens a menu at (x, y) for an item: a context menu or the keyboard menu key. */
export type OpenItemMenu = (item: WorkItem, x: number, y: number) => void

/** Opens the Resume menu and keeps the trigger for Escape focus return. */
export type OpenResumeMenu = (item: WorkItem, x: number, y: number, anchor: HTMLElement) => void

/** Row appearance: bordered 26px controls, Start revealed by the row hover. */
const ROW_CONTROL_BASE =
  'h-[26px] shrink-0 border border-edge bg-button text-[12px] font-medium text-ink hover:bg-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
const ROW_CONTROL_CLASS = `${ROW_CONTROL_BASE} rounded-[6px] px-2.5`
const ROW_RESUME_MAIN_CLASS = `${ROW_CONTROL_BASE} rounded-l-[6px] border-r-0 px-2.5`
const ROW_RESUME_TRIGGER_CLASS = `${ROW_CONTROL_BASE} rounded-r-[6px] px-1.5`

const ROW_START_REVEAL_CLASS =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-50 [@media(hover:none)]:opacity-100'

/** Start stays visible and is disabled while a confirmed handoff shows Resume.
 * Hover underlines Start only while it is enabled, and Resume while it is shown.
 * The `row` appearance is the grouped list: Start is hidden until the row is
 * hovered or focused, while a shown Resume stays visible.
 */
export function ItemLaunchButtons({
  item,
  resumeEnabled,
  onStart,
  onResume,
  onOpenStartMenu,
  onOpenResumeMenu,
  resumeMenuOpen = false,
  appearance = 'default',
}: {
  item: WorkItem
  resumeEnabled: boolean
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: OpenItemMenu
  /** Present only when the host supports Resume without sending. */
  onOpenResumeMenu?: OpenResumeMenu
  /** True while this item's Resume menu is open. */
  resumeMenuOpen?: boolean
  appearance?: 'default' | 'row'
}): React.JSX.Element {
  const isRow = appearance === 'row'
  const resumeMainClass = isRow
    ? onOpenResumeMenu === undefined
      ? ROW_CONTROL_CLASS
      : ROW_RESUME_MAIN_CLASS
    : `${ITEM_CONTROL_CLASS} text-ink ${ACTION_HOVER_CLASS}`
  const resumeTriggerClass = isRow
    ? ROW_RESUME_TRIGGER_CLASS
    : `${ITEM_CONTROL_CLASS} text-ink-secondary hover:text-ink ${ACTION_HOVER_CLASS}`
  const openResumeMenu = (trigger: HTMLElement): void => {
    if (onOpenResumeMenu === undefined) return
    const rect = trigger.getBoundingClientRect()
    onOpenResumeMenu(item, rect.left, rect.bottom, trigger)
  }
  return (
    <div className={`flex shrink-0 gap-1${isRow ? ' justify-self-end' : ''}`}>
      <button
        type="button"
        className={
          isRow
            ? `${ROW_CONTROL_CLASS} ${ROW_START_REVEAL_CLASS}`
            : `${ITEM_CONTROL_CLASS} text-ink disabled:pointer-events-none disabled:opacity-50${resumeEnabled ? '' : ` ${ACTION_HOVER_CLASS}`}`
        }
        aria-label={isRow ? `Start ${item.ref}` : undefined}
        data-testid={testIdFor.kanbanItemStart(item.ref)}
        disabled={resumeEnabled}
        onClick={() => {
          onStart?.(item)
        }}
        onKeyDown={(event) => {
          if (resumeEnabled || onOpenStartMenu === undefined) return
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenStartMenu(item, rect.left, rect.bottom)
          }
        }}
        onContextMenu={(event) => {
          if (resumeEnabled || onOpenStartMenu === undefined) return
          event.preventDefault()
          onOpenStartMenu(item, event.clientX, event.clientY)
        }}
      >
        Start
      </button>
      {resumeEnabled ? (
        <div
          role="group"
          aria-label={`Resume ${item.ref}`}
          className={isRow ? 'flex shrink-0 items-stretch' : 'flex shrink-0 items-center'}
        >
          <button
            type="button"
            className={resumeMainClass}
            data-testid={testIdFor.kanbanItemResume(item.ref)}
            onClick={() => {
              onResume?.(item)
            }}
          >
            Resume
          </button>
          {onOpenResumeMenu !== undefined ? (
            <button
              type="button"
              aria-label={`Resume options for ${item.ref}`}
              aria-haspopup="menu"
              aria-expanded={resumeMenuOpen}
              className={resumeTriggerClass}
              data-testid={testIdFor.kanbanResumeOptions(item.ref)}
              onClick={(event) => {
                openResumeMenu(event.currentTarget)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return
                event.preventDefault()
                openResumeMenu(event.currentTarget)
              }}
            >
              <Icon.chevronDown size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Start button menu (NEKODE-99): Start, or Start without sending. */
export function StartMenu({
  item,
  x,
  y,
  onStart,
  onStartDraft,
  onClose,
}: {
  item: WorkItem
  x: number
  y: number
  onStart?: (item: WorkItem) => void
  onStartDraft: (item: WorkItem) => void
  onClose: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 200, menuHeight: 72 })

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      aria-label={`Start ${item.ref}`}
      className="fixed inset-0 z-40"
      data-testid={TEST_ID.kanbanStartMenu}
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
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: position.left, top: position.top }}
      >
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          data-testid={TEST_ID.kanbanStartMenuStart}
          onClick={() => {
            onClose()
            onStart?.(item)
          }}
        >
          Start
        </button>
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          data-testid={TEST_ID.kanbanStartMenuDraft}
          onClick={() => {
            onClose()
            onStartDraft(item)
          }}
        >
          Start without sending
        </button>
      </div>
    </div>
  )
}

/** Resume split-control menu: Resume, or Resume without sending (2026-11-12). */
export function ResumeMenu({
  item,
  x,
  y,
  anchor,
  onResume,
  onResumeDraft,
  onClose,
}: {
  item: WorkItem
  x: number
  y: number
  /** Trigger that opened the menu: Escape returns focus to it. */
  anchor: HTMLElement
  onResume?: (item: WorkItem) => void
  onResumeDraft: (item: WorkItem) => void
  onClose: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 200, menuHeight: 72 })

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      anchor.focus()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, onClose])

  const moveFocus = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    )
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = current < 0 ? 0 : (current + step + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      role="menu"
      aria-label={`Resume ${item.ref}`}
      className="fixed inset-0 z-40"
      data-testid={TEST_ID.kanbanResumeMenu}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={moveFocus}
    >
      <div
        ref={menuRef}
        className="absolute min-w-48 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: position.left, top: position.top }}
      >
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          data-testid={TEST_ID.kanbanResumeMenuResume}
          onClick={() => {
            onClose()
            onResume?.(item)
          }}
        >
          Resume
        </button>
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          data-testid={TEST_ID.kanbanResumeMenuDraft}
          onClick={() => {
            onClose()
            onResumeDraft(item)
          }}
        >
          Resume without sending
        </button>
      </div>
    </div>
  )
}
