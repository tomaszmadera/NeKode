import { describe, expect, it } from 'vitest'
import { parseTaskMarkdown, type TaskRecordFs, TaskRecordService } from './task-record-service'

describe('parseTaskMarkdown', () => {
  it('parses explicit progress block from frontmatter', () => {
    const content = `---
id: nekode-74-spec-content-verification
status: active
current_phase: Phase 2
progress:
  step: 5
  total_steps: 8
  step_name: Fixes
  fix: 3
---

# Weryfikacja tresci 15 specyfikacji funkcji wobec kodu
`
    const parsed = parseTaskMarkdown(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.step).toBe(5)
    expect(parsed?.totalSteps).toBe(8)
    expect(parsed?.stepName).toBe('Fixes')
    expect(parsed?.fix).toBe(3)
    expect(parsed?.ariaLabel).toBe('Task progress: step 5 of 8, Fixes, fix 3')
    expect(parsed?.label).toBe('Fixes · fix:3')
    expect(parsed?.taskId).toBe('NEKODE-74')
  })

  it('derives dynamic steps and Fixes with fix count from checklist and Timing table', () => {
    const content = `---
id: nekode-74-spec-content-verification
status: active
current_phase: Phase 2
current_step: Phase 2.1
---

# Weryfikacja tresci 15 specyfikacji funkcji wobec kodu

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification

## Phase 1 - Specification and plan

- [x] Phase 1.1 - Write the specification
- [x] Phase 1.2 - Write the plan
- [x] Phase 1.3 - Obtain plan approval

## Phase 2 - Implementation

- [ ] Phase 2.1 - Stage 1: implementation

## Phase 3 - Verification and closure

- [ ] Phase 3.1 - Prepare closure, run final verification, and close the recorded task

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| approval | wait | 2026-10-17T13:37:10Z | 2026-10-17T13:40:09Z |
| implement:1 | work | 2026-10-17T13:42:18Z | 2026-10-17T14:11:00Z |
| review:1 | work | 2026-10-17T14:11:00Z | 2026-10-17T14:21:51Z |
| correction:1 | work | 2026-10-17T14:21:51Z | 2026-10-17T14:23:06Z |
| review:1 | work | 2026-10-17T14:23:06Z | 2026-10-17T14:24:25Z |
| correction:2 | work | 2026-10-17T14:24:25Z | 2026-10-17T14:25:00Z |
| correction:3 | work | 2026-10-17T14:25:00Z |  |
`
    const parsed = parseTaskMarkdown(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.step).toBe(5)
    expect(parsed?.totalSteps).toBe(6)
    expect(parsed?.stepName).toBe('Fixes')
    expect(parsed?.fix).toBe(3)
    expect(parsed?.stepNames).toEqual([
      'Intake',
      'Specification',
      'Plan',
      'Plan approval',
      'Stage 1',
      'Verification',
    ])
    expect(parsed?.ariaLabel).toBe('Task progress: step 5 of 6, Fixes, fix 3')
    expect(parsed?.label).toBe('Fixes · fix:3')
  })

  it('derives last step Verification when status is completed without Merge', () => {
    const content = `---
id: nekode-74-spec-content-verification
status: completed
current_phase: Phase 3
current_step: none
---

# Weryfikacja tresci

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification

## Phase 1 - Specification and plan

- [x] Phase 1.1 - Write the specification
- [x] Phase 1.2 - Write the plan
- [x] Phase 1.3 - Obtain plan approval

## Phase 2 - Implementation

- [x] Phase 2.1 - Stage 1: implementation

## Phase 3 - Verification and closure

- [x] Phase 3.1 - Prepare closure, run final verification, and close the recorded task
`
    const parsed = parseTaskMarkdown(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.step).toBe(6)
    expect(parsed?.totalSteps).toBe(6)
    expect(parsed?.stepName).toBe('Verification')
    expect(parsed?.ariaLabel).toBe('Task progress: step 6 of 6, Verification')
  })
})

describe('TaskRecordService', () => {
  const mockTaskMd = `---
id: nekode-74-spec-content-verification
status: active
current_phase: Phase 2
progress:
  step: 5
  total_steps: 8
  step_name: Fixes
  fix: 3
---

# Weryfikacja tresci 15 specyfikacji
`

  const createMockFs = (): TaskRecordFs => {
    const files: Record<string, string> = {
      'C:/project/.agents/tasks/archive/nekode-74-spec-content-verification/task.md': mockTaskMd,
    }
    const dirs: Record<string, string[]> = {
      'C:/project/.agents/tasks': ['archive'],
      'C:/project/.agents/tasks/archive': ['nekode-74-spec-content-verification'],
    }
    return {
      existsSync: (p) => p.replace(/\\/g, '/') in files || p.replace(/\\/g, '/') in dirs,
      readdirSync: (p) => dirs[p.replace(/\\/g, '/')] ?? [],
      readFileSync: (p) => files[p.replace(/\\/g, '/')] ?? '',
    }
  }

  it('discovers task when chat name contains exact ref NEKODE-74', () => {
    const service = new TaskRecordService({ fs: createMockFs() })
    const task = service.getTaskForChat('C:/project', 'NEKODE-74')
    expect(task).not.toBeNull()
    expect(task?.taskId).toBe('NEKODE-74')
    expect(task?.step).toBe(5)
    expect(task?.totalSteps).toBe(8)
    expect(task?.ariaLabel).toBe('Task progress: step 5 of 8, Fixes, fix 3')
  })

  it('discovers task when chat name has shell prefix [PS7] NEKODE-74', () => {
    const service = new TaskRecordService({ fs: createMockFs() })
    const task = service.getTaskForChat('C:/project', '[PS7] NEKODE-74')
    expect(task).not.toBeNull()
    expect(task?.taskId).toBe('NEKODE-74')
    expect(task?.step).toBe(5)
  })

  it('discovers task when chat name has short format n74', () => {
    const service = new TaskRecordService({ fs: createMockFs() })
    const task = service.getTaskForChat('C:/project', 'n74')
    expect(task).not.toBeNull()
    expect(task?.taskId).toBe('NEKODE-74')
    expect(task?.step).toBe(5)
  })

  it('returns null when chat name has no matching task', () => {
    const service = new TaskRecordService({ fs: createMockFs() })
    const task = service.getTaskForChat('C:/project', '[PS7]')
    expect(task).toBeNull()
  })
})
