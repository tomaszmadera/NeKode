import {
  KANBAN_PRIORITIES,
  KANBAN_STATE_GROUPS,
  type KanbanState,
  type KanbanStateGroup,
  type WorkItem,
} from '../../../shared/ipc-contract'

// Response normalization (spec kanban-adapter-interface Business rules).
// The wire shapes are adapter-produced JSON; anything outside the normalized
// contract is a protocol violation, never a best-effort coercion. States and
// items outside the stateGroup enum, priorities outside the fixed set, or
// missing required fields reject with AdapterHostError('protocol').

import { AdapterHostError } from './adapter-host'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new AdapterHostError('protocol', `${what}: "${key}" must be a string`)
  }
  if (value.length === 0) {
    throw new AdapterHostError('protocol', `${what}: "${key}" must be non-empty`)
  }
  return value
}

function requireGroup(
  record: Record<string, unknown>,
  key: 'group' | 'stateGroup',
  what: string,
): KanbanStateGroup {
  const value = record[key]
  if (typeof value !== 'string' || !KANBAN_STATE_GROUPS.includes(value as KanbanStateGroup)) {
    throw new AdapterHostError(
      'protocol',
      `${what}: "${key}" must be one of ${KANBAN_STATE_GROUPS.join('|')}`,
    )
  }
  return value as KanbanStateGroup
}

/** Parses and validates the listStates payload. */
export function normalizeStates(data: unknown): KanbanState[] {
  if (!Array.isArray(data)) {
    throw new AdapterHostError('protocol', 'listStates data must be an array')
  }
  return data.map((entry, index) => {
    const what = `listStates[${index}]`
    if (!isRecord(entry)) {
      throw new AdapterHostError('protocol', `${what} must be an object`)
    }
    const order = entry.order
    if (typeof order !== 'number' || !Number.isSafeInteger(order)) {
      throw new AdapterHostError('protocol', `${what}: "order" must be an integer`)
    }
    return {
      id: requireString(entry, 'id', what),
      name: requireString(entry, 'name', what),
      group: requireGroup(entry, 'group', what),
      order,
    }
  })
}

/** Parses and validates one item entry of a listItems/getItem/create/update payload. */
export function normalizeItem(entry: unknown, what: string): WorkItem {
  if (!isRecord(entry)) {
    throw new AdapterHostError('protocol', `${what} must be an object`)
  }
  const stateId = requireString(entry, 'stateId', what)
  const stateName = requireString(entry, 'stateName', what)
  const group = requireGroup(entry, 'stateGroup', what)
  const priority = entry.priority
  if (
    priority !== null &&
    (typeof priority !== 'string' || !KANBAN_PRIORITIES.includes(priority as never))
  ) {
    throw new AdapterHostError(
      'protocol',
      `${what}: "priority" must be one of ${KANBAN_PRIORITIES.join('|')} or null`,
    )
  }
  const optional = (key: 'assignee' | 'url' | 'updatedAt'): string | null => {
    const value = entry[key]
    if (value === null || value === undefined) {
      return null
    }
    if (typeof value !== 'string') {
      throw new AdapterHostError('protocol', `${what}: "${key}" must be a string or null`)
    }
    return value
  }
  const description = entry.description
  if (description !== null && description !== undefined && typeof description !== 'string') {
    throw new AdapterHostError('protocol', `${what}: "description" must be a string or null`)
  }
  return {
    ref: requireString(entry, 'ref', what),
    id: requireString(entry, 'id', what),
    title: requireString(entry, 'title', what),
    description: description ?? null,
    stateId,
    stateName,
    stateGroup: group,
    priority: (priority ?? null) as WorkItem['priority'],
    assignee: optional('assignee'),
    url: optional('url'),
    updatedAt: optional('updatedAt'),
  }
}

/** Parses and validates the listItems payload (an array of items). */
export function normalizeItems(data: unknown): WorkItem[] {
  if (!Array.isArray(data)) {
    throw new AdapterHostError('protocol', 'listItems data must be an array')
  }
  return data.map((entry, index) => normalizeItem(entry, `listItems[${index}]`))
}

/**
 * Valid action names of protocol v1 (the service is the only caller).
 *
 * `getItem` is part of the protocol vocabulary (spec Behaviour 4: it is a
 * valid action an adapter must implement), so it stays in this allowlist. The
 * spec's IPC Data/API list fixes the app's channels and contains no
 * `kanban:getItem`, so no KanbanService method or IPC channel invokes it in
 * this stage — a deliberate deferral, not a missing wiring. Re-add the call
 * site when a read-one surface is specced.
 */
export const ADAPTER_ACTIONS = [
  'test',
  'listStates',
  'listItems',
  'getItem',
  'createItem',
  'updateItem',
] as const

export type AdapterAction = (typeof ADAPTER_ACTIONS)[number]
