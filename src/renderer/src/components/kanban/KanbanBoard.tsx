import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppApi,
  HandoffRejection,
  KanbanBoard as KanbanBoardData,
  KanbanComment,
  KanbanCreateInput,
  KanbanPriority,
  KanbanState,
  KanbanUpdatePatch,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Kanban surface (spec kanban-adapter-interface Behaviour 14, AC14).
// The only arrangement is a list: the items grouped under the state names, in
// adapter `order`. Each row shows the ref (Plane slug) and the title in
// separate columns, plus the priority. The title truncates in a fixed slug
// column. Nothing is underlined at rest. Hover underlines the slug, the
// title, enabled Start, and shown Resume. Each of those is only as wide as
// its text, and only those handle a click. The row highlights on hover.
// Opening the slug or the title replaces the list with a review. The review
// is two columns. The left is three quarters of the width and holds the ref,
// full title, and description. The right is one quarter and holds Priority
// and Status. Back sits in the header immediately after Kanban and uses
// the same bordered style as Back to Projects. The ref,
// full title, and description stay read-only and can be selected and copied.
// Status and Priority save from the review only. Status lists board.states in
// adapter order. Its label and stateRef value are state.name. Priority lists
// Urgent, High, Medium, Low, and None. None sends priority null. A change
// calls the existing `kanban:updateItem` with only that field. One review
// write at a time: both selects stay disabled until it settles, so the first
// success is not dropped. Success replaces that item by ref and leaves the
// review open on the returned item. Failure restores the confirmed value and
// shows the error on the review. A `listBoard` already in flight keeps that
// updated item as the one copy, including when its snapshot still has the old
// item. A later refresh still drops an absent ref.
// When the board is ready and the review is closed, the header shows New
// task as a bordered button with a plus before the label. The form under
// the header calls the existing
// `kanban:createItem` with title, stateRef, and an optional description, then
// upserts the returned item by ref and sends no priority. A `listBoard` already
// in flight keeps that ref when its snapshot omits it. A later refresh still
// drops an absent ref. The header's right side
// carries the refresh icon, with an accessible name (UX-UI §63). The surface
// loads lazily: exactly one
// `kanban:listBoard` call on first activation. The host retains each visited
// project session while hidden; activation and Refresh share a background load.
// Loading, typed error, empty board and not-configured states are inline text;
// the not-configured state offers Configure (Project Settings on its Kanban
// tab), mirroring the Resume picker's affordance. No drag-and-drop. Start is
// always shown and disabled when Resume is shown. Resume renders only for an
// item the batch handoff check proved available. Neither control opens the
// review: Start asks the host to open the
// launch confirmation, Resume asks the host to open the handoff confirmation.
// Neither launches from the board. The slug and title menu copies the ref or
// `WorkItem.url` through the renderer clipboard. It does not build a Plane
// address, and it does not open on Start, Resume, priority, or the row
// background. The review's own menu copies the current text selection.

/** Inline render phase of the board. */
export type KanbanBoardPhase = 'loading' | 'ready' | 'error' | 'not-configured' | 'empty'

export interface KanbanToolbarControls {
  phase: KanbanBoardPhase
  refreshing: boolean
  isReviewing: boolean
  creatingBusy: boolean
  sortState: KanbanSortState
  onSortByChange: (sortBy: KanbanSortBy) => void
  onToggleSortDirection: () => void
  onRefresh: () => void
  onNewTask: () => void
  onCloseReview: () => void
}

interface KanbanBoardProps {
  app: AppApi
  /** Active project; the board never renders without one. */
  projectId: string
  /** Opens Project Settings on the Kanban tab (the not-configured state). */
  onConfigure: () => void
  /** Opens Project Settings on the tab that owns the handoff directory. */
  onConfigureHandoffs?: () => void
  /**
   * Opens the Start confirmation in the app shell. Start is always shown, for
   * every item, and disabled when Resume is shown.
   */
  onStart?: (item: WorkItem) => void
  /**
   * Start without sending (NEKODE-99): the Start button's context menu offers
   * it. Without this callback the Start button has no menu.
   */
  onStartDraft?: (item: WorkItem) => void
  /**
   * Opens the Resume and handoff confirmation in the app shell. Resume is a
   * row control shown only for an item the batch handoff check proved
   * available.
   */
  onResume?: (item: WorkItem) => void
  /** Hidden retained sessions never initiate requests. */
  active?: boolean
  /**
   * External toolbar control bridge (e.g. ActionBar host). When supplied,
   * KanbanBoard omits its internal header.
   */
  onToolbarControls?: (controls: KanbanToolbarControls | null) => void
}

import {
  boardColumns,
  compareRefs,
  compareWorkItems,
  DEFAULT_KANBAN_SORT,
  type KanbanColumn,
  type KanbanSortBy,
  type KanbanSortDirection,
  type KanbanSortState,
  kanbanCollapsedStorageKey,
  kanbanSortStorageKey,
  loadCollapsedStateIds,
  loadKanbanSort,
  PRIORITY_NONE_RANK,
  PRIORITY_RANK,
  parseCollapsedStateIds,
  parseKanbanSort,
  reconcileBoard,
  reconcileBoardResponse,
  reconcileKeepingCreates,
  saveCollapsedStateIds,
  saveKanbanSort,
  sortWorkItems,
  upsertWorkItem,
  workItemsMatch,
} from './kanban-board-logic'

export {
  boardColumns,
  compareRefs,
  compareWorkItems,
  DEFAULT_KANBAN_SORT,
  type KanbanColumn,
  type KanbanSortBy,
  type KanbanSortDirection,
  type KanbanSortState,
  kanbanCollapsedStorageKey,
  kanbanSortStorageKey,
  loadCollapsedStateIds,
  loadKanbanSort,
  PRIORITY_NONE_RANK,
  PRIORITY_RANK,
  parseCollapsedStateIds,
  parseKanbanSort,
  reconcileBoard,
  reconcileBoardResponse,
  reconcileKeepingCreates,
  saveCollapsedStateIds,
  saveKanbanSort,
  sortWorkItems,
  upsertWorkItem,
  workItemsMatch,
}

export const PRIORITY_COLOR: Record<KanbanPriority, string> = {
  urgent: 'rgb(99, 40, 36)',
  high: 'rgb(107, 62, 20)',
  medium: '#f5d125',
  low: '#63acff',
}

