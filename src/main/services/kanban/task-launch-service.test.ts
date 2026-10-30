import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentProfile,
  KanbanDraftLaunchInput,
  KanbanResumeLaunchInput,
  KanbanStartLaunchInput,
  WorkItem,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { isWindowsHost } from '../../test-support/host-path'
import { AgentProfilesService } from '../agent-profiles/agent-profiles-service'
import { AppStateService } from '../app-state-service'
import { ChatService } from '../chat-service'
import { ProjectService } from '../project-service'
import {
  type PtyProcessLike,
  type PtySpawnOptions,
  TerminalService,
} from '../terminal/terminal-service'
import { runWslAsync } from '../terminal/wsl-async'
import { buildStartPrompt, TaskLaunchService } from './task-launch-service'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'usable') }))
vi.mock('../terminal/wsl-async', () => ({ runWslAsync: vi.fn(async () => 'usable') }))

const openDatabases: Array<{ close(): void }> = []
const projectPath = join(tmpdir(), 'nekode-task-launch', 'demo-project')
const LEAK = 'PROMPT_LEAK_9f3a'
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
    prompt: 'Resume from handoffs/nekode-28-notes.md',
    ...overrides,
  }
}

function harness(
  options: {
    failSpawn?: boolean
    globalProfiles?: boolean
    path?: string
    profile?: AgentProfile
  } = {},
) {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: { stat: () => ({ isDirectory: () => true }) },
  })
  const project = projects.add(options.path ?? projectPath)
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
  let current = liveItem()
  const getItem = vi.fn(async () => current)
  const globalProfiles = new AgentProfilesService({ projects, state: new AppStateService({ db }) })
  const service = new TaskLaunchService({
    projects,
    profiles: options.globalProfiles
      ? globalProfiles
      : {
          get: () => ({ defaultId: profile.id, profiles: [options.profile ?? profile] }),
        },
    kanban: { getItem },
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, 'kanban:launchTask', identity),
    terminals,
  })
  return {
    service,
    globalProfiles,
    projects,
    project,
    chats,
    terminals,
    spawns,
    getItem,
    setItem: (next: WorkItem) => {
      current = next
    },
  }
}

