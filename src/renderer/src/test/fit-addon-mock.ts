import { vi } from 'vitest'

// Module-boundary mock for @xterm/addon-fit: records fit() calls so tests can
// assert the fit-on-open / fit-on-resize wiring without a real terminal.

export class MockFitAddon {
  fit = vi.fn((): void => undefined)
  activate = vi.fn((): void => undefined)
  dispose = vi.fn((): void => undefined)
}

export const mockFitAddonInstances: MockFitAddon[] = []

class TrackedFitAddon extends MockFitAddon {
  constructor() {
    super()
    mockFitAddonInstances.push(this)
  }
}

export function resetMockFitAddons(): void {
  mockFitAddonInstances.length = 0
}

export { TrackedFitAddon as FitAddon }
