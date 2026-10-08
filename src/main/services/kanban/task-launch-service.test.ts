import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentProfile,
  HandoffCandidatesResult,
  KanbanHandoffCandidatesInput,
  KanbanResumeLaunchInput,
  KanbanStartLaunchInput,
  WorkItem,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { ChatService } from '../chat-service'
import { ProjectService } from '../project-service'
import {
  type PtyProcessLike,
  type PtySpawnOptions,
  TerminalService,
} from '../terminal/terminal-service'
import { buildResumePrompt, buildStartPrompt, TaskLaunchService } from './task-launch-service'

const openDatabases: Array<{ close(): void }> = []
const projectPath = join(tmpdir(), 'nekode-task-launch', 'demo-project')
const LEAK = 'PROMPT_LEAK_9f3a'
const HANDOFF = 'D:\\handoffs\\box'
const URL = 'https://example.test/tasks/DEMO-1?q=1&x=2'

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

class FakePty implements PtyProcessLike {
  readonly pid: number
  readonly options: PtySpawnOptions

  constructor(pid: number, options: PtySpawnOptions) {
    this.pid = pid
    this.options = options
  }

  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(): { dispose(): void } {
    return { dispose() {} }
  }
  onExit(): { dispose(): void } {
    return { dispose() {} }
  }
}

function liveItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    ref: 'DEMO-1',
    id: 'native-1',
    title: 'Ship the launch',
    description: `line one\nline "two" & | ; \` {prompt} ${LEAK}`,
    stateId: 'st1',
    stateName: 'Started',
    stateGroup: 'started',
    priority: 'high',
    assignee: null,
    url: URL,
    updatedAt: null,
    ...overrides,
  }
}

const profile: AgentProfile = {
  id: 'prof-1',
  name: 'Codex',
  executable: 'codex.exe',
  args: ['--model', 'gpt', '{prompt}', '--yolo'],
}

const STAMP = new Date(1000).toISOString()
const EMPTY_SCAN: HandoffCandidatesResult = {
  state: 'ready',
  files: [],
  rejections: [],
  link: null,
}

/** One ready scan result. `files` carry the name, display path and stamp. */
function readyScan(
  files: Array<{
    name: string
    path: string
    modifiedAt: string
    matchKind: 'metadata' | 'filename' | 'none'
  }>,
  link: { name: string; path: string; modifiedAt: string } | null = null,
): HandoffCandidatesResult {
  return { state: 'ready', files, rejections: [], link }
}

function input(overrides: Partial<KanbanStartLaunchInput> = {}): KanbanStartLaunchInput {
  return {
    projectId: 'pending',
    itemId: 'native-1',
    ref: 'DEMO-1',
    profileId: profile.id,
    attemptId: 'attempt-1',
    mode: 'start',
    ...overrides,
  }
}

function resumeInput(overrides: Partial<KanbanResumeLaunchInput> = {}): KanbanResumeLaunchInput {
  return {
    projectId: 'pending',
    itemId: 'native-1',
    ref: 'DEMO-1',
    profileId: profile.id,
    attemptId: 'resume-1',
    mode: 'resume',
    fileName: 'nekode-28-notes.md',
    stamp: STAMP,
    ...overrides,
  }
}

function harness(options: { handoff?: string | null; failSpawn?: boolean } = {}) {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: { stat: () => ({ isDirectory: () => true }) },
  })
  const project = projects.add(projectPath)
  const chats = new ChatService({ db, chatName: () => 'PowerShell' })
  const spawns: PtySpawnOptions[] = []
  const terminals = new TerminalService({
    isDirectory: () => true,
    createPty: (spawn) => {
      spawns.push(spawn)
      if (options.failSpawn || spawn.args.some((arg) => arg.includes('SPAWN_FAIL'))) {
        throw new Error(`pty failed ${spawn.file} ${spawn.args.join('\u0000')}`)
      }
      return new FakePty(spawns.length, spawn)
    },
  })
  const reads: string[] = []
  let current = liveItem()
  const getItem = vi.fn(async () => current)
  let scan: (input: KanbanHandoffCandidatesInput) => HandoffCandidatesResult = () => EMPTY_SCAN
  const handoffScans: KanbanHandoffCandidatesInput[] = []
  const handoffs = {
    candidates: vi.fn(async (candidatesInput: KanbanHandoffCandidatesInput) => {
      handoffScans.push(candidatesInput)
      return scan(candidatesInput)
    }),
  }
  const service = new TaskLaunchService({
    projects,
    profiles: {
      get: () => ({ defaultId: profile.id, profiles: [profile] }),
    },
    kanban: { getItem },
    handoffs,
    handoffDir: (projectId) => {
      reads.push(projectId)
      if (reads.some((key) => key.includes('autoSend') || key.includes('handoffResume'))) {
        throw new Error('Start read handoffResume.autoSend')
      }
      const value = options.handoff === undefined ? HANDOFF : options.handoff
      return value
    },
    createChat: (projectId, name) => chats.createNamed(projectId, name),
    terminals,
  })
  return {
    service,
    projects,
    project,
    chats,
    spawns,
    getItem,
    reads,
    handoffs,
    handoffScans,
    setScan: (next: (input: KanbanHandoffCandidatesInput) => HandoffCandidatesResult) => {
      scan = next
    },
    setItem: (next: WorkItem) => {
      current = next
    },
  }
}