describe('project opt-in at Kanban launch', () => {
  it('rejects a removed project while terminal creation is pending', async () => {
    const bundle = harness()
    let finish: () => void = () => {}
    let started: () => void = () => {}
    const spawnStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(bundle.terminals, 'create').mockImplementationOnce(() => {
      started()
      return new Promise<string>((resolve) => {
        finish = () => resolve('chat')
      }) as unknown as string
    })
    const result = bundle.service.launch(input({ projectId: bundle.project.id }))
    await spawnStarted
    bundle.service.dropProject(bundle.project.id)
    finish()
    await expect(result).rejects.toThrow('Project not found.')
  })
  // WSL UNC project paths are Windows-only (absolute only under win32 path rules).
  it.skipIf(!isWindowsHost).each(['start', 'resume'] as const)(
    'reports a missing WSL CLI before creating a %s chat',
    async (mode) => {
      const h = harness({ globalProfiles: true, path: '\\\\wsl$\\Ubuntu\\tmp' })
      const selected = h.globalProfiles.put({
        id: null,
        name: 'Missing',
        command: 'missing-cli "{prompt}"',
      }).profiles[0]
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [selected.id], defaultId: null })
      vi.mocked(runWslAsync).mockResolvedValueOnce('')
      const fields = { projectId: h.project.id, profileId: selected.id }
      await expect(
        h.service.launch(mode === 'start' ? input(fields) : resumeInput(fields)),
      ).rejects.toMatchObject({
        code: 'not_found',
        message: expect.stringMatching(/missing-cli.*Ubuntu/),
      })
      expect(h.chats.list(h.project.id)).toEqual([])
      expect(h.spawns).toEqual([])
    },
  )

  it.skipIf(!isWindowsHost)(
    'rejects a profile deselected during the WSL executable probe',
    async () => {
      const h = harness({ globalProfiles: true, path: '\\\\wsl$\\Ubuntu\\tmp' })
      const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'old "{prompt}"' })
        .profiles[0]
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
      let release!: (value: string) => void
      let started!: () => void
      const probing = new Promise<void>((resolve) => {
        started = resolve
      })
      vi.mocked(runWslAsync).mockImplementationOnce(() => {
        started()
        return new Promise((resolve) => {
          release = resolve
        })
      })
      const pending = h.service.launch(input({ projectId: h.project.id, profileId: agent.id }))
      await probing
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [], defaultId: null })
      release('usable')
      await expect(pending).rejects.toMatchObject({ code: 'not_found' })
      expect(h.chats.list(h.project.id)).toEqual([])
      expect(h.spawns).toEqual([])
    },
  )

  it.skipIf(!isWindowsHost)(
    'validates and uses a profile edited during the WSL executable probe',
    async () => {
      vi.mocked(runWslAsync).mockClear()
      const h = harness({ globalProfiles: true, path: '\\\\wsl$\\Ubuntu\\tmp' })
      const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'old "{prompt}"' })
        .profiles[0]
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
      let release!: (value: string) => void
      let started!: () => void
      const probing = new Promise<void>((resolve) => {
        started = resolve
      })
      vi.mocked(runWslAsync).mockImplementationOnce(() => {
        started()
        return new Promise((resolve) => {
          release = resolve
        })
      })
      const pending = h.service.launch(input({ projectId: h.project.id, profileId: agent.id }))
      await probing
      h.globalProfiles.put({ id: agent.id, name: 'Edited', command: 'updated --flag "{prompt}"' })
      release('usable')
      const result = await pending
      expect(result.chat.name).toBe('[PowerShell] Edited')
      expect(vi.mocked(runWslAsync).mock.calls.some((call) => call[1].includes('updated'))).toBe(
        true,
      )
      expect(h.spawns[0].args).toContain('updated')
      expect(h.spawns[0].args).toContain('--flag')
    },
  )

  it.skipIf(!isWindowsHost)(
    'validates a replacement profile when the pending WSL probe fails',
    async () => {
      vi.mocked(runWslAsync).mockClear()
      const h = harness({ globalProfiles: true, path: '\\\\wsl$\\Ubuntu\\tmp' })
      const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'old "{prompt}"' })
        .profiles[0]
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
      let release!: (value: string) => void
      let started!: () => void
      const probing = new Promise<void>((resolve) => {
        started = resolve
      })
      vi.mocked(runWslAsync).mockImplementationOnce(() => {
        started()
        return new Promise((resolve) => {
          release = resolve
        })
      })
      const pending = h.service.launch(input({ projectId: h.project.id, profileId: agent.id }))
      await probing
      h.globalProfiles.put({ id: agent.id, name: 'Edited', command: 'updated --flag "{prompt}"' })
      release('')
      const result = await pending
      expect(result.delivered).toBe(true)
      expect(result.chat.name).toBe('[PowerShell] Edited')
      expect(vi.mocked(runWslAsync).mock.calls.some((call) => call[1].includes('updated'))).toBe(
        true,
      )
      expect(h.spawns[0].args).toContain('updated')
      expect(h.spawns[0].args).toContain('--flag')
    },
  )

  it.each([
    { executable: 'hermes', flag: '-q', mode: 'start' },
    { executable: 'hermes', flag: '-q', mode: 'resume' },
    { executable: 'agy', flag: '-i', mode: 'start' },
    { executable: 'agy', flag: '-i', mode: 'resume' },
  ])(
    'keeps the task prompt flag for $executable $mode despite interactiveArgs',
    async ({ executable, flag, mode }) => {
      const h = harness({ globalProfiles: true })
      const agent = h.globalProfiles.put({
        id: null,
        name: executable,
        command: `${executable} ${flag} "{prompt}" --model "my model"`,
        interactiveArgs: [],
      }).profiles[0]
      h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
      const overrides = { projectId: h.project.id, profileId: agent.id }
      const result = await h.service.launch(
        mode === 'start' ? input(overrides) : resumeInput(overrides),
      )
      expect(result.delivered).toBe(true)
      expect(h.chats.list(h.project.id)).toHaveLength(1)
      expect(h.spawns).toHaveLength(1)
      const prompt =
        mode === 'start' ? buildStartPrompt(liveItem()) : 'Resume from handoffs/nekode-28-notes.md'
      expect(h.spawns[0].file).toBe(executable)
      expect(h.spawns[0].args).toEqual([flag, prompt, '--model', 'my model'])
    },
  )

  it('rejects a globally existing unselected profile with no chat or process', async () => {
    const h = harness({ globalProfiles: true })
    const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'agent "{prompt}"' })
      .profiles[0]
    await expect(
      h.service.launch(input({ projectId: h.project.id, profileId: agent.id })),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(h.chats.list(h.project.id)).toEqual([])
    expect(h.spawns).toEqual([])
    expect(h.getItem).not.toHaveBeenCalled()
  })

  it('rechecks selection after an awaited adapter read and refuses a removed selection without chat creation', async () => {
    const h = harness({ globalProfiles: true })
    const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'agent "{prompt}"' })
      .profiles[0]
    h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
    let resolveItem!: (item: WorkItem) => void
    h.getItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveItem = resolve
        }),
    )
    const pending = h.service.launch(input({ projectId: h.project.id, profileId: agent.id }))
    expect(h.getItem).toHaveBeenCalled()
    h.globalProfiles.selectionSet(h.project.id, { selectedIds: [], defaultId: null })
    resolveItem(liveItem())
    await expect(pending).rejects.toMatchObject({ code: 'not_found' })
    expect(h.chats.list(h.project.id)).toEqual([])
    expect(h.spawns).toEqual([])
  })

  it('uses an edited definition after adapter read and passes the full prompt as one argv element', async () => {
    const h = harness({ globalProfiles: true })
    const agent = h.globalProfiles.put({ id: null, name: 'Agent', command: 'old "{prompt}"' })
      .profiles[0]
    h.globalProfiles.selectionSet(h.project.id, { selectedIds: [agent.id], defaultId: null })
    let resolveItem!: (item: WorkItem) => void
    h.getItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveItem = resolve
        }),
    )
    const pending = h.service.launch(input({ projectId: h.project.id, profileId: agent.id }))
    expect(h.getItem).toHaveBeenCalled()
    h.globalProfiles.put({
      id: agent.id,
      name: 'Edited',
      command: 'updated --model "my model" "{prompt}"',
    })
    resolveItem(liveItem())
    const result = await pending
    expect(result.chat.name).toBe('[PowerShell] Edited')
    expect(h.spawns[0].file).toBe('updated')
    expect(h.spawns[0].args).toEqual(['--model', 'my model', buildStartPrompt(liveItem())])
  })
})

