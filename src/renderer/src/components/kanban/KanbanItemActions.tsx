import type { WorkItem } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect } from 'react'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Launch controls shared by the list rows (KanbanListView) and the item review
// (KanbanItemReview): Start, Resume, and the Start menu (NEKODE-99). Neither
// control opens the review or launches from the board; each asks the host.

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

/** Row appearance: bordered 26px controls, Start revealed by the row hover. */
const ROW_CONTROL_CLASS =
  'h-[26px] shrink-0 rounded-[6px] border border-edge bg-button px-2.5 text-[12px] font-medium text-ink hover:bg-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

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
  appearance = 'default',
}: {
  item: WorkItem
  resumeEnabled: boolean
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: OpenItemMenu
  appearance?: 'default' | 'row'
}): React.JSX.Element {
  const isRow = appearance === 'row'
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
        <button
          type="button"
          className={
            isRow ? ROW_CONTROL_CLASS : `${ITEM_CONTROL_CLASS} text-ink ${ACTION_HOVER_CLASS}`
          }
          data-testid={testIdFor.kanbanItemResume(item.ref)}
          onClick={() => {
            onResume?.(item)
          }}
        >
          Resume
        </button>
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
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: x, top: y }}
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