const PRIORITY_LABEL: Record<KanbanPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const PRIORITY_OPTIONS: readonly { value: KanbanPriority | 'none'; label: string }[] = [
  { value: 'urgent', label: PRIORITY_LABEL.urgent },
  { value: 'high', label: PRIORITY_LABEL.high },
  { value: 'medium', label: PRIORITY_LABEL.medium },
  { value: 'low', label: PRIORITY_LABEL.low },
  { value: 'none', label: 'None' },
]

/** Visible priority word. Null stays visible as None so the field is never dropped. */
function priorityLabel(priority: KanbanPriority | null): string {
  return priority === null ? 'None' : PRIORITY_LABEL[priority]
}

/** Review body. A null or blank description is a sentence, not an empty gap. */
function descriptionText(description: string | null): string {
  if (description === null || description.trim() === '') {
    return 'No description.'
  }
  return description
}

const ITEM_CONTROL_CLASS =
  'w-fit rounded-md px-1.5 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Hover underline is the click affordance. Resting text stays plain. */
const ACTION_HOVER_CLASS = 'hover:underline underline-offset-2'

const COPY_FAILED = 'Could not copy to the clipboard.'

const MENU_ITEM_CLASS =
  'w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent'

/** Renderer clipboard (typed locally so tests can stub navigator.clipboard). */
/**
 * Comment timestamp for reading (spec kanban-adapter-interface, comments:
 * "the creation timestamp (formatted for reading)"). Adapters return ISO
 * strings in UTC; show them in local time with the same `toLocaleString()`
 * form as other app dates. A value that does not parse stays unchanged.
 */
export function commentTimestamp(createdAt: string): string {
  const time = Date.parse(createdAt)
  return Number.isNaN(time) ? createdAt : new Date(time).toLocaleString()
}

function navigatorClipboard(): { writeText(text: string): Promise<void> } | null {
  return typeof navigator !== 'undefined' && navigator.clipboard !== null
    ? navigator.clipboard
    : null
}

function blankUrl(url: string | null): boolean {
  return url === null || url.trim() === ''
}

/** List rows share this track so the slug and title line up across items. */
const LIST_ROW_COLUMNS = '7.5rem minmax(0, 1fr) auto auto'

/** Review split. The Priority and Status column is one quarter of the free width. */
const REVIEW_COLUMNS = 'minmax(0, 3fr) minmax(0, 1fr)'

const IDENTITY_CLASS =
  'w-fit max-w-full min-w-0 justify-self-start rounded-md px-0.5 py-0.5 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Border box of a single-line list row before this split: 26.9px.
 * Electron, default theme, deviceScaleFactor 1. The row is 1.5× that height.
 */
const LIST_ROW_MIN_HEIGHT_PX = 40.35

/** Header icon control without a selected state (refresh). */
const ICON_BUTTON_CLASS =
  'flex size-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink disabled:opacity-50'

function PriorityText({ priority }: { priority: KanbanPriority | null }): React.JSX.Element {
  return (
    <span
      className="inline-flex w-24 shrink-0 justify-end text-ink-secondary"
      style={priority !== null ? { color: PRIORITY_COLOR[priority] } : undefined}
    >
      <span className="sr-only">Priority </span>
      <span>{priorityLabel(priority)}</span>
    </span>
  )
}

function identityHandlers(
  item: WorkItem,
  onOpen: (ref: string) => void,
  onOpenMenu: (item: WorkItem, x: number, y: number) => void,
): Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onKeyDown' | 'onContextMenu'> {
  return {
    onClick: () => {
      onOpen(item.ref)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onOpen(item.ref)
        return
      }
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onOpenMenu(item, rect.left, rect.bottom)
      }
    },
    onContextMenu: (event) => {
      event.preventDefault()
      onOpenMenu(item, event.clientX, event.clientY)
    },
  }
}

/** Slug and title. Hover underlines the text, and that text is the click target. */
function ItemColumns({
  item,
  onOpen,
  onOpenMenu,
}: {
  item: WorkItem
  onOpen: (ref: string) => void
  onOpenMenu: (item: WorkItem, x: number, y: number) => void
}): React.JSX.Element {
  const handlers = identityHandlers(item, onOpen, onOpenMenu)
  return (
    <>
      <button
        type="button"
        className={`${IDENTITY_CLASS} truncate ${ACTION_HOVER_CLASS}`}
        data-testid={testIdFor.kanbanItemRef(item.ref)}
        {...handlers}
      >
        {item.ref}
      </button>
      <button
        type="button"
        className={`${IDENTITY_CLASS} truncate ${ACTION_HOVER_CLASS}`}
        data-testid={testIdFor.kanbanItemTitle(item.ref)}
        {...handlers}
      >
        {item.title}
      </button>
    </>
  )
}

