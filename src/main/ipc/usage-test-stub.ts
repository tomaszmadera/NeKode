import { vi } from 'vitest'
import type { AppServices } from './service-registry'

export function usageTestStub(): AppServices['usage'] {
  return {
    listAdapters: vi.fn(() => []),
    getSettings: vi.fn(() => ({
      connections: [],
      pin: null,
      adaptersDirectory: null,
      export: { enabled: false, path: null },
    })),
    saveSettings: vi.fn(),
    read: vi.fn(() => ({ connections: [], pin: null, cacheError: null, exportError: null })),
    refresh: vi.fn(),
    test: vi.fn(),
    pickFile: vi.fn(),
    setVisible: vi.fn(),
    shutdown: vi.fn(),
  }
}
