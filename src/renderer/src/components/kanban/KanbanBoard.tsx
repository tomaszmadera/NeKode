import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  KanbanPriority,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Read-only Kanban surface (spec kanban-adapter-interface Behaviour 14, AC14).
// List is the default: the same items grouped under the state names. Board is
// one column per adapter state, ordered by `order`. Both show the ref (Plane
// slug), a truncated title, and the priority. Opening an item replaces that
// view with a review: the same fields, the state name, the title in full, and
// the description. The review reads the loaded board; it does not call another
// action. The header's right side carries the icon controls (user request
// 2026-10-05): a Board | List switch and the refresh icon, each with an
// accessible name (UX-UI §63). The surface loads lazily: exactly one
// `kanban:listBoard` call when it mounts (the host mounts it only while the
// Kanban tab is selected), and the refresh control re-runs that one load.
// Loading, typed error, empty board and not-configured states are inline text;
// the not-configured state offers Configure (Project Settings on its Kanban
// tab), mirroring the Resume picker's affordance. Read-only: no drag-and-drop
// and no card actions.

/** Inline render phase of the board. */
export type KanbanBoardPhase = 'loading' | 'ready' | 'error' | 'not-configured' | 'empty'

interface KanbanBoardProps {
  app: AppApi
  /** Active project; the board never renders without one. */
  projectId: string
  /** Opens Project Settings on the Kanban tab (the not-configured state). */
  onConfigure: () => void
}

/** One rendered column: a state with the items that belong to it. */
export interface KanbanColumn {
  stateId: string
  name: string
  items: WorkItem[]
}

/** Which arrangement of the loaded items is on screen. List is the default. */
type KanbanSurfaceView = 'board' | 'list'

const PRIORITY_LABEL: Record<KanbanPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

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

/**
 * Columns in the adapter's `order`, items grouped by their state id keeping
 * the adapter's item order. Pure so the column contract is testable.
 *
 * An item's `stateId` is NOT guaranteed to be one of the returned states'
 * ids: the spec fixes only the WorkItem and KanbanState shapes independently
 * (Business rules) and the Stage 1 normalization validates each separately —
 * `normalizeItem` requires a non-empty `stateId`/`stateName`, `normalizeStates`
 * requires state ids, but nothing cross-checks that an item's `stateId` is a
 * known state id (`src/main/services/kanban/adapter-protocol.ts`). Dropping
 * such items would silently lose data, so any item whose `stateId` matches no
 * state is collected into a TRAILING column per unmatched state id, labelled
 * from the item's own `stateName` (never invented), in first-seen item order.
 * Every item in `board.items` therefore appears in exactly one column.
 */
export function boardColumns(board: KanbanBoardData): KanbanColumn[] {
  const columns = [...board.states]
    .sort((a, b) => a.order - b.order)
    .map((state) => ({
      stateId: state.id,
      name: state.name,
      items: board.items.filter((item) => item.stateId === state.id),
    }))
  const knownStateIds = new Set(board.states.map((state) => state.id))
  const unmatched = new Map<string, KanbanColumn>()
  for (const item of board.items) {
    if (knownStateIds.has(item.stateId)) {
      continue
    }
    const column = unmatched.get(item.stateId)
    if (column === undefined) {
      unmatched.set(item.stateId, {
        stateId: item.stateId,
        name: item.stateName,
        items: [item],
      })
    } else {
      column.items.push(item)
    }
  }
  return [...columns, ...unmatched.values()]
}

const ITEM_BUTTON_CLASS =
  'rounded-md px-1.5 py-1 text-left hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Header icon toggle: the selected view keeps a highlight fill. */
function viewButtonClass(selected: boolean): string {
  return selected
    ? 'flex size-6 items-center justify-center rounded bg-highlight text-ink'
    : 'flex size-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink'
}

/** Header icon control without a selected state (refresh). */
const ICON_BUTTON_CLASS =
  'flex size-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink disabled:opacity-50'