describe('buildStartPrompt', () => {
  it('includes the live description, URL, and instructions', () => {
    const prompt = buildStartPrompt(liveItem())
    expect(prompt.startsWith('Work on task DEMO-1: Ship the launch.')).toBe(true)
    expect(prompt).toContain(`line one\nline "two" & | ; \` {prompt} ${LEAK}`)
    expect(prompt).toContain(URL)
    expect(prompt).toContain(
      "Follow the project's instructions. Do not assume approval for actions that require it.",
    )
    expect(prompt).toContain(
      "Keep the full ref in the name of the local task record, following the project's instructions.",
    )
    expect(prompt).not.toContain('autoSend')
    expect(prompt).not.toContain('handoff directory')
  })

  it('says when the description or URL is missing', () => {
    const prompt = buildStartPrompt(liveItem({ description: '  ', url: ' \n' }))
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
    expect(result.chat.name).toBe('[PowerShell] Codex')
    expect(result.chat.projectId).toBe(bundle.project.id)
    expect(result.chat.taskRef).toBe('DEMO-1')
    expect(result.chat.agentName).toBe('Codex')
    expect(bundle.chats.list(bundle.project.id)).toEqual([result.chat])
    expect(bundle.chats.create(bundle.project.id).name).toBe('[PowerShell]')
    expect(bundle.spawns).toHaveLength(1)
    const spawn = bundle.spawns[0]
    expect(spawn?.file).toBe('codex.exe')
    expect(spawn?.cwd).toBe(projectPath)
    const prompt = buildStartPrompt(liveItem())
    expect(spawn?.args).toEqual(['--model', 'gpt', prompt, '--yolo'])
    expect(spawn?.args[2]).toContain('\n')
    expect(spawn?.args[2]).toContain('"')
    expect(spawn?.args[2]).toContain('&')
    expect(spawn?.args[2]).toContain('|')
    expect(spawn?.args[2]).toContain(';')
    expect(spawn?.args[2]).toContain('`')
    expect(spawn?.args[2]).toContain(' ')
    expect(spawn?.args.filter((arg) => arg.includes(LEAK))).toHaveLength(1)
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
      bundle.chats.list(bundle.project.id).filter((chat) => chat.name === '[PowerShell] Codex'),
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
    expect(() =>
      bundle.service.launch({
        ...resumeInput({ projectId: bundle.project.id }),
        prompt: '',
      }),
    ).toThrow(/prompt is invalid/)
    expect(() =>
      bundle.service.launch({
        ...resumeInput({ projectId: bundle.project.id }),
        prompt: '   ',
      }),
    ).toThrow(/prompt is invalid/)
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

function draftInput(overrides: Partial<KanbanDraftLaunchInput> = {}): KanbanDraftLaunchInput {
  return {
    projectId: 'pending',
    itemId: 'native-1',
    ref: 'DEMO-1',
    profileId: profile.id,
    attemptId: 'draft-1',
    mode: 'draft',
    ...overrides,
  }
}

describe('TaskLaunchService draft (NEKODE-99)', () => {
  it('starts the profile without its prompt slot and returns the Start prompt', async () => {
    const bundle = harness()
    const result = await bundle.service.launch(draftInput({ projectId: bundle.project.id }))
    expect(bundle.getItem).toHaveBeenCalledWith(bundle.project.id, 'DEMO-1')
    expect(result.delivered).toBe(true)
    expect(result.chat.name).toBe('[PowerShell] Codex')
    expect(result.chat.taskRef).toBe('DEMO-1')
    expect(result.draftPrompt).toBe(buildStartPrompt(liveItem()))
    expect(bundle.spawns).toHaveLength(1)
    expect(bundle.spawns[0]?.file).toBe('codex.exe')
    expect(bundle.spawns[0]?.args).toEqual(['--model', 'gpt', '--yolo'])
    expect(bundle.spawns[0]?.args.some((arg) => arg.includes(LEAK))).toBe(false)
  })

  it('uses interactiveArgs when the profile defines them', async () => {
    const bundle = harness({ profile: { ...profile, interactiveArgs: ['--tui'] } })
    const result = await bundle.service.launch(draftInput({ projectId: bundle.project.id }))
    expect(bundle.spawns[0]?.args).toEqual(['--tui'])
    expect(result.draftPrompt).toBe(buildStartPrompt(liveItem()))
  })

  it('keeps the Start result shape without draftPrompt', async () => {
    const bundle = harness()
    const result = await bundle.service.launch(input({ projectId: bundle.project.id }))
    expect('draftPrompt' in result).toBe(false)
  })

  it('returns the prompt only after a failed spawn is retried, and again on a repeat', async () => {
    const options = { failSpawn: true }
    const bundle = harness(options)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const launch = draftInput({ projectId: bundle.project.id })
    const failed = await bundle.service.launch(launch)
    spy.mockRestore()
    expect(failed.delivered).toBe(false)
    expect('draftPrompt' in failed).toBe(false)
    options.failSpawn = false
    const retried = await bundle.service.launch(launch)
    expect(retried.delivered).toBe(true)
    expect(retried.chat.id).toBe(failed.chat.id)
    expect(retried.draftPrompt).toBe(buildStartPrompt(liveItem()))
    const again = await bundle.service.launch(launch)
    expect(again).toEqual(retried)
    expect(bundle.spawns).toHaveLength(2)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
  })

  it('rejects a draft with extra fields or a mismatched retry', async () => {
    const bundle = harness()
    expect(() =>
      bundle.service.launch({
        ...draftInput({ projectId: bundle.project.id }),
        fileName: 'x.md',
      } as unknown as KanbanDraftLaunchInput),
    ).toThrow(/unexpected or missing fields/)
    await bundle.service.launch(draftInput({ projectId: bundle.project.id, attemptId: 'kept' }))
    expect(() =>
      bundle.service.launch(input({ projectId: bundle.project.id, attemptId: 'kept' })),
    ).toThrow(AppError)
    expect(bundle.spawns).toHaveLength(1)
  })
})

describe('TaskLaunchService resume', () => {
  it('passes the prepared prompt as one argv element and keeps Start unchanged', async () => {
    const bundle = harness()
    const resumePromptText = `Resume from demo-1.md\nUse project instructions.`
    await bundle.service.launch(input({ projectId: bundle.project.id }))
    expect(bundle.spawns[0]?.args[2]).toBe(buildStartPrompt(liveItem()))

    const result = await bundle.service.launch(
      resumeInput({ projectId: bundle.project.id, prompt: resumePromptText }),
    )
    expect(result.delivered).toBe(true)
    expect(result.chat.name).toBe('[PowerShell] Codex')
    expect(bundle.chats.list(bundle.project.id)).toEqual([
      bundle.chats.list(bundle.project.id)[0],
      result.chat,
    ])
    expect(result.chat.taskRef).toBe('DEMO-1')
    expect(result.chat.agentName).toBe('Codex')
    expect(bundle.spawns).toHaveLength(2)
    const spawn = bundle.spawns[1]
    expect(spawn?.cwd).toBe(projectPath)
    expect(spawn?.args).toEqual(['--model', 'gpt', resumePromptText, '--yolo'])
    expect(spawn?.args[2]).toBe(resumePromptText)
    expect(spawn?.args.filter((arg) => arg.includes(LEAK))).toHaveLength(0)
  })

  it('creates no chat on an invalid prompt', async () => {
    const bundle = harness()
    const launch = resumeInput({ projectId: bundle.project.id, prompt: '   ' })
    expect(() => bundle.service.launch(launch)).toThrow(AppError)
    expect(bundle.chats.list(bundle.project.id)).toHaveLength(0)
    expect(bundle.spawns).toHaveLength(0)
  })

  it('dedups a resume by attempt id and delivers to the same chat', async () => {
    const options = { failSpawn: true }
    const bundle = harness(options)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const launch = resumeInput({ projectId: bundle.project.id, prompt: 'Resume attempt 1' })
      const failed = await bundle.service.launch(launch)
      expect(failed.delivered).toBe(false)
      options.failSpawn = false
      const delivered = await bundle.service.launch(launch)
      expect(delivered.delivered).toBe(true)
      expect(delivered.chat.id).toBe(failed.chat.id)
      expect(bundle.spawns.map((spawn) => spawn.args[2])).toEqual([
        'Resume attempt 1',
        'Resume attempt 1',
      ])
      expect(bundle.chats.list(bundle.project.id)).toHaveLength(1)
    } finally {
      log.mockRestore()
    }
  })

  it('keeps the prompt out of logs on spawn failure', async () => {
    const bundle = harness({ failSpawn: true })
    const sensitivePrompt = `Secret instructions with ${LEAK}`
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    const launch = resumeInput({ projectId: bundle.project.id, prompt: sensitivePrompt })
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
    spy.mockRestore()
  })
})
