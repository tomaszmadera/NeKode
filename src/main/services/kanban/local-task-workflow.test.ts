import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOCAL_PROGRESS_RESUME_SOURCE,
  matchesResumeCandidateRef,
} from '@shared/contracts/resume-sources-contract'
import type { AppError } from '@shared/ipc-error'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverResumeFiles } from '../handoffs/resume-source-files'
import { LocalTaskFile } from './local-task-file'

// Complete no-Harness flow (local-task-workflow spec AC1, AC3-5, AC8): a real
// temporary project root, the built-in `local-file` task list, and the Files
// Resume source. Nothing here imports taskctl, Python, Plane, or a process
// adapter.

const CHANNEL = 'kanban:local-task-workflow-test'
const signal = new AbortController().signal

let root: string
let file: LocalTaskFile

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-local-workflow-'))
  file = new LocalTaskFile({
    projects: {
      get: (projectId: string) => (projectId === 'p1' ? { path: root } : null),
    },
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function progressFile(ref: string): string {
  return join(root, 'work', ref, 'progress.md')
}

function writeProgress(ref: string, text = '# Progress\n\nNext action: finish the task.\n'): void {
  mkdirSync(join(root, 'work', ref), { recursive: true })
  writeFileSync(progressFile(ref), text)
}

async function createCards(count: number): Promise<Array<{ ref: string; revision: number }>> {
  await file.ensure('p1', CHANNEL)
  let revision = 1
  const created: Array<{ ref: string; revision: number }> = []
  for (let index = 0; index < count; index += 1) {
    const item = await file.createItem(
      'p1',
      { title: `Local task ${index + 1}`, stateRef: 'in progress' },
      revision,
      CHANNEL,
    )
    revision = item.revision as number
    created.push({ ref: item.ref, revision })
  }
  return created
}

describe('local task workflow without Harness', () => {
  it('discovers the T-1 progress file through the ready preset without taskctl or Python', async () => {
    const [card] = await createCards(1)
    expect(card.ref).toBe('T-1')
    expect(LOCAL_PROGRESS_RESUME_SOURCE).toEqual({
      kind: 'files',
      directory: 'work',
      pattern: 'progress.md',
      recursive: true,
      identity: 'parent',
    })
    writeProgress('T-1')

    const discovery = await discoverResumeFiles(root, LOCAL_PROGRESS_RESUME_SOURCE, signal)

    expect(discovery.candidates.map((candidate) => candidate.id)).toEqual(['T-1'])
    expect(discovery.candidates[0].path).toBe(progressFile('T-1'))
    expect(matchesResumeCandidateRef(card.ref, discovery.candidates[0].id)).toBe(true)
    expect(() => readFileSync(join(root, '.agents', 'scripts', 'taskctl'))).toThrow()
  })

  it('does not match T-10 or a missing progress file to T-1', async () => {
    await createCards(10)
    writeProgress('T-1')
    writeProgress('T-10')

    const discovery = await discoverResumeFiles(root, LOCAL_PROGRESS_RESUME_SOURCE, signal)
    const ids = discovery.candidates.map((candidate) => candidate.id)

    expect(ids).toContain('T-1')
    expect(ids).toContain('T-10')
    expect(matchesResumeCandidateRef('T-1', 'T-10')).toBe(false)
    expect(matchesResumeCandidateRef('T-1', 'T-1-follow-up')).toBe(true)
    expect(ids).not.toContain('T-3')
  })

  it('withdraws completed context to work-completed and restores it on reopening', async () => {
    await createCards(1)
    writeProgress('T-1')
    expect(
      (await discoverResumeFiles(root, LOCAL_PROGRESS_RESUME_SOURCE, signal)).candidates.map(
        (candidate) => candidate.id,
      ),
    ).toEqual(['T-1'])

    mkdirSync(join(root, 'work-completed'), { recursive: true })
    renameSync(join(root, 'work', 'T-1'), join(root, 'work-completed', 'T-1'))

    expect(
      (await discoverResumeFiles(root, LOCAL_PROGRESS_RESUME_SOURCE, signal)).candidates,
    ).toEqual([])

    renameSync(join(root, 'work-completed', 'T-1'), join(root, 'work', 'T-1'))

    expect(
      (await discoverResumeFiles(root, LOCAL_PROGRESS_RESUME_SOURCE, signal)).candidates.map(
        (candidate) => candidate.id,
      ),
    ).toEqual(['T-1'])
  })

  it('rejects a parallel write with the stale revision and keeps the newer file', async () => {
    await createCards(1)
    const newer = await file.updateItem('p1', 'T-1', { title: 'Newer title' }, 2, CHANNEL)
    expect(newer.revision).toBe(3)

    await expect(
      file.updateItem('p1', 'T-1', { title: 'Stale title' }, 2, CHANNEL),
    ).rejects.toMatchObject<Partial<AppError>>({ code: 'conflict' })

    const document = JSON.parse(readFileSync(join(root, '.nekode', 'tasks.json'), 'utf8')) as {
      revision: number
      items: Array<{ ref: string; title: string }>
    }
    expect(document.revision).toBe(3)
    expect(document.items.find((item) => item.ref === 'T-1')?.title).toBe('Newer title')
  })
})
