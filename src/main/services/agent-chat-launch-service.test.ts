import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAgentCommand } from '@shared/agent-command'
import type { AgentProfile } from '@shared/ipc-contract'
import { AppError, type AppErrorCode } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { AgentChatLaunchService } from './agent-chat-launch-service'
import { agentProfileTemplates } from './agent-profiles/agent-profile-templates'
import { AgentProfilesService } from './agent-profiles/agent-profiles-service'
import { AgentSessionRegistry } from './agent-session-registry'
import { AppStateService } from './app-state-service'
import { ChatService } from './chat-service'
import { ProjectService } from './project-service'
import type { ShellSpec } from './terminal/terminal-service'

// Agent chat launch unit tests (spec new-chat-agent-menu): the left panel's
// profile menu creates exactly one chat named for the profile and starts that
// profile in the chat's terminal at the project root. The chat rows are real
// (ChatService on an :memory: database) so the name and the rollback are
// asserted against stored state, not against a mock.

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

const demoPath = join(tmpdir(), 'nekode-agent-chat-tests', 'demo-project')

const codexProfile: AgentProfile = {
  id: 'prof-1',
  name: 'Codex',
  executable: 'codex.exe',
  args: ['--flag', '{prompt}', '--keep'],
}

async function expectAppError(run: () => Promise<unknown>, code: AppErrorCode): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AppError) {
      expect(error.code).toBe(code)
      return error
    }
    throw error
  }
  throw new Error('expected the call to throw an AppError')
}

interface HarnessOptions {
  profiles?: AgentProfile[]
  /** Thrown by the terminal service instead of spawning. */
  spawnError?: unknown
}

function createHarness(options: HarnessOptions = {}) {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const projects = new ProjectService({
    db,
    fs: { stat: () => ({ isDirectory: () => true }) },
  })
  const chats = new ChatService({ db, chatNameForProject: () => 'PowerShell' })
  const sessions = new AgentSessionRegistry()
  const created: string[] = []
  const spawns: ShellSpec[] = []
  const terminals = {
    create: vi.fn((chatId: string, _cwd: string, shell?: ShellSpec) => {
      if (options.spawnError !== undefined) {
        throw options.spawnError
      }
      if (shell === undefined) {
        throw new Error('agent launch must spawn with an explicit shell spec')
      }
      spawns.push(shell)
      return chatId
    }),
  }
  const service = new AgentChatLaunchService({
    projects,
    profiles: { get: () => ({ defaultId: null, profiles: options.profiles ?? [codexProfile] }) },
    createChat: (projectId, name, identity) => {
      const chat = chats.createNamed(projectId, name, 'chats:createWithAgent', identity)
      created.push(chat.id)
      return chat
    },
    removeChat: (chatId) => chats.remove(chatId),
    sessions,
    terminals,
  })
  const project = projects.add(demoPath)
  return { service, projects, chats, spawns, terminals, project, db, sessions, created }
}

