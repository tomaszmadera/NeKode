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
    discover: vi.fn(async () => ({
      projectId: 'p',
      templateId: 't',
      revision: 1,
      candidates: [],
      rejections: [],
    })),
    prepare: vi.fn(async () => 'prompt'),
    importLegacy: vi.fn(async () => null),
    dropProject: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  }
}
