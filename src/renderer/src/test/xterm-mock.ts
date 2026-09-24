import { vi } from 'vitest'

// Module-boundary mock for @xterm/xterm (jsdom cannot host a real xterm
// canvas). Tests assert NeKode's own wiring — open/attach, write, fit, dispose
// — not xterm internals. Import this module in tests to inspect the instances
// the code under test constructed.

export class MockTerminal {
  cols = 80
  rows = 24
  options: unknown
  openedElement: HTMLElement | null = null
  written: unknown[] = []
  loadedAddons: unknown[] = []
  disposed = false
  private dataListeners = new Set<(data: string) => void>()

  constructor(options?: unknown) {
    this.options = options
    mockTerminalInstances.push(this)
  }

  open = vi.fn((element: HTMLElement): void => {
    this.openedElement = element
  })

  write = vi.fn((data: unknown): void => {
    this.written.push(data)
  })

  onData = vi.fn((listener: (data: string) => void): { dispose(): void } => {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  })

  loadAddon = vi.fn((addon: unknown): void => {
    this.loadedAddons.push(addon)
  })

  dispose = vi.fn((): void => {
    this.disposed = true
    this.dataListeners.clear()
  })

  /** Simulates the user typing into the terminal. */
  emitInput(data: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(data)
    }
  }
}

export const mockTerminalInstances: MockTerminal[] = []

export function resetMockTerminals(): void {
  mockTerminalInstances.length = 0
}

export { MockTerminal as Terminal }
