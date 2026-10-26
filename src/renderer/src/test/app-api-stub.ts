// Shared window.app API stub for renderer tests. The full surface resolves
// with neutral values; per-file differences are explicit overrides spread
// after the factory call in each test file (Stage 2 W16). One definition so
// the copies that used to live in eight test files cannot drift.

import { type AppApi, emptyGitWorktree, relativeToProject } from '@shared/ipc-contract'
import { vi } from 'vitest'
import { createDictationApiStub } from './dictation-api-stub'

export function createAppApiStub(): AppApi {
  return {
    appUpdate: {
      latest: vi.fn().mockResolvedValue({ canInstall: false, version: null, error: null }),
      download: vi.fn().mockResolvedValue(undefined),
      launch: vi.fn().mockResolvedValue(undefined),
    },
    usage: {
      listAdapters: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({
        connections: [],
        pin: null,
        export: { enabled: false, path: null },
      }),
      saveSettings: vi.fn(),
      read: vi
        .fn()
        .mockResolvedValue({ connections: [], pin: null, cacheError: null, exportError: null }),
      refresh: vi
        .fn()
        .mockResolvedValue({ connections: [], pin: null, cacheError: null, exportError: null }),
      test: vi.fn(),
      pickFile: vi.fn(),
      getEnabled: vi.fn().mockResolvedValue(false),
      openAdaptersFolder: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn((enabled: boolean) => Promise.resolve(enabled)),
    },
    dictation: createDictationApiStub(),
    actions: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
    },
    projects: {
      wslDirectories: vi.fn(() => Promise.resolve([])),
      wslDistributions: vi.fn().mockResolvedValue([]),
      addWsl: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 't9', projectId: 'p1', name: 'PowerShell' }),
      createWithAgent: vi.fn().mockResolvedValue({ id: 't9', projectId: 'p1', name: 'PowerShell' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockResolvedValue('term-1'),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      shellName: vi.fn().mockResolvedValue('PowerShell'),
      shellList: vi.fn().mockResolvedValue([]),
      // Shell tab detection (spec project-shell-selection): Project Settings
      // opens on the Shell tab and runs one detection on entry.
      shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
      shellAddCustom: vi.fn().mockResolvedValue({ id: 'default', label: 'PowerShell' }),
      terminate: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi
        .fn()
        .mockResolvedValue({ branch: 'main', dirty: false, worktree: emptyGitWorktree() }),
      fileStatuses: vi.fn().mockResolvedValue({}),
      sync: vi.fn().mockResolvedValue(undefined),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
      openRoot: vi.fn().mockResolvedValue(undefined),
      showInFolder: vi.fn().mockResolvedValue(undefined),
      trash: vi.fn().mockResolvedValue(undefined),
    },
    handoffs: {
      list: vi.fn().mockResolvedValue([]),
      resumePrompt: vi.fn(
        async (_projectId: string, path: string) =>
          `Resume from handoff ${relativeToProject('D:/code/demo', path) ?? path}`,
      ),
    },
    kanban: {
      adaptersList: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ adapterId: null, values: {}, secretKeys: [] }),
      setConfig: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue(undefined),
      listBoard: vi.fn().mockResolvedValue({ states: [], items: [] }),
      createItem: vi.fn(),
      updateItem: vi.fn(),
      getItem: vi.fn(),
      getComments: vi.fn().mockResolvedValue([]),
      bindLocalFile: vi.fn().mockResolvedValue(undefined),
      skillStatus: vi.fn().mockResolvedValue({ exists: false }),
      writeSkill: vi.fn().mockResolvedValue(undefined),
      launchTask: vi.fn(),
      handoffCandidates: vi.fn(),
      handoffAvailability: vi.fn(async () => ({
        state: 'ready' as const,
        items: [],
        rejections: [],
      })),
    },
    taskProgress: {
      adaptersList: vi.fn().mockResolvedValue({ adapters: [], warnings: [] }),
      getBinding: vi.fn().mockResolvedValue({ adapterId: null, config: {} }),
      saveBinding: vi.fn().mockResolvedValue(undefined),
      test: vi.fn(),
      observe: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      onChanged: vi.fn(() => () => undefined),
    },
    agentProfiles: {
      get: vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }),
      libraryGet: vi.fn().mockResolvedValue({ version: 1, profiles: [] }),
      templatesGet: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue({ version: 1, profiles: [] }),
      delete: vi.fn().mockResolvedValue({ version: 1, profiles: [] }),
      selectionGet: vi.fn().mockResolvedValue({ version: 1, selectedIds: [], defaultId: null }),
      selectionSet: vi.fn().mockResolvedValue({ version: 1, selectedIds: [], defaultId: null }),
    },
    dialogs: {
      pickDirectory: vi.fn().mockResolvedValue(null),
    },
  }
}
