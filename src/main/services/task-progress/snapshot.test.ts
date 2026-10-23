import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskProgressAdapterError } from './adapter-host'
import { validateTaskProgressSnapshot } from './snapshot'

// Snapshot validation (spec task-progress-adapters Data / API, Required tests
// "Walidacja snapshotu"): required fields, types, duplicate id, currentStepId
// without a step, watch outside the project, unknown fields ignored.

const LABEL = 'Adapter "demo" (snapshot)'

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'nekode-101-palette-tokens',
    state: 'active',
    location: 'live',
    recordState: 'valid',
    phases: [
      {
        name: 'Build',
        steps: [
          { id: 'Phase 0.1', label: 'Inspect', done: true },
          { id: 'Phase 0.2', label: 'Implement', done: false },
        ],
      },
    ],
    ...overrides,
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-23T09:27:37Z',
    watch: [{ path: '.agents/tasks', recursive: true }],
    tasks: [task()],
    ...overrides,
  }
}

function rejection(data: unknown): TaskProgressAdapterError {
  try {
    validateTaskProgressSnapshot(data, LABEL)
  } catch (error) {
    expect(error).toBeInstanceOf(TaskProgressAdapterError)
    expect((error as TaskProgressAdapterError).code).toBe('protocol')
    expect((error as TaskProgressAdapterError).message).toContain(LABEL)
    return error as TaskProgressAdapterError
  }
  throw new Error('expected the snapshot to be rejected')
}

