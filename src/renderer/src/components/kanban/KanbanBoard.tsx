import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

// Read-only Kanban board surface (spec kanban-adapter-interface Behaviour 14,
// AC14): one plain column per adapter state, ordered by the adapter's `order`
// sort key, each headed by the state name with the item titles listed
// underneath. The board loads lazily — exactly one `kanban:listBoard` call
// when the surface mounts (the host mounts it only while the Kanban tab is
// selected) — and the refresh control re-runs that one load. Loading, typed
// error, empty board and not-configured states are inline text; the
// not-configured state offers Configure (Project Settings on its Kanban tab),
// mirroring the Resume picker's affordance. Read-only: no card components, no
// metadata, no drag-and-drop (spec Non-goals).

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

export function KanbanBoard({ app, projectId, onConfigure }: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-xs"
      data-testid={TEST_ID.kanbanBoard}
    >
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Kanban</h2>
        <button
          type="button"
          className="h-control rounded-md px-3 text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:opacity-50"
          data-testid={TEST_ID.kanbanBoardRefresh}
          disabled={phase === 'loading'}
          onClick={() => {
            void load()
          }}
        >
          Refresh
        </button>
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
      {phase === 'ready' ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
          {boardColumns(board).map((column) => (
            <section
              key={column.stateId}
              className="flex w-48 shrink-0 flex-col rounded border border-edge p-2"
              data-testid={testIdFor.kanbanColumn(column.stateId)}
            >
              <h3 className="mb-2 border-b border-edge pb-1 text-xs font-semibold text-ink">
                {column.name}
              </h3>
              <ul className="space-y-1">
                {column.items.map((item) => (
                  <li
                    key={item.ref}
                    className="truncate text-xs text-ink-secondary"
                    title={item.title}
                    data-testid={testIdFor.kanbanItem(item.ref)}
                  >
                    {item.title}
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
