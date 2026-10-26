import type { KanbanPriority, WorkItem } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
  ACTION_HOVER_CLASS,
  COPY_FAILED,
  ItemLaunchButtons,
  MENU_ITEM_CLASS,
  navigatorClipboard,
  type OpenItemMenu,
} from './KanbanItemActions'
import {
  blankUrl,
  type KanbanColumn,
  type KanbanSortBy,
  type KanbanSortState,
  loadCollapsedStateIds,
  loadKanbanSort,
  PRIORITY_COLOR,
  priorityLabel,
  saveCollapsedStateIds,
  saveKanbanSort,
  sortWorkItems,
} from './kanban-board-logic'

// The board list: the items grouped under the state names, in adapter
// `order`. Each row shows the ref (Plane slug) and the title in separate
// columns, plus the priority. The title truncates in a fixed slug column.
// Hover underlines the slug, the title, enabled Start, and shown Resume; only
// those handle a click, and only the slug and the title open the review. The
// slug and title menu copies the ref or `WorkItem.url`.

/** List rows share this track so the slug and title line up across items. */
const LIST_ROW_COLUMNS = '7.5rem minmax(0, 1fr) auto auto'

const IDENTITY_CLASS =
  'w-fit max-w-full min-w-0 justify-self-start rounded-md px-0.5 py-0.5 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Border box of a single-line list row before this split: 26.9px.
 * Electron, default theme, deviceScaleFactor 1. The row is 1.5× that height.
 */
const LIST_ROW_MIN_HEIGHT_PX = 40.35

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
  onOpenMenu: OpenItemMenu,
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
  onOpenMenu: OpenItemMenu
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

/** Slug and title menu: copies the ref or `WorkItem.url` through the renderer clipboard. */
export function ItemCopyMenu({
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
  onOpenMenu: OpenItemMenu
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: OpenItemMenu
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

export interface KanbanListViewProps {
  /** Columns to show, already filtered by the search query. */
  columns: readonly KanbanColumn[]
  /** A search query is active: groups cannot collapse and empty groups are gone. */
  isFiltering: boolean
  collapsedStates: ReadonlySet<string>
  sortState: KanbanSortState
  /** Resume is shown only for an item the batch handoff check proved available. */
  itemResumable: (item: WorkItem) => boolean
  onToggleCollapse: (stateId: string) => void
  onOpen: (ref: string) => void
  onOpenMenu: OpenItemMenu
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  /** Present only when the host supports Start without sending. */
  onOpenStartMenu?: OpenItemMenu
}

export function KanbanListView({
  columns,
  isFiltering,
  collapsedStates,
  sortState,
  itemResumable,
  onToggleCollapse,
  onOpen,
  onOpenMenu,
  onStart,
  onResume,
  onOpenStartMenu,
}: KanbanListViewProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={TEST_ID.kanbanList}>
      {isFiltering && columns.length === 0 ? <p role="status">No matching tasks.</p> : null}
      {columns.map((column) => {
        const isCollapsed = !isFiltering && collapsedStates.has(column.stateId)
        const listId = `kanban-list-items-${column.stateId}`
        const sortedItems = sortWorkItems(column.items, sortState.sortBy, sortState.direction)
        return (
          <section key={column.stateId} data-testid={testIdFor.kanbanListGroup(column.stateId)}>
            <h3 className="mb-1 border-b border-edge pb-1 text-[12.6px] font-semibold text-ink">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                aria-expanded={!isCollapsed}
                disabled={isFiltering}
                aria-controls={listId}
                data-testid={testIdFor.kanbanGroupToggle(column.stateId)}
                onClick={() => {
                  onToggleCollapse(column.stateId)
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="flex shrink-0 text-ink-muted">
                    {isCollapsed ? <Icon.chevronRight size={14} /> : <Icon.chevronDown size={14} />}
                  </span>
                  <span>{column.name}</span>
                </span>
                <span className="text-sm font-normal text-ink-muted">{column.items.length}</span>
              </button>
            </h3>
            {!isCollapsed ? (
              <ul id={listId} className="space-y-1">
                {sortedItems.map((item) => (
                  <li key={item.ref}>
                    <WorkItemSurface
                      item={item}
                      resumeEnabled={itemResumable(item)}
                      onOpen={onOpen}
                      onOpenMenu={onOpenMenu}
                      onStart={onStart}
                      onResume={onResume}
                      onOpenStartMenu={onOpenStartMenu}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/**
 * Per-project list preferences persisted in localStorage: collapsed groups and
 * the sort. `reload` reads them again for a project.
 */
export function useKanbanListPrefs(projectId: string): {
  collapsedStates: ReadonlySet<string>
  sortState: KanbanSortState
  onSortByChange: (sortBy: KanbanSortBy) => void
  onToggleSortDirection: () => void
  onToggleCollapse: (stateId: string) => void
  reload: (projectId: string) => void
} {
  const [collapsedStates, setCollapsedStates] = useState<Set<string>>(() =>
    loadCollapsedStateIds(projectId),
  )
  const [sortState, setSortState] = useState<KanbanSortState>(() => loadKanbanSort(projectId))

  const reload = useCallback((nextProjectId: string) => {
    setCollapsedStates(loadCollapsedStateIds(nextProjectId))
    setSortState(loadKanbanSort(nextProjectId))
  }, [])

  const onSortByChange = useCallback(
    (nextSortBy: KanbanSortBy) => {
      setSortState((previous) => {
        const next: KanbanSortState = { ...previous, sortBy: nextSortBy }
        saveKanbanSort(projectId, next)
        return next
      })
    },
    [projectId],
  )

  const onToggleSortDirection = useCallback(() => {
    setSortState((previous) => {
      const next: KanbanSortState = {
        ...previous,
        direction: previous.direction === 'asc' ? 'desc' : 'asc',
      }
      saveKanbanSort(projectId, next)
      return next
    })
  }, [projectId])

  const onToggleCollapse = useCallback(
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

  return {
    collapsedStates,
    sortState,
    onSortByChange,
    onToggleSortDirection,
    onToggleCollapse,
    reload,
  }
}
