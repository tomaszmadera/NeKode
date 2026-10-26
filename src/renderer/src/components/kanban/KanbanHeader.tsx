import type React from 'react'
import { useEffect, useRef } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { KanbanSearch } from './KanbanSearch'
import type {
  KanbanBoardPhase,
  KanbanSortBy,
  KanbanSortDirection,
  KanbanToolbarControls,
} from './kanban-board-logic'

// Internal board header, rendered when no host toolbar takes the controls.
// Back sits immediately after the title while the review is open and uses
// the bordered style of Back to Projects. When the board is ready and the
// review is closed, the header shows New task (a bordered button with a plus
// before the label), the search, and the sort controls. Refresh sits on the
// right with an accessible name (UX-UI §63).

/** Header icon control without a selected state (refresh). */
const ICON_BUTTON_CLASS =
  'flex size-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink disabled:opacity-50'

export type KanbanHeaderProps = KanbanToolbarControls

export function KanbanHeader({
  phase,
  refreshing,
  isReviewing,
  creatingBusy,
  sortState,
  searchQuery,
  onSearchQueryChange,
  onSortByChange,
  onToggleSortDirection,
  onRefresh,
  onNewTask,
  onCloseReview,
}: KanbanHeaderProps): React.JSX.Element {
  const listControls = phase === 'ready' && !isReviewing
  return (
    <div className="sticky top-0 z-10 -mx-3 mb-3 flex shrink-0 items-center gap-2 bg-app px-3 py-2">
      <h2 className="text-[14.7px] font-semibold text-ink">Tasks</h2>
      {isReviewing ? (
        <button
          type="button"
          className="no-drag flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid={TEST_ID.kanbanReviewBack}
          aria-label="Back"
          title="Back"
          onClick={onCloseReview}
        >
          <Icon.back size={12} aria-hidden />
          Back
        </button>
      ) : null}
      {listControls ? (
        <button
          type="button"
          className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-edge bg-panel px-2 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          data-testid={TEST_ID.kanbanNewTask}
          disabled={creatingBusy}
          onClick={onNewTask}
        >
          <Icon.plus size={14} aria-hidden />
          New task
        </button>
      ) : null}
      {listControls ? (
        <KanbanSearch query={searchQuery} onQueryChange={onSearchQueryChange} />
      ) : null}
      {/* Refresh sits on the right (UX-UI §63). */}
      <div className="ml-auto flex items-center gap-1">
        {listControls ? (
          <div className="mr-1 flex items-center gap-1">
            <label htmlFor="kanban-sort-by" className="sr-only">
              Sort by
            </label>
            <select
              id="kanban-sort-by"
              className="h-6 rounded border border-edge bg-app px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={sortState.sortBy}
              onChange={(event) => {
                onSortByChange(event.target.value as KanbanSortBy)
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
              onClick={onToggleSortDirection}
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
          onClick={onRefresh}
        >
          <Icon.retry size={14} aria-hidden className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </div>
    </div>
  )
}

/**
 * Reports the header controls to an external toolbar host (e.g. ActionBar)
 * instead of rendering KanbanHeader. A report goes out only when a shown value
 * changes; an inactive or unmounted board reports null once.
 */
export function useKanbanToolbarBridge(
  onToolbarControls: ((controls: KanbanToolbarControls | null) => void) | undefined,
  active: boolean,
  controls: KanbanToolbarControls,
): void {
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
    searchQuery: string
  } | null>(null)
  const {
    phase,
    refreshing,
    isReviewing,
    creatingBusy,
    sortState,
    searchQuery,
    onSearchQueryChange,
    onSortByChange,
    onToggleSortDirection,
    onRefresh,
    onNewTask,
    onCloseReview,
  } = controls

  useEffect(() => {
    if (!onToolbarControlsRef.current) return
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
      prev.direction === sortState.direction &&
      prev.searchQuery === searchQuery
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
      searchQuery,
    }
    onToolbarControlsRef.current({
      phase,
      refreshing,
      isReviewing,
      creatingBusy,
      sortState,
      searchQuery,
      onSearchQueryChange,
      onSortByChange,
      onToggleSortDirection,
      onRefresh,
      onNewTask,
      onCloseReview,
    })
  }, [
    active,
    phase,
    refreshing,
    isReviewing,
    creatingBusy,
    sortState,
    searchQuery,
    onSearchQueryChange,
    onSortByChange,
    onToggleSortDirection,
    onRefresh,
    onNewTask,
    onCloseReview,
  ])

  useEffect(() => {
    return () => {
      if (lastReportedRef.current !== null) {
        lastReportedRef.current = null
        onToolbarControlsRef.current?.(null)
      }
    }
  }, [])
}
