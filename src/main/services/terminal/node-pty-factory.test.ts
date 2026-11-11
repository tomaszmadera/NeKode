import { spawn } from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodePty } from './node-pty-factory'
import type { PtySpawnOptions } from './terminal-service'

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}))

// The Windows name lookup has its own suite (windows-executable.test.ts); here
// the factory only has to hand the resolved target to node-pty.
vi.mock('./windows-executable', () => ({
  resolveWindowsExecutable: (file: string) => `resolved:${file}`,
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

  it('spawns the Windows target the resolver returns for the profile name', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const args = ['a b', '& | ;', '"quote"', 'ą', '']
    createNodePty({
      file: 'opencode',
      args,
      cwd: 'C:\\project',
      cols: 80,
      rows: 24,
      env: { PATH: 'C:\\bin' },
    })
    expect(spawn).toHaveBeenCalledWith('resolved:opencode', args, expect.any(Object))
  })

  it('preserves the profile name on other platforms', () => {
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
    Object.defineProperty(process, 'platform', { value: 'linux' })
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
