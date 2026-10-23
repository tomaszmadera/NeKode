import { describe, expect, it } from 'vitest'
import type { ChatInfo, TaskProgressItem, TaskProgressSnapshot } from '../../../shared/ipc-contract'
import { sessionTaskProgress } from './task-progress'

function task(overrides: Partial<TaskProgressItem> = {}): TaskProgressItem {
  return {
    id: 'nekode-74-work',
    ref: 'NEKODE-74',
    title: 'Work',
    state: 'active',
    location: 'live',
    recordState: 'valid',
    errors: [],
    activity: null,
    phases: [
      {
        name: 'Work',
        steps: [
          { id: 'one', label: 'Plan', done: true },
          { id: 'two', label: 'Implement', done: false },
          { id: 'three', label: 'Verify', done: false },
        ],
      },
    ],
    currentStepId: null,
    currentLabel: null,
    corrections: 0,
    reviews: 0,
    nextAction: null,
    blockers: null,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    checkpoints: [],
    path: null,
    ...overrides,
  }
}

function progress(
  tasks: TaskProgressItem[],
  chat: Partial<ChatInfo> = {},
  snapshot: Partial<TaskProgressSnapshot> = {},
) {
  return sessionTaskProgress(
    { id: 'c1', projectId: 'p1', name: '[PS7] NEKODE-74', ...chat },
    {
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      receivedAt: null,
      tasks,
      ...snapshot,
    },
  )
}

describe('normalized session task progress', () => {
  it('prefers taskRef, falls back to the first name token, and ignores shell prefixes', () => {
    const tasks = [task(), task({ id: 'other', ref: 'OTHER-2', title: 'Explicit' })]
    expect(progress(tasks, { taskRef: 'other-2' })?.taskTitle).toBe('Explicit')
    expect(progress(tasks, { taskRef: 'missing-1' })?.taskId).toBe('NEKODE-74')
    expect(progress(tasks, { name: '[OTHER-2] NEKODE-74 OTHER-2' })?.taskId).toBe('NEKODE-74')
    expect(progress(tasks, { name: '[NEKODE-74] Codex' })).toBeUndefined()
  })

  it('matches refs case-insensitively and ids only at a hyphen boundary', () => {
    expect(progress([task({ ref: 'nekode-74', id: 'custom' })])?.taskId).toBe('nekode-74')
    expect(progress([task({ ref: null, id: 'nekode-74' })])).toBeDefined()
    expect(progress([task({ ref: null, id: 'nekode-74-work' })])).toBeDefined()
    expect(progress([task({ ref: null, id: 'nekode-740-work' })])).toBeUndefined()
    expect(progress([task({ ref: null, id: 'nekode-74_work' })])).toBeUndefined()
    expect(progress([task()], { name: 'n74' })).toBeUndefined()
    expect(progress([task({ id: 'custom', ref: null })], { name: 'custom' })).toBeUndefined()
  })

  it('ranks active and blocked before completed, then by updated timestamp', () => {
    expect(
      progress([
        task({ id: 'done', state: 'completed', updatedAt: '2026-10-23T12:00:00Z', title: 'Done' }),
        task({ id: 'old', updatedAt: '2026-10-20T12:00:00Z', title: 'Old' }),
        task({ id: 'new', state: 'blocked', updatedAt: '2026-10-22T12:00:00Z', title: 'New' }),
      ])?.taskTitle,
    ).toBe('New')
    expect(
      progress([
        task({ id: 'second', updatedAt: '2026-10-23T12:00:00Z', title: 'Earlier' }),
        task({ id: 'millisecond', updatedAt: '2026-10-23T12:00:00.100Z', title: 'Later' }),
      ])?.taskTitle,
    ).toBe('Later')
  })

  it('uses explicit current step and label, counts corrections, and keeps archived active tasks active', () => {
    expect(
      progress([
        task({
          location: 'archived',
          currentStepId: 'one',
          currentLabel: 'Fixes',
          corrections: 3,
          reviews: 2,
        }),
      ]),
    ).toMatchObject({
      step: 1,
      totalSteps: 3,
      stepName: 'Fixes',
      label: 'Fixes · fix:3',
      fix: 3,
      review: 2,
      ariaLabel: 'Task progress: step 1 of 3, Fixes, fix 3',
      stepNames: ['Plan', 'Implement', 'Verify'],
    })
    expect(progress([task()])?.step).toBe(2)
    expect(progress([task({ state: 'completed', currentStepId: 'one' })])?.step).toBe(3)
  })

  it('hides invalid records and data from other projects or absent bindings', () => {
    expect(progress([task({ recordState: 'invalid' })])).toBeUndefined()
    expect(progress([task({ recordState: 'unsupported' })])).toBeUndefined()
    expect(progress([task()], {}, { projectId: 'p2' })).toBeUndefined()
    expect(
      sessionTaskProgress({ id: 'c', projectId: 'p', name: 'NEKODE-74' }, null),
    ).toBeUndefined()
  })

  it('prefixes stale accessibility text with the current error', () => {
    expect(
      progress(
        [task()],
        {},
        { status: 'stale', error: { code: 'runtime', message: 'Source unavailable' } },
      ),
    ).toMatchObject({
      stale: true,
      staleReason: 'Source unavailable',
      ariaLabel: 'Out of date: Source unavailable. Task progress: step 2 of 3, Implement',
    })
  })
})
