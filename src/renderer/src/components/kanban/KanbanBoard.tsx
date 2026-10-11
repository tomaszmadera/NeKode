import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppApi,
  HandoffRejection,
  KanbanBoard as KanbanBoardData,
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
// List is the default: the same items grouped under the state names. Board is
// one column per adapter state, ordered by `order`. Both show one underlined
// link of the ref (Plane slug) and the title, plus the priority. The list link
// truncates; the card link wraps. Opening the link replaces that view with a
// review. Ref, priority, the full title, and the description stay read-only.
// Status lists board.states in adapter order. Its label and stateRef value are
// state.name. A change calls the existing `kanban:updateItem` with only
// stateRef. Success replaces that item by ref and leaves the review open on
// the returned item. Failure restores the confirmed state name and shows the
// error on the review. The select stays disabled and ignores another change
// until that update settles, so the first success is not dropped. A `listBoard`
// already in flight keeps that updated item as the one copy, including when its
// snapshot still has the old item. A later refresh still drops an absent ref.
// When the board is ready and the review is
// closed, the header shows
// New task on List and Board. The form under the header calls the existing
// `kanban:createItem` with title, stateRef, and an optional description, then
// upserts the returned item by ref and sends no priority. A `listBoard` already
// in flight keeps that ref when its snapshot omits it. A later refresh still
// drops an absent ref. The header's right side
// carries the icon controls (user request
// 2026-10-05): a List | Board switch and the refresh icon, each with an
// accessible name (UX-UI §63). The surface loads lazily: exactly one
// `kanban:listBoard` call on first activation. The host retains each visited
// project session while hidden; activation and Refresh share a background load.
// Loading, typed error, empty board and not-configured states are inline text;
// the not-configured state offers Configure (Project Settings on its Kanban
// tab), mirroring the Resume picker's affordance. No drag-and-drop. Start is
// always shown and disabled when Resume is shown. Resume renders only for an
// item the batch handoff check proved available. Neither control opens the
// review: Start asks the host to open the
// launch confirmation, Resume asks the host to open the handoff confirmation.
// Neither launches from the board. The link menu copies the ref or `WorkItem.url`
// through the renderer clipboard. It does not build a Plane address, and it does
// not open on Start, Resume, priority, or the card background.

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
   * every item, and disabled when Resume is shown.
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

const COPY_FAILED = 'Could not copy to the clipboard.'

const MENU_ITEM_CLASS =
  'w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent'

/** Renderer clipboard (typed locally so tests can stub navigator.clipboard). */
function navigatorClipboard(): { writeText(text: string): Promise<void> } | null {
  return typeof navigator !== 'undefined' && navigator.clipboard !== null
    ? navigator.clipboard
    : null
}

function blankUrl(url: string | null): boolean {
  return url === null || url.trim() === ''
}

function linkLayoutClass(layout: 'card' | 'row'): string {
  if (layout === 'row') return 'min-w-0 max-w-full flex-1 truncate'
  return 'min-w-0 flex-1 whitespace-normal break-words'
}

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