describe('buildStartPrompt', () => {
  it('includes the live description, URL, instructions, and handoff directory', () => {
    const prompt = buildStartPrompt(liveItem(), HANDOFF)
    expect(prompt.startsWith('Work on task DEMO-1: Ship the launch.')).toBe(true)
    expect(prompt).toContain(`line one\nline "two" & | ; \` {prompt} ${LEAK}`)
    expect(prompt).toContain(URL)
    expect(prompt).toContain(
      "Follow the project's instructions. Do not assume approval for actions that require it.",
    )
    expect(prompt).toContain(
      "Keep the full ref in the name of the future local record and handoff, following the project's instructions.",
    )
    expect(prompt).toContain(`The project's handoff directory is ${HANDOFF}.`)
    expect(prompt).not.toContain('autoSend')
  })

  it('says when the description, URL, or handoff directory is missing', () => {
    const prompt = buildStartPrompt(liveItem({ description: '  ', url: ' \n' }), '   ')
    expect(prompt).toContain('This task has no description.')
    expect(prompt).not.toContain(URL)
    expect(prompt).not.toContain('handoff directory')
  })
})

describe('TaskLaunchService start', () => {
  it('refetches the item and passes the prompt as one argv element', async () => {
    const bundle = harness()
    const launch = input({ projectId: bundle.project.id })
    const result = await bundle.service.launch(launch)
    expect(bundle.getItem).toHaveBeenCalledTimes(1)
    expect(bundle.getItem).toHaveBeenCalledWith(bundle.project.id, 'DEMO-1')
    expect(result.delivered).toBe(true)
    expect(result.chat.name).toBe('Codex')
    expect(result.chat.projectId).toBe(bundle.project.id)
    expect(bundle.chats.list(bundle.project.id)).toEqual([result.chat])
    expect(bundle.chats.create(bundle.project.id).name).toBe('PowerShell')
    expect(bundle.spawns).toHaveLength(1)
    const spawn = bundle.spawns[0]
    expect(spawn?.file).toBe('codex.exe')
    expect(spawn?.cwd).toBe(projectPath)
    const prompt = buildStartPrompt(liveItem(), HANDOFF)
    expect(spawn?.args).toEqual(['--model', 'gpt', prompt, '--yolo'])
    expect(spawn?.args[2]).toContain('\n')
    expect(spawn?.args[2]).toContain('"')
    expect(spawn?.args[2]).toContain('&')
    expect(spawn?.args[2]).toContain('|')
    expect(spawn?.args[2]).toContain(';')
    expect(spawn?.args[2]).toContain('`')
    expect(spawn?.args[2]).toContain(' ')
    expect(spawn?.args.filter((arg) => arg.includes(LEAK))).toHaveLength(1)
    expect(bundle.reads).toEqual([bundle.project.id])
    expect(bundle.service.blocksProjectShell(result.chat.id)).toBe(false)
  })

  it('uses a fresh getItem for a new confirmation', async () => {
    const bundle = harness()
    await bundle.service.launch(input({ projectId: bundle.project.id, attemptId: 'a' }))
    bundle.setItem(liveItem({ title: 'Updated title' }))
    await bundle.service.launch(input({ projectId: bundle.project.id, attemptId: 'b' }))
    expect(bundle.getItem).toHaveBeenCalledTimes(2)
    expect(bundle.spawns[1]?.args[2]).toContain('Work on task DEMO-1: Updated title.')
    expect(
      bundle.chats.list(bundle.project.id).filter((chat) => chat.name === 'Codex'),
    ).toHaveLength(2)
  })

  it('returns the same in-flight chat and does not spawn twice', async () => {
    const bundle = harness()
    let release: (item: WorkItem) => void = () => undefined
    bundle.getItem.mockImplementation(
      () =>
        new Promise<WorkItem>((resolve) => {
          release = resolve
        }),
    )
    const launch = input({ projectId: bundle.project.id })
    const first = bundle.service.launch(launch)
    const second = bundle.service.launch(launch)
    expect(second).toBe(first)
    expect(bundle.getItem).toHaveBeenCalledTimes(1)
    release(liveItem())
    const [left, right] = await Promise.all([first, second])
    expect(left.chat.id).toBe(right.chat.id)
    expect(bundle.spawns).toHaveLength(1)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
  })

  it('does not spawn again after argv was delivered', async () => {
    const bundle = harness()
    const launch = input({ projectId: bundle.project.id })
    const first = await bundle.service.launch(launch)
    const again = await bundle.service.launch(launch)
    expect(again).toEqual(first)
    expect(bundle.spawns).toHaveLength(1)
    expect(bundle.getItem).toHaveBeenCalledTimes(1)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
  })

  it('retries a failed spawn on the same chat and keeps the prompt out of logs', async () => {
    const bundle = harness()
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    bundle.setItem(liveItem({ description: `needs SPAWN_FAIL ${LEAK}\n"quoted" & | ; \`` }))
    const launch = input({ projectId: bundle.project.id })
    const failed = await bundle.service.launch(launch)
    expect(failed.delivered).toBe(false)
    expect(bundle.spawns).toHaveLength(1)
    expect(bundle.service.blocksProjectShell(failed.chat.id)).toBe(true)
    const logged = JSON.stringify(errors)
    expect(logged).toContain('[terminal] failed to spawn PTY')
    expect(logged).toContain('[kanban-launch] failed to start the task process')
    expect(logged).not.toContain(LEAK)
    expect(logged).not.toContain(URL)
    expect(logged).not.toContain(HANDOFF)
    expect(logged).not.toContain('SPAWN_FAIL')
    expect(logged).not.toContain('quoted')
    bundle.setItem(liveItem())
    const retried = await bundle.service.launch(launch)
    expect(retried.delivered).toBe(true)
    expect(retried.chat.id).toBe(failed.chat.id)
    expect(bundle.spawns).toHaveLength(2)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
    expect(bundle.service.blocksProjectShell(failed.chat.id)).toBe(false)
    const quiet = await bundle.service.launch(launch)
    expect(quiet.delivered).toBe(true)
    expect(bundle.spawns).toHaveLength(2)
    spy.mockRestore()
  })

  it('drops an in-flight start when the project is removed', async () => {
    const bundle = harness()
    let release: (item: WorkItem) => void = () => undefined
    bundle.getItem.mockImplementation(
      () =>
        new Promise<WorkItem>((resolve) => {
          release = resolve
        }),
    )
    const pending = bundle.service.launch(input({ projectId: bundle.project.id }))
    bundle.service.dropProject(bundle.project.id)
    release(liveItem())
    await expect(pending).rejects.toMatchObject({
      code: 'not_found',
      message: 'Project not found.',
    })
    expect(bundle.spawns).toHaveLength(0)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(0)
  })

  it('rejects an invalid resume and a mismatched retry before creating a chat', async () => {
    const bundle = harness()
    // A file name that is a path, or a missing stamp, is not a valid resume.
    expect(() =>
      bundle.service.launch(resumeInput({ projectId: bundle.project.id, fileName: 'a/b.md' })),
    ).toThrow(/file name, not a path/)
    expect(() =>
      bundle.service.launch({ ...resumeInput({ projectId: bundle.project.id }), stamp: '' }),
    ).toThrow(/stamp is invalid/)
    bundle.setItem(liveItem({ id: 'other-native' }))
    await expect(
      bundle.service.launch(input({ projectId: bundle.project.id })),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'The task changed. Refresh the board and start again.',
    })
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(0)
    bundle.setItem(liveItem())
    await bundle.service.launch(input({ projectId: bundle.project.id, attemptId: 'kept' }))
    expect(() =>
      bundle.service.launch(
        input({ projectId: bundle.project.id, attemptId: 'kept', profileId: 'other' }),
      ),
    ).toThrow(AppError)
    expect(bundle.spawns).toHaveLength(1)
  })
})

