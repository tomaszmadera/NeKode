import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppApi,
  HandoffRejection,
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
// slug), a truncated title, and the priority. Opening the ref or the title
// replaces that view with a review: the same fields, the state name, the title
// in full, and the description. The review reads the loaded board; it does not call another
// action. The header's right side carries the icon controls (user request
// 2026-10-05): a List | Board switch and the refresh icon, each with an
// accessible name (UX-UI §63). The surface loads lazily: exactly one
// `kanban:listBoard` call on first activation. The host retains each visited
// project session while hidden; activation and Refresh share a background load.
// Loading, typed error, empty board and not-configured states are inline text;
// the not-configured state offers Configure (Project Settings on its Kanban
// tab), mirroring the Resume picker's affordance. No drag-and-drop. Start is
// always shown; Resume renders only for an item the batch handoff check proved
// available. Neither control opens the review: Start asks the host to open the
// launch confirmation, Resume asks the host to open the handoff confirmation.
// Neither launches from the board.

/** Inline render phase of the board. */
export type KanbanBoardPhase = 'loading' | 'ready' | 'error' | 'not-configured' | 'empty'

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
   * every item, regardless of handoff availability.
   */
  onStart?: (item: WorkItem) => void
  /**
   * Opens the Resume and handoff confirmation in the app shell. Resume is a
   * row control shown only for an item the batch handoff check proved
   * available.
   */
  onResume?: (item: WorkItem) => void
  /** Hidden retained sessions never initiate requests. */
  active?: boolean
}

/** One rendered column: a state with the items that belong to it. */
export interface KanbanColumn {
  stateId: string
  name: string
  items: WorkItem[]
}

/** Which arrangement of the loaded items is on screen. List is the default. */
type KanbanSurfaceView = 'board' | 'list'

export type KanbanSortBy = 'slug' | 'priority'
export type KanbanSortDirection = 'asc' | 'desc'

export const PRIORITY_RANK: Record<KanbanPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

export const PRIORITY_NONE_RANK = 5

export function compareRefs(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareWorkItems(
  a: WorkItem,
  b: WorkItem,
  sortBy: KanbanSortBy,
  direction: KanbanSortDirection,
): number {
  let diff = 0
  if (sortBy === 'priority') {
    const rankA = a.priority !== null ? PRIORITY_RANK[a.priority] : PRIORITY_NONE_RANK
    const rankB = b.priority !== null ? PRIORITY_RANK[b.priority] : PRIORITY_NONE_RANK
    diff = rankA - rankB
  }
  if (diff === 0) {
    diff = compareRefs(a.ref, b.ref)
  }
  return direction === 'asc' ? diff : -diff
}

export function sortWorkItems(
  items: readonly WorkItem[],
  sortBy: KanbanSortBy,
  direction: KanbanSortDirection,
): WorkItem[] {
  return [...items].sort((a, b) => compareWorkItems(a, b, sortBy, direction))
}

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

const ITEM_CONTROL_CLASS =
  'rounded-md px-1.5 py-0.5 text-left hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Border box of a single-line list row before this split: 26.9px.
 * Electron, default theme, deviceScaleFactor 1. The row is 1.5× that height.
 */
const LIST_ROW_MIN_HEIGHT_PX = 40.35

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
    <span className="inline-flex w-24 shrink-0 justify-end text-ink-secondary">
      <span className="sr-only">Priority </span>
      <span>{priorityLabel(priority)}</span>
    </span>
  )
}

function ItemRefButton({
  item,
  onOpen,
}: {
  item: WorkItem
  onOpen: (ref: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${ITEM_CONTROL_CLASS} shrink-0 font-medium text-ink`}
      data-testid={testIdFor.kanbanItemRef(item.ref)}
      onClick={() => {
        onOpen(item.ref)
      }}
    >
      {item.ref}
    </button>
  )
}

function ItemTitleButton({
  item,
  onOpen,
}: {
  item: WorkItem
  onOpen: (ref: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${ITEM_CONTROL_CLASS} min-w-32 max-w-full flex-1 truncate text-ink-secondary`}
      data-testid={testIdFor.kanbanItemTitle(item.ref)}
      onClick={() => {
        onOpen(item.ref)
      }}
    >
      {item.title}
    </button>
  )
}

