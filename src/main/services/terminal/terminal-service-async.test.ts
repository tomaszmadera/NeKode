import { createBottomTabId } from '@shared/bottom-tab-id'
import { describe, expect, it, vi } from 'vitest'
import { TerminalService } from './terminal-service'

describe('asynchronous terminal creation', () => {
  it('cancels pending bottom tabs when their project is removed', async () => {
    let finish: (value: { file: string; args: string[] }) => void = () => {}
    const createPty = vi.fn()
    const service = new TerminalService({ createPty, isDirectory: () => true })
    const id = createBottomTabId('project')
    const result = service.createAsync(
      id,
      'D:/project',
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    service.terminateProjectBottom('project')
    finish({ file: 'bash', args: [] })
    await expect(result).rejects.toThrow('closed')
    expect(createPty).not.toHaveBeenCalled()
  })
  it('shares one creation between simultaneous attaches and cancels a create for a closed chat', async () => {
    let finish: (value: { file: string; args: string[] }) => void = () => {}
    const shell = vi.fn(
      () =>
        new Promise<{ file: string; args: string[] }>((resolve) => {
          finish = resolve
        }),
    )
    const createPty = vi.fn(() => ({
      pid: 1,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => ({ dispose: vi.fn() }),
      onExit: () => ({ dispose: vi.fn() }),
    }))
    const service = new TerminalService({ createPty, isDirectory: () => true })
    const first = service.createAsync('chat', 'D:/project', shell)
    const second = service.createAsync('chat', 'D:/project', shell)
    finish({ file: 'bash', args: [] })
    await expect(Promise.all([first, second])).resolves.toEqual(['chat', 'chat'])
    expect(shell).toHaveBeenCalledOnce()
    expect(createPty).toHaveBeenCalledOnce()

    // A create racing the termination of its chat fails before spawning.
    service.terminate('chat')
    const third = service.createAsync('chat', 'D:/project', shell)
    expect(shell).toHaveBeenCalledTimes(2)
    service.terminate('chat')
    finish({ file: 'bash', args: [] })
    await expect(third).rejects.toThrow('closed')
    expect(createPty).toHaveBeenCalledOnce()
    service.terminateAll()
  })

  it('does not spawn after shutdown while a probe is pending', async () => {
    let finish: (value: { file: string; args: string[] }) => void = () => {}
    const createPty = vi.fn()
    const service = new TerminalService({ createPty, isDirectory: () => true })
    const result = service.createAsync(
      'chat',
      'D:/project',
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let rolledBack = false
    const rollback = result.catch(() => {
      rolledBack = true
    })
    let shutdownSettled = false
    const shutdown = service.shutdown().then(() => {
      expect(rolledBack).toBe(true)
      shutdownSettled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(shutdownSettled).toBe(false)
    finish({ file: 'bash', args: [] })
    await expect(result).rejects.toThrow('closing')
    await shutdown
    await rollback
    expect(rolledBack).toBe(true)
    expect(createPty).not.toHaveBeenCalled()
  })
})
