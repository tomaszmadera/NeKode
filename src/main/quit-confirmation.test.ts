import { describe, expect, it, vi } from 'vitest'
import { createQuitGate, quitConfirmationCopy } from './quit-confirmation'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('quit confirmation gate', () => {
  it('allows quit without asking when nothing is running', () => {
    const ask = vi.fn()
    const quit = vi.fn()
    const gate = createQuitGate({ runningCount: () => 0, ask, quit })
    expect(gate.blockWindowClose()).toBe(false)
    expect(gate.allowTeardown()).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('asks once while a terminal is running and quits only after confirmation', async () => {
    const pending = deferred<boolean>()
    const ask = vi.fn(() => pending.promise)
    const quit = vi.fn()
    const gate = createQuitGate({ runningCount: () => 2, ask, quit })

    expect(gate.blockWindowClose()).toBe(true)
    expect(gate.allowTeardown()).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(2)
    expect(quit).not.toHaveBeenCalled()

    pending.resolve(true)
    await pending.promise
    expect(quit).toHaveBeenCalledOnce()
    expect(gate.blockWindowClose()).toBe(false)
    expect(gate.allowTeardown()).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('keeps the app open when the person cancels, and asks again on the next close', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const ask = vi.fn()
    ask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const quit = vi.fn()
    const gate = createQuitGate({ runningCount: () => 1, ask, quit })

    expect(gate.blockWindowClose()).toBe(true)
    first.resolve(false)
    await first.promise
    expect(quit).not.toHaveBeenCalled()

    expect(gate.blockWindowClose()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    second.resolve(false)
    await second.promise
    expect(quit).not.toHaveBeenCalled()
  })

  it('does not open a second dialog while the first is still open', () => {
    const ask = vi.fn(() => new Promise<boolean>(() => {}))
    const gate = createQuitGate({ runningCount: () => 1, ask, quit: vi.fn() })
    expect(gate.blockWindowClose()).toBe(true)
    expect(gate.allowTeardown()).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('skips the prompt after an earlier approval', () => {
    const ask = vi.fn()
    const gate = createQuitGate({ runningCount: () => 4, ask, quit: vi.fn() })
    gate.approve()
    expect(gate.blockWindowClose()).toBe(false)
    expect(gate.allowTeardown()).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('can ask again after the dialog fails', async () => {
    const failed = deferred<boolean>()
    const ask = vi.fn()
    ask.mockReturnValueOnce(failed.promise).mockReturnValueOnce(Promise.resolve(false))
    const gate = createQuitGate({ runningCount: () => 1, ask, quit: vi.fn() })
    expect(gate.blockWindowClose()).toBe(true)
    failed.reject(new Error('dialog failed'))
    await failed.promise.catch(() => undefined)
    expect(gate.blockWindowClose()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})

describe('quitConfirmationCopy', () => {
  it('uses the singular for one terminal and the plural otherwise', () => {
    expect(quitConfirmationCopy(1).message).toBe(
      '1 terminal is still running. Closing NeKode ends it.',
    )
    expect(quitConfirmationCopy(3).message).toBe(
      '3 terminals are still running. Closing NeKode ends them.',
    )
    expect(quitConfirmationCopy(1).detail).toBe(
      'Chats stay in the list. Their terminals start fresh next time.',
    )
  })
})
