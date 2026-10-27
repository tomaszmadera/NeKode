import { applyUserDataOverride } from './user-data-override'

export interface MainWindowFocusTarget {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
}

export interface PrimaryInstanceDeps {
  rawUserData: string | undefined
  setPath: (name: string, path: string) => void
  requestSingleInstanceLock: () => boolean
  quit: () => void
  onSecondInstance: (listener: () => void) => void
  getMainWindows: () => readonly MainWindowFocusTarget[]
  start: () => void
}

function focusExistingMainWindow(windows: readonly MainWindowFocusTarget[]): void {
  const mainWindow = windows.find((window) => !window.isDestroyed())
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

export function runPrimaryInstance(deps: PrimaryInstanceDeps): void {
  applyUserDataOverride(deps.rawUserData, deps.setPath)
  // Electron scopes this one lock to the userData directory just selected.
  // A denied process quits before database, service, or window startup.
  if (!deps.requestSingleInstanceLock()) {
    deps.quit()
    return
  }
  deps.onSecondInstance(() => {
    focusExistingMainWindow(deps.getMainWindows())
  })
  deps.start()
}
