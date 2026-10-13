// Pure-helper unit tests for the Kanban board (Stage 2 W15, extracted from
// KanbanBoard.test.tsx): board grouping, defensive storage parsing and sort
// ordering run without rendering the component. Test names are kept as-is so
// their spec/regression references survive the move.
import { describe, expect, it } from 'vitest'
import type { WorkItem } from '../../../../shared/ipc-contract'
import { kanbanBoardFixture, kanbanWorkItem } from '../../test/kanban-fixtures'
import {
  boardColumns,
  compareRefs,
  DEFAULT_KANBAN_SORT,
  parseCollapsedStateIds,
  parseKanbanSort,
  reconcileBoard,
  sortWorkItems,
} from './KanbanBoard'

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