describe('buildResumePrompt', () => {
  it('starts with the spec sentence and carries the description, URL and path', () => {
    const prompt = buildResumePrompt(liveItem(), 'handoffs/nekode-28-notes.md', HANDOFF)
    expect(
      prompt.startsWith(
        'Resume task DEMO-1: Ship the launch from handoff handoffs/nekode-28-notes.md. Read the handoff first and reconcile it with the current repository state before continuing.',
      ),
    ).toBe(true)
    expect(prompt).toContain(URL)
    expect(prompt).toContain(
      "Follow the project's instructions. Do not assume approval for actions that require it.",
    )
    expect(prompt).toContain(`The project's handoff directory is ${HANDOFF}.`)
  })
})

describe('TaskLaunchService resume', () => {
  const notesFile = {
    name: 'nekode-28-notes.md',
    path: 'handoffs/nekode-28-notes.md',
    modifiedAt: STAMP,
    matchKind: 'filename' as const,
  }

  it('rechecks the file and stamp, then passes the Resume prompt as one argv element', async () => {
    const bundle = harness()
    bundle.setScan(() => readyScan([notesFile]))
    const launch = resumeInput({ projectId: bundle.project.id })
    const result = await bundle.service.launch(launch)
    expect(bundle.getItem).toHaveBeenCalledTimes(1)
    expect(bundle.getItem).toHaveBeenCalledWith(bundle.project.id, 'DEMO-1')
    expect(bundle.handoffs.candidates).toHaveBeenCalledWith({
      projectId: bundle.project.id,
      itemId: 'native-1',
      ref: 'DEMO-1',
    })
    expect(result.delivered).toBe(true)
    expect(result.chat.name).toBe('Codex')
    expect(bundle.chats.list(bundle.project.id)).toEqual([result.chat])
    expect(bundle.spawns).toHaveLength(1)
    const spawn = bundle.spawns[0]
    expect(spawn?.cwd).toBe(projectPath)
    const prompt = buildResumePrompt(liveItem(), notesFile.path, HANDOFF)
    expect(spawn?.args).toEqual(['--model', 'gpt', prompt, '--yolo'])
    expect(spawn?.args[2]?.startsWith('Resume task DEMO-1: Ship the launch from handoff')).toBe(
      true,
    )
    expect(spawn?.args[2]).toContain('handoffs/nekode-28-notes.md')
    expect(spawn?.args.filter((arg) => arg.includes(LEAK))).toHaveLength(1)
  })

  it('refreshes the choice and creates no chat when the stamp changed or the file is gone', async () => {
    const bundle = harness()
    bundle.setScan(() => readyScan([{ ...notesFile, modifiedAt: new Date(2000).toISOString() }]))
    await expect(
      bundle.service.launch(resumeInput({ projectId: bundle.project.id })),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: /Refresh the handoff list and resume again/,
    })
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(0)
    expect(bundle.spawns).toHaveLength(0)

    bundle.setScan(() => readyScan([]))
    await expect(
      bundle.service.launch(resumeInput({ projectId: bundle.project.id, attemptId: 'resume-2' })),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(0)
    expect(bundle.spawns).toHaveLength(0)

    bundle.setScan(() => ({ state: 'error', message: 'Handoff directory not found: D:/x' }))
    await expect(
      bundle.service.launch(resumeInput({ projectId: bundle.project.id, attemptId: 'resume-3' })),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(bundle.spawns).toHaveLength(0)
  })

  it('does not carry a link to a different adapter binding: an unlinked none-match is refused', async () => {
    const bundle = harness()
    bundle.setScan(() => readyScan([{ ...notesFile, name: 'loose.md', matchKind: 'none' }]))
    await expect(
      bundle.service.launch(resumeInput({ projectId: bundle.project.id, fileName: 'loose.md' })),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(bundle.spawns).toHaveLength(0)
  })

  it('accepts an explicit link and uses the absolute path when the file is outside the project', async () => {
    const bundle = harness()
    const linked = { name: 'outer.md', path: 'D:/outside/outer.md', modifiedAt: STAMP }
    bundle.setScan(() => readyScan([], linked))
    const result = await bundle.service.launch(
      resumeInput({ projectId: bundle.project.id, fileName: 'outer.md' }),
    )
    expect(result.delivered).toBe(true)
    expect(bundle.spawns[0]?.args[2]).toContain('from handoff D:/outside/outer.md.')
  })

  it('dedups a resume by attempt id and keeps the prompt and handoff path out of logs', async () => {
    const bundle = harness()
    bundle.setItem(liveItem({ description: `needs SPAWN_FAIL ${LEAK}` }))
    bundle.setScan(() => readyScan([{ ...notesFile, matchKind: 'metadata' }]))
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    const launch = resumeInput({ projectId: bundle.project.id })
    const failed = await bundle.service.launch(launch)
    expect(failed.delivered).toBe(false)
    expect(bundle.service.blocksProjectShell(failed.chat.id)).toBe(true)
    const again = await bundle.service.launch(launch)
    expect(again.delivered).toBe(false)
    expect(again.chat.id).toBe(failed.chat.id)
    expect(bundle.spawns).toHaveLength(2)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
    const logged = JSON.stringify(errors)
    expect(logged).not.toContain(LEAK)
    expect(logged).not.toContain('handoffs/nekode-28-notes.md')
    spy.mockRestore()
  })
})
