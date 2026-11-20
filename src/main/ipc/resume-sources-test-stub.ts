import { WORK_RECORD_SKILL_FILE_PATH } from '@shared/ipc-contract'
import { vi } from 'vitest'
import type { AppServices } from './service-registry'

export function resumeSourcesTestStub(): AppServices['resumeSources'] {
  return {
    list: vi.fn(() => ({ revision: 1, templates: [] })),
    put: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    test: vi.fn(),
    cancel: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
    bind: vi.fn((projectId: string, templateId: string | null) => ({ projectId, templateId })),
    binding: vi.fn((projectId: string) => ({ projectId, templateId: null })),
    usage: vi.fn((templateId: string) => ({ templateId, projects: [] })),
    discover: vi.fn(async () => ({
      projectId: 'p',
      templateId: 't',
      revision: 1,
      candidates: [],
      rejections: [],
    })),
    prepare: vi.fn(async () => 'prompt'),
    importLegacy: vi.fn(async () => null),
    skillPreview: vi.fn(async () => ({
      path: WORK_RECORD_SKILL_FILE_PATH,
      origin: 'local-progress' as const,
      sourceName: 'Local work record',
      exists: false,
      current: null,
      text: '',
      token: 'a'.repeat(64),
    })),
    writeSkill: vi.fn(async () => undefined),
    dropProject: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  }
}
