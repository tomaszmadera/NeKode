import { describe, expect, it } from 'vitest'
import { isSecretStateKey, relativeToProject } from './ipc-contract'

describe('relativeToProject', () => {
  it('returns a forward-slash relative path for a file inside the project root', () => {
    expect(relativeToProject('D:\\code\\demo', 'D:\\code\\demo\\.agents\\handoffs\\task.md')).toBe(
      '.agents/handoffs/task.md',
    )
  })

  it('returns null when the file lies outside the project root', () => {
    expect(relativeToProject('D:/code/demo', 'D:/elsewhere/handoff.md')).toBeNull()
  })

  it('returns null for a sibling directory that only shares a prefix', () => {
    expect(relativeToProject('D:/code/demo', 'D:/code/demo-2/handoff.md')).toBeNull()
  })

  it("returns '' for the project root itself", () => {
    expect(relativeToProject('D:/code/demo', 'D:/code/demo')).toBe('')
  })

  it('strips a trailing slash from the project root', () => {
    expect(relativeToProject('D:/code/demo/', 'D:/code/demo/handoffs/x.md')).toBe('handoffs/x.md')
  })

  it('returns null on a casing mismatch (absolute-form fallback on Windows)', () => {
    expect(relativeToProject('D:/Code/Demo', 'D:/code/demo/handoffs/x.md')).toBeNull()
  })
})

describe('isSecretStateKey', () => {
  it('identifies exact and project-scoped kanbanConfig keys as secret-bearing', () => {
    expect(isSecretStateKey('project.kanbanConfig')).toBe(true)
    expect(isSecretStateKey('project.kanbanConfig:proj-123')).toBe(true)
    expect(isSecretStateKey('project.kanbanConfig:')).toBe(true)
  })

  it('permits non-secret state keys', () => {
    expect(isSecretStateKey('project.kanbanAdapter:proj-123')).toBe(false)
    expect(isSecretStateKey('project.shell:proj-123')).toBe(false)
    expect(isSecretStateKey('selection.projectId')).toBe(false)
    expect(isSecretStateKey('region.left.width')).toBe(false)
    expect(isSecretStateKey('kanban.adaptersDir')).toBe(false)
  })
})
