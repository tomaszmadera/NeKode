import { vi } from 'vitest'
import type { AppApi } from '../../../shared/ipc-contract'

/** Existing renderer suites do not activate dictation before its UX stage. */
export function createDictationApiStub(): AppApi['dictation'] {
  return {
    desktopSetup: vi.fn(async () => ({
      settings: { enabled: false, confirmed: false },
      supported: true,
    })),
    desktopConfigure: vi.fn(async (settings) => ({ settings, supported: true })),
    desktopActivate: vi.fn(async () => {}),
    status: vi.fn(),
    testConnection: vi.fn(),
    refreshModels: vi.fn(),
    dictionaryList: vi.fn(async () => ({
      state: 'unavailable' as const,
      error: 'bridge-missing' as const,
    })),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    start: vi.fn(),
    audio: vi.fn(),
    cancel: vi.fn(),
    onResult: vi.fn(() => () => undefined),
  }
}
