import { spawn } from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodePty } from './node-pty-factory'
import type { PtySpawnOptions } from './terminal-service'

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}))

describe('createNodePty', () => {
  const originalPlatform = process.platform
  const fakePty = {
    pid: 4321,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(spawn).mockReturnValue(fakePty as unknown as ReturnType<typeof spawn>)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it.each(['hermes', 'agy', 'grok', 'claude', 'codex', 'C:\\Agent tools\\agent'])(
    'starts the Windows native executable for extensionless profile %s',
    (file) => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const args = ['a b', '& | ;', '"quote"', 'ą', '']
      createNodePty({ file, args, cwd: 'C:\\project', cols: 80, rows: 24, env: {} })
      expect(spawn).toHaveBeenCalledWith(`${file}.exe`, args, expect.any(Object))
    },
  )

  it.each(['agent.exe', 'agent.com', 'agent.cmd', 'agent.bat', 'wsl.exe'])(
    'preserves an explicit Windows executable extension in %s',
    (file) => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      createNodePty({ file, args: [], cwd: 'C:\\project', cols: 80, rows: 24, env: {} })
      expect(spawn).toHaveBeenCalledWith(file, [], expect.any(Object))
    },
  )

  it('preserves extensionless executables on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    createNodePty({
      file: '/usr/bin/claude',
      args: [],
      cwd: '/home/user',
      cols: 80,
      rows: 24,
      env: {},
    })
    expect(spawn).toHaveBeenCalledWith('/usr/bin/claude', [], expect.any(Object))
  })

  it('forwards all spawn options to node-pty spawn', () => {
    const options: PtySpawnOptions = {
      file: 'powershell.exe',
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
      cwd: 'D:/workspace/project',
      cols: 120,
      rows: 40,
      env: { CUSTOM_VAR: '123', PATH: 'C:/bin' },
    }

    createNodePty(options)

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
      {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: 'D:/workspace/project',
        env: { CUSTOM_VAR: '123', PATH: 'C:/bin' },
      },
    )
  })

  it('wraps and delegates all instance methods to the underlying pty process', () => {
    const options: PtySpawnOptions = {
      file: '/bin/bash',
      args: [],
      cwd: '/home/user',
      cols: 80,
      rows: 24,
      env: {},
    }

    const process = createNodePty(options)

    expect(process.pid).toBe(4321)

    process.write('hello world\n')
    expect(fakePty.write).toHaveBeenCalledWith('hello world\n')

    process.resize(100, 30)
    expect(fakePty.resize).toHaveBeenCalledWith(100, 30)

    process.kill()
    expect(fakePty.kill).toHaveBeenCalledTimes(1)

    const dataListener = vi.fn()
    const dataSub = process.onData(dataListener)
    expect(fakePty.onData).toHaveBeenCalledWith(dataListener)
    expect(dataSub).toBeDefined()

    const exitListener = vi.fn()
    const exitSub = process.onExit(exitListener)
    expect(fakePty.onExit).toHaveBeenCalledWith(exitListener)
    expect(exitSub).toBeDefined()
  })
})
