import { execFileSync } from 'node:child_process'
import { accessSync, statSync } from 'node:fs'
import { APP_STATE_KEY, projectShellKey, projectWslShellsKey } from '@shared/ipc-contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isWindowsHost } from '../test-support/host-path'
import { createServices } from './create-services'
import { HandoffMatcherService } from './handoffs/handoff-matcher-service'
import { ResumeTemplateService } from './handoffs/resume-template-service'
import { KanbanService } from './kanban/kanban-service'
import { createNodePty } from './terminal/node-pty-factory'
import { listWslDirectories, listWslDistributions, runWsl } from './terminal/wsl'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(() => 'usable'),
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  accessSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}))
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
vi.mock('./terminal/wsl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./terminal/wsl')>()),
  listWslDistributions: vi.fn(() => ['Ubuntu']),
  listWslDirectories: vi.fn(() => ['/home/user/Project']),
  runWsl: vi.fn((_distribution: string, args: string[]) =>
    args[0] === '/bin/cat' ? '/bin/bash\n' : 'usable',
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(runWsl).mockImplementation((_distribution, args) =>
    args[0] === '/bin/cat' ? '/bin/bash\n' : 'usable',
  )
})

function setup(path = '\\\\wsl.localhost\\Ubuntu\\home\\user\\Project') {
  const services = createServices({
    dbPath: ':memory:',
    userDataPath: 'D:/scratch',
    openExternal: async () => '',
    showInFolder: () => undefined,
    trashItem: async () => undefined,
    pickDirectory: async () => null,
  })
  const project = services.projects.add(path)
  return { services, project }
}