function ItemLink({
  item,
  layout,
  onOpen,
  onOpenMenu,
}: {
  item: WorkItem
  layout: 'card' | 'row'
  onOpen: (ref: string) => void
  onOpenMenu: (item: WorkItem, x: number, y: number) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${ITEM_CONTROL_CLASS} ${linkLayoutClass(layout)} text-ink underline`}
      data-testid={testIdFor.kanbanItemLink(item.ref)}
      onClick={() => {
        onOpen(item.ref)
      }}
      onKeyDown={(event) => {
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
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu(item, event.clientX, event.clientY)
      }}
    >
      {`${item.ref} ${item.title}`}
    </button>
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

/** Start stays visible and is disabled while a confirmed handoff shows Resume. */
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
        className={`${ITEM_CONTROL_CLASS} text-ink disabled:pointer-events-none disabled:opacity-50`}
        data-testid={testIdFor.kanbanItemStart(item.ref)}
        disabled={resumeEnabled}
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

/** Board card or list row. Only the link opens the review. */
function WorkItemSurface({
  item,
  layout,
  resumeEnabled,
  onOpen,
  onOpenMenu,
  onStart,
  onResume,
}: {
  item: WorkItem
  layout: 'card' | 'row'
  resumeEnabled: boolean
  onOpen: (ref: string) => void
  onOpenMenu: (item: WorkItem, x: number, y: number) => void
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
}): React.JSX.Element {
  if (layout === 'card') {
    return (
      <div className="w-full rounded-md px-1.5 py-1" data-testid={testIdFor.kanbanItem(item.ref)}>
        <div className="flex items-baseline justify-between gap-2">
          <ItemLink item={item} layout="card" onOpen={onOpen} onOpenMenu={onOpenMenu} />
          <PriorityText priority={item.priority} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ItemLaunchButtons
            item={item}
            resumeEnabled={resumeEnabled}
            onStart={onStart}
            onResume={onResume}
          />
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
      <ItemLink item={item} layout="row" onOpen={onOpen} onOpenMenu={onOpenMenu} />
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

const NEW_TASK_FIELD_CLASS =
  'w-full rounded-md border border-edge bg-app px-3 text-[12.6px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function ItemReview({
  item,
  states,
  statusValue,
  statusError,
  statusDisabled,
  onBack,
  onStatusChange,
}: {
  item: WorkItem
  states: readonly KanbanState[]
  statusValue: string
  statusError: string | null
  statusDisabled: boolean
  onBack: () => void
  onStatusChange: (stateName: string) => void
}): React.JSX.Element {
  const ordered = statesInAdapterOrder(states)
  const names = new Set(ordered.map((state) => state.name))
  const extras = [item.stateName, statusValue].filter(
    (name, index, all) => !names.has(name) && all.indexOf(name) === index,
  )
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
      <div className="mt-3 flex flex-col gap-1">
        <label className="text-ink-secondary" htmlFor={TEST_ID.kanbanReviewStatus}>
          Status
        </label>
        <select
          id={TEST_ID.kanbanReviewStatus}
          className={`h-control ${NEW_TASK_FIELD_CLASS} disabled:opacity-50`}
          data-testid={TEST_ID.kanbanReviewStatus}
          value={statusValue}
          disabled={statusDisabled}
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
      return old !== undefined && workItemsMatch(old, item) ? old : item
    }),
  }
}

function workItemsMatch(left: WorkItem, right: WorkItem): boolean {
  return (Object.keys(right) as (keyof WorkItem)[]).every((key) => left[key] === right[key])
}

/** Replace the item with this ref, or append it once. Equal fields keep the stored object. */
function upsertWorkItem(items: WorkItem[], created: WorkItem): WorkItem[] {
  const index = items.findIndex((entry) => entry.ref === created.ref)
  if (index === -1) return [...items, created]
  if (workItemsMatch(items[index], created)) return items
  const next = items.slice()
  next[index] = created
  return next
}

/** Creates fill omitted refs. Status updates replace that same ref. */
function reconcileKeepingCreates(
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

interface NewTaskDraft {
  stateRef: string
  title: string
  description: string
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

function updateFailureMessage(cause: unknown): string {
  const payload = parseAppErrorPayload(cause)
  if (payload !== null) return payload.message
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message
  return 'Could not update the status.'
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
        if (event.key !== 'Escape') return
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
          className="h-control rounded-md px-4 text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          data-testid={TEST_ID.kanbanNewTaskCancel}
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
  onResume,
  active = true,
}: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<KanbanSurfaceView>('list')
  const [reviewRef, setReviewRef] = useState<string | null>(null)
  const [copyMenu, setCopyMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null)
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
  const [draft, setDraft] = useState<NewTaskDraft | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [statusChoice, setStatusChoice] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
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
  const statusGeneration = useRef(0)
  const statusBusy = useRef(false)
  const boardRef = useRef(board)
  const projectRef = useRef(projectId)
  const shownReviewRef = useRef<string | null>(null)
  boardRef.current = board
  projectRef.current = projectId
  shownReviewRef.current = reviewRef

  const closeNewTask = useCallback(() => {
    createGeneration.current += 1
    createBusy.current = false
    setCreatingBusy(false)
    setDraft(null)
    setCreateError(null)
  }, [])

  useEffect(() => {
    setCollapsedStates(loadCollapsedStateIds(projectId))
    setSortState(loadKanbanSort(projectId))
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    // The previous project's status write must not keep this select locked.
    statusBusy.current = false
    setUpdatingStatus(false)
    // A project change (or a direct projectId switch in a test) is a new scan
    // generation: a late response for the previous project never restores Resume.
    handoffGeneration.current += 1
    handoffPending.current = null
    setHandoffPhase('loading')
    setAvailableIds(new Set())
    setHandoffError(null)
    setHandoffWarnings([])
    setHandoffEmpty(false)
  }, [projectId, closeNewTask])

  useEffect(() => {
    if (phase !== 'ready') closeNewTask()
  }, [phase, closeNewTask])

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
      const keptCreates = retained.filter(
        (entry) => !next.items.some((item) => item.ref === entry.ref),
      )
      const keptUpdates = retainedUpdates.current.get(requestId) ?? []
      retainedUpdates.current.delete(requestId)
      const keptUpdateExtras = keptUpdates.filter(
        (entry) =>
          !next.items.some((item) => item.ref === entry.ref) &&
          !keptCreates.some((created) => created.ref === entry.ref),
      )
      setBoard((previous) => reconcileKeepingCreates(previous, next, keptCreates, keptUpdates))
      // A refresh that drops the open item closes the review. A ref kept by an
      // in-flight create or status update stays open. The first load has no
      // open review.
      const visibleRefs = new Set<string>([
        ...next.items.map((entry) => entry.ref),
        ...keptCreates.map((entry) => entry.ref),
        ...keptUpdates.map((entry) => entry.ref),
      ])
      setReviewRef((current) => (current !== null && visibleRefs.has(current) ? current : null))
      // A board with items but no states is not empty: those items still
      // render in unmatched-state columns (see boardColumns), so the empty
      // state only fires when there is genuinely nothing to show.
      const visibleItemCount = next.items.length + keptCreates.length + keptUpdateExtras.length
      setPhase(next.states.length === 0 && visibleItemCount === 0 ? 'empty' : 'ready')
      // Availability is checked on activation, tab return and Refresh; the
      // board render never waits for it (spec Dostępność Resume pkt 7).
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

  const openNewTask = (): void => {
    if (draft !== null) return
    setCreateError(null)
    setDraft({
      stateRef: defaultNewTaskStateRef(board.states),
      title: '',
      description: '',
    })
  }

  async function submitNewTask(): Promise<void> {
    if (draft === null || createBusy.current) return
    const title = draft.title
    const stateRef = draft.stateRef
    const description = draft.description
    if (title.trim() === '' || stateRef.trim() === '') return
    const input: KanbanCreateInput = { title, stateRef }
    if (description.trim() !== '') input.description = description
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

  async function submitStatus(nextName: string): Promise<void> {
    // A second change must not bump the generation: that drops this success
    // before the board or retainedUpdates is updated.
    if (statusBusy.current) return
    const ref = reviewRef
    if (ref === null) return
    const current = boardRef.current.items.find((entry) => entry.ref === ref)
    if (current === undefined) return
    if (statusChoice === null && nextName === current.stateName) return
    const request = ++statusGeneration.current
    const sourceProject = projectId
    const patch: KanbanUpdatePatch = { stateRef: nextName }
    statusBusy.current = true
    setUpdatingStatus(true)
    setStatusChoice(nextName)
    setStatusError(null)
    try {
      const updated = await app.kanban.updateItem(sourceProject, ref, patch)
      if (request !== statusGeneration.current || sourceProject !== projectRef.current) return
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
        setStatusChoice(null)
        setStatusError(null)
      }
    } catch (cause) {
      if (request !== statusGeneration.current || sourceProject !== projectRef.current) return
      if (shownReviewRef.current !== ref) return
      setStatusChoice(null)
      setStatusError(updateFailureMessage(cause))
    } finally {
      if (request === statusGeneration.current) {
        statusBusy.current = false
        setUpdatingStatus(false)
      }
    }
  }

  const openReview = (ref: string): void => {
    setCopyMenu(null)
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    setReviewRef(ref)
  }

  const selectView = (next: KanbanSurfaceView): void => {
    if (next !== view) closeNewTask()
    setView(next)
    setReviewRef(null)
    setStatusChoice(null)
    setStatusError(null)
    setCopyMenu(null)
  }

  const openCopyMenu = (item: WorkItem, x: number, y: number): void => {
    setCopyMenu({ item, x, y })
  }

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
        {phase === 'ready' && reviewItem === null ? (
          <button
            type="button"
            className="h-6 shrink-0 rounded px-2 text-[12.6px] text-ink hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            data-testid={TEST_ID.kanbanNewTask}
            onClick={openNewTask}
          >
            New task
          </button>
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
                  selectView('list')
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
                  selectView('board')
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
          states={board.states}
          statusValue={statusChoice ?? reviewItem.stateName}
          statusError={statusError}
          statusDisabled={updatingStatus}
          onStatusChange={(nextName) => {
            void submitStatus(nextName)
          }}
          onBack={() => {
            setReviewRef(null)
            setStatusChoice(null)
            setStatusError(null)
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
                      onOpen={openReview}
                      onOpenMenu={openCopyMenu}
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
                          onOpen={openReview}
                          onOpenMenu={openCopyMenu}
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
    </div>
  )
}