function PriorityText({ priority }: { priority: KanbanPriority | null }): React.JSX.Element {
  return (
    <span className="inline-flex w-16 shrink-0 justify-end text-ink-secondary">
      <span className="sr-only">Priority </span>
      <span>{priorityLabel(priority)}</span>
    </span>
  )
}

/** Board card or list row. The title is truncated; the review shows it in full. */
function WorkItemButton({
  item,
  layout,
  onOpen,
}: {
  item: WorkItem
  layout: 'card' | 'row'
  onOpen: (ref: string) => void
}): React.JSX.Element {
  const titleClass =
    layout === 'card' ? 'block truncate text-ink-secondary' : 'min-w-0 truncate text-ink-secondary'
  return (
    <button
      type="button"
      className={
        layout === 'card'
          ? `block w-full ${ITEM_BUTTON_CLASS}`
          : `grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 ${ITEM_BUTTON_CLASS}`
      }
      data-testid={testIdFor.kanbanItem(item.ref)}
      onClick={() => {
        onOpen(item.ref)
      }}
    >
      {layout === 'card' ? (
        <span className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 font-medium text-ink">{item.ref}</span>
          <PriorityText priority={item.priority} />
        </span>
      ) : (
        <span className="shrink-0 font-medium text-ink">{item.ref}</span>
      )}
      <span className={titleClass}>{item.title}</span>
      {layout === 'row' ? <PriorityText priority={item.priority} /> : null}
    </button>
  )
}

function ItemReview({ item, onBack }: { item: WorkItem; onBack: () => void }): React.JSX.Element {
  return (
    <article className="min-w-0" data-testid={TEST_ID.kanbanReview}>
      <button
        type="button"
        className="h-control rounded-md px-3 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        data-testid={TEST_ID.kanbanReviewBack}
        onClick={onBack}
      >
        Back
      </button>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="font-medium text-ink">{item.ref}</p>
        <PriorityText priority={item.priority} />
      </div>
      <p className="text-ink-secondary">{item.stateName}</p>
      <h3
        className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-ink"
        data-testid={TEST_ID.kanbanReviewTitle}
      >
        {item.title}
      </h3>
      <h4 className="mt-4 font-semibold text-ink">Description</h4>
      <p
        className="mt-1 whitespace-pre-wrap break-words text-ink-secondary"
        data-testid={TEST_ID.kanbanReviewDescription}
      >
        {descriptionText(item.description)}
      </p>
    </article>
  )
}

