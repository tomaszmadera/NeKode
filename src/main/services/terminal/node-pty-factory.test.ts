import { spawn } from 'node-pty'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodePty } from './node-pty-factory'
import type { PtySpawnOptions } from './terminal-service'

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}))

describe('createNodePty', () => {
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
