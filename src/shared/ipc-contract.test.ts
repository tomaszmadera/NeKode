import { describe, expect, it } from 'vitest'
import {
  AGENT_PROMPT_PLACEHOLDER,
  agentProfileFieldError,
  isSecretStateKey,
  isTaskProgressStateKey,
  projectTaskProgressAdapterKey,
  projectTaskProgressConfigKey,
  relativeToProject,
} from './ipc-contract'

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

describe('task progress state keys', () => {
  it('uses the spec keys and marks them as channel-only', () => {
    expect(projectTaskProgressAdapterKey('p1')).toBe('project.taskProgressAdapter:p1')
    expect(projectTaskProgressConfigKey('p1')).toBe('project.taskProgressConfig:p1')
    expect(isTaskProgressStateKey(projectTaskProgressAdapterKey('p1'))).toBe(true)
    expect(isTaskProgressStateKey(projectTaskProgressConfigKey('p1'))).toBe(true)
    expect(isTaskProgressStateKey('project.kanbanAdapter:p1')).toBe(false)
  })
})

describe('agentProfileFieldError', () => {
  it('accepts a profile with valid fields and exactly one placeholder argv element', () => {
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: ['--flag', AGENT_PROMPT_PLACEHOLDER, 'value'],
      }),
    ).toBeNull()
  })

  it('rejects missing or blank names and executables', () => {
    expect(
      agentProfileFieldError({
        name: '   ',
        executable: 'agent-cli',
        args: [AGENT_PROMPT_PLACEHOLDER],
      }),
    ).toBe('Name is required.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: '   ',
        args: [AGENT_PROMPT_PLACEHOLDER],
      }),
    ).toBe('Executable is required.')
  })

  it('rejects invalid args arrays', () => {
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: null as unknown as readonly string[],
      }),
    ).toBe('Arguments must be a list of strings.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: [AGENT_PROMPT_PLACEHOLDER, 123 as unknown as string],
      }),
    ).toBe('Arguments must be a list of strings.')
  })

  it('rejects args with missing or multiple exact placeholders', () => {
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: ['--flag'],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: [AGENT_PROMPT_PLACEHOLDER, AGENT_PROMPT_PLACEHOLDER],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
  })

  it('rejects args containing the placeholder as a substring alone or mixed with exact placeholder', () => {
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: ['pre{prompt}'],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: ['{prompt}post'],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: [AGENT_PROMPT_PLACEHOLDER, 'pre{prompt}'],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: ['pre{prompt}', AGENT_PROMPT_PLACEHOLDER],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
    expect(
      agentProfileFieldError({
        name: 'Agent',
        executable: 'agent-cli',
        args: [AGENT_PROMPT_PLACEHOLDER, '{prompt}post'],
      }),
    ).toBe('Arguments must include {prompt} exactly once.')
  })
})
