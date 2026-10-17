import { describe, expect, it } from 'vitest'
import { KANBAN_PRIORITIES, KANBAN_STATE_GROUPS } from '../../../shared/ipc-contract'
import { AdapterHostError } from './adapter-host'
import {
  ADAPTER_ACTIONS,
  normalizeComments,
  normalizeItem,
  normalizeItems,
  normalizeStates,
} from './adapter-protocol'

describe('adapter-protocol', () => {
  describe('normalizeStates', () => {
    it('rejects non-array payloads with typed protocol error', () => {
      const invalid = [null, undefined, 42, 'not-array', {}, true]
      for (const payload of invalid) {
        expect(() => normalizeStates(payload)).toThrowError(
          new AdapterHostError('protocol', 'listStates data must be an array'),
        )
      }
    })

    it('rejects non-object entries in listStates', () => {
      expect(() => normalizeStates([null])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0] must be an object'),
      )
      expect(() => normalizeStates(['string-entry'])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0] must be an object'),
      )
      expect(() => normalizeStates([[]])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0] must be an object'),
      )
    })

    it('rejects missing or non-integer order', () => {
      const base = { id: 's1', name: 'Todo', group: 'unstarted' }
      expect(() => normalizeStates([{ ...base }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "order" must be an integer'),
      )
      expect(() => normalizeStates([{ ...base, order: '0' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "order" must be an integer'),
      )
      expect(() => normalizeStates([{ ...base, order: 1.5 }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "order" must be an integer'),
      )
      expect(() => normalizeStates([{ ...base, order: Number.NaN }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "order" must be an integer'),
      )
      expect(() => normalizeStates([{ ...base, order: Number.POSITIVE_INFINITY }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "order" must be an integer'),
      )
    })

    it('rejects missing, non-string, or empty id and name', () => {
      const base = { group: 'unstarted', order: 0 }
      expect(() => normalizeStates([{ ...base, name: 'Todo' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "id" must be a string'),
      )
      expect(() => normalizeStates([{ ...base, id: 123, name: 'Todo' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "id" must be a string'),
      )
      expect(() => normalizeStates([{ ...base, id: '', name: 'Todo' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "id" must be non-empty'),
      )
      expect(() => normalizeStates([{ ...base, id: 's1' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "name" must be a string'),
      )
      expect(() => normalizeStates([{ ...base, id: 's1', name: 123 }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "name" must be a string'),
      )
      expect(() => normalizeStates([{ ...base, id: 's1', name: '' }])).toThrowError(
        new AdapterHostError('protocol', 'listStates[0]: "name" must be non-empty'),
      )
    })

    it('rejects missing or out-of-enum group', () => {
      const base = { id: 's1', name: 'Todo', order: 0 }
      const expectedMessage = `listStates[0]: "group" must be one of ${KANBAN_STATE_GROUPS.join('|')}`
      expect(() => normalizeStates([{ ...base }])).toThrowError(
        new AdapterHostError('protocol', expectedMessage),
      )
      expect(() => normalizeStates([{ ...base, group: 'in_progress' }])).toThrowError(
        new AdapterHostError('protocol', expectedMessage),
      )
      expect(() => normalizeStates([{ ...base, group: 123 }])).toThrowError(
        new AdapterHostError('protocol', expectedMessage),
      )
    })

    it('accepts valid state entries and preserves order and groups', () => {
      const input = [
        { id: 's1', name: 'Backlog', group: 'backlog', order: 0 },
        { id: 's2', name: 'In Progress', group: 'started', order: 1 },
        { id: 's3', name: 'Done', group: 'completed', order: 2 },
      ]
      expect(normalizeStates(input)).toEqual([
        { id: 's1', name: 'Backlog', group: 'backlog', order: 0 },
        { id: 's2', name: 'In Progress', group: 'started', order: 1 },
        { id: 's3', name: 'Done', group: 'completed', order: 2 },
      ])
    })
  })

  describe('normalizeItem', () => {
    const validItem = {
      ref: 'TASK-1',
      id: 'item-uuid-1',
      title: 'First task',
      description: 'A detailed description',
      stateId: 's1',
      stateName: 'In Progress',
      stateGroup: 'started',
      priority: 'high',
      assignee: 'Alice',
      url: 'https://example.com/task/1',
      updatedAt: '2026-10-12T10:00:00Z',
    }

    it('rejects non-object entries', () => {
      expect(() => normalizeItem(null, 'getItem')).toThrowError(
        new AdapterHostError('protocol', 'getItem must be an object'),
      )
      expect(() => normalizeItem('string', 'getItem')).toThrowError(
        new AdapterHostError('protocol', 'getItem must be an object'),
      )
      expect(() => normalizeItem([], 'getItem')).toThrowError(
        new AdapterHostError('protocol', 'getItem must be an object'),
      )
    })

    it('rejects missing or invalid required string fields (ref, id, title, stateId, stateName)', () => {
      const requiredFields = ['ref', 'id', 'title', 'stateId', 'stateName'] as const
      for (const field of requiredFields) {
        const missing = { ...validItem }
        delete (missing as Record<string, unknown>)[field]
        expect(() => normalizeItem(missing, 'testItem')).toThrowError(
          new AdapterHostError('protocol', `testItem: "${field}" must be a string`),
        )

        const nonString = { ...validItem, [field]: 999 }
        expect(() => normalizeItem(nonString, 'testItem')).toThrowError(
          new AdapterHostError('protocol', `testItem: "${field}" must be a string`),
        )

        const empty = { ...validItem, [field]: '' }
        expect(() => normalizeItem(empty, 'testItem')).toThrowError(
          new AdapterHostError('protocol', `testItem: "${field}" must be non-empty`),
        )
      }
    })

    it('rejects missing or out-of-enum stateGroup', () => {
      const expectedMessage = `getItem: "stateGroup" must be one of ${KANBAN_STATE_GROUPS.join('|')}`
      const missing = { ...validItem }
      delete (missing as { stateGroup?: unknown }).stateGroup
      expect(() => normalizeItem(missing, 'getItem')).toThrowError(
        new AdapterHostError('protocol', expectedMessage),
      )

      const invalid = { ...validItem, stateGroup: 'doing' }
      expect(() => normalizeItem(invalid, 'getItem')).toThrowError(
        new AdapterHostError('protocol', expectedMessage),
      )
    })

    it('rejects invalid priorities (non-null out-of-enum, undefined, or non-string)', () => {
      const expectedMessage = `getItem: "priority" must be one of ${KANBAN_PRIORITIES.join('|')} or null`
      const invalidValues = ['critical', 'lowest', 1, {}, true, undefined]
      for (const priority of invalidValues) {
        expect(() => normalizeItem({ ...validItem, priority }, 'getItem')).toThrowError(
          new AdapterHostError('protocol', expectedMessage),
        )
      }
    })

    it('accepts null priority and all valid enum priorities', () => {
      const validPriorities = [...KANBAN_PRIORITIES, null]
      for (const priority of validPriorities) {
        const item = normalizeItem({ ...validItem, priority }, 'getItem')
        expect(item.priority).toBe(priority)
      }
    })

    it('rejects non-string non-null optional fields', () => {
      const optionals = ['assignee', 'url', 'updatedAt'] as const
      for (const field of optionals) {
        expect(() => normalizeItem({ ...validItem, [field]: 123 }, 'getItem')).toThrowError(
          new AdapterHostError('protocol', `getItem: "${field}" must be a string or null`),
        )
      }
      expect(() => normalizeItem({ ...validItem, description: 123 }, 'getItem')).toThrowError(
        new AdapterHostError('protocol', 'getItem: "description" must be a string or null'),
      )
    })

    it('normalizes missing or undefined optional description, assignee, url, updatedAt to null', () => {
      const minimal = {
        ref: 'TASK-2',
        id: 'item-uuid-2',
        title: 'Minimal task',
        stateId: 's1',
        stateName: 'Backlog',
        stateGroup: 'backlog',
        priority: null,
      }
      const item = normalizeItem(minimal, 'getItem')
      expect(item).toEqual({
        ref: 'TASK-2',
        id: 'item-uuid-2',
        title: 'Minimal task',
        description: null,
        stateId: 's1',
        stateName: 'Backlog',
        stateGroup: 'backlog',
        priority: null,
        assignee: null,
        url: null,
        updatedAt: null,
      })
    })

    it('preserves all provided valid fields', () => {
      const item = normalizeItem(validItem, 'getItem')
      expect(item).toEqual(validItem)
    })
  })

  describe('normalizeItems', () => {
    it('rejects non-array payloads with typed protocol error', () => {
      expect(() => normalizeItems(null)).toThrowError(
        new AdapterHostError('protocol', 'listItems data must be an array'),
      )
      expect(() => normalizeItems({})).toThrowError(
        new AdapterHostError('protocol', 'listItems data must be an array'),
      )
    })

    it('normalizes each item citing its index in failure messages', () => {
      const valid = {
        ref: 'TASK-1',
        id: 'item-1',
        title: 'Task 1',
        stateId: 's1',
        stateName: 'Todo',
        stateGroup: 'unstarted',
        priority: null,
      }
      const invalid = {
        ref: 'TASK-2',
        id: 'item-2',
        title: 'Task 2',
        stateId: 's1',
        stateName: 'Todo',
        stateGroup: 'invalid-group',
        priority: null,
      }
      expect(() => normalizeItems([valid, invalid])).toThrowError(
        new AdapterHostError(
          'protocol',
          `listItems[1]: "stateGroup" must be one of ${KANBAN_STATE_GROUPS.join('|')}`,
        ),
      )
    })

    it('returns array of normalized WorkItems for valid payload', () => {
      const items = [
        {
          ref: 'TASK-1',
          id: 'item-1',
          title: 'Task 1',
          stateId: 's1',
          stateName: 'Todo',
          stateGroup: 'unstarted',
          priority: 'urgent',
        },
      ]
      const result = normalizeItems(items)
      expect(result).toHaveLength(1)
      expect(result[0].ref).toBe('TASK-1')
      expect(result[0].stateGroup).toBe('unstarted')
      expect(result[0].priority).toBe('urgent')
    })
  })

  describe('normalizeComments', () => {
    it('rejects non-array payloads with typed protocol error', () => {
      expect(() => normalizeComments(null, 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments must be an array'),
      )
      expect(() => normalizeComments({}, 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments must be an array'),
      )
    })

    it('rejects non-object entries in listComments', () => {
      expect(() => normalizeComments([null], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0] must be an object'),
      )
      expect(() => normalizeComments(['string-entry'], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0] must be an object'),
      )
    })

    it('rejects missing or empty id', () => {
      expect(() => normalizeComments([{}], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0]: "id" must be a string'),
      )
      expect(() => normalizeComments([{ id: '' }], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0]: "id" must be non-empty'),
      )
    })

    it('rejects invalid author or createdAt types', () => {
      expect(() => normalizeComments([{ id: 'c1', author: 123 }], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0]: "author" must be a string or null'),
      )
      expect(() => normalizeComments([{ id: 'c1', createdAt: 456 }], 'listComments')).toThrowError(
        new AdapterHostError('protocol', 'listComments[0]: "createdAt" must be a string or null'),
      )
    })

    it('normalizes valid comments and preserves optional fields', () => {
      const input = [
        { id: 'c1', text: 'First comment', author: 'Alice', createdAt: '2026-10-17T12:00:00Z' },
        { id: 'c2', text: 'Second comment', author: null, createdAt: null },
      ]
      expect(normalizeComments(input, 'listComments')).toEqual([
        { id: 'c1', text: 'First comment', author: 'Alice', createdAt: '2026-10-17T12:00:00Z' },
        { id: 'c2', text: 'Second comment', author: null, createdAt: null },
      ])
    })
  })

  describe('ADAPTER_ACTIONS', () => {
    it('exposes the expected protocol action list', () => {
      expect(ADAPTER_ACTIONS).toEqual([
        'test',
        'listStates',
        'listItems',
        'getItem',
        'createItem',
        'updateItem',
        'listComments',
      ])
    })
  })
})
