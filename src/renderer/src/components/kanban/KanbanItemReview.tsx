import type {
  AppApi,
  KanbanComment,
  KanbanPriority,
  KanbanState,
  WorkItem,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
  COPY_FAILED,
  ItemLaunchButtons,
  KANBAN_FIELD_CLASS,
  MENU_ITEM_CLASS,
  navigatorClipboard,
  type OpenItemMenu,
} from './KanbanItemActions'
import {
  commentTimestamp,
  descriptionText,
  extraStatusNames,
  PRIORITY_COLOR,
  PRIORITY_OPTIONS,
  priorityFromSelect,
  prioritySelectValue,
  statesInAdapterOrder,
} from './kanban-board-logic'

// Item review (spec kanban-adapter-interface Behaviour 14). Two columns: the
// left is three quarters of the width and holds the ref, full title,
// description, and comments, read-only and selectable. The right is one
// quarter and holds Start/Resume, Priority, and Status. Status lists the board
// states in adapter order; its label and value are the state name. Priority
// lists Urgent, High, Medium, Low, and None. The selects stay disabled while a
// review write is in flight. The review's own menu copies the text selection.

/** Review split. The Priority and Status column is one quarter of the free width. */
const REVIEW_COLUMNS = 'minmax(0, 3fr) minmax(0, 1fr)'

/** Right-click on the review copies the selection captured when the menu opened. */
export function ReviewTextMenu({
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

/** Comments under the description: loading, typed error, empty, or the list. */
function ReviewComments({
  comments,
  loading,
  error,
}: {
  comments: readonly KanbanComment[] | null
  loading: boolean
  error: string | null
}): React.JSX.Element {
  if (loading) {
    return <p className="mt-1 cursor-text text-[12.6px] text-ink-secondary">Loading comments...</p>
  }
  if (error !== null) {
    return (
      <p
        role="alert"
        className="mt-1 text-[12.6px] text-error"
        data-testid={TEST_ID.kanbanReviewCommentsError}
      >
        {error}
      </p>
    )
  }
  if (comments === null || comments.length === 0) {
    return (
      <p
        className="mt-1 cursor-text text-ink-secondary"
        data-testid={TEST_ID.kanbanReviewCommentsEmpty}
      >
        No comments.
      </p>
    )
  }
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid={TEST_ID.kanbanReviewCommentsList}>
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
  )
}

export interface KanbanItemReviewProps {
  item: WorkItem
  states: readonly KanbanState[]
  /** Shown status name: the pending choice, else the item's state name. */
  statusValue: string
  statusError: string | null
  /** Shown priority: the pending choice, else the item's priority. */
  priorityValue: KanbanPriority | null
  priorityError: string | null
  /** True while a review write is in flight. */
  fieldsDisabled: boolean
  resumeEnabled: boolean
  comments: readonly KanbanComment[] | null
  commentsLoading: boolean
  commentsError: string | null
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: OpenItemMenu
  onStatusChange: (stateName: string) => void
  onPriorityChange: (priority: KanbanPriority | null) => void
  /** Context menu on review text: the current selection and the pointer position. */
  onCopyText: (text: string, x: number, y: number) => void
}

export function KanbanItemReview({
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
}: KanbanItemReviewProps): React.JSX.Element {
  const ordered = statesInAdapterOrder(states)
  const extras = extraStatusNames(ordered, item.stateName, statusValue)
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
          <ReviewComments comments={comments} loading={commentsLoading} error={commentsError} />
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
              className={`h-control ${KANBAN_FIELD_CLASS} disabled:opacity-50`}
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
              className={`h-control ${KANBAN_FIELD_CLASS} disabled:opacity-50`}
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
 * Comments of the reviewed item: one `kanban:getComments` call each time the
 * review opens on a ref (or the project changes). A closed review clears them;
 * a late response for a ref no longer shown is dropped.
 */
export function useReviewComments(
  app: AppApi,
  projectId: string,
  reviewRef: string | null,
): { comments: readonly KanbanComment[] | null; loading: boolean; error: string | null } {
  const [comments, setComments] = useState<readonly KanbanComment[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (reviewRef === null) {
      setComments(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setComments(null)
    setLoading(true)
    setError(null)
    app.kanban
      .getComments(projectId, reviewRef)
      .then((next) => {
        if (cancelled) return
        setComments(next)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to load comments.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [app, projectId, reviewRef])

  return { comments, loading, error }
}
