import { accessSync, statSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STATE_KEY, projectShellKey, projectWslShellsKey } from '../../shared/ipc-contract'
import { createServices } from './create-services'
import { createNodePty } from './terminal/node-pty-factory'
import { listWslDistributions, runWsl } from './terminal/wsl'

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

function setup() {
  const services = createServices({
    dbPath: ':memory:',
    userDataPath: 'D:/scratch',
    openExternal: async () => '',
    pickDirectory: async () => null,
  })
  const project = services.projects.add('\\\\wsl.localhost\\Ubuntu\\home\\user\\Project')
  return { services, project }
}

describe('WSL service wiring', () => {
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
            args: ['--distribution', 'Ubuntu', '--cd', '/home/user/Project', '--exec', '/bin/fish'],
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
