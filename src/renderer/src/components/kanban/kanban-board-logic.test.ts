// Pure-helper unit tests for the Kanban board (Stage 2 W15, Stage 3 C.5):
// board grouping, defensive storage parsing, sort ordering, and concurrent
// IPC promise race-ordering reconciliation run without rendering the component.
// Test names are kept as-is so their spec/regression references survive.

import type { KanbanBoard as KanbanBoardData, WorkItem } from '@shared/ipc-contract'
import { describe, expect, it } from 'vitest'
import { kanbanBoardFixture, kanbanWorkItem } from '../../test/kanban-fixtures'
import {
  boardColumns,
  compareRefs,
  DEFAULT_KANBAN_SORT,
  parseCollapsedStateIds,
  parseKanbanSort,
  reconcileBoard,
  reconcileBoardResponse,
  reconcileKeepingCreates,
  sortWorkItems,
  upsertWorkItem,
  workItemsMatch,
} from './kanban-board-logic'

const item = kanbanWorkItem
const fixture = kanbanBoardFixture

describe('kanban board logic — reconcileBoard (cached background refresh)', () => {
  it('reuses unchanged item and state objects while applying updates and order', () => {
    const next = structuredClone(fixture)
    next.items.reverse()
    next.items[0].title = 'Changed'
    const result = reconcileBoard(fixture, next)
    expect(result.states[0]).toBe(fixture.states[0])
    expect(result.items[2]).toBe(fixture.items[0])
    expect(result.items[0]).not.toBe(fixture.items[2])
    expect(result.items[0].title).toBe('Changed')
  })
})

describe('kanban board logic — boardColumns grouping (spec Behaviour 14, AC14)', () => {
  it('boardColumns groups items by state id, keeping the adapter item order', () => {
    const columns = boardColumns(fixture)
    expect(columns.map((column) => column.name)).toEqual(['Backlog', 'In Progress', 'Done'])
    expect(columns[0].items.map((entry) => entry.ref)).toEqual(['NK-1', 'NK-3'])
    expect(columns[2].items).toEqual([])
  })

  // The spec fixes the WorkItem/KanbanState shapes independently and Stage 1
  // normalization never cross-checks an item's stateId against the state ids,
  // so an unmatched state id is possible. Such items must not be dropped.
  it('boardColumns keeps every item: an unmatched stateId gets a trailing column labelled from the item', () => {
    const columns = boardColumns({
      states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
      items: [
        item('NK-1', 'Known task', 's1'),
        { ...item('NK-2', 'Orphan one', 'sx'), stateName: 'Ghost state' },
        item('NK-3', 'Orphan two', 'sx'),
      ],
    })
    // Matched column first, unmatched trailing; label from the item's stateName.
    expect(columns.map((column) => column.name)).toEqual(['Backlog', 'Ghost state'])
    expect(columns[1].stateId).toBe('sx')
    expect(columns[1].items.map((entry) => entry.ref)).toEqual(['NK-2', 'NK-3'])
    // Nothing is dropped: every item appears in exactly one column.
    expect(
      columns
        .flatMap((column) => column.items)
        .map((entry) => entry.ref)
        .sort(),
    ).toEqual(['NK-1', 'NK-2', 'NK-3'])
  })
})

describe('kanban board logic — parseCollapsedStateIds', () => {
  it('parses collapsed state ids safely', () => {
    expect(parseCollapsedStateIds(null)).toEqual(new Set())
    expect(parseCollapsedStateIds('')).toEqual(new Set())
    expect(parseCollapsedStateIds('not-json')).toEqual(new Set())
    expect(parseCollapsedStateIds('{"not": "array"}')).toEqual(new Set())
    expect(parseCollapsedStateIds('["s1", 123]')).toEqual(new Set())
    expect(parseCollapsedStateIds('["s1", "s2"]')).toEqual(new Set(['s1', 's2']))
  })
})