// WSL integration is Windows-only: projects live on \\wsl.localhost UNC paths
// and wsl.exe is the launcher, so this suite runs only on a Windows host.
describe.skipIf(!isWindowsHost)('WSL service wiring', () => {
  it('rolls back a Local agent chat when its selected WSL cannot resolve the project path', () => {
    const { services, project } = setup('D:/Project')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      services.state.set(projectShellKey(project.id), 'wsl:Removed')
      const profile = services.agentProfiles.put({
        id: null,
        name: 'Codex',
        command: 'codex "{prompt}"',
      }).profiles[0]
      services.agentProfiles.selectionSet(project.id, {
        selectedIds: [profile.id],
        defaultId: null,
      })
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error('unavailable')
      })
      expect(() => services.chats.createWithAgent(project.id, profile.id)).toThrow(
        'Unable to resolve the project directory in WSL distribution "Removed".',
      )
      expect(services.chats.list(project.id)).toEqual([])
      expect(createNodePty).not.toHaveBeenCalled()
    } finally {
      errorLog.mockRestore()
      services.terminals.terminateAll()
      services.closeDatabase?.()
    }
  })

  it.each(['new-chat', 'start', 'resume'] as const)(
    'runs a Local project profile in its selected WSL distribution for %s',
    async (mode) => {
      const { services, project } = setup('D:/My Project')
      const item = vi.spyOn(KanbanService.prototype, 'getItem').mockResolvedValue({
        id: 'item-1',
        ref: 'DEMO-1',
        title: 'Keep argv literal',
        description: 'Line one\n$(literal) & | ; "quotes"',
        stateId: 'started',
        stateName: 'Started',
        stateGroup: 'started',
        priority: 'high',
        assignee: null,
        url: 'https://example.test/DEMO-1',
        updatedAt: null,
      })
      const handoff = vi.spyOn(HandoffMatcherService.prototype, 'candidates').mockResolvedValue({
        state: 'ready',
        files: [
          {
            name: 'demo-1.md',
            path: 'D:/My Project/demo-1.md',
            modifiedAt: 'stamp',
            matchKind: 'filename',
          },
        ],
        rejections: [],
      })
      const resume = vi
        .spyOn(ResumeTemplateService.prototype, 'format')
        .mockResolvedValue('Resume from demo-1.md\n$(literal)')
      vi.mocked(execFileSync).mockImplementation((_file, args) =>
        args?.includes('wslpath') ? '/mnt/d/My Project\n' : 'usable',
      )
      try {
        services.state.set(projectShellKey(project.id), 'wsl:Ubuntu')
        const profile = services.agentProfiles.put({
          id: null,
          name: 'Codex',
          command: 'codex --flag "{prompt}"',
        }).profiles[0]
        services.agentProfiles.selectionSet(project.id, {
          selectedIds: [profile.id],
          defaultId: null,
        })
        const input = {
          projectId: project.id,
          itemId: 'item-1',
          ref: 'DEMO-1',
          profileId: profile.id,
          attemptId: 'attempt-1',
        }
        const chat =
          mode === 'new-chat'
            ? services.chats.createWithAgent(project.id, profile.id)
            : (
                await services.kanban.launchTask(
                  mode === 'start'
                    ? { ...input, mode }
                    : { ...input, mode, fileName: 'demo-1.md', stamp: 'stamp' },
                )
              ).chat
        expect(chat).toMatchObject({ name: '[WSL] Codex', agentName: 'Codex' })
        expect(createNodePty).toHaveBeenCalledTimes(1)
        const { file, args, cwd } = vi.mocked(createNodePty).mock.calls[0][0]
        expect({ file, args, cwd }).toEqual({
          file: 'wsl.exe',
          cwd: project.path,
          args: [
            '--distribution',
            'Ubuntu',
            '--cd',
            '/mnt/d/My Project',
            '--exec',
            'bash',
            '-lc',
            'exec "$@"',
            'bash',
            'codex',
            '--flag',
            ...(mode === 'new-chat' ? [] : [expect.stringContaining('$(literal)')]),
          ],
        })
        // Reattaching after a settings change keeps the original agent process.
        services.state.set(projectShellKey(project.id), 'powershell')
        services.terminals.create(chat.id, project.path)
        expect(createNodePty).toHaveBeenCalledTimes(1)
      } finally {
        item.mockRestore()
        handoff.mockRestore()
        resume.mockRestore()
        services.terminals.terminateAll()
        services.closeDatabase?.()
      }
    },
  )

  it('persists the launched agent identity through profile edits and deletion', () => {
    const { services, project } = setup()
    try {
      const profile = services.agentProfiles.put({
        id: null,
        name: 'Code analysis',
        command: 'claude "{prompt}"',
      }).profiles[0]
      services.agentProfiles.selectionSet(project.id, {
        selectedIds: [profile.id],
        defaultId: null,
      })
      const chat = services.chats.createWithAgent(project.id, profile.id)
      expect(chat).toMatchObject({ name: '[WSL] Code analysis', agentName: 'Claude' })
      services.agentProfiles.put({
        id: profile.id,
        name: 'New profile name',
        command: 'codex "{prompt}"',
      })
      expect(services.chats.list(project.id)).toEqual([chat])
      services.agentProfiles.selectionSet(project.id, { selectedIds: [], defaultId: null })
      services.agentProfiles.delete(profile.id)
      expect(services.chats.list(project.id)).toEqual([chat])
    } finally {
      services.terminals.terminateAll()
      services.closeDatabase?.()
    }
  })

  it('lists directories through the existing WSL helper without registering a project', () => {
    const { services, project } = setup()
    const before = services.projects.list()
    expect(services.projects.wslDirectories('Ubuntu', '/home/user/')).toEqual([
      '/home/user/Project',
    ])
    expect(listWslDirectories).toHaveBeenCalledExactlyOnceWith('Ubuntu', '/home/user/')
    expect(services.projects.list()).toEqual(before)
    expect(before.map((entry) => entry.id)).toEqual([project.id])
  })
  it.each(['chat', 'bottom'] as const)(
    'reattaches a live %s PTY after its saved Linux shell becomes unavailable',
    (kind) => {
      const { services, project } = setup()
      services.state.set(projectShellKey(project.id), 'custom:/bin/fish')
      const sessionId =
        kind === 'chat' ? services.chats.create(project.id).id : `bottom:${project.id}:tab1`
      try {
        expect(services.terminals.create(sessionId, project.path)).toBe(sessionId)
        expect(createNodePty).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            file: 'wsl.exe',
            args: [
              '--distribution',
              'Ubuntu',
              '--cd',
              '/home/user/Project',
              '--exec',
              'bash',
              '-lc',
              'exec "$@"',
              'bash',
              '/bin/fish',
            ],
          }),
        )
        expect(runWsl).toHaveBeenCalledWith('Ubuntu', expect.arrayContaining(['/bin/fish']))

        // Models a removed executable or lost execute permission after the PTY started.
        vi.mocked(runWsl).mockReturnValue('')
        vi.mocked(runWsl).mockClear()
        expect(services.terminals.create(sessionId, project.path)).toBe(sessionId)
        expect(runWsl).not.toHaveBeenCalled()
        expect(createNodePty).toHaveBeenCalledTimes(1)

        // Existing sessions still enforce their persisted project's distribution.
        expect(() => services.terminals.create(sessionId, 'D:/host')).toThrow(
          /project distribution/,
        )
        expect(() => services.terminals.create(sessionId, '\\\\wsl$\\Debian\\home\\user')).toThrow(
          /project distribution/,
        )
        expect(runWsl).not.toHaveBeenCalled()

        const newSessionId =
          kind === 'chat' ? services.chats.create(project.id).id : `bottom:${project.id}:tab2`
        expect(() => services.terminals.create(newSessionId, project.path)).toThrow(
          /Linux shell is unavailable or not executable/,
        )
        expect(runWsl).toHaveBeenCalledWith('Ubuntu', expect.arrayContaining(['/bin/fish']))
        expect(createNodePty).toHaveBeenCalledTimes(1)
      } finally {
        services.terminals.terminateAll()
      }
    },
  )

  it('uses project Linux shell settings without reading, probing or pruning host custom shells', () => {
    const { services, project } = setup()
    services.state.set(APP_STATE_KEY.customShells, JSON.stringify(['D:/removed.exe']))
    services.state.set(projectWslShellsKey(project.id), JSON.stringify(['/bin/fish']))
    vi.mocked(accessSync).mockClear()
    vi.mocked(statSync).mockClear()
    expect(services.terminals.shellDetect(project.id).map((entry) => entry.id)).toEqual([
      'default',
      'custom:/bin/bash',
      'custom:/bin/fish',
    ])
    services.terminals.shellAddCustom('/bin/zsh', project.id)
    expect(services.state.get(APP_STATE_KEY.customShells)).toBe('["D:/removed.exe"]')
    expect(JSON.parse(services.state.get(projectWslShellsKey(project.id)) ?? '[]')).toEqual([
      '/bin/fish',
      '/bin/zsh',
    ])
    expect(accessSync).not.toHaveBeenCalled()
    expect(statSync).not.toHaveBeenCalled()
    expect(listWslDistributions).not.toHaveBeenCalled()
    expect(vi.mocked(runWsl).mock.calls.every(([distribution]) => distribution === 'Ubuntu')).toBe(
      true,
    )
  })

  it('routes chat and bottom terminals to the persisted distribution and rejects host or other-distro cwd', () => {
    const { services, project } = setup()
    const chat = services.chats.create(project.id)
    services.terminals.create(chat.id, project.path)
    services.terminals.create(`bottom:${project.id}:tab1`, project.path)
    const calls = vi
      .mocked(createNodePty)
      .mock.calls.map(([options]) => ({ file: options.file, args: options.args, cwd: options.cwd }))
    expect(calls).toEqual(
      Array.from({ length: 2 }, () => ({
        file: 'wsl.exe',
        args: ['--distribution', 'Ubuntu', '--cd', '/home/user/Project'],
        cwd: process.cwd(),
      })),
    )
    expect(() => services.terminals.create(`bottom:${project.id}:tab2`, 'D:/host')).toThrow(
      /project distribution/,
    )
    expect(() =>
      services.terminals.create(`bottom:${project.id}:tab3`, '\\\\wsl$\\Debian\\home\\user'),
    ).toThrow(/project distribution/)
    expect(createNodePty).toHaveBeenCalledTimes(2)
    services.terminals.terminateAll()
  })
})
