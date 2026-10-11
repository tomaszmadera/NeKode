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
})
