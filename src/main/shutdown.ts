interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

export interface ShutdownHooks {
  shutdownUsage?: () => void
  shutdownTaskProgress?: () => void
  shutdownResumeSources?: () => Promise<void>
  stopActions?: () => void
  closeDatabase?: () => void
}

/** Keep Electron alive until terminal shutdown settles. A cleanup failure cannot skip the rest. */
export function registerShutdown(
  app: QuitApp,
  shutdownTerminals: (reportTimeout?: (error: unknown) => void) => Promise<void>,
  shutdownDictation: () => void,
  reportFailure: (error: unknown) => void,
  hooks?: ShutdownHooks,
): void {
  let started = false
  let complete = false
  let teardownFailed = false
  let terminalSettled = false
  let sourceSettled = true

  const reportCleanupFailure = (error: unknown): void => {
    teardownFailed = true
    try {
      reportFailure(error)
    } catch (reportError) {
      console.error('[shutdown] failed to report cleanup error', error, reportError)
    }
  }

  const runCleanup = (cleanup: (() => void) | undefined): void => {
    if (!cleanup) return
    try {
      cleanup()
    } catch (error) {
      reportCleanupFailure(error)
    }
  }

  const failTerminalShutdown = (error: unknown): void => {
    terminalSettled = true
    reportCleanupFailure(error)
  }

  app.on('before-quit', (event) => {
    // A cleanup failure or timeout report stays pending until the terminal
    // promise settles. Only a settled terminal failure may force exit.
    if (complete || (teardownFailed && terminalSettled && sourceSettled)) return
    event.preventDefault()
    if (started) return
    started = true

    runCleanup(hooks?.shutdownUsage)
    runCleanup(hooks?.shutdownTaskProgress)
    // Source cancellation owns child cleanup; finish it before the final quit.
    let sourceShutdown: Promise<void>
    let sourceFailed = false
    try {
      sourceSettled = hooks?.shutdownResumeSources === undefined
      sourceShutdown = hooks?.shutdownResumeSources?.() ?? Promise.resolve()
    } catch (error) {
      sourceSettled = true
      sourceFailed = true
      reportCleanupFailure(error)
      sourceShutdown = Promise.resolve()
    }
    sourceShutdown = sourceShutdown
      .catch((error: unknown) => {
        sourceFailed = true
        reportCleanupFailure(error)
      })
      .finally(() => {
        sourceSettled = true
      })
    runCleanup(shutdownDictation)
    runCleanup(hooks?.stopActions)

    try {
      const terminalShutdown = shutdownTerminals(reportFailure).then(() => {
        terminalSettled = true
      })
      void Promise.all([sourceShutdown, terminalShutdown]).then(() => {
        if (sourceFailed) return
        try {
          hooks?.closeDatabase?.()
        } catch (error) {
          reportCleanupFailure(error)
        }
        terminalSettled = true
        complete = true
        app.quit()
      }, failTerminalShutdown)
    } catch (error) {
      failTerminalShutdown(error)
    }
  })
}
