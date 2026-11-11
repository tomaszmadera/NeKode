import { emptyGitWorktree, type SshProjectInput } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CreateServicesOptions, createServices } from './create-services'
import { SshClient, type SshRunner } from './ssh/ssh-client'
import { createNodePty } from './terminal/node-pty-factory'

// SSH service wiring (spec ssh-projects Stage 1): registration through the
// injected client, one launch resolver for terminals and agent launches, the
// unsupported surfaces, and the shell/files/git guards. The ssh runner and the
// PTY are fakes: nothing is spawned.

vi.mock('./terminal/node-pty-factory', () => ({
  createNodePty: vi.fn(() => ({
    pid: 1,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: () => ({ dispose: vi.fn() }),
  })),
}))

const MARKER = 'nekode-test'
const SSH_PATH = 'ssh://Minipc/srv/My Project'
const SSH_ROOT = '/srv/My Project'

let runner: ReturnType<typeof vi.fn<SshRunner>>

function remoteDirectory(remotePath: string): { stdout: string; stderr: string; exitCode: number } {
  return { stdout: `${MARKER}\u0000${remotePath}\n`, stderr: '', exitCode: 0 }
}

function setup(overrides: Partial<CreateServicesOptions> = {}) {
  runner = vi.fn<SshRunner>(async () => remoteDirectory('/srv/My Project'))
  const services = createServices({
    dbPath: ':memory:',
    userDataPath: 'D:/scratch',
    openExternal: async () => '',
    showInFolder: () => undefined,
    trashItem: async () => undefined,
    pickDirectory: async () => null,
    homeDir: 'D:/Users/tomek',
    ssh: new SshClient({ platform: 'linux', marker: () => MARKER, run: runner }),
    ...overrides,
  })
  return services
}

async function register(
  services: ReturnType<typeof setup>,
  input: SshProjectInput = { host: 'Minipc', user: null, port: null, path: '/srv/My Project' },
) {
  return services.projects.addSsh(input)
}

function appError(run: () => unknown): AppError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

