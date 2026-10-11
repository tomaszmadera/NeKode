interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/** Keep Electron alive until the native terminal exit callbacks have drained. */
export function registerShutdown(
  app: QuitApp,
  shutdownTerminals: (reportTimeout?: (error: unknown) => void) => Promise<void>,
  shutdownDictation: () => void,
  reportFailure: (error: unknown) => void,
): void {
  let started = false
  let complete = false
  app.on('before-quit', (event) => {
    if (complete) return
    event.preventDefault()
    if (started) return
    started = true
    shutdownDictation()
    // The timeout report does not settle this promise. Quit only after every exit.
    void shutdownTerminals(reportFailure).then(() => {
      complete = true
      app.quit()
    }, reportFailure)
  })
}
