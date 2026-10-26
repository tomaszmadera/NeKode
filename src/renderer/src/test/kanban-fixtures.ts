// Shared Kanban board fixtures for the board's test files (KanbanBoard.test.tsx
// renders the component; kanban-board-logic.test.ts covers the pure helpers).
// One definition so the two files cannot drift.
import type { KanbanBoard as KanbanBoardData, WorkItem } from '@shared/ipc-contract'

/** A minimal work item; the id is derived from the ref so tests read naturally. */
export function kanbanWorkItem(ref: string, title: string, stateId: string): WorkItem {
  return {
    ref,
    id: `id-${ref}`,
    title,
    description: null,
    stateId,
    stateName: stateId,
    stateGroup: 'backlog',
    priority: null,
    assignee: null,
    url: null,
    updatedAt: null,
  }
}

/**
 * Three states deliberately listed out of adapter order, with two items in
 * Backlog and one in In Progress; Done stays empty.
 */
export const kanbanBoardFixture: KanbanBoardData = {
  states: [
    { id: 's2', name: 'In Progress', group: 'started', order: 2 },
    { id: 's1', name: 'Backlog', group: 'backlog', order: 1 },
    { id: 's3', name: 'Done', group: 'completed', order: 3 },
  ],
  items: [
    kanbanWorkItem('NK-1', 'First task', 's1'),
    kanbanWorkItem('NK-3', 'Third task', 's1'),
    kanbanWorkItem('NK-2', 'Second task', 's2'),
  ],
}