describe('AgentChatLaunchService', () => {
  it('stores the launched CLI name separately from the profile name', async () => {
    const { service, chats, project } = createHarness({
      profiles: [{ ...codexProfile, name: 'Code analysis', executable: 'claude.cmd' }],
    })
    const chat = await service.createWithAgent(project.id, codexProfile.id)
    expect(chat).toMatchObject({ name: '[PowerShell] Code analysis', agentName: 'Claude' })
    expect(chat.taskRef).toBeUndefined()
    expect(chats.get(chat.id)).toEqual(chat)
  })

  it('hands Claude its session id after a Node script and before the prompt', async () => {
    const nodeClaude: AgentProfile = {
      ...codexProfile,
      name: 'Claude',
      executable: 'node.exe',
      args: ['C:\\app\\node_modules\\@anthropic-ai\\claude-code\\cli.js', '{prompt}'],
    }
    const { service, project, spawns, sessions } = createHarness({ profiles: [nodeClaude] })
    const chat = await service.createWithAgent(project.id, nodeClaude.id)
    const sessionId = sessions.launch(chat.id)?.sessionId
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(spawns[0].args).toEqual([
      'C:\\app\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
      '--session-id',
      sessionId,
    ])
  })

  it('points a resume profile at the session it names, without injecting a flag', async () => {
    const resuming: AgentProfile = {
      ...codexProfile,
      name: 'Claude resume',
      executable: 'claude.cmd',
      args: ['--resume', 'abc', '{prompt}'],
    }
    const { service, project, spawns, sessions } = createHarness({ profiles: [resuming] })
    const chat = await service.createWithAgent(project.id, resuming.id)
    expect(spawns[0].args).toEqual(['--resume', 'abc'])
    expect(sessions.launch(chat.id)?.sessionId).toBe('abc')
  })

  it('records no session id for --continue or --fork-session, which name none', async () => {
    for (const args of [['--continue'], ['-c'], ['--resume', 'abc', '--fork-session']]) {
      const profile: AgentProfile = {
        ...codexProfile,
        name: 'Claude named',
        executable: 'claude.cmd',
        args: [...args, '{prompt}'],
      }
      const { service, project, sessions } = createHarness({ profiles: [profile] })
      const chat = await service.createWithAgent(project.id, profile.id)
      expect(sessions.launch(chat.id)?.sessionId).toBeNull()
    }
  })

  it('forgets the launch record on chat removal and on a failed spawn', async () => {
    const claude: AgentProfile = {
      ...codexProfile,
      name: 'Claude',
      executable: 'claude.cmd',
      args: ['{prompt}'],
    }
    const ok = createHarness({ profiles: [claude] })
    const chat = await ok.service.createWithAgent(ok.project.id, claude.id)
    expect(ok.sessions.launch(chat.id)).not.toBeNull()
    ok.service.removeChat(chat.id)
    expect(ok.sessions.launch(chat.id)).toBeNull()
    expect(ok.chats.get(chat.id)).toBeNull()

    const failing = createHarness({ profiles: [claude], spawnError: new Error('refused') })
    await expectAppError(
      () => failing.service.createWithAgent(failing.project.id, claude.id),
      'unknown',
    )
    expect(failing.created).toHaveLength(1)
    expect(failing.sessions.launch(failing.created[0])).toBeNull()
    expect(failing.chats.list(failing.project.id)).toEqual([])
  })

  it.each(
    [null, 'args', [42], new Array<string>(1), ['\u0000'], ['{prompt}'], ['pre{prompt}']].map(
      (interactiveArgs) => ({ interactiveArgs }),
    ),
  )('rejects invalid interactive argv %j before creating a chat', async ({ interactiveArgs }) => {
    const selected = { ...codexProfile, interactiveArgs } as AgentProfile
    const { service, project, chats, terminals } = createHarness({ profiles: [selected] })
    await expectAppError(() => service.createWithAgent(project.id, selected.id), 'validation')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it.each([
    { executable: 'hermes', args: ['-q', '{prompt}'], interactiveArgs: [] },
    {
      executable: 'agy',
      args: ['-i', '{prompt}', '--model', 'configured-model'],
      interactiveArgs: ['--model', 'configured-model'],
    },
    {
      executable: 'node.exe',
      args: ['C:\\Agent tools\\cli.js', '-q', '{prompt}'],
      interactiveArgs: ['C:\\Agent tools\\cli.js', '--model', 'my model', ''],
    },
  ])('uses the complete interactive override for $executable', async (fields) => {
    const selected = { ...codexProfile, ...fields }
    const { service, project, spawns, chats } = createHarness({ profiles: [selected] })
    const chat = await service.createWithAgent(project.id, selected.id)
    expect(chats.list(project.id)).toHaveLength(1)
    expect(chat.id).toBeTruthy()
    expect(spawns).toEqual([{ file: fields.executable, args: fields.interactiveArgs }])
    expect(selected.interactiveArgs).toEqual(fields.interactiveArgs)
    expect(spawns[0].args).not.toBe(selected.interactiveArgs)
  })

  it('starts the OpenCode template without a dangling --prompt flag', async () => {
    const template = agentProfileTemplates().find((p) => p.id === 'opencode')
    if (template === undefined) throw new Error('missing OpenCode template')
    const selected: AgentProfile = {
      id: 'prof-opencode',
      name: template.name,
      ...parseAgentCommand(template.command),
      interactiveArgs: template.interactiveArgs,
    }
    const { service, project, spawns } = createHarness({ profiles: [selected] })
    await service.createWithAgent(project.id, selected.id)
    expect(spawns).toEqual([{ file: 'opencode', args: [] }])
    expect(selected.args).toEqual(['--prompt', '{prompt}'])
  })

  it('rejects a globally existing unselected profile before chat creation and reads the current definition on later launch', async () => {
    const { db, projects, chats, terminals, project, spawns } = createHarness()
    const profiles = new AgentProfilesService({ projects, state: new AppStateService({ db }) })
    const agent = profiles.put({ id: null, name: 'Agent', command: 'original "{prompt}"' })
      .profiles[0]
    const launch = new AgentChatLaunchService({
      projects,
      profiles,
      sessions: new AgentSessionRegistry(),
      terminals,
      createChat: (id, name, identity) =>
        chats.createNamed(id, name, 'chats:createWithAgent', identity),
      removeChat: (id) => chats.remove(id),
    })
    await expectAppError(() => launch.createWithAgent(project.id, agent.id), 'not_found')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
    profiles.selectionSet(project.id, { selectedIds: [agent.id], defaultId: null })
    profiles.put({ id: agent.id, name: 'Edited', command: 'updated --model "my model" "{prompt}"' })
    const chat = await launch.createWithAgent(project.id, agent.id)
    expect(chat.name).toBe('[PowerShell] Edited')
    expect(spawns).toEqual([{ file: 'updated', args: ['--model', 'my model'] }])
    chats.remove(chat.id)
    profiles.selectionSet(project.id, { selectedIds: [], defaultId: null })
    await expectAppError(() => launch.createWithAgent(project.id, agent.id), 'not_found')
    expect(chats.list(project.id)).toEqual([])
    expect(spawns).toHaveLength(1)
  })
  it('creates one chat named for the profile and spawns its executable at the project root', async () => {
    const { service, chats, spawns, terminals, project } = createHarness()

    const chat = await service.createWithAgent(project.id, 'prof-1')

    // The name follows the existing `[shell] <profile name>` contract.
    expect(chat.name).toBe('[PowerShell] Codex')
    expect(chat.projectId).toBe(project.id)
    expect(chats.list(project.id)).toEqual([chat])
    // The agent is the chat's process, started at the project root.
    expect(terminals.create).toHaveBeenCalledWith(chat.id, project.path, {
      file: 'codex.exe',
      args: ['--flag', '--keep'],
    })
    expect(spawns).toEqual([{ file: 'codex.exe', args: ['--flag', '--keep'] }])
  })

  it.each([
    ['the only prompt element is dropped', 'codex.exe', ['{prompt}'], []],
    [
      'the other argv elements keep their order',
      'codex.exe',
      ['-a', '{prompt}', '--model', 'gpt', '--'],
      ['-a', '--model', 'gpt', '--'],
    ],
    [
      'a trailing prompt is not substituted (codex)',
      'codex',
      ['--model', 'my model', '{prompt}'],
      ['--model', 'my model'],
    ],
    [
      'a trailing prompt is not substituted (grok)',
      'grok',
      ['--model', 'my model', '{prompt}'],
      ['--model', 'my model'],
    ],
  ] as const)('builds the prompt-free argv when %s', async (_case, executable, args, expected) => {
    const { service, chats, spawns, project } = createHarness({
      profiles: [{ id: 'prof-1', name: 'Codex', executable, args: [...args] }],
    })

    await service.createWithAgent(project.id, 'prof-1')

    expect(chats.list(project.id)).toHaveLength(1)
    // No prompt is typed anywhere: the agent gets its argv without the slot.
    expect(spawns).toEqual([{ file: executable, args: expected }])
  })

  it('rolls the chat back and surfaces the classified spawn error for a throw and a rejection', async () => {
    const spawnError = new AppError(
      'not_found',
      'The project directory does not exist. Terminal sessions need an existing project directory.',
      'terminals:create',
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { service, chats, project } = createHarness({ spawnError })

      const error = await expectAppError(
        () => service.createWithAgent(project.id, 'prof-1'),
        'not_found',
      )

      expect(error.message).toContain('project directory does not exist')
      // No half-chat survives the failed launch, and no fallback shell chat is
      // ever started in its place (spec Errors).
      expect(chats.list(project.id)).toEqual([])
      expect(log).toHaveBeenCalledWith('[agent-chat] failed to start the agent process')

      // A rejected terminal creation is the same catch as a synchronous throw.
      const rejected = createHarness()
      rejected.terminals.create.mockImplementationOnce(
        () => Promise.reject(new AppError('not_found', 'Unavailable')) as unknown as string,
      )
      await expect(
        rejected.service.createWithAgent(rejected.project.id, codexProfile.id),
      ).rejects.toThrow('Unavailable')
      expect(rejected.chats.list(rejected.project.id)).toEqual([])
      expect(log).toHaveBeenCalledTimes(2)
    } finally {
      log.mockRestore()
    }
  })

  it('rolls the chat back and reports the launch failure for an unclassified spawn error', async () => {
    const { service, chats, project } = createHarness({ spawnError: new Error('EPERM: spawn') })

    const error = await expectAppError(
      () => service.createWithAgent(project.id, 'prof-1'),
      'unknown',
    )

    // A raw OS error never reaches the renderer: it becomes the launch's typed
    // failure with its fallback message.
    expect(error.message).toBe('Failed to start the agent chat.')
    expect(error.channel).toBe('chats:createWithAgent')
    expect(chats.list(project.id)).toEqual([])
  })

  it('creates no chat for an unknown project', async () => {
    const { service, chats, terminals, project } = createHarness()

    const error = await expectAppError(
      () => service.createWithAgent('ghost-project', 'prof-1'),
      'not_found',
    )

    expect(error.message).toBe('Project not found.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('creates no chat for a profile that no longer exists', async () => {
    const { service, chats, terminals, project } = createHarness()

    const error = await expectAppError(
      () => service.createWithAgent(project.id, 'ghost-profile'),
      'not_found',
    )

    expect(error.message).toBe('The selected agent profile is no longer available.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('refuses a profile whose argv has no single prompt element', async () => {
    const { service, chats, terminals, project } = createHarness({
      profiles: [{ id: 'prof-1', name: 'Codex', executable: 'codex.exe', args: ['--flag'] }],
    })

    const error = await expectAppError(
      () => service.createWithAgent(project.id, 'prof-1'),
      'validation',
    )

    expect(error.message).toBe('The selected agent profile is invalid.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('refuses a profile with two prompt elements instead of dropping an argument', async () => {
    const { service, chats, project } = createHarness({
      profiles: [
        {
          id: 'prof-1',
          name: 'Codex',
          executable: 'codex.exe',
          args: ['{prompt}', '--flag', '{prompt}'],
        },
      ],
    })

    await expectAppError(() => service.createWithAgent(project.id, 'prof-1'), 'validation')
    expect(chats.list(project.id)).toEqual([])
  })
})
