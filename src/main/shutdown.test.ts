import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerShutdown } from './shutdown'

it('prevents reentrant quit until terminal shutdown finishes, then quits once', async () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  let finish!: () => void
  const terminals = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const dictation = vi.fn()
  const failed = vi.fn()
  registerShutdown(app, terminals, dictation, failed)
  const event = { preventDefault: vi.fn() }
  app.emit('before-quit', event)
  app.emit('before-quit', event)
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  expect(terminals).toHaveBeenCalledOnce()
  expect(dictation).toHaveBeenCalledOnce()
  expect(app.quit).not.toHaveBeenCalled()
  finish()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(app.quit).toHaveBeenCalledOnce()
  event.preventDefault.mockClear()
  app.emit('before-quit', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(terminals).toHaveBeenCalledOnce()
  expect(failed).not.toHaveBeenCalled()
})

it('quits once after a timeout report when the pending shutdown later resolves', async () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  let finish!: () => void
  let reportTimeout: ((error: unknown) => void) | undefined
  const terminals = vi.fn((reporter?: (error: unknown) => void) => {
    reportTimeout = reporter
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  const dictation = vi.fn()
  const failed = vi.fn()
  registerShutdown(app, terminals, dictation, failed)
  const event = { preventDefault: vi.fn() }
  app.emit('before-quit', event)
  app.emit('before-quit', event)
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  expect(terminals).toHaveBeenCalledOnce()
  expect(terminals).toHaveBeenCalledWith(failed)
  expect(dictation).toHaveBeenCalledOnce()
  expect(app.quit).not.toHaveBeenCalled()
  reportTimeout?.(new Error('Terminal shutdown timed out.'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(failed).toHaveBeenCalledOnce()
  expect(app.quit).not.toHaveBeenCalled()
  app.emit('before-quit', event)
  expect(event.preventDefault).toHaveBeenCalledTimes(3)
  expect(terminals).toHaveBeenCalledOnce()
  expect(dictation).toHaveBeenCalledOnce()
  finish()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(app.quit).toHaveBeenCalledOnce()
  expect(failed).toHaveBeenCalledOnce()
  expect(terminals).toHaveBeenCalledOnce()
  expect(dictation).toHaveBeenCalledOnce()
  event.preventDefault.mockClear()
  app.emit('before-quit', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
})

describe('shutdown failures', () => {
  it('reports terminal failure and keeps native teardown ahead of process exit', async () => {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    const error = new Error('timeout')
    const failed = vi.fn()
    registerShutdown(app, () => Promise.reject(error), vi.fn(), failed)
    app.emit('before-quit', { preventDefault: vi.fn() })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(failed).toHaveBeenCalledWith(error)
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('starts terminal shutdown and reports failure when dictation throws synchronously', async () => {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    let finish!: () => void
    const terminals = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const dictationError = new Error('dictation crash')
    const dictation = vi.fn(() => {
      throw dictationError
    })
    const failed = vi.fn()
    registerShutdown(app, terminals, dictation, failed)
    const event = { preventDefault: vi.fn() }
    expect(() => app.emit('before-quit', event)).not.toThrow()
    expect(terminals).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledWith(dictationError)
    finish()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('permits force quit on subsequent before-quit event after teardown failure', async () => {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    const error = new Error('teardown failed')
    const failed = vi.fn()
    registerShutdown(app, () => Promise.reject(error), vi.fn(), failed)
    const firstEvent = { preventDefault: vi.fn() }
    app.emit('before-quit', firstEvent)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(failed).toHaveBeenCalledWith(error)
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()

    const secondEvent = { preventDefault: vi.fn() }
    app.emit('before-quit', secondEvent)
    expect(secondEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('invokes stopActions and closeDatabase hooks around terminal shutdown and app quit', async () => {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    let finish!: () => void
    const terminals = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const dictation = vi.fn()
    const failed = vi.fn()
    const stopActions = vi.fn()
    const closeDatabase = vi.fn()

    registerShutdown(app, terminals, dictation, failed, { stopActions, closeDatabase })
    app.emit('before-quit', { preventDefault: vi.fn() })

    expect(dictation).toHaveBeenCalledOnce()
    expect(stopActions).toHaveBeenCalledOnce()
    expect(terminals).toHaveBeenCalledOnce()
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()

    finish()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(closeDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      app.quit.mock.invocationCallOrder[0],
    )
  })

  it('routes stopActions and closeDatabase errors to reportFailure without breaking quit flow', async () => {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    let finish!: () => void
    const terminals = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const dictation = vi.fn()
    const failed = vi.fn()
    const actionError = new Error('action kill error')
    const dbError = new Error('db close error')
    const stopActions = vi.fn(() => {
      throw actionError
    })
    const closeDatabase = vi.fn(() => {
      throw dbError
    })

    registerShutdown(app, terminals, dictation, failed, { stopActions, closeDatabase })
    app.emit('before-quit', { preventDefault: vi.fn() })

    expect(failed).toHaveBeenCalledWith(actionError)
    expect(terminals).toHaveBeenCalledOnce()

    finish()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(failed).toHaveBeenCalledWith(dbError)
    expect(app.quit).toHaveBeenCalledOnce()
  })
})