function ItemCopyMenu({
  item,
  x,
  y,
  onClose,
}: {
  item: WorkItem
  x: number
  y: number
  onClose: () => void
}): React.JSX.Element {
  const [copyError, setCopyError] = useState<string | null>(null)
  const alive = useRef(true)
  const copyLinkDisabled = blankUrl(item.url)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function writeClipboard(text: string): Promise<void> {
    const clipboard = navigatorClipboard()
    if (clipboard === null) {
      setCopyError(COPY_FAILED)
      return
    }
    try {
      await clipboard.writeText(text)
    } catch {
      if (alive.current) setCopyError(COPY_FAILED)
      return
    }
    if (alive.current) onClose()
  }

  return (
    <div
      role="menu"
      aria-label={`Copy ${item.ref}`}
      className="fixed inset-0 z-40"
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
          onClick={() => {
            void writeClipboard(item.ref)
          }}
        >
          Copy slug
        </button>
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          disabled={copyLinkDisabled}
          onClick={() => {
            if (item.url === null || blankUrl(item.url)) return
            void writeClipboard(item.url)
          }}
        >
          Copy link
        </button>
        {copyError !== null ? (
          <p role="alert" className="px-3 py-1.5 text-xs text-error">
            {copyError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Start button menu (NEKODE-99): Start, or Start without sending. */
function StartMenu({
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

/** Right-click on the review copies the selection captured when the menu opened. */
function ReviewTextMenu({
  text,
  x,
  y,
  onClose,
}: {
  text: string
  x: number
  y: number
  onClose: () => void
}): React.JSX.Element {
  const [copyError, setCopyError] = useState<string | null>(null)
  const alive = useRef(true)
  const copyDisabled = text.trim() === ''

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function writeClipboard(): Promise<void> {
    if (copyDisabled) return
    const clipboard = navigatorClipboard()
    if (clipboard === null) {
      setCopyError(COPY_FAILED)
      return
    }
    try {
      await clipboard.writeText(text)
    } catch {
      if (alive.current) setCopyError(COPY_FAILED)
      return
    }
    if (alive.current) onClose()
  }

  return (
    <div
      role="menu"
      aria-label="Copy selection"
      className="fixed inset-0 z-40"
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
          disabled={copyDisabled}
          onClick={() => {
            void writeClipboard()
          }}
        >
          Copy
        </button>
        {copyError !== null ? (
          <p role="alert" className="px-3 py-1.5 text-xs text-error">
            {copyError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Start stays visible and is disabled while a confirmed handoff shows Resume.
 * Hover underlines Start only while it is enabled, and Resume while it is shown.
 */
function ItemLaunchButtons({
  item,
  resumeEnabled,
  onStart,
  onResume,
  onOpenStartMenu,
}: {
  item: WorkItem
  resumeEnabled: boolean
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: (item: WorkItem, x: number, y: number) => void
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        className={`${ITEM_CONTROL_CLASS} text-ink disabled:pointer-events-none disabled:opacity-50${resumeEnabled ? '' : ` ${ACTION_HOVER_CLASS}`}`}
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
          className={`${ITEM_CONTROL_CLASS} text-ink ${ACTION_HOVER_CLASS}`}
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

/** List row. Only the slug and the title open the review. */
function WorkItemSurface({
  item,
  resumeEnabled,
  onOpen,
  onOpenMenu,
  onStart,
  onResume,
  onOpenStartMenu,
}: {
  item: WorkItem
  resumeEnabled: boolean
  onOpen: (ref: string) => void
  onOpenMenu: (item: WorkItem, x: number, y: number) => void
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: (item: WorkItem, x: number, y: number) => void
}): React.JSX.Element {
  return (
    <div
      className="grid w-full items-center gap-x-3 rounded-md px-1.5 py-1 hover:bg-highlight"
      style={{ minHeight: LIST_ROW_MIN_HEIGHT_PX, gridTemplateColumns: LIST_ROW_COLUMNS }}
      data-testid={testIdFor.kanbanItem(item.ref)}
    >
      <ItemColumns item={item} onOpen={onOpen} onOpenMenu={onOpenMenu} />
      <PriorityText priority={item.priority} />
      <ItemLaunchButtons
        item={item}
        resumeEnabled={resumeEnabled}
        onStart={onStart}
        onResume={onResume}
        onOpenStartMenu={onOpenStartMenu}
      />
    </div>
  )
}

const NEW_TASK_FIELD_CLASS =
  'w-full rounded-md border border-edge bg-app px-3 text-[12.6px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function prioritySelectValue(priority: KanbanPriority | null): string {
  return priority === null ? 'none' : priority
}

function priorityFromSelect(value: string): KanbanPriority | null {
  if (value === 'none') return null
  if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') {
    return value
  }
  return null
}

function ItemReview({
  item,
  states,
  statusValue,
  statusError,
  priorityValue,
  priorityError,
  fieldsDisabled,
  resumeEnabled,
  onStart,
  onResume,
  onOpenStartMenu,
  onStatusChange,
  onPriorityChange,
  onCopyText,
  comments,
  commentsLoading,
  commentsError,
}: {
  item: WorkItem
  states: readonly KanbanState[]
  statusValue: string
  statusError: string | null
  priorityValue: KanbanPriority | null
  priorityError: string | null
  fieldsDisabled: boolean
  resumeEnabled: boolean
  comments: readonly KanbanComment[] | null
  commentsLoading: boolean
  commentsError: string | null
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: (item: WorkItem, x: number, y: number) => void
  onStatusChange: (stateName: string) => void
  onPriorityChange: (priority: KanbanPriority | null) => void
  onCopyText: (text: string, x: number, y: number) => void
}): React.JSX.Element {
  const ordered = statesInAdapterOrder(states)
  const names = new Set(ordered.map((state) => state.name))
  const extras = [item.stateName, statusValue].filter(
    (name, index, all) => !names.has(name) && all.indexOf(name) === index,
  )
  return (
    <article
      className="min-w-0 select-text"
      data-testid={TEST_ID.kanbanReview}
      onContextMenu={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest('button, select')) return
        event.preventDefault()
        onCopyText(window.getSelection()?.toString() ?? '', event.clientX, event.clientY)
      }}
    >
      <div className="grid items-start gap-6" style={{ gridTemplateColumns: REVIEW_COLUMNS }}>
        <div className="min-w-0">
          <p className="cursor-text font-medium text-ink">{item.ref}</p>
          <h3
            className="mt-2 cursor-text whitespace-pre-wrap break-words text-[14.7px] font-semibold text-ink"
            data-testid={TEST_ID.kanbanReviewTitle}
          >
            {item.title}
          </h3>
          <h4 className="mt-4 cursor-text font-semibold text-ink">Description</h4>
          <p
            className="mt-1 cursor-text whitespace-pre-wrap break-words text-ink-secondary"
            data-testid={TEST_ID.kanbanReviewDescription}
          >
            {descriptionText(item.description)}
          </p>
          <h4 className="mt-4 cursor-text font-semibold text-ink">Comments</h4>
          {commentsLoading ? (
            <p className="mt-1 cursor-text text-[12.6px] text-ink-secondary">Loading comments...</p>
          ) : commentsError !== null ? (
            <p
              role="alert"
              className="mt-1 text-[12.6px] text-error"
              data-testid={TEST_ID.kanbanReviewCommentsError}
            >
              {commentsError}
            </p>
          ) : comments === null || comments.length === 0 ? (
            <p
              className="mt-1 cursor-text text-ink-secondary"
              data-testid={TEST_ID.kanbanReviewCommentsEmpty}
            >
              No comments.
            </p>
          ) : (
            <div
              className="mt-2 flex flex-col gap-2"
              data-testid={TEST_ID.kanbanReviewCommentsList}
            >
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-md border border-edge bg-app/50 p-2.5 text-[12.6px]"
                  data-testid={testIdFor.kanbanReviewComment(comment.id)}
                >
                  <div className="flex items-center justify-between text-[11px] text-ink-secondary">
                    <span className="font-medium text-ink">{comment.author ?? 'Unknown'}</span>
                    {comment.createdAt ? (
                      <span title={comment.createdAt}>{commentTimestamp(comment.createdAt)}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-ink select-text">
                    {comment.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ItemLaunchButtons
            item={item}
            resumeEnabled={resumeEnabled}
            onStart={onStart}
            onResume={onResume}
            onOpenStartMenu={onOpenStartMenu}
          />
          <div className="flex flex-col gap-1">
            <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanReviewPriority}>
              Priority
            </label>
            <select
              id={TEST_ID.kanbanReviewPriority}
              className={`h-control ${NEW_TASK_FIELD_CLASS} disabled:opacity-50`}
              data-testid={TEST_ID.kanbanReviewPriority}
              value={prioritySelectValue(priorityValue)}
              style={priorityValue ? { color: PRIORITY_COLOR[priorityValue] } : undefined}
              disabled={fieldsDisabled}
              onChange={(event) => {
                onPriorityChange(priorityFromSelect(event.target.value))
              }}
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  style={
                    option.value !== 'none' ? { color: PRIORITY_COLOR[option.value] } : undefined
                  }
                >
                  {option.label}
                </option>
              ))}
            </select>
            {priorityError !== null ? (
              <p
                role="alert"
                className="text-[12.6px] text-error"
                data-testid={TEST_ID.kanbanReviewPriorityError}
              >
                {priorityError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanReviewStatus}>
              Status
            </label>
            <select
              id={TEST_ID.kanbanReviewStatus}
              className={`h-control ${NEW_TASK_FIELD_CLASS} disabled:opacity-50`}
              data-testid={TEST_ID.kanbanReviewStatus}
              value={statusValue}
              disabled={fieldsDisabled}
              onChange={(event) => {
                onStatusChange(event.target.value)
              }}
            >
              {ordered.map((state) => (
                <option key={state.id} value={state.name}>
                  {state.name}
                </option>
              ))}
              {extras.map((name) => (
                <option key={`extra-state-name:${name}`} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {statusError !== null ? (
              <p
                role="alert"
                className="text-[12.6px] text-error"
                data-testid={TEST_ID.kanbanReviewError}
              >
                {statusError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * Inline handoff-directory notices beneath the board header (spec Resume
 * availability items 3-4): an unconfigured directory offers Configure handoffs, a read
 * failure is its own state with Retry, and rejected files are named warnings.
 * A read failure never removes the loaded board; the notices render above it.
 */
function HandoffNotices({
  phase,
  error,
  warnings,
  onConfigureHandoffs,
  onRetry,
}: {
  phase: 'not-configured' | 'error' | 'ready'
  error: string | null
  warnings: HandoffRejection[]
  onConfigureHandoffs?: () => void
  onRetry: () => void
}): React.JSX.Element | null {
  if (phase === 'not-configured') {
    return (
      <div className="mb-3 text-[12.6px]" data-testid={TEST_ID.kanbanHandoffNotConfigured}>
        <p className="text-ink-secondary">Handoff directory is not configured.</p>
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.kanbanHandoffConfigure}
          onClick={onConfigureHandoffs}
        >
          Configure handoffs
        </button>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="mb-3 text-[12.6px]" data-testid={TEST_ID.kanbanHandoffError}>
        <p className="text-error">{error ?? 'Failed to read the handoff directory.'}</p>
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.kanbanHandoffRetry}
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    )
  }
  if (warnings.length > 0) {
    return (
      <ul
        className="mb-3 list-none space-y-1 text-[12.6px] text-warning"
        data-testid={TEST_ID.kanbanHandoffWarnings}
      >
        {warnings.map((warning) => (
          <li key={warning.name}>
            {warning.name}: {warning.reason}
          </li>
        ))}
      </ul>
    )
  }
  return null
}

interface NewTaskDraft {
  stateRef: string
  title: string
  description: string
  priority: KanbanPriority | null
}

/** Board states in adapter `order`, matching the columns. */
function statesInAdapterOrder(states: readonly KanbanState[]): KanbanState[] {
  return [...states].sort((a, b) => a.order - b.order)
}

/** First state named Todo, ignoring case, or '' when the board has none. */
function defaultNewTaskStateRef(states: readonly KanbanState[]): string {
  const match = statesInAdapterOrder(states).find((state) => state.name.toLowerCase() === 'todo')
  return match?.name ?? ''
}

function createFailureMessage(cause: unknown): string {
  const payload = parseAppErrorPayload(cause)
  if (payload !== null) return payload.message
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message
  return 'Could not create the task.'
}

function updateFailureMessage(cause: unknown, fallback: string): string {
  const payload = parseAppErrorPayload(cause)
  if (payload !== null) return payload.message
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message
  return fallback
}

function NewTaskForm({
  states,
  draft,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  states: readonly KanbanState[]
  draft: NewTaskDraft
  busy: boolean
  error: string | null
  onChange: (next: NewTaskDraft) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const ordered = statesInAdapterOrder(states)
  const canCreate = draft.title.trim() !== '' && draft.stateRef.trim() !== '' && !busy
  return (
    <form
      className="mb-3 flex flex-col gap-3 rounded-md border border-edge p-3"
      aria-label="New task"
      data-testid={TEST_ID.kanbanNewTaskForm}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={(event) => {
        if (busy || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskStatus}>
          Status
        </label>
        <select
          id={TEST_ID.kanbanNewTaskStatus}
          className={`h-control ${NEW_TASK_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskStatus}
          value={draft.stateRef}
          onChange={(event) => {
            onChange({ ...draft, stateRef: event.target.value })
          }}
        >
          {draft.stateRef === '' ? <option value=""> </option> : null}
          {ordered.map((state) => (
            <option key={state.id} value={state.name}>
              {state.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskPriority}>
          Priority
        </label>
        <select
          id={TEST_ID.kanbanNewTaskPriority}
          className={`h-control ${NEW_TASK_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskPriority}
          value={prioritySelectValue(draft.priority)}
          style={draft.priority ? { color: PRIORITY_COLOR[draft.priority] } : undefined}
          onChange={(event) => {
            onChange({ ...draft, priority: priorityFromSelect(event.target.value) })
          }}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              style={option.value !== 'none' ? { color: PRIORITY_COLOR[option.value] } : undefined}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskTitle}>
          Title
        </label>
        <input
          id={TEST_ID.kanbanNewTaskTitle}
          type="text"
          className={`h-control ${NEW_TASK_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskTitle}
          value={draft.title}
          onChange={(event) => {
            onChange({ ...draft, title: event.target.value })
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanNewTaskDescription}>
          Description
        </label>
        <textarea
          id={TEST_ID.kanbanNewTaskDescription}
          className={`min-h-16 py-2 ${NEW_TASK_FIELD_CLASS}`}
          data-testid={TEST_ID.kanbanNewTaskDescription}
          value={draft.description}
          onChange={(event) => {
            onChange({ ...draft, description: event.target.value })
          }}
        />
      </div>
      {error !== null ? (
        <p
          role="alert"
          className="text-[12.6px] text-error"
          data-testid={TEST_ID.kanbanNewTaskError}
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          data-testid={TEST_ID.kanbanNewTaskCreate}
          disabled={!canCreate}
        >
          Create
        </button>
        <button
          type="button"
          className="h-control rounded-md px-4 text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          data-testid={TEST_ID.kanbanNewTaskCancel}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export function KanbanBoard({
  app,
  projectId,
  onConfigure,
  onConfigureHandoffs,
  onStart,
  onStartDraft,
  onResume,
  active = true,
  onToolbarControls,
}: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)
  const [reviewRef, setReviewRef] = useState<string | null>(null)
  const [copyMenu, setCopyMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null)
  const [startMenu, setStartMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsedStates, setCollapsedStates] = useState<Set<string>>(() =>
    loadCollapsedStateIds(projectId),
  )
  const [sortState, setSortState] = useState<KanbanSortState>(() => loadKanbanSort(projectId))
  // Handoff availability (spec Resume availability): Resume is hidden until a
  // batch check succeeds and the item has a readable accepted candidate. The
  // check runs beside the board load and never delays rendering the board.
  const [handoffPhase, setHandoffPhase] = useState<
    'loading' | 'not-configured' | 'error' | 'ready'
  >('loading')
  const [availableIds, setAvailableIds] = useState<ReadonlySet<string>>(new Set())
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffWarnings, setHandoffWarnings] = useState<HandoffRejection[]>([])
  const [draft, setDraft] = useState<NewTaskDraft | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [statusChoice, setStatusChoice] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [priorityChoice, setPriorityChoice] = useState<KanbanPriority | null | undefined>(undefined)
  const [priorityError, setPriorityError] = useState<string | null>(null)
  const [reviewCopy, setReviewCopy] = useState<{ text: string; x: number; y: number } | null>(null)
  const [updatingReview, setUpdatingReview] = useState(false)
  const [reviewComments, setReviewComments] = useState<readonly KanbanComment[] | null>(null)
  const [reviewCommentsLoading, setReviewCommentsLoading] = useState(false)
  const [reviewCommentsError, setReviewCommentsError] = useState<string | null>(null)
  const pending = useRef(false)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const handoffPending = useRef<string | null>(null)
  const handoffGeneration = useRef(0)
  const createGeneration = useRef(0)
  const createBusy = useRef(false)
  const loadRequest = useRef(0)
  // Writes that succeeded while this listBoard request was already pending.
  // Creates fill omitted refs. Status updates replace that ref. A refresh that
  // starts afterwards keeps the normal remove-absent rule.
  const retainedCreates = useRef(new Map<number, WorkItem[]>())
  const retainedUpdates = useRef(new Map<number, WorkItem[]>())
  const reviewGeneration = useRef(0)
  const reviewBusy = useRef(false)
  const boardRef = useRef(board)
  const projectRef = useRef(projectId)
  const shownReviewRef = useRef<string | null>(null)
  boardRef.current = board
  projectRef.current = projectId
  shownReviewRef.current = reviewRef

  const closeNewTask = useCallback(() => {
    setDraft(null)
    setCreateError(null)
  }, [])

  useEffect(() => {
    generation.current += 1
    pending.current = false
    hasSnapshot.current = false
    loadRequest.current += 1
    retainedCreates.current.clear()
    retainedUpdates.current.clear()
    setBoard({ states: [], items: [] })
    setPhase('loading')
    setReviewRef(null)
    setCopyMenu(null)
    setStartMenu(null)
    setError(null)
    setRefreshing(false)
    createGeneration.current += 1
    createBusy.current = false
    setCreatingBusy(false)
    setCollapsedStates(loadCollapsedStateIds(projectId))
    setSortState(loadKanbanSort(projectId))
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewCopy(null)
    setReviewComments(null)
    setReviewCommentsLoading(false)
    setReviewCommentsError(null)
    // The previous project's review write must not keep these selects locked.
    reviewBusy.current = false
    setUpdatingReview(false)
    // A project change (or a direct projectId switch in a test) is a new scan
    // generation: a late response for the previous project never restores Resume.
    handoffGeneration.current += 1
    handoffPending.current = null
    setHandoffPhase('loading')
    setAvailableIds(new Set())
    setHandoffError(null)
    setHandoffWarnings([])
  }, [projectId, closeNewTask])

  useEffect(() => {
    if (phase !== 'ready') closeNewTask()
  }, [phase, closeNewTask])

  useEffect(() => {
    if (reviewRef === null) {
      setReviewComments(null)
      setReviewCommentsLoading(false)
      setReviewCommentsError(null)
      return
    }
    let cancelled = false
    setReviewComments(null)
    setReviewCommentsLoading(true)
    setReviewCommentsError(null)
    app.kanban
      .getComments(projectId, reviewRef)
      .then((comments) => {
        if (cancelled) return
        setReviewComments(comments)
        setReviewCommentsLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setReviewCommentsError(parseAppErrorPayload(cause)?.message ?? 'Failed to load comments.')
        setReviewCommentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [app, projectId, reviewRef])

  const handleSortByChange = useCallback(
    (nextSortBy: KanbanSortBy) => {
      setSortState((previous) => {
        const next: KanbanSortState = { ...previous, sortBy: nextSortBy }
        saveKanbanSort(projectId, next)
        return next
      })
    },
    [projectId],
  )

  const toggleSortDirection = useCallback(() => {
    setSortState((previous) => {
      const next: KanbanSortState = {
        ...previous,
        direction: previous.direction === 'asc' ? 'desc' : 'asc',
      }
      saveKanbanSort(projectId, next)
      return next
    })
  }, [projectId])

  const toggleStateCollapse = useCallback(
    (stateId: string) => {
      setCollapsedStates((previous) => {
        const next = new Set(previous)
        if (next.has(stateId)) {
          next.delete(stateId)
        } else {
          next.add(stateId)
        }
        saveCollapsedStateIds(projectId, next)
        return next
      })
    },
    [projectId],
  )

  // A changed binding is a new keyed component in the host. Cleanup excludes
  // late responses from that disposed session (including StrictMode replay).
  useEffect(() => {
    return () => {
      generation.current += 1
      pending.current = false
      handoffGeneration.current += 1
      handoffPending.current = null
      createGeneration.current += 1
      createBusy.current = false
      reviewGeneration.current += 1
      reviewBusy.current = false
    }
  }, [])

  // One batch handoff check for the loaded items: one directory read, then the
  // same snapshot matched against every item. Identical concurrent triggers
  // are coalesced; a different item set is its own generation, so an older
  // result never marks a new item available (spec Resume availability items 6-9).
  const loadHandoff = useCallback(
    async (items: Array<{ itemId: string; ref: string }>): Promise<void> => {
      const signature = items.map((entry) => `${entry.itemId}:${entry.ref}`).join('|')
      // The same load firing twice for an unchanged item set is one request.
      if (handoffPending.current === signature) {
        return
      }
      const requestGeneration = ++handoffGeneration.current
      handoffPending.current = signature
      setHandoffPhase('loading')
      setAvailableIds(new Set())
      setHandoffError(null)
      setHandoffWarnings([])
      try {
        const result = await app.kanban.handoffAvailability({ projectId, items })
        if (requestGeneration !== handoffGeneration.current) return
        if (result.state === 'not-configured') {
          setHandoffPhase('not-configured')
          return
        }
        if (result.state === 'error') {
          setHandoffPhase('error')
          setHandoffError(result.message)
          return
        }
        setAvailableIds(
          new Set(result.items.filter((entry) => entry.available).map((entry) => entry.itemId)),
        )
        setHandoffWarnings(result.rejections)
        setHandoffPhase('ready')
      } catch (cause) {
        if (requestGeneration !== handoffGeneration.current) return
        setHandoffPhase('error')
        setHandoffError(
          parseAppErrorPayload(cause)?.message ?? 'Failed to read the handoff directory.',
        )
      } finally {
        if (requestGeneration === handoffGeneration.current) {
          handoffPending.current = null
        }
      }
    },
    [app, projectId],
  )

  const recheckHandoff = useCallback((): void => {
    void loadHandoff(boardRef.current.items.map((entry) => ({ itemId: entry.id, ref: entry.ref })))
  }, [loadHandoff])

  // One load: the mount effect and the refresh control share it. An
  // unconfigured project rejects with the typed validation error naming the
  // project (spec Behaviour 9), which is the not-configured state; every other
  // rejection is surfaced as its typed message inline — never a silent drop.
  const load = useCallback(async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    const requestGeneration = generation.current
    const requestId = ++loadRequest.current
    if (!hasSnapshot.current) setPhase('loading')
    setRefreshing(true)
    setError(null)
    try {
      const next = await app.kanban.listBoard(projectId)
      if (requestGeneration !== generation.current) return
      hasSnapshot.current = true
      const retained = retainedCreates.current.get(requestId) ?? []
      retainedCreates.current.delete(requestId)
      const keptUpdates = retainedUpdates.current.get(requestId) ?? []
      retainedUpdates.current.delete(requestId)
      const result = reconcileBoardResponse({
        previousBoard: boardRef.current,
        incomingBoard: next,
        retainedCreates: retained,
        retainedUpdates: keptUpdates,
        currentReviewRef: shownReviewRef.current,
      })
      setBoard(result.board)
      setReviewRef(result.reviewRef)
      setPhase(result.phase)
      // Availability is checked on activation, tab return and Refresh; the
      // board render never waits for it (spec Resume availability item 7).
      void loadHandoff(next.items.map((entry) => ({ itemId: entry.id, ref: entry.ref })))
    } catch (cause) {
      if (requestGeneration !== generation.current) return
      retainedCreates.current.delete(requestId)
      retainedUpdates.current.delete(requestId)
      const payload = parseAppErrorPayload(cause)
      if (payload?.code === 'validation' || payload?.code === 'not_found') {
        hasSnapshot.current = false
        setBoard({ states: [], items: [] })
        setReviewRef(null)
        setCopyMenu(null)
        setStartMenu(null)
        setError(payload.message)
        setPhase(payload.code === 'validation' ? 'not-configured' : 'error')
        return
      }
      setError(payload?.message ?? 'Failed to load the Kanban board.')
      if (!hasSnapshot.current) setPhase('error')
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false
        setRefreshing(false)
      }
    }
  }, [app, projectId, loadHandoff])

  // Lazy first activation and one background refresh on each tab return.
  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const reviewItem =
    phase === 'ready' && reviewRef !== null
      ? (board.items.find((entry) => entry.ref === reviewRef) ?? null)
      : null

  // Resume is shown only for an item the batch check proved available. The
  // backend status and the mere presence of files never decide (spec
  // Resume availability item 2).
  const itemResumable = (item: WorkItem): boolean =>
    handoffPhase === 'ready' && availableIds.has(item.id)

  const openNewTask = useCallback((): void => {
    if (draft !== null || createBusy.current) return
    setCreateError(null)
    setDraft({
      stateRef: defaultNewTaskStateRef(board.states),
      title: '',
      description: '',
      priority: null,
    })
  }, [draft, board.states])

  async function submitNewTask(): Promise<void> {
    if (draft === null || createBusy.current) return
    const title = draft.title
    const stateRef = draft.stateRef
    const description = draft.description
    const priority = draft.priority
    if (title.trim() === '' || stateRef.trim() === '') return
    const input: KanbanCreateInput = { title, stateRef }
    if (description.trim() !== '') input.description = description
    if (priority !== null) input.priority = priority
    const request = ++createGeneration.current
    const sourceProject = projectId
    createBusy.current = true
    setCreatingBusy(true)
    setCreateError(null)
    try {
      const created = await app.kanban.createItem(sourceProject, input)
      if (request !== createGeneration.current || sourceProject !== projectRef.current) return
      setBoard((previous) => {
        const items = upsertWorkItem(previous.items, created)
        return items === previous.items ? previous : { ...previous, items }
      })
      if (pending.current) {
        const inFlight = loadRequest.current
        const existing = retainedCreates.current.get(inFlight) ?? []
        retainedCreates.current.set(inFlight, upsertWorkItem(existing, created))
      }
      setDraft(null)
      setCreateError(null)
    } catch (cause) {
      if (request !== createGeneration.current || sourceProject !== projectRef.current) return
      setCreateError(createFailureMessage(cause))
    } finally {
      if (request === createGeneration.current) {
        createBusy.current = false
        setCreatingBusy(false)
      }
    }
  }

  async function submitReviewWrite(
    write:
      | { field: 'status'; stateRef: string }
      | { field: 'priority'; priority: KanbanPriority | null },
  ): Promise<void> {
    // A second change must not bump the generation: that drops this success
    // before the board or retainedUpdates is updated.
    if (reviewBusy.current) return
    const ref = reviewRef
    if (ref === null) return
    const current = boardRef.current.items.find((entry) => entry.ref === ref)
    if (current === undefined) return
    if (write.field === 'status') {
      if (statusChoice === null && write.stateRef === current.stateName) return
    } else if (priorityChoice === undefined && write.priority === current.priority) {
      return
    }
    const request = ++reviewGeneration.current
    const sourceProject = projectId
    const patch: KanbanUpdatePatch =
      write.field === 'status' ? { stateRef: write.stateRef } : { priority: write.priority }
    reviewBusy.current = true
    setUpdatingReview(true)
    setStatusError(null)
    setPriorityError(null)
    if (write.field === 'status') {
      setStatusChoice(write.stateRef)
    } else {
      setPriorityChoice(write.priority)
    }
    try {
      const updated = await app.kanban.updateItem(sourceProject, ref, patch)
      if (request !== reviewGeneration.current || sourceProject !== projectRef.current) return
      setBoard((previous) => {
        const items = upsertWorkItem(previous.items, updated)
        return items === previous.items ? previous : { ...previous, items }
      })
      if (pending.current) {
        const inFlight = loadRequest.current
        const existing = retainedUpdates.current.get(inFlight) ?? []
        retainedUpdates.current.set(inFlight, upsertWorkItem(existing, updated))
      }
      if (shownReviewRef.current === ref) {
        if (write.field === 'status') {
          setStatusChoice(null)
        } else {
          setPriorityChoice(undefined)
        }
        setStatusError(null)
        setPriorityError(null)
      }
    } catch (cause) {
      if (request !== reviewGeneration.current || sourceProject !== projectRef.current) return
      if (shownReviewRef.current !== ref) return
      const message = updateFailureMessage(
        cause,
        write.field === 'status'
          ? 'Could not update the status.'
          : 'Could not update the priority.',
      )
      if (write.field === 'status') {
        setStatusChoice(null)
        setStatusError(message)
      } else {
        setPriorityChoice(undefined)
        setPriorityError(message)
      }
    } finally {
      if (request === reviewGeneration.current) {
        reviewBusy.current = false
        setUpdatingReview(false)
      }
    }
  }

  const closeReview = useCallback((): void => {
    setReviewRef(null)
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewCopy(null)
  }, [])

  const openReview = (ref: string): void => {
    setCopyMenu(null)
    setStartMenu(null)
    setReviewCopy(null)
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewRef(ref)
  }

  const openCopyMenu = (item: WorkItem, x: number, y: number): void => {
    setStartMenu(null)
    setCopyMenu({ item, x, y })
  }

  const openStartMenu = (item: WorkItem, x: number, y: number): void => {
    setCopyMenu(null)
    setReviewCopy(null)
    setStartMenu({ item, x, y })
  }
  const startMenuOpener = onStartDraft === undefined ? undefined : openStartMenu

  const onToolbarControlsRef = useRef(onToolbarControls)
  onToolbarControlsRef.current = onToolbarControls
  const lastReportedRef = useRef<{
    active: boolean
    phase: KanbanBoardPhase
    refreshing: boolean
    isReviewing: boolean
    creatingBusy: boolean
    sortBy: KanbanSortBy
    direction: KanbanSortDirection
  } | null>(null)

  useEffect(() => {
    if (!onToolbarControlsRef.current) return
    const isReviewing = reviewItem !== null
    if (!active) {
      if (lastReportedRef.current !== null) {
        lastReportedRef.current = null
        onToolbarControlsRef.current(null)
      }
      return
    }
    const prev = lastReportedRef.current
    if (
      prev !== null &&
      prev.active === active &&
      prev.phase === phase &&
      prev.refreshing === refreshing &&
      prev.isReviewing === isReviewing &&
      prev.creatingBusy === creatingBusy &&
      prev.sortBy === sortState.sortBy &&
      prev.direction === sortState.direction
    ) {
      return
    }
    lastReportedRef.current = {
      active,
      phase,
      refreshing,
      isReviewing,
      creatingBusy,
      sortBy: sortState.sortBy,
      direction: sortState.direction,
    }
    onToolbarControlsRef.current({
      phase,
      refreshing,
      isReviewing,
      creatingBusy,
      sortState,
      onSortByChange: handleSortByChange,
      onToggleSortDirection: toggleSortDirection,
      onRefresh: () => {
        void load()
      },
      onNewTask: openNewTask,
      onCloseReview: closeReview,
    })
  }, [
    active,
    phase,
    refreshing,
    reviewItem,
    creatingBusy,
    sortState,
    handleSortByChange,
    toggleSortDirection,
    load,
    openNewTask,
    closeReview,
  ])

  useEffect(() => {
    return () => {
      if (lastReportedRef.current !== null) {
        lastReportedRef.current = null
        onToolbarControlsRef.current?.(null)
      }
    }
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-[12.6px]"
      data-testid={TEST_ID.kanbanBoard}
    >
      {onToolbarControls ? null : (
        <div className="sticky top-0 z-10 -mx-3 mb-3 flex shrink-0 items-center gap-2 bg-app px-3 py-2">
          <h2 className="text-[14.7px] font-semibold text-ink">Kanban</h2>
          {reviewItem !== null ? (
            <button
              type="button"
              className="no-drag flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-testid={TEST_ID.kanbanReviewBack}
              aria-label="Back"
              title="Back"
              onClick={closeReview}
            >
              <Icon.back size={12} aria-hidden />
              Back
            </button>
          ) : null}
          {phase === 'ready' && reviewItem === null ? (
            <button
              type="button"
              className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-edge bg-panel px-2 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
              data-testid={TEST_ID.kanbanNewTask}
              disabled={creatingBusy}
              onClick={openNewTask}
            >
              <Icon.plus size={14} aria-hidden />
              New task
            </button>
          ) : null}
          {/* Refresh sits on the right (UX-UI §63). */}
          <div className="ml-auto flex items-center gap-1">
            {phase === 'ready' && reviewItem === null ? (
              <div className="mr-1 flex items-center gap-1">
                <label htmlFor="kanban-sort-by" className="sr-only">
                  Sort by
                </label>
                <select
                  id="kanban-sort-by"
                  className="h-6 rounded border border-edge bg-app px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  value={sortState.sortBy}
                  onChange={(event) => {
                    handleSortByChange(event.target.value as KanbanSortBy)
                  }}
                  data-testid={TEST_ID.kanbanSortBy}
                >
                  <option value="slug">Slug</option>
                  <option value="priority">Priority</option>
                </select>
                <button
                  type="button"
                  className={ICON_BUTTON_CLASS}
                  aria-label={sortState.direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
                  title={sortState.direction === 'asc' ? 'Ascending' : 'Descending'}
                  data-testid={TEST_ID.kanbanSortDirection}
                  onClick={toggleSortDirection}
                >
                  {sortState.direction === 'asc' ? (
                    <Icon.sortAsc size={14} aria-hidden />
                  ) : (
                    <Icon.sortDesc size={14} aria-hidden />
                  )}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              aria-label="Refresh"
              title="Refresh"
              data-testid={TEST_ID.kanbanBoardRefresh}
              disabled={refreshing}
              onClick={() => {
                void load()
              }}
            >
              <Icon.retry
                size={14}
                aria-hidden
                className={refreshing ? 'animate-spin' : undefined}
              />
            </button>
          </div>
        </div>
      )}
      {phase === 'ready' && reviewItem === null && draft !== null ? (
        <NewTaskForm
          states={board.states}
          draft={draft}
          busy={creatingBusy}
          error={createError}
          onChange={(next) => {
            setDraft(next)
          }}
          onSubmit={() => {
            void submitNewTask()
          }}
          onCancel={closeNewTask}
        />
      ) : null}
      {handoffPhase !== 'loading' ? (
        <HandoffNotices
          phase={handoffPhase}
          error={handoffError}
          warnings={handoffWarnings}
          onConfigureHandoffs={onConfigureHandoffs}
          onRetry={recheckHandoff}
        />
      ) : null}
      {phase === 'loading' ? (
        <p
          className="text-[12.6px] text-ink-secondary"
          role="status"
          data-testid={TEST_ID.kanbanBoardLoading}
        >
          Loading board…
        </p>
      ) : null}
      {phase === 'not-configured' ? (
        <div className="text-[12.6px]" data-testid={TEST_ID.kanbanBoardUnconfigured}>
          <p className="text-ink-secondary">
            No Kanban adapter is configured for this project. Bind one in Project Settings to see
            its board.
          </p>
          <button
            type="button"
            className="mt-3 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
            data-testid={TEST_ID.kanbanBoardConfigure}
            onClick={onConfigure}
          >
            Configure
          </button>
        </div>
      ) : null}
      {error !== null && phase !== 'not-configured' ? (
        <p role="alert" className="text-[12.6px] text-error" data-testid={TEST_ID.kanbanBoardError}>
          {error}
        </p>
      ) : null}
      {phase === 'empty' ? (
        <p className="text-[12.6px] text-ink-secondary" data-testid={TEST_ID.kanbanBoardEmpty}>
          This board has no states yet.
        </p>
      ) : null}
      {reviewItem !== null ? (
        <ItemReview
          item={reviewItem}
          states={board.states}
          statusValue={statusChoice ?? reviewItem.stateName}
          statusError={statusError}
          priorityValue={priorityChoice !== undefined ? priorityChoice : reviewItem.priority}
          priorityError={priorityError}
          fieldsDisabled={updatingReview}
          resumeEnabled={itemResumable(reviewItem)}
          comments={reviewComments}
          commentsLoading={reviewCommentsLoading}
          commentsError={reviewCommentsError}
          onStart={onStart}
          onResume={onResume}
          onOpenStartMenu={startMenuOpener}
          onStatusChange={(nextName) => {
            void submitReviewWrite({ field: 'status', stateRef: nextName })
          }}
          onPriorityChange={(nextPriority) => {
            void submitReviewWrite({ field: 'priority', priority: nextPriority })
          }}
          onCopyText={(text, x, y) => {
            setReviewCopy({ text, x, y })
          }}
        />
      ) : null}
      {phase === 'ready' && reviewItem === null ? (
        <div className="flex min-w-0 flex-col gap-3" data-testid={TEST_ID.kanbanList}>
          {boardColumns(board).map((column) => {
            const isCollapsed = collapsedStates.has(column.stateId)
            const listId = `kanban-list-items-${column.stateId}`
            const sortedItems = sortWorkItems(column.items, sortState.sortBy, sortState.direction)
            return (
              <section key={column.stateId} data-testid={testIdFor.kanbanListGroup(column.stateId)}>
                <h3 className="mb-1 border-b border-edge pb-1 text-[12.6px] font-semibold text-ink">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    aria-expanded={!isCollapsed}
                    aria-controls={listId}
                    data-testid={testIdFor.kanbanGroupToggle(column.stateId)}
                    onClick={() => {
                      toggleStateCollapse(column.stateId)
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="flex shrink-0 text-ink-muted">
                        {isCollapsed ? (
                          <Icon.chevronRight size={14} />
                        ) : (
                          <Icon.chevronDown size={14} />
                        )}
                      </span>
                      <span>{column.name}</span>
                    </span>
                    <span className="text-sm font-normal text-ink-muted">
                      {column.items.length}
                    </span>
                  </button>
                </h3>
                {!isCollapsed ? (
                  <ul id={listId} className="space-y-1">
                    {sortedItems.map((item) => (
                      <li key={item.ref}>
                        <WorkItemSurface
                          item={item}
                          resumeEnabled={itemResumable(item)}
                          onOpen={openReview}
                          onOpenMenu={openCopyMenu}
                          onStart={onStart}
                          onResume={onResume}
                          onOpenStartMenu={startMenuOpener}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}
      {copyMenu !== null ? (
        <ItemCopyMenu
          item={copyMenu.item}
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => {
            setCopyMenu(null)
          }}
        />
      ) : null}
      {startMenu !== null && onStartDraft !== undefined ? (
        <StartMenu
          item={startMenu.item}
          x={startMenu.x}
          y={startMenu.y}
          onStart={onStart}
          onStartDraft={onStartDraft}
          onClose={() => {
            setStartMenu(null)
          }}
        />
      ) : null}
      {reviewCopy !== null ? (
        <ReviewTextMenu
          text={reviewCopy.text}
          x={reviewCopy.x}
          y={reviewCopy.y}
          onClose={() => {
            setReviewCopy(null)
          }}
        />
      ) : null}
    </div>
  )
}
