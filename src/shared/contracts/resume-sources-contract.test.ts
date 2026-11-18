import { describe, expect, it } from 'vitest'
import { formatResumePrompt } from './resume-sources-contract'

describe('formatResumePrompt', () => {
  it('writes the path with project separators', () => {
    expect(formatResumePrompt('Resume task {taskPath}', 'work\\T-1\\progress.md')).toBe(
      'Resume task work/T-1/progress.md',
    )
  })

  it('keeps a path that already uses project separators', () => {
    expect(formatResumePrompt('Resume task {taskPath}', 'work/T-1/progress.md')).toBe(
      'Resume task work/T-1/progress.md',
    )
  })

  it('replaces both placeholders and leaves other text untouched', () => {
    expect(
      formatResumePrompt('A {taskPath}\nB {handoffPath} $& {other}', 'work\\T-1\\progress.md'),
    ).toBe('A work/T-1/progress.md\nB work/T-1/progress.md $& {other}')
  })
})