describe('kanban board logic — sorting items', () => {
  const unsortedItems: WorkItem[] = [
    { ...item('NK-10', 'Task 10', 's1'), priority: 'low' },
    { ...item('NK-2', 'Task 2', 's1'), priority: 'urgent' },
    { ...item('NK-1', 'Task 1', 's1'), priority: null },
    { ...item('NK-3', 'Task 3', 's1'), priority: 'urgent' },
    { ...item('NK-5', 'Task 5', 's1'), priority: 'high' },
    { ...item('NK-4', 'Task 4', 's1'), priority: 'medium' },
  ]

  it('natural sort orders task slugs correctly', () => {
    expect(compareRefs('NK-2', 'NK-10')).toBeLessThan(0)
    expect(compareRefs('NK-10', 'NK-2')).toBeGreaterThan(0)
    expect(compareRefs('NK-1', 'NK-1')).toBe(0)
  })

  it('sorts by slug ascending by default (natural numerical order)', () => {
    const sorted = sortWorkItems(unsortedItems, 'slug', 'asc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-1', 'NK-2', 'NK-3', 'NK-4', 'NK-5', 'NK-10'])
  })

  it('sorts by slug descending when direction is desc', () => {
    const sorted = sortWorkItems(unsortedItems, 'slug', 'desc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-10', 'NK-5', 'NK-4', 'NK-3', 'NK-2', 'NK-1'])
  })

  it('sorts by slug using the ref only', () => {
    const items: WorkItem[] = [
      { ...item('NK-2', 'Alpha', 's1'), priority: 'low' },
      { ...item('NK-1', 'Zulu', 's1'), priority: 'urgent' },
    ]
    expect(sortWorkItems(items, 'slug', 'asc').map((entry) => entry.ref)).toEqual(['NK-1', 'NK-2'])
  })

  it('sorts by priority ascending (urgent -> high -> medium -> low -> none) with secondary slug', () => {
    const sorted = sortWorkItems(unsortedItems, 'priority', 'asc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-2', 'NK-3', 'NK-5', 'NK-4', 'NK-10', 'NK-1'])
    expect(sorted.map((i) => i.priority)).toEqual([
      'urgent',
      'urgent',
      'high',
      'medium',
      'low',
      null,
    ])
  })

  it('sorts by priority descending (none -> low -> medium -> high -> urgent) with secondary slug reversed', () => {
    const sorted = sortWorkItems(unsortedItems, 'priority', 'desc')
    expect(sorted.map((i) => i.ref)).toEqual(['NK-1', 'NK-10', 'NK-4', 'NK-5', 'NK-3', 'NK-2'])
    expect(sorted.map((i) => i.priority)).toEqual([
      null,
      'low',
      'medium',
      'high',
      'urgent',
      'urgent',
    ])
  })

  it('parses stored kanban sort settings safely', () => {
    expect(parseKanbanSort(null)).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort('')).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort('not-json')).toEqual(DEFAULT_KANBAN_SORT)
    expect(parseKanbanSort(JSON.stringify({ sortBy: 'priority', direction: 'desc' }))).toEqual({
      sortBy: 'priority',
      direction: 'desc',
    })
    expect(parseKanbanSort(JSON.stringify({ sortBy: 'unknown', direction: 'invalid' }))).toEqual({
      sortBy: 'slug',
      direction: 'asc',
    })
  })
})

