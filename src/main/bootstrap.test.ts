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

  it('catches synchronous startup exception, shows error dialog, and quits app', async () => {
    const startupError = new Error('Database disk image is malformed')
    const start = vi.fn(() => {
      throw startupError
    })
    const showErrorBox = vi.fn()
    const quit = vi.fn()
    const logError = vi.fn()

    await bootstrap(start, { showErrorBox, quit, logError })

    expect(start).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledWith('[bootstrap] application failed to start', startupError)
    expect(showErrorBox).toHaveBeenCalledWith(
      'NeKode failed to start',
      'Database disk image is malformed',
    )
    expect(quit).toHaveBeenCalledOnce()
  })

  it('catches asynchronous startup rejection, shows error dialog, and quits app', async () => {
    const startupError = new Error('Async migration failure')
    const start = vi.fn(async () => {
      throw startupError
    })
    const showErrorBox = vi.fn()
    const quit = vi.fn()
    const logError = vi.fn()

    await bootstrap(start, { showErrorBox, quit, logError })

    expect(start).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledWith('[bootstrap] application failed to start', startupError)
    expect(showErrorBox).toHaveBeenCalledWith('NeKode failed to start', 'Async migration failure')
    expect(quit).toHaveBeenCalledOnce()
  })

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
