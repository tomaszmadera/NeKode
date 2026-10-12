export interface BootstrapDeps {
  showErrorBox: (title: string, content: string) => void
  quit: () => void
  logError?: (message: string, error: unknown) => void
}

/**
 * Executes application bootstrap logic with top-level error handling.
 * Catches synchronous and asynchronous initialization failures, presents
 * a diagnostic error box, and quits the application cleanly.
 */
export async function bootstrap(
  start: () => void | Promise<void>,
  deps: BootstrapDeps,
): Promise<void> {
  try {
    await start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ;(deps.logError ?? console.error)('[bootstrap] application failed to start', error)
    deps.showErrorBox('NeKode failed to start', message)
    deps.quit()
  }
}
