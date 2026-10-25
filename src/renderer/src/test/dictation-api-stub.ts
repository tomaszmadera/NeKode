import { vi } from 'vitest'
import type { AppApi, DictationDictionaryEntry } from '../../../shared/ipc-contract'

const dummyEntry: DictationDictionaryEntry = {
  id: 'd1',
  term: 'term',
  aliases: [],
  description: null,
  scope: 'global',
  projectId: null,
  enabled: true,
  createdAt: '',
  updatedAt: '',
}

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
    dictionaryList: vi.fn(async () => []),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    start: vi.fn(),
    audio: vi.fn(),
    cancel: vi.fn(),
    onResult: vi.fn(() => () => undefined),
    providersList: vi.fn(async () => []),
    providersTestConnection: vi.fn(async () => ({ ok: true, message: '' })),
    providersDiscoverModels: vi.fn(async () => []),
    providersGetConfig: vi.fn(async () => ({})),
    providersSetConfig: vi.fn(async () => {}),
    getActiveProvider: vi.fn(async () => 'openwhispr'),
    setActiveProvider: vi.fn(async () => {}),
    dictionaryAdd: vi.fn(async () => dummyEntry),
    dictionaryUpdate: vi.fn(async () => dummyEntry),
    dictionaryDelete: vi.fn(async () => {}),
    dictionaryToggle: vi.fn(async () => dummyEntry),
    postProcessingGetSettings: vi.fn(async () => ({
      mode: 'disabled' as const,
      level: 'light' as const,
      hasApiKey: false,
    })),
    postProcessingSetSettings: vi.fn(async () => {}),
  }
}
