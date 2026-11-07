import { describe, expect, it, vi } from 'vitest'
import { bootstrap } from './bootstrap'

describe('bootstrap', () => {
  it('runs startup successfully without calling error dialog or quit', async () => {
    const start = vi.fn()
    const showErrorBox = vi.fn()
    const quit = vi.fn()
    const logError = vi.fn()

    await bootstrap(start, { showErrorBox, quit, logError })

    expect(start).toHaveBeenCalledOnce()
    expect(showErrorBox).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it.each([
    [
      'synchronous throw',
      'Database disk image is malformed',
      (error: Error) => () => {
        throw error
      },
    ],
    [
      'asynchronous rejection',
      'Async migration failure',
      (error: Error) => async () => {
        throw error
      },
    ],
  ] as const)(
    'catches a %s from startup, shows error dialog, and quits app',
    async (_mode, message, fail) => {
      const startupError = new Error(message)
      const start = vi.fn(fail(startupError))
      const showErrorBox = vi.fn()
      const quit = vi.fn()
      const logError = vi.fn()

      await bootstrap(start, { showErrorBox, quit, logError })

      expect(start).toHaveBeenCalledOnce()
      expect(logError).toHaveBeenCalledWith('[bootstrap] application failed to start', startupError)
      expect(showErrorBox).toHaveBeenCalledWith('NeKode failed to start', message)
      expect(quit).toHaveBeenCalledOnce()
    },
  )

  it('handles non-Error thrown objects gracefully', async () => {
    const start = vi.fn(() => {
      throw 'string failure'
    })
    const showErrorBox = vi.fn()
    const quit = vi.fn()
    const logError = vi.fn()

    await bootstrap(start, { showErrorBox, quit, logError })

    expect(showErrorBox).toHaveBeenCalledWith('NeKode failed to start', 'string failure')
    expect(quit).toHaveBeenCalledOnce()
  })
})