async function rejection(value: unknown): Promise<AppError> {
  try {
    await value
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError rejection')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SSH project registration', () => {
  it('checks the remote directory, stores the canonical path and names the project', async () => {
    const services = setup()
    const project = await register(services, {
      host: 'Minipc',
      user: 'Tomek',
      port: 2222,
      path: '/srv/My Project/',
    })
    expect(project).toMatchObject({
      name: 'My Project',
      path: 'ssh://Tomek@minipc:2222/srv/My Project',
      runtimeLabel: null,
    })
    expect(services.projects.list()).toEqual([project])
    expect(runner).toHaveBeenCalledOnce()
    const [file, args] = runner.mock.calls[0]
    expect(file).toBe('ssh')
    expect(args).toEqual(
      expect.arrayContaining([
        '-o',
        'BatchMode=yes',
        '-o',
        'RemoteCommand=none',
        '-o',
        'ConnectTimeout=10',
        '-T',
        '-p',
        '2222',
        '--',
        'Tomek@minipc',
        'sh',
        '-c',
        'nekode',
        "'/srv/My Project'",
      ]),
    )
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('conflicts on the same canonical location across port, slash and host case', async () => {
    const services = setup()
    runner.mockImplementation(async () => remoteDirectory('/srv/app'))
    const created = await services.projects.addSsh({
      host: 'host',
      user: null,
      port: 22,
      path: '/srv/app/',
    })
    expect(created.path).toBe('ssh://host/srv/app')
    const error = await rejection(
      services.projects.addSsh({ host: 'HOST', user: null, port: null, path: '/srv/app' }),
    )
    expect(error).toMatchObject({
      code: 'conflict',
      message: 'This remote directory is already registered as a project.',
    })
    expect(services.projects.list()).toHaveLength(1)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('conflicts on two spellings that resolve to one remote directory', async () => {
    const services = setup()
    runner.mockResolvedValueOnce(remoteDirectory('/srv/real'))
    await services.projects.addSsh({ host: 'host', user: null, port: null, path: '/srv/link' })
    runner.mockResolvedValueOnce(remoteDirectory('/srv/real'))
    const error = await rejection(
      services.projects.addSsh({ host: 'host', user: null, port: null, path: '/srv/real' }),
    )
    expect(error.code).toBe('conflict')
    expect(services.projects.list()).toHaveLength(1)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('writes no row when the remote directory is missing', async () => {
    const services = setup()
    runner.mockResolvedValueOnce({
      stdout: `${MARKER}\u0000`,
      stderr: 'cd: can not cd to /srv/missing',
      exitCode: 1,
    })
    const error = await rejection(
      services.projects.addSsh({ host: 'host', user: null, port: null, path: '/srv/missing' }),
    )
    expect(error).toMatchObject({
      code: 'not_found',
      message: 'The remote directory does not exist or is not accessible.',
    })
    expect(services.projects.list()).toEqual([])
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('writes no row when the connection fails', async () => {
    const services = setup()
    runner.mockResolvedValueOnce({
      stdout: '',
      stderr: 'tomek@host: Permission denied (publickey).',
      exitCode: 255,
    })
    const error = await rejection(
      services.projects.addSsh({ host: 'host', user: null, port: null, path: '/srv/app' }),
    )
    expect(error.code).toBe('auth')
    expect(services.projects.list()).toEqual([])
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it.each([
    [
      { host: '-oProxyCommand=evil', user: null, port: null, path: '/srv/app' },
      'The host name is invalid.',
    ],
    [{ host: 'host', user: 'to mek', port: null, path: '/srv/app' }, 'The user name is invalid.'],
    [
      { host: 'host', user: null, port: 0, path: '/srv/app' },
      'The port must be a number from 1 to 65535.',
    ],
    [
      { host: 'host', user: null, port: null, path: 'relative' },
      'The remote directory must be an absolute POSIX path.',
    ],
    [
      { host: 'host', user: null, port: null, path: '/' },
      'Cannot add a filesystem root as a project.',
    ],
  ])('rejects invalid input %j before any connection', async (input, message) => {
    const services = setup()
    const error = await rejection(services.projects.addSsh(input))
    expect(error).toMatchObject({ code: 'validation', message })
    expect(runner).not.toHaveBeenCalled()
    expect(services.projects.list()).toEqual([])
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })
})

describe('SSH launch routing', () => {
  it('spawns the remote login shell for a chat terminal with the local home cwd', async () => {
    const services = setup()
    const project = await register(services)
    const chat = services.chats.create(project.id)
    expect(chat.name).toBe('[SSH]')
    await services.terminals.create(chat.id, project.path)
    expect(createNodePty).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        file: 'ssh',
        cwd: 'D:/Users/tomek',
        args: expect.arrayContaining([
          '-tt',
          '-o',
          'RemoteCommand=none',
          '--',
          'minipc',
          'sh',
          '-c',
          'nekode',
          "'/srv/My Project'",
        ]),
      }),
    )
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('routes a bottom terminal through the same resolver', async () => {
    const services = setup()
    const project = await register(services)
    await services.terminals.create(`bottom:${project.id}:tab1`, project.path)
    expect(createNodePty).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        file: 'ssh',
        cwd: 'D:/Users/tomek',
        args: expect.arrayContaining(['-tt', '--', 'minipc']),
      }),
    )
    expect(() =>
      services.terminals.create(`bottom:${project.id}:tab2`, 'ssh://other/srv/My Project'),
    ).toThrow('The working directory does not belong to this project.')
    expect(createNodePty).toHaveBeenCalledOnce()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it.each([
    ['another SSH host', 'ssh://other/srv/My Project'],
    ['a local path', 'D:/code/app'],
    ['the remote path without the scheme', '/srv/My Project'],
  ])('rejects a cwd that is %s for an SSH project', async (_label, cwd) => {
    const services = setup()
    const project = await register(services)
    const chat = services.chats.create(project.id)
    const error = appError(() => services.terminals.create(chat.id, cwd))
    expect(error).toMatchObject({
      code: 'validation',
      message: 'The working directory does not belong to this project.',
    })
    expect(createNodePty).not.toHaveBeenCalled()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects a foreign ssh cwd for a local project', async () => {
    const services = setup()
    const project = services.projects.add(process.cwd())
    const chat = services.chats.create(project.id)
    const error = appError(() => services.terminals.create(chat.id, SSH_PATH))
    expect(error.code).toBe('validation')
    expect(createNodePty).not.toHaveBeenCalled()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('runs an agent profile argv remotely as positional arguments', async () => {
    const services = setup()
    const project = await register(services)
    const profile = services.agentProfiles.put({
      id: null,
      name: 'Codex',
      command: 'codex "a b" "{prompt}"',
    }).profiles[0]
    services.agentProfiles.selectionSet(project.id, {
      selectedIds: [profile.id],
      defaultId: null,
    })
    const chat = await services.chats.createWithAgent(project.id, profile.id)
    expect(chat.name).toBe('[SSH] Codex')
    const options = vi.mocked(createNodePty).mock.calls[0][0]
    expect(options.file).toBe('ssh')
    expect(options.args.slice(-4)).toEqual(['nekode', "'/srv/My Project'", "'codex'", "'a b'"])
    // No remote preflight: the directory check is the only ssh invocation.
    expect(runner).toHaveBeenCalledOnce()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects actions:execute and Kanban launch for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    const action = services.actions.create({
      scope: 'project',
      projectId: project.id,
      title: 'Build',
      icon: null,
      group: null,
      command: 'make',
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    })
    expect(appError(() => services.actions.execute(action.id, project.id, true))).toMatchObject({
      code: 'unsupported',
      message: 'This action is not available for SSH projects.',
    })
    await expect(
      services.kanban.launchTask({
        projectId: project.id,
        itemId: 'item-1',
        ref: 'DEMO-1',
        profileId: 'profile-1',
        attemptId: 'attempt-1',
        mode: 'start',
      }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    expect(createNodePty).not.toHaveBeenCalled()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })
})

describe('SSH local-file surfaces', () => {
  const unsupported = {
    code: 'unsupported',
    message: 'This action is not available for SSH projects.',
  }

  it('rejects kanban.skillPreview for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    expect(appError(() => services.kanban.skillPreview(project.id))).toMatchObject(unsupported)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects kanban.writeSkill for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    expect(
      appError(() =>
        services.kanban.writeSkill(
          project.id,
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ),
      ),
    ).toMatchObject(unsupported)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects kanban.bindLocalFile for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    expect(appError(() => services.kanban.bindLocalFile(project.id))).toMatchObject(unsupported)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects taskProgress.saveBinding for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    expect(
      appError(() => services.taskProgress.saveBinding(project.id, 'local-file', {})),
    ).toMatchObject(unsupported)
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('rejects taskProgress.test for an SSH project', async () => {
    const services = setup()
    const project = await register(services)
    expect(appError(() => services.taskProgress.test(project.id, 'local-file', {}))).toMatchObject(
      unsupported,
    )
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })
})

describe('SSH shell, files and git surfaces', () => {
  it('lists one Default entry without probing and rejects detection and custom shells', async () => {
    const services = setup()
    const project = await register(services)
    services.state.set('shells.custom', JSON.stringify(['D:/sh.exe']))
    expect(services.terminals.shellList(project.id)).toEqual([
      { id: 'default', label: 'Default (remote login shell)' },
    ])
    expect(services.terminals.shellName(project.id)).toBe('Default (remote login shell)')
    await expect(services.terminals.shellDetect(project.id)).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(services.terminals.shellAddCustom('/bin/fish', project.id)).rejects.toMatchObject({
      code: 'unsupported',
    })
    expect(services.state.get('shells.custom')).toBe('["D:/sh.exe"]')
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('serves a remote listing and preview over SSH and keeps every local-only surface unsupported', async () => {
    const openExternal = vi.fn(async (_path: string) => '')
    const showInFolder = vi.fn()
    const trashItem = vi.fn(async () => undefined)
    const services = setup({ openExternal, showInFolder, trashItem })
    const project = await register(services)
    // Stage 2: the files adapter sends one listing or one read script, so the
    // fake runner answers the framing of each and refuses anything else.
    runner.mockImplementation(async (_file, argv) => {
      const line = argv.join(' ')
      if (line.includes("'/srv/My Project/missing.txt'")) {
        return { stdout: `${MARKER}\u0000`, stderr: '', exitCode: 111 }
      }
      if (line.includes('for entry in')) {
        return {
          stdout: `${MARKER}\u0000${SSH_ROOT}\u0000${SSH_ROOT}\u0000notes.md\u0000f\u0000src\u0000d\u0000`,
          stderr: '',
          exitCode: 0,
        }
      }
      if (line.includes('readlink')) {
        return {
          stdout: `${MARKER}\u0000${SSH_ROOT}\u0000${SSH_ROOT}/notes.md\u0000f\u00008\u0000# notes\n`,
          stderr: '',
          exitCode: 0,
        }
      }
      throw new Error(`unexpected files script: ${line}`)
    })

    expect(await services.files.list(project.id, null)).toEqual([
      { name: 'src', relativePath: 'src', kind: 'directory' },
      { name: 'notes.md', relativePath: 'notes.md', kind: 'file' },
    ])
    expect(await services.files.read(project.id, 'notes.md')).toEqual({
      kind: 'text',
      content: '# notes\n',
      language: 'markdown',
    })
    // A path the remote runner does not answer stays the files contract's
    // not_found, not an unsupported SSH surface.
    await expect(services.files.read(project.id, 'missing.txt')).rejects.toMatchObject({
      code: 'not_found',
      message: 'File not found.',
    })

    const openSpy = vi.spyOn(services.files, 'openExternal')
    await expect(services.files.openExternal(project.id, 'notes.md')).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(services.files.openRoot(project.id)).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(services.files.showInFolder(project.id, 'notes.md')).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(services.files.trash(project.id, 'notes.md')).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(services.preview.target(project.id, 'notes.md')).rejects.toMatchObject({
      code: 'unsupported',
    })
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
    expect(showInFolder).not.toHaveBeenCalled()
    expect(trashItem).not.toHaveBeenCalled()
    services.terminals.terminateAll()
    services.closeDatabase?.()
  })

  it('degrades git to the no-git state and rejects git:sync without logging', async () => {
    const services = setup()
    const project = await register(services)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(await services.git.getStatus(project.id)).toEqual({
        branch: null,
        dirty: false,
        worktree: emptyGitWorktree(),
      })
      expect(await services.git.fileStatuses(project.id)).toEqual({})
      await expect(services.git.sync(project.id)).rejects.toMatchObject({
        code: 'unsupported',
        message: 'This action is not available for SSH projects.',
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      services.terminals.terminateAll()
      services.closeDatabase?.()
    }
  })
})
