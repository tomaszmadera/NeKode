import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@shared/ipc-contract'
import { AppError, type AppErrorCode } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { AgentChatLaunchService } from './agent-chat-launch-service'
import { AgentProfilesService } from './agent-profiles/agent-profiles-service'
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

function expectAppError(run: () => unknown, code: AppErrorCode): AppError {
  try {
    run()
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
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, 'chats:createWithAgent', identity),
    removeChat: (chatId) => chats.remove(chatId),
    terminals,
  })
  const project = projects.add(demoPath)
  return { service, projects, chats, spawns, terminals, project, db }
}

describe('AgentChatLaunchService', () => {
  it('stores the launched CLI name separately from the profile name', () => {
    const { service, chats, project } = createHarness({
      profiles: [{ ...codexProfile, name: 'Code analysis', executable: 'claude.cmd' }],
    })
    const chat = service.createWithAgent(project.id, codexProfile.id)
    expect(chat).toMatchObject({ name: '[PowerShell] Code analysis', agentName: 'Claude' })
    expect(chat.taskRef).toBeUndefined()
    expect(chats.get(chat.id)).toEqual(chat)
  })

  it.each(
    [null, 'args', [42], new Array<string>(1), ['\u0000'], ['{prompt}'], ['pre{prompt}']].map(
      (interactiveArgs) => ({ interactiveArgs }),
    ),
  )('rejects invalid interactive argv %j before creating a chat', ({ interactiveArgs }) => {
    const selected = { ...codexProfile, interactiveArgs } as AgentProfile
    const { service, project, chats, terminals } = createHarness({ profiles: [selected] })
    expectAppError(() => service.createWithAgent(project.id, selected.id), 'validation')
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
  ])('uses the complete interactive override for $executable', (fields) => {
    const selected = { ...codexProfile, ...fields }
    const { service, project, spawns, chats } = createHarness({ profiles: [selected] })
    const chat = service.createWithAgent(project.id, selected.id)
    expect(chats.list(project.id)).toHaveLength(1)
    expect(chat.id).toBeTruthy()
    expect(spawns).toEqual([{ file: fields.executable, args: fields.interactiveArgs }])
    expect(selected.interactiveArgs).toEqual(fields.interactiveArgs)
    expect(spawns[0].args).not.toBe(selected.interactiveArgs)
  })

  it.each(['codex', 'grok'])(
    'keeps positional-prompt behavior for %s without an override',
    (executable) => {
      const { service, project, spawns } = createHarness({
        profiles: [{ ...codexProfile, executable, args: ['--model', 'my model', '{prompt}'] }],
      })
      service.createWithAgent(project.id, codexProfile.id)
      expect(spawns).toEqual([{ file: executable, args: ['--model', 'my model'] }])
    },
  )

  it('rejects a globally existing unselected profile before chat creation and reads the current definition on later launch', () => {
    const { db, projects, chats, terminals, project, spawns } = createHarness()
    const profiles = new AgentProfilesService({ projects, state: new AppStateService({ db }) })
    const agent = profiles.put({ id: null, name: 'Agent', command: 'original "{prompt}"' })
      .profiles[0]
    const launch = new AgentChatLaunchService({
      projects,
      profiles,
      terminals,
      createChat: (id, name, identity) =>
        chats.createNamed(id, name, 'chats:createWithAgent', identity),
      removeChat: (id) => chats.remove(id),
    })
    expectAppError(() => launch.createWithAgent(project.id, agent.id), 'not_found')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
    profiles.selectionSet(project.id, { selectedIds: [agent.id], defaultId: null })
    profiles.put({ id: agent.id, name: 'Edited', command: 'updated --model "my model" "{prompt}"' })
    const chat = launch.createWithAgent(project.id, agent.id)
    expect(chat.name).toBe('[PowerShell] Edited')
    expect(spawns).toEqual([{ file: 'updated', args: ['--model', 'my model'] }])
    chats.remove(chat.id)
    profiles.selectionSet(project.id, { selectedIds: [], defaultId: null })
    expectAppError(() => launch.createWithAgent(project.id, agent.id), 'not_found')
    expect(chats.list(project.id)).toEqual([])
    expect(spawns).toHaveLength(1)
  })
  it('creates one chat named for the profile and spawns its executable at the project root', () => {
    const { service, chats, spawns, terminals, project } = createHarness()

    const chat = service.createWithAgent(project.id, 'prof-1')

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

  it('removes exactly the prompt argv element and starts the agent interactively', () => {
    const { service, spawns, project } = createHarness({
      profiles: [{ id: 'prof-1', name: 'Codex', executable: 'codex.exe', args: ['{prompt}'] }],
    })

    service.createWithAgent(project.id, 'prof-1')

    // No prompt is typed anywhere: the agent gets an empty argv.
    expect(spawns).toEqual([{ file: 'codex.exe', args: [] }])
  })

  it('keeps the other argv elements in order and never substitutes the prompt', () => {
    const { service, spawns, project } = createHarness({
      profiles: [
        {
          id: 'prof-1',
          name: 'Codex',
          executable: 'codex.exe',
          args: ['-a', '{prompt}', '--model', 'gpt', '--'],
        },
      ],
    })

    service.createWithAgent(project.id, 'prof-1')

    expect(spawns).toEqual([{ file: 'codex.exe', args: ['-a', '--model', 'gpt', '--'] }])
  })

  it('rolls the chat back and surfaces the classified spawn error', () => {
    const spawnError = new AppError(
      'not_found',
      'The project directory does not exist. Terminal sessions need an existing project directory.',
      'terminals:create',
    )
    const { service, chats, project } = createHarness({ spawnError })

    const error = expectAppError(() => service.createWithAgent(project.id, 'prof-1'), 'not_found')

    expect(error.message).toContain('project directory does not exist')
    // No half-chat survives the failed launch, and no fallback shell chat is
    // ever started in its place (spec Errors).
    expect(chats.list(project.id)).toEqual([])
  })

  it('rolls the chat back and reports the launch failure for an unclassified spawn error', () => {
    const { service, chats, project } = createHarness({ spawnError: new Error('EPERM: spawn') })

    const error = expectAppError(() => service.createWithAgent(project.id, 'prof-1'), 'unknown')

    // A raw OS error never reaches the renderer: it becomes the launch's typed
    // failure with its fallback message.
    expect(error.message).toBe('Failed to start the agent chat.')
    expect(error.channel).toBe('chats:createWithAgent')
    expect(chats.list(project.id)).toEqual([])
  })

  it('creates no chat for an unknown project', () => {
    const { service, chats, terminals, project } = createHarness()

    const error = expectAppError(
      () => service.createWithAgent('ghost-project', 'prof-1'),
      'not_found',
    )

    expect(error.message).toBe('Project not found.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('creates no chat for a profile that no longer exists', () => {
    const { service, chats, terminals, project } = createHarness()

    const error = expectAppError(
      () => service.createWithAgent(project.id, 'ghost-profile'),
      'not_found',
    )

    expect(error.message).toBe('The selected agent profile is no longer available.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('refuses a profile whose argv has no single prompt element', () => {
    const { service, chats, terminals, project } = createHarness({
      profiles: [{ id: 'prof-1', name: 'Codex', executable: 'codex.exe', args: ['--flag'] }],
    })

    const error = expectAppError(() => service.createWithAgent(project.id, 'prof-1'), 'validation')

    expect(error.message).toBe('The selected agent profile is invalid.')
    expect(chats.list(project.id)).toEqual([])
    expect(terminals.create).not.toHaveBeenCalled()
  })

  it('refuses a profile with two prompt elements instead of dropping an argument', () => {
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

    expectAppError(() => service.createWithAgent(project.id, 'prof-1'), 'validation')
    expect(chats.list(project.id)).toEqual([])
  })
})