export function KanbanBoard({ app, projectId, onConfigure }: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<KanbanSurfaceView>('list')
  const [reviewRef, setReviewRef] = useState<string | null>(null)

  // One load: the mount effect and the refresh control share it. An
  // unconfigured project rejects with the typed validation error naming the
  // project (spec Behaviour 9), which is the not-configured state; every other
  // rejection is surfaced as its typed message inline — never a silent drop.
  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    setError(null)
    try {
      const next = await app.kanban.listBoard(projectId)
      setBoard(next)
      // A refresh that drops the open item closes the review. A ref that is
      // still on the board stays open, including across the first load (null).
      setReviewRef((current) =>
        current !== null && next.items.some((entry) => entry.ref === current) ? current : null,
      )
      // A board with items but no states is not empty: those items still
      // render in unmatched-state columns (see boardColumns), so the empty
      // state only fires when there is genuinely nothing to show.
      setPhase(next.states.length === 0 && next.items.length === 0 ? 'empty' : 'ready')
    } catch (cause) {
      const payload = parseAppErrorPayload(cause)
      if (payload?.code === 'validation') {
        setPhase('not-configured')
        return
      }
      setError(payload?.message ?? 'Failed to load the Kanban board.')
      setPhase('error')
    }
  }, [app, projectId])

  // Lazy: the host mounts this surface only when the Kanban tab is selected,
  // so this effect is the single load on first selection. `load` is stable for
  // one (app, projectId) pair, so re-renders never re-fire it.
  useEffect(() => {
    void load()
  }, [load])

  const reviewItem =
    phase === 'ready' && reviewRef !== null
      ? (board.items.find((entry) => entry.ref === reviewRef) ?? null)
      : null

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-xs"
      data-testid={TEST_ID.kanbanBoard}
    >
      <div className="sticky top-0 z-10 -mx-3 mb-3 flex shrink-0 items-center gap-2 bg-app px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">Kanban</h2>
        {/* View switch and refresh sit on the right (user request 2026-10-05);
            both are icon controls carrying accessible names (UX-UI §63). */}
        <div className="ml-auto flex items-center gap-1">
          {phase === 'ready' ? (
            <fieldset className="flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">Kanban view</legend>
              <button
                type="button"
                className={viewButtonClass(view === 'board')}
                aria-label="Board view"
                aria-pressed={view === 'board'}
                title="Board"
                data-testid={TEST_ID.kanbanViewBoard}
                onClick={() => {
                  setView('board')
                  setReviewRef(null)
                }}
              >
                <Icon.board size={14} aria-hidden />
              </button>
              <button
                type="button"
                className={viewButtonClass(view === 'list')}
                aria-label="List view"
                aria-pressed={view === 'list'}
                title="List"
                data-testid={TEST_ID.kanbanViewList}
                onClick={() => {
                  setView('list')
                  setReviewRef(null)
                }}
              >
                <Icon.list size={14} aria-hidden />
              </button>
            </fieldset>
          ) : null}
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            aria-label="Refresh"
            title="Refresh"
            data-testid={TEST_ID.kanbanBoardRefresh}
            disabled={phase === 'loading'}
            onClick={() => {
              void load()
            }}
          >
            <Icon.retry size={14} aria-hidden />
          </button>
        </div>
      </div>
      {phase === 'loading' ? (
        <p
          className="text-xs text-ink-secondary"
          role="status"
          data-testid={TEST_ID.kanbanBoardLoading}
        >
          Loading board…
        </p>
      ) : null}
      {phase === 'not-configured' ? (
        <div className="text-xs" data-testid={TEST_ID.kanbanBoardUnconfigured}>
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
      {phase === 'error' ? (
        <p role="alert" className="text-xs text-error" data-testid={TEST_ID.kanbanBoardError}>
          {error}
        </p>
      ) : null}
      {phase === 'empty' ? (
        <p className="text-xs text-ink-secondary" data-testid={TEST_ID.kanbanBoardEmpty}>
          This board has no states yet.
        </p>
      ) : null}
      {reviewItem !== null ? (
        <ItemReview
          item={reviewItem}
          onBack={() => {
            setReviewRef(null)
          }}
        />
      ) : null}
      {phase === 'ready' && reviewItem === null && view === 'board' ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
          {boardColumns(board).map((column) => (
            <section
              key={column.stateId}
              className="flex w-56 shrink-0 flex-col rounded border border-edge p-2"
              data-testid={testIdFor.kanbanColumn(column.stateId)}
            >
              <h3 className="mb-2 border-b border-edge pb-1 text-xs font-semibold text-ink">
                {column.name}
              </h3>
              <ul className="space-y-1">
                {column.items.map((item) => (
                  <li key={item.ref}>
                    <WorkItemButton
                      item={item}
                      layout="card"
                      onOpen={(ref) => {
                        setReviewRef(ref)
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {phase === 'ready' && reviewItem === null && view === 'list' ? (
        <div className="flex min-w-0 flex-col gap-3" data-testid={TEST_ID.kanbanList}>
          {boardColumns(board).map((column) => (
            <section key={column.stateId} data-testid={testIdFor.kanbanListGroup(column.stateId)}>
              <h3 className="mb-1 border-b border-edge pb-1 text-xs font-semibold text-ink">
                {column.name}
              </h3>
              <ul className="space-y-1">
                {column.items.map((item) => (
                  <li key={item.ref}>
                    <WorkItemButton
                      item={item}
                      layout="row"
                      onOpen={(ref) => {
                        setReviewRef(ref)
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
