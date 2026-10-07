import { describe, expect, it } from 'vitest'
import { isMarkdownPath } from './markdown-path'

describe('isMarkdownPath', () => {
  it('accepts md and markdown extensions, including case', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.markdown')).toBe(true)
    expect(isMarkdownPath('notes/CHANGELOG.MD')).toBe(true)
  })

  it('rejects other extensions and a leading-dot name', () => {
    expect(isMarkdownPath('src/app.ts')).toBe(false)
    expect(isMarkdownPath('notes.txt')).toBe(false)
    expect(isMarkdownPath('.md')).toBe(false)
    expect(isMarkdownPath('file.md.bak')).toBe(false)
  })
})
