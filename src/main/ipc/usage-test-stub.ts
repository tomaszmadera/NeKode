import { vi } from 'vitest'
import type { AppServices } from './service-registry'

export function usageTestStub(): AppServices['usage'] {
  return {
    listAdapters: vi.fn(() => []),
    getSettings: vi.fn(() => ({
      connections: [],
      pin: null,
      export: { enabled: false, path: null },
    })),
    saveSettings: vi.fn(),
    read: vi.fn(() => ({ connections: [], pin: null, cacheError: null, exportError: null })),
    refresh: vi.fn(),
    test: vi.fn(),
    pickFile: vi.fn(),
    getEnabled: vi.fn(() => false),
    setEnabled: vi.fn((enabled: boolean) => enabled),
    setVisible: vi.fn(),
    shutdown: vi.fn(),
    inspectFile: vi.fn(() => []),
    claudeSetup: vi.fn(() => ({ directory: 'C:/data/claude', command: 'node setup.cjs' })),
    openAdaptersFolder: vi.fn(async () => undefined),
  }
}