describe('validateTaskProgressSnapshot', () => {
  it('rejects watch paths leaving the project through a directory link, including missing children', () => {
    const root = mkdtempSync(join(tmpdir(), 'nekode-progress-watch-'))
    const project = join(root, 'project')
    const outside = join(root, 'outside')
    mkdirSync(project)
    mkdirSync(outside)
    symlinkSync(outside, join(project, 'link'), 'junction')
    try {
      for (const path of ['link', 'link/not-created']) {
        expect(() =>
          validateTaskProgressSnapshot(snapshot({ watch: [{ path }] }), LABEL, project),
        ).toThrow(/outside the project/)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('normalizes a minimal valid snapshot', () => {
    expect(validateTaskProgressSnapshot(snapshot(), LABEL)).toEqual({
      generatedAt: '2026-10-23T09:27:37Z',
      watch: [{ path: '.agents/tasks', recursive: true }],
      tasks: [
        {
          id: 'nekode-101-palette-tokens',
          ref: null,
          title: null,
          state: 'active',
          location: 'live',
          recordState: 'valid',
          errors: [],
          activity: null,
          phases: [
            {
              name: 'Build',
              steps: [
                { id: 'Phase 0.1', label: 'Inspect', done: true },
                { id: 'Phase 0.2', label: 'Implement', done: false },
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
        },
      ],
    })
  })

  it('keeps every optional field of the spec example and ignores unknown fields', () => {
    const full = task({
      ref: 'NEKODE-101',
      title: 'NEKODE-101: Tokeny palety',
      state: 'completed',
      location: 'archived',
      errors: [],
      activity: 'idle',
      currentStepId: 'Phase 0.2',
      currentLabel: 'Implementing',
      corrections: 2,
      reviews: 1,
      nextAction: 'Close',
      blockers: null,
      createdAt: '2026-10-23T09:14:09Z',
      updatedAt: '2026-10-23T09:27:37.123Z',
      completedAt: '2026-10-23T09:27:37Z',
      checkpoints: [{ stepId: 'Phase 0.1', completedAt: '2026-10-23T09:14:57Z', extra: 1 }],
      path: '.agents/tasks/archive/nekode-101 zadanie/task.md',
      futureField: { nested: true },
    })
    const result = validateTaskProgressSnapshot(snapshot({ tasks: [full], extra: 'x' }), LABEL)
    expect(result.tasks[0]).toMatchObject({
      ref: 'NEKODE-101',
      state: 'completed',
      location: 'archived',
      activity: 'idle',
      currentStepId: 'Phase 0.2',
      currentLabel: 'Implementing',
      corrections: 2,
      reviews: 1,
      nextAction: 'Close',
      updatedAt: '2026-10-23T09:27:37.123Z',
      checkpoints: [{ stepId: 'Phase 0.1', completedAt: '2026-10-23T09:14:57Z' }],
      path: '.agents/tasks/archive/nekode-101 zadanie/task.md',
    })
    expect(result.tasks[0]).not.toHaveProperty('futureField')
    expect(result).not.toHaveProperty('extra')
  })

  it('accepts empty tasks and empty phases for records that are not valid', () => {
    expect(validateTaskProgressSnapshot(snapshot({ tasks: [] }), LABEL).tasks).toEqual([])
    const broken = task({ recordState: 'invalid', phases: [], errors: ['missing Phase 1'] })
    expect(
      validateTaskProgressSnapshot(snapshot({ tasks: [broken] }), LABEL).tasks[0],
    ).toMatchObject({ recordState: 'invalid', phases: [], errors: ['missing Phase 1'] })
  })

  it('defaults watch recursive to false and accepts the project root', () => {
    const result = validateTaskProgressSnapshot(snapshot({ watch: [{ path: '.' }] }), LABEL)
    expect(result.watch).toEqual([{ path: '.', recursive: false }])
  })

  it.each([
    ['a non-object', 'nope'],
    ['an array', []],
    ['another schemaVersion', snapshot({ schemaVersion: 2 })],
    ['a missing generatedAt', snapshot({ generatedAt: undefined })],
    ['a non-UTC generatedAt', snapshot({ generatedAt: '2026-10-23T09:27:37+02:00' })],
    ['a missing watch', snapshot({ watch: undefined })],
    ['a missing tasks', snapshot({ tasks: undefined })],
    ['tasks not an array', snapshot({ tasks: {} })],
  ])('rejects %s', (_name, data) => {
    rejection(data)
  })

  it.each([
    ['missing id', { id: undefined }],
    ['empty id', { id: '' }],
    ['id over 120 characters', { id: 'x'.repeat(121) }],
    ['unknown state', { state: 'done' }],
    ['missing location', { location: undefined }],
    ['unknown recordState', { recordState: 'ok' }],
    ['missing phases', { phases: undefined }],
    ['empty phases on a valid record', { phases: [] }],
    ['a step without done', { phases: [{ name: 'A', steps: [{ id: '1', label: 'x' }] }] }],
    ['a phase without name', { phases: [{ steps: [] }] }],
    [
      'duplicate step ids',
      {
        phases: [
          {
            name: 'A',
            steps: [
              { id: '1', label: 'a', done: false },
              { id: '1', label: 'b', done: false },
            ],
          },
        ],
      },
    ],
    ['ref of the wrong type', { ref: 7 }],
    ['errors not a list of text', { errors: [1] }],
    ['unknown activity', { activity: 'busy' }],
    ['currentStepId without a step', { currentStepId: 'Phase 9' }],
    ['currentLabel over 40 characters', { currentLabel: 'x'.repeat(41) }],
    ['negative corrections', { corrections: -1 }],
    ['fractional reviews', { reviews: 1.5 }],
    ['blockers of the wrong type', { blockers: false }],
    ['a non-ISO updatedAt', { updatedAt: 'yesterday' }],
    ['a checkpoint without completedAt', { checkpoints: [{ stepId: 'Phase 0.1' }] }],
    ['an absolute path', { path: 'C:/repo/task.md' }],
  ])('rejects a task with %s', (_name, overrides) => {
    rejection(snapshot({ tasks: [task(overrides)] }))
  })

  it('rejects a duplicate task id across the snapshot', () => {
    const error = rejection(snapshot({ tasks: [task(), task({ location: 'archived' })] }))
    expect(error.message).toContain('nekode-101-palette-tokens')
  })

  it.each([
    ['a parent segment', [{ path: '../outside' }]],
    ['a nested parent segment', [{ path: '.agents/../../outside' }]],
    ['a POSIX absolute path', [{ path: '/etc' }]],
    ['a drive path', [{ path: 'C:\\repo' }]],
    ['a UNC path', [{ path: '\\\\wsl.localhost\\Ubuntu\\x' }]],
    ['an empty path', [{ path: '' }]],
    ['a non-boolean recursive', [{ path: 'a', recursive: 'yes' }]],
    ['more than 8 entries', Array.from({ length: 9 }, (_, index) => ({ path: `d${index}` }))],
    ['a non-array watch', { path: 'a' }],
  ])('rejects watch with %s', (_name, watch) => {
    rejection(snapshot({ watch }))
  })
})