describe('kanban board logic — concurrent IPC promise race ordering matrix (C.5)', () => {
  const baseBoard: KanbanBoardData = {
    states: [
      { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
      { id: 's2', name: 'Done', group: 'completed', order: 2 },
    ],
    items: [item('NK-1', 'Task 1', 's1'), item('NK-2', 'Task 2', 's1')],
  }

  const createdItem: WorkItem = {
    ...item('NK-40', 'Newly created task', 's1'),
    stateName: 'Backlog',
  }

  const updatedItem: WorkItem = {
    ...item('NK-1', 'Task 1 updated', 's2'),
    stateName: 'Done',
  }

  describe('in-flight create races', () => {
    it('race 1: incoming snapshot omits the created ref -> retained create is kept and added to board', () => {
      const incoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[0], baseBoard.items[1]], // omits NK-40
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: incoming,
        retainedCreates: [createdItem],
        retainedUpdates: [],
        currentReviewRef: null,
      })

      expect(result.keptCreates).toEqual([createdItem])
      expect(result.board.items.map((i) => i.ref)).toEqual(['NK-1', 'NK-2', 'NK-40'])
      expect(result.phase).toBe('ready')
      expect(result.visibleItemCount).toBe(3)
    })

    it('race 2: incoming snapshot already includes the created ref -> deduplicated to exactly one copy', () => {
      const incoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[0], baseBoard.items[1], createdItem],
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: incoming,
        retainedCreates: [createdItem],
        retainedUpdates: [],
        currentReviewRef: null,
      })

      expect(result.keptCreates).toEqual([]) // already in incoming snapshot
      expect(result.board.items.map((i) => i.ref)).toEqual(['NK-1', 'NK-2', 'NK-40'])
      expect(result.board.items.filter((i) => i.ref === 'NK-40')).toHaveLength(1)
    })

    it('race 3: subsequent refresh without in-flight creates drops an omitted item (normal remove-absent rule)', () => {
      const boardWithCreated: KanbanBoardData = {
        states: baseBoard.states,
        items: [...baseBoard.items, createdItem],
      }
      const laterSnapshot: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[0]], // NK-40 was removed on server
      }
      const result = reconcileBoardResponse({
        previousBoard: boardWithCreated,
        incomingBoard: laterSnapshot,
        retainedCreates: [], // no in-flight create during this refresh
        retainedUpdates: [],
        currentReviewRef: 'NK-40',
      })

      expect(result.keptCreates).toEqual([])
      expect(result.board.items.map((i) => i.ref)).toEqual(['NK-1'])
      expect(result.reviewRef).toBeNull() // closed review for dropped item
    })
  })

  describe('in-flight update races', () => {
    it('race 4: incoming snapshot has stale item -> retained update overrides the stale record', () => {
      const staleIncoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [{ ...baseBoard.items[0], title: 'Stale snapshot title' }, baseBoard.items[1]],
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: staleIncoming,
        retainedCreates: [],
        retainedUpdates: [updatedItem],
        currentReviewRef: 'NK-1',
      })

      const itemNk1 = result.board.items.find((i) => i.ref === 'NK-1')
      expect(itemNk1?.title).toBe('Task 1 updated')
      expect(itemNk1?.stateId).toBe('s2')
      expect(result.reviewRef).toBe('NK-1') // review stays open on updated item
    })

    it('race 5: incoming snapshot omits the updated item -> retained update is preserved', () => {
      const omittingIncoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[1]], // NK-1 omitted
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: omittingIncoming,
        retainedCreates: [],
        retainedUpdates: [updatedItem],
        currentReviewRef: 'NK-1',
      })

      expect(result.board.items.map((i) => i.ref)).toContain('NK-1')
      const itemNk1 = result.board.items.find((i) => i.ref === 'NK-1')
      expect(itemNk1?.title).toBe('Task 1 updated')
      expect(result.reviewRef).toBe('NK-1')
    })

    it('race 6: subsequent refresh applies fresh server snapshot over older update', () => {
      const boardWithUpdate: KanbanBoardData = {
        states: baseBoard.states,
        items: [updatedItem, baseBoard.items[1]],
      }
      const freshServerSnapshot: KanbanBoardData = {
        states: baseBoard.states,
        items: [{ ...updatedItem, title: 'Server canonical title' }, baseBoard.items[1]],
      }
      const result = reconcileBoardResponse({
        previousBoard: boardWithUpdate,
        incomingBoard: freshServerSnapshot,
        retainedCreates: [],
        retainedUpdates: [],
        currentReviewRef: 'NK-1',
      })

      const itemNk1 = result.board.items.find((i) => i.ref === 'NK-1')
      expect(itemNk1?.title).toBe('Server canonical title')
      expect(result.reviewRef).toBe('NK-1')
    })
  })

  describe('concurrent creates and updates in flight simultaneously', () => {
    it('race 7: both create and update succeed during one listBoard call', () => {
      const incoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[0], baseBoard.items[1]],
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: incoming,
        retainedCreates: [createdItem],
        retainedUpdates: [updatedItem],
        currentReviewRef: 'NK-40',
      })

      expect(result.board.items.map((i) => i.ref)).toEqual(['NK-1', 'NK-2', 'NK-40'])
      const itemNk1 = result.board.items.find((i) => i.ref === 'NK-1')
      expect(itemNk1?.title).toBe('Task 1 updated')
      expect(result.reviewRef).toBe('NK-40') // newly created review stays open
      expect(result.visibleItemCount).toBe(3)
    })
  })

  describe('review reference and phase lifecycle', () => {
    it('closes review when item is not in incoming snapshot or retained writes', () => {
      const incoming: KanbanBoardData = {
        states: baseBoard.states,
        items: [baseBoard.items[1]],
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: incoming,
        currentReviewRef: 'NK-1',
      })
      expect(result.reviewRef).toBeNull()
    })

    it('determines empty phase only when states and visible items are both zero', () => {
      const emptyBoard: KanbanBoardData = { states: [], items: [] }
      const emptyResult = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: emptyBoard,
      })
      expect(emptyResult.phase).toBe('empty')

      // 0 states but retained create present -> ready, not empty
      const createOnlyResult = reconcileBoardResponse({
        previousBoard: emptyBoard,
        incomingBoard: emptyBoard,
        retainedCreates: [createdItem],
      })
      expect(createOnlyResult.phase).toBe('ready')
      expect(createOnlyResult.visibleItemCount).toBe(1)
    })

    it('preserves object identity for unchanged items and states', () => {
      const incoming: KanbanBoardData = {
        states: structuredClone(baseBoard.states),
        items: [structuredClone(baseBoard.items[0]), structuredClone(baseBoard.items[1])],
      }
      const result = reconcileBoardResponse({
        previousBoard: baseBoard,
        incomingBoard: incoming,
      })
      expect(result.board.states[0]).toBe(baseBoard.states[0])
      expect(result.board.items[0]).toBe(baseBoard.items[0])
      expect(result.board.items[1]).toBe(baseBoard.items[1])
    })
  })

  describe('workItemsMatch, upsertWorkItem, and reconcileKeepingCreates', () => {
    it('detects equal work items and appends or replaces items by ref', () => {
      const item1 = item('NK-1', 'Title 1', 's1')
      const item1Clone = { ...item1 }
      expect(workItemsMatch(item1, item1Clone)).toBe(true)
      expect(workItemsMatch(item1, { ...item1, title: 'Other' })).toBe(false)

      const list = [item1]
      expect(upsertWorkItem(list, item1Clone)).toBe(list)

      const replaced = upsertWorkItem(list, { ...item1, title: 'Updated' })
      expect(replaced).toHaveLength(1)
      expect(replaced[0].title).toBe('Updated')

      const appended = upsertWorkItem(list, item('NK-2', 'Title 2', 's1'))
      expect(appended).toHaveLength(2)
    })

    it('reconcileKeepingCreates preserves retained creates and updates without duplicate entries', () => {
      const next = { ...baseBoard, items: [baseBoard.items[0]] }
      const result = reconcileKeepingCreates(baseBoard, next, [createdItem], [updatedItem])
      expect(result.items.map((i) => i.ref)).toEqual(['NK-1', 'NK-40'])
    })
  })
})
