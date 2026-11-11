import type { KanbanStateGroup, WorkItem } from '@shared/ipc-contract'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import {
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
  PRIORITY_DOT_COLOR,
  priorityLabel,
  saveCollapsedStateIds,
  saveKanbanSort,
  sortWorkItems,
} from './kanban-board-logic'

// The board list: one titled section per state in adapter `order`. A section
// header is a title control (chevron, status icon, uppercase name, count pill),
// not a row. An open non-empty group is one rounded container whose rows share
// hairlines. A row shows the ref, the title, the priority dot and label, and
// the launch actions. Only the ref and the title open the review; their menu
// copies the ref or `WorkItem.url`.

/** Row track: ID, title, priority, and the launch actions. */
const LIST_ROW_COLUMNS = '96px minmax(0, 1fr) auto minmax(72px, auto)'

const ROW_IDENTITY_CLASS =
  'min-w-0 truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** Status-icon colours and marks per adapter group. */
const GROUP_ICON_COLOR: Record<KanbanStateGroup, string> = {
  backlog: 'text-ink-muted',
  unstarted: 'text-ink-secondary',
  started: 'text-info',
  completed: 'text-success',
  cancelled: 'text-ink-disabled',
}

function GroupStatusIcon({ group }: { group: KanbanStateGroup }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`shrink-0 ${GROUP_ICON_COLOR[group]}`}
    >
      <circle cx={12} cy={12} r={9} strokeDasharray={group === 'backlog' ? '3 3' : undefined} />
      {group === 'started' ? (
        <path d="M12 6.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
      ) : null}
      {group === 'completed' ? <path d="M8 12.5l2.8 2.8L16.5 9.5" /> : null}
      {group === 'cancelled' ? <path d="M9 9l6 6M15 9l-6 6" /> : null}
    </svg>
  )
}

/** A closed task is a Completed or Cancelled group: its title reads muted and struck. */
function isClosedGroup(group: KanbanStateGroup): boolean {
  return group === 'completed' || group === 'cancelled'
}

function PriorityCell({ item }: { item: WorkItem }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-ink-muted"
      data-testid={testIdFor.kanbanItemPriority(item.ref)}
    >
      {item.priority !== null ? (
        <>
          <span className="sr-only">Priority </span>
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_DOT_COLOR[item.priority] }}
            data-testid={testIdFor.kanbanItemPriorityDot(item.ref)}
          />
          <span>{priorityLabel(item.priority)}</span>
        </>
      ) : null}
    </div>
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

/** ID and title. Both are the review's click targets. */
function ItemColumns({
  item,
  closed,
  onOpen,
  onOpenMenu,
}: {
  item: WorkItem
  closed: boolean
  onOpen: (ref: string) => void
  onOpenMenu: OpenItemMenu
}): React.JSX.Element {
  const handlers = identityHandlers(item, onOpen, onOpenMenu)
  return (
    <>
      <button
        type="button"
        className={`${ROW_IDENTITY_CLASS} font-mono text-[12px] text-ink-muted`}
        data-testid={testIdFor.kanbanItemRef(item.ref)}
        {...handlers}
      >
        {item.ref}
      </button>
      <button
        type="button"
        className={`${ROW_IDENTITY_CLASS} ${closed ? 'text-ink-muted line-through' : 'text-ink'}`}
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

/** List row. Only the ID and the title open the review. */
function WorkItemSurface({
  item,
  closed,
  resumeEnabled,
  onOpen,
  onOpenMenu,
  onStart,
  onResume,
  onOpenStartMenu,
}: {
  item: WorkItem
  closed: boolean
  resumeEnabled: boolean
  onOpen: (ref: string) => void
  onOpenMenu: OpenItemMenu
  onStart?: (item: WorkItem) => void
  onResume?: (item: WorkItem) => void
  onOpenStartMenu?: OpenItemMenu
}): React.JSX.Element {
  return (
    <li
      className="group grid w-full items-center gap-x-[14px] py-0 pr-2.5 pl-3.5 text-[13px] transition-[background-color] duration-[120ms] hover:bg-ink/[0.04] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-edge/70"
      style={{ minHeight: 40, gridTemplateColumns: LIST_ROW_COLUMNS }}
      data-testid={testIdFor.kanbanItem(item.ref)}
    >
      <ItemColumns item={item} closed={closed} onOpen={onOpen} onOpenMenu={onOpenMenu} />
      <PriorityCell item={item} />
      <ItemLaunchButtons
        item={item}
        resumeEnabled={resumeEnabled}
        onStart={onStart}
        onResume={onResume}
        onOpenStartMenu={onOpenStartMenu}
        appearance="row"
      />
    </li>
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
    <div className="flex min-w-0 flex-col gap-[14px]" data-testid={TEST_ID.kanbanList}>
      {isFiltering && columns.length === 0 ? <p role="status">No matching tasks.</p> : null}
      {columns.map((column) => {
        const isCollapsed = !isFiltering && collapsedStates.has(column.stateId)
        const listId = `kanban-list-items-${column.stateId}`
        const sortedItems = sortWorkItems(column.items, sortState.sortBy, sortState.direction)
        const showTasks = !isCollapsed && sortedItems.length > 0
        return (
          <section
            key={column.stateId}
            aria-label={column.name}
            className="flex flex-col gap-1.5"
            data-testid={testIdFor.kanbanListGroup(column.stateId)}
          >
            <button
              type="button"
              className="flex h-7 items-center gap-2 self-start rounded-[6px] bg-transparent pr-2 pl-1 text-ink-secondary hover:bg-button-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-expanded={!isCollapsed}
              aria-controls={showTasks ? listId : undefined}
              disabled={isFiltering}
              data-testid={testIdFor.kanbanGroupToggle(column.stateId)}
              onClick={() => {
                onToggleCollapse(column.stateId)
              }}
            >
              <Icon.chevronRight
                size={12}
                strokeWidth={2.4}
                aria-hidden
                className={`shrink-0 text-ink-muted transition-transform duration-150${isCollapsed ? '' : ' rotate-90'}`}
              />
              <GroupStatusIcon group={column.group} />
              <span className="text-[12px] font-semibold tracking-[0.06em] uppercase">
                {column.name}
              </span>
              <span className="rounded-full bg-ink/[0.07] px-[7px] py-px font-mono text-[11px] text-ink-muted">
                {column.items.length}
              </span>
            </button>
            {showTasks ? (
              <ul
                id={listId}
                className="overflow-hidden rounded-[10px] border border-edge bg-ink/[0.02]"
              >
                {sortedItems.map((item) => (
                  <WorkItemSurface
                    key={item.ref}
                    item={item}
                    closed={isClosedGroup(column.group)}
                    resumeEnabled={itemResumable(item)}
                    onOpen={onOpen}
                    onOpenMenu={onOpenMenu}
                    onStart={onStart}
                    onResume={onResume}
                    onOpenStartMenu={onOpenStartMenu}
                  />
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