/** Start stays visible. Resume only when the item has a confirmed handoff. */
function ItemLaunchButtons({
  item,
  resumeEnabled,
  onStart,
  onResume,
}: {
  item: WorkItem
  resumeEnabled: boolean
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        className={`${ITEM_CONTROL_CLASS} text-ink`}
        data-testid={testIdFor.kanbanItemStart(item.ref)}
        onClick={() => {
          onStart?.(item)
        }}
      >
        Start
      </button>
      {resumeEnabled ? (
        <button
          type="button"
          className={`${ITEM_CONTROL_CLASS} text-ink`}
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

/** Board card or list row. Only the ref and the title open the review. */
function WorkItemSurface({
  item,
  layout,
  resumeEnabled,
  onOpen,
  onStart,
  onResume,
}: {
  item: WorkItem
  layout: 'card' | 'row'
  resumeEnabled: boolean
  onOpen: (ref: string) => void
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
}): React.JSX.Element {
  if (layout === 'card') {
    return (
      <div className="w-full rounded-md px-1.5 py-1" data-testid={testIdFor.kanbanItem(item.ref)}>
        <div className="flex items-baseline justify-between gap-2">
          <ItemRefButton item={item} onOpen={onOpen} />
          <PriorityText priority={item.priority} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ItemLaunchButtons
            item={item}
            resumeEnabled={resumeEnabled}
            onStart={onStart}
            onResume={onResume}
          />
          <ItemTitleButton item={item} onOpen={onOpen} />
        </div>
      </div>
    )
  }
  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1"
      style={{ minHeight: LIST_ROW_MIN_HEIGHT_PX }}
      data-testid={testIdFor.kanbanItem(item.ref)}
    >
      <ItemRefButton item={item} onOpen={onOpen} />
      <ItemTitleButton item={item} onOpen={onOpen} />
      <PriorityText priority={item.priority} />
      <ItemLaunchButtons
        item={item}
        resumeEnabled={resumeEnabled}
        onStart={onStart}
        onResume={onResume}
      />
    </div>
  )
}

function ItemReview({ item, onBack }: { item: WorkItem; onBack: () => void }): React.JSX.Element {
  return (
    <article className="min-w-0" data-testid={TEST_ID.kanbanReview}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-control rounded-md px-3 text-[12.6px] text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          data-testid={TEST_ID.kanbanReviewBack}
          onClick={onBack}
        >
          Back
        </button>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="font-medium text-ink">{item.ref}</p>
        <PriorityText priority={item.priority} />
      </div>
      <p className="text-ink-secondary">{item.stateName}</p>
      <h3
        className="mt-2 whitespace-pre-wrap break-words text-[14.7px] font-semibold text-ink"
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

/**
 * Inline handoff-directory notices beneath the board header (spec Dostępność
 * Resume pkt 3-4): an unconfigured directory offers Configure handoffs, a read
 * failure is its own state with Retry, and rejected files are named warnings.
 * A read failure never removes the loaded board; the notices render above it.
 */
function HandoffNotices({
  phase,
  error,
  warnings,
  showEmpty,
  onConfigureHandoffs,
  onRetry,
}: {
  phase: 'not-configured' | 'error' | 'ready'
  error: string | null
  warnings: HandoffRejection[]
  showEmpty: boolean
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
  return (
    <>
      {warnings.length > 0 ? (
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
      ) : null}
      {showEmpty ? (
        <p
          className="mb-3 text-[12.6px] text-ink-secondary"
          data-testid={TEST_ID.kanbanHandoffEmpty}
        >
          No handoffs match the loaded items.
        </p>
      ) : null}
    </>
  )
}

/** Retain unchanged normalized records; React keys retain same-group DOM nodes. */
export function reconcileBoard(previous: KanbanBoardData, next: KanbanBoardData): KanbanBoardData {
  const items = new Map(previous.items.map((item) => [item.ref, item]))
  const states = new Map(previous.states.map((state) => [state.id, state]))
  return {
    states: next.states.map((state) => {
      const old = states.get(state.id)
      return old !== undefined &&
        old.name === state.name &&
        old.group === state.group &&
        old.order === state.order
        ? old
        : state
    }),
    items: next.items.map((item) => {
      const old = items.get(item.ref)
      return old !== undefined &&
        (Object.keys(item) as (keyof WorkItem)[]).every((key) => old[key] === item[key])
        ? old
        : item
    }),
  }
}

export const KANBAN_COLLAPSED_STORAGE_KEY_PREFIX = 'nekode.kanban-collapsed-states.v1'

export function kanbanCollapsedStorageKey(projectId: string): string {
  return `${KANBAN_COLLAPSED_STORAGE_KEY_PREFIX}.${projectId}`
}

export function parseCollapsedStateIds(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return new Set(parsed)
    }
  } catch {
    // Malformed JSON falls back safely to empty set
  }
  return new Set()
}

export function loadCollapsedStateIds(projectId: string): Set<string> {
  try {
    return parseCollapsedStateIds(localStorage.getItem(kanbanCollapsedStorageKey(projectId)))
  } catch {
    return new Set()
  }
}

export function saveCollapsedStateIds(projectId: string, ids: Set<string>): void {
  try {
    if (ids.size === 0) {
      localStorage.removeItem(kanbanCollapsedStorageKey(projectId))
    } else {
      localStorage.setItem(kanbanCollapsedStorageKey(projectId), JSON.stringify([...ids]))
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export const KANBAN_SORT_STORAGE_KEY_PREFIX = 'nekode.kanban-sort.v1'

export function kanbanSortStorageKey(projectId: string): string {
  return `${KANBAN_SORT_STORAGE_KEY_PREFIX}.${projectId}`
}

export interface KanbanSortState {
  sortBy: KanbanSortBy
  direction: KanbanSortDirection
}

export const DEFAULT_KANBAN_SORT: KanbanSortState = {
  sortBy: 'slug',
  direction: 'asc',
}

export function parseKanbanSort(raw: string | null): KanbanSortState {
  if (raw === null) return DEFAULT_KANBAN_SORT
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const candidate = parsed as Record<string, unknown>
      const sortBy: KanbanSortBy = candidate.sortBy === 'priority' ? 'priority' : 'slug'
      const direction: KanbanSortDirection = candidate.direction === 'desc' ? 'desc' : 'asc'
      return { sortBy, direction }
    }
  } catch {
    // Malformed JSON falls back safely
  }
  return DEFAULT_KANBAN_SORT
}

export function loadKanbanSort(projectId: string): KanbanSortState {
  try {
    return parseKanbanSort(localStorage.getItem(kanbanSortStorageKey(projectId)))
  } catch {
    return DEFAULT_KANBAN_SORT
  }
}

export function saveKanbanSort(projectId: string, state: KanbanSortState): void {
  try {
    localStorage.setItem(kanbanSortStorageKey(projectId), JSON.stringify(state))
  } catch {
    // Ignore storage quota or access errors
  }
}

export function KanbanBoard({
  app,
  projectId,
  onConfigure,
  onConfigureHandoffs,
  onStart,
  onResume,
  active = true,
}: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<KanbanSurfaceView>('list')
  const [reviewRef, setReviewRef] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsedStates, setCollapsedStates] = useState<Set<string>>(() =>
    loadCollapsedStateIds(projectId),
  )
  const [sortState, setSortState] = useState<KanbanSortState>(() => loadKanbanSort(projectId))
  // Handoff availability (spec Dostępność Resume): Resume is hidden until a
  // batch check succeeds and the item has a readable accepted candidate. The
  // check runs beside the board load and never delays rendering the board.
  const [handoffPhase, setHandoffPhase] = useState<
    'loading' | 'not-configured' | 'error' | 'ready'
  >('loading')
  const [availableIds, setAvailableIds] = useState<ReadonlySet<string>>(new Set())
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffWarnings, setHandoffWarnings] = useState<HandoffRejection[]>([])
  const [handoffEmpty, setHandoffEmpty] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const handoffPending = useRef<string | null>(null)
  const handoffGeneration = useRef(0)
  const boardRef = useRef(board)
  boardRef.current = board

  useEffect(() => {
    setCollapsedStates(loadCollapsedStateIds(projectId))
    setSortState(loadKanbanSort(projectId))
    // A project change (or a direct projectId switch in a test) is a new scan
    // generation: a late response for the previous project never restores Resume.
    handoffGeneration.current += 1
    handoffPending.current = null
    setHandoffPhase('loading')
    setAvailableIds(new Set())
    setHandoffError(null)
    setHandoffWarnings([])
    setHandoffEmpty(false)
  }, [projectId])

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
    }
  }, [])

  // One batch handoff check for the loaded items: one directory read, then the
  // same snapshot matched against every item. Identical concurrent triggers
  // are coalesced; a different item set is its own generation, so an older
  // result never marks a new item available (spec Dostępność Resume pkt 6-9).
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
      setHandoffEmpty(false)
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
        setHandoffEmpty(
          result.items.length > 0 &&
            result.items.every((entry) => !entry.available) &&
            result.rejections.length === 0,
        )
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
    if (!hasSnapshot.current) setPhase('loading')
    setRefreshing(true)
    setError(null)
    try {
      const next = await app.kanban.listBoard(projectId)
      if (requestGeneration !== generation.current) return
      hasSnapshot.current = true
      setBoard((previous) => reconcileBoard(previous, next))
      // A refresh that drops the open item closes the review. A ref that is
      // still on the board stays open, including across the first load (null).
      setReviewRef((current) =>
        current !== null && next.items.some((entry) => entry.ref === current) ? current : null,
      )
      // A board with items but no states is not empty: those items still
      // render in unmatched-state columns (see boardColumns), so the empty
      // state only fires when there is genuinely nothing to show.
      setPhase(next.states.length === 0 && next.items.length === 0 ? 'empty' : 'ready')
      // Availability is checked on activation, tab return and Refresh; the
      // board render never waits for it (spec Dostępność Resume pkt 7).
      void loadHandoff(next.items.map((entry) => ({ itemId: entry.id, ref: entry.ref })))
    } catch (cause) {
      if (requestGeneration !== generation.current) return
      const payload = parseAppErrorPayload(cause)
      if (payload?.code === 'validation' || payload?.code === 'not_found') {
        hasSnapshot.current = false
        setBoard({ states: [], items: [] })
        setReviewRef(null)
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
  // Dostępność Resume pkt 2).
  const itemResumable = (item: WorkItem): boolean =>
    handoffPhase === 'ready' && availableIds.has(item.id)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-[12.6px]"
      data-testid={TEST_ID.kanbanBoard}
    >
      <div className="sticky top-0 z-10 -mx-3 mb-3 flex shrink-0 items-center gap-2 bg-app px-3 py-2">
        <h2 className="text-[14.7px] font-semibold text-ink">Kanban</h2>
        {refreshing && phase !== 'loading' ? (
          <p role="status" className="min-w-0 truncate text-[12.6px] text-ink-secondary">
            Refreshing board...
          </p>
        ) : null}
        {/* View switch and refresh sit on the right (user request 2026-10-05);
            both are icon controls carrying accessible names (UX-UI §63). */}
        <div className="ml-auto flex items-center gap-1">
          {phase === 'ready' && view === 'list' && reviewItem === null ? (
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
          {phase === 'ready' ? (
            <fieldset className="flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">Kanban view</legend>
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
            </fieldset>
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
            <Icon.retry size={14} aria-hidden />
          </button>
        </div>
      </div>
      {handoffPhase !== 'loading' ? (
        <HandoffNotices
          phase={handoffPhase}
          error={handoffError}
          warnings={handoffWarnings}
          showEmpty={handoffEmpty}
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
              className="flex w-80 shrink-0 flex-col rounded border border-edge p-2"
              data-testid={testIdFor.kanbanColumn(column.stateId)}
            >
              <h3 className="mb-2 border-b border-edge pb-1 text-[12.6px] font-semibold text-ink">
                {column.name}
              </h3>
              <ul className="space-y-1">
                {column.items.map((item) => (
                  <li key={item.ref}>
                    <WorkItemSurface
                      item={item}
                      layout="card"
                      resumeEnabled={itemResumable(item)}
                      onOpen={(ref) => {
                        setReviewRef(ref)
                      }}
                      onStart={onStart}
                      onResume={onResume}
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
                          layout="row"
                          resumeEnabled={itemResumable(item)}
                          onOpen={(ref) => {
                            setReviewRef(ref)
                          }}
                          onStart={onStart}
                          onResume={onResume}
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
    </div>
  )
}
