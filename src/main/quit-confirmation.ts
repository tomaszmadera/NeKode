/** Main-process gate for the quit confirmation. The dialog stays in main. */
export interface QuitGate {
  /** Skip the prompt. The in-app update quit already asked the person to save work. */
  approve(): void
  /**
   * True when the main window must stay open. Starts one prompt when a
   * terminal is still running.
   */
  blockWindowClose(): boolean
  /**
   * True when before-quit may start teardown. A prompt that is already open
   * does not start a second dialog.
   */
  allowTeardown(): boolean
}

export function createQuitGate(options: {
  runningCount: () => number
  ask: (count: number) => Promise<boolean>
  quit: () => void
}): QuitGate {
  let approved = false
  let asking = false

  // True when this quit must wait. A count of zero, or an earlier approval,
  // does not ask.
  const promptIfNeeded = (): boolean => {
    if (approved) return false
    const count = options.runningCount()
    if (count === 0) return false
    if (!asking) {
      asking = true
      void options.ask(count).then(
        (confirmed) => {
          asking = false
          if (!confirmed) return
          approved = true
          options.quit()
        },
        () => {
          asking = false
        },
      )
    }
    return true
  }

  return {
    approve(): void {
      approved = true
    },
    blockWindowClose(): boolean {
      return promptIfNeeded()
    },
    allowTeardown(): boolean {
      return !promptIfNeeded()
    },
  }
}

/** English copy for the quit dialog. `count` is the number of live terminals. */
export function quitConfirmationCopy(count: number): { message: string; detail: string } {
  const one = count === 1
  return {
    message: one
      ? '1 terminal is still running. Closing NeKode ends it.'
      : `${count} terminals are still running. Closing NeKode ends them.`,
    detail: 'Chats stay in the list. Their terminals start fresh next time.',
  }
}
