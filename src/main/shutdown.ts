interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

export interface ShutdownHooks {
  stopActions?: () => void
  closeDatabase?: () => void
}

/** Keep Electron alive until native terminal exits and background processes have drained. */
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

  app.on('before-quit', (event) => {
    if (complete || teardownFailed) return
    event.preventDefault()
    if (started) return
    started = true

    try {
      shutdownDictation()
    } catch (error) {
      teardownFailed = true
      reportFailure(error)
    }

    try {
      hooks?.stopActions?.()
    } catch (error) {
      teardownFailed = true
      reportFailure(error)
    }

    void shutdownTerminals(reportFailure).then(
      () => {
        try {
          hooks?.closeDatabase?.()
        } catch (error) {
          teardownFailed = true
          reportFailure(error)
        }
        complete = true
        app.quit()
      },
      (error) => {
        teardownFailed = true
        reportFailure(error)
      },
    )
  })
}
