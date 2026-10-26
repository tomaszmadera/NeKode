import type { KanbanBoard as KanbanBoardData, KanbanPriority, WorkItem } from '@shared/ipc-contract'

/** One rendered column: a state with the items that belong to it. */
export interface KanbanColumn {
  stateId: string
  name: string
  items: WorkItem[]
}

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

export function workItemsMatch(left: WorkItem, right: WorkItem): boolean {
  return (Object.keys(right) as (keyof WorkItem)[]).every((key) => left[key] === right[key])
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
      return old !== undefined && workItemsMatch(old, item) ? old : item
    }),
  }
}

/** Replace the item with this ref, or append it once. Equal fields keep the stored object. */
export function upsertWorkItem(items: WorkItem[], created: WorkItem): WorkItem[] {
  const index = items.findIndex((entry) => entry.ref === created.ref)
  if (index === -1) return [...items, created]
  if (workItemsMatch(items[index], created)) return items
  const next = items.slice()
  next[index] = created
  return next
}

/** Creates fill omitted refs. Status updates replace that same ref. */
export function reconcileKeepingCreates(
  previous: KanbanBoardData,
  next: KanbanBoardData,
  keptCreates: readonly WorkItem[],
  keptUpdates: readonly WorkItem[],
): KanbanBoardData {
  const reconciled = reconcileBoard(previous, next)
  if (keptCreates.length === 0 && keptUpdates.length === 0) return reconciled
  let items = reconciled.items
  for (const created of keptCreates) {
    items = upsertWorkItem(items, created)
  }
  for (const updated of keptUpdates) {
    items = upsertWorkItem(items, updated)
  }
  return items === reconciled.items ? reconciled : { ...reconciled, items }
}

export interface ReconcileBoardResponseInput {
  /** Previously displayed board state in the renderer. */
  previousBoard: KanbanBoardData
  /** Incoming board snapshot returned by listBoard IPC. */
  incomingBoard: KanbanBoardData
  /** Items successfully created while this listBoard was in-flight. */
  retainedCreates?: readonly WorkItem[]
  /** Items successfully updated while this listBoard was in-flight. */
  retainedUpdates?: readonly WorkItem[]
  /** Currently open item ref in review mode, or null if review is closed. */
  currentReviewRef?: string | null
}

export interface ReconcileBoardResponseResult {
  /** The reconciled board preserving object identity for unchanged records and applying retained writes. */
  board: KanbanBoardData
  /** Review ref after reconciliation (null if the open item was dropped). */
  reviewRef: string | null
  /** Reconciled display phase: 'empty' if 0 states and 0 visible items, otherwise 'ready'. */
  phase: 'ready' | 'empty'
  /** Created items that had to be filled in because the incoming snapshot omitted them. */
  keptCreates: WorkItem[]
  /** Updated items that were applied on top of the incoming snapshot. */
  keptUpdates: WorkItem[]
  /** Total count of visible items across columns. */
  visibleItemCount: number
}

/**
 * Pure state reconciliation for concurrent IPC responses in KanbanBoard (C.5).
 * Reconciles an incoming listBoard response with concurrent in-flight creates and updates:
 * - Creates that succeeded while listBoard was in-flight and are omitted by the snapshot are preserved.
 * - Updates that succeeded while listBoard was in-flight replace the older snapshot record.
 * - An open review remains open if its ref survives in the reconciled board; otherwise closes.
 * - Display phase correctly reports 'empty' only when states and visible items are both zero.
 */
export function reconcileBoardResponse({
  previousBoard,
  incomingBoard,
  retainedCreates = [],
  retainedUpdates = [],
  currentReviewRef = null,
}: ReconcileBoardResponseInput): ReconcileBoardResponseResult {
  const keptCreates = retainedCreates.filter(
    (entry) => !incomingBoard.items.some((item) => item.ref === entry.ref),
  )
  const keptUpdatesList = [...retainedUpdates]
  const keptUpdateExtras = keptUpdatesList.filter(
    (entry) =>
      !incomingBoard.items.some((item) => item.ref === entry.ref) &&
      !keptCreates.some((created) => created.ref === entry.ref),
  )
  const board = reconcileKeepingCreates(previousBoard, incomingBoard, keptCreates, keptUpdatesList)

  const visibleRefs = new Set<string>([
    ...incomingBoard.items.map((entry) => entry.ref),
    ...keptCreates.map((entry) => entry.ref),
    ...keptUpdatesList.map((entry) => entry.ref),
  ])
  const reviewRef =
    currentReviewRef !== null && visibleRefs.has(currentReviewRef) ? currentReviewRef : null

  const visibleItemCount = incomingBoard.items.length + keptCreates.length + keptUpdateExtras.length
  const phase = incomingBoard.states.length === 0 && visibleItemCount === 0 ? 'empty' : 'ready'

  return {
    board,
    reviewRef,
    phase,
    keptCreates,
    keptUpdates: keptUpdatesList,
    visibleItemCount,
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
