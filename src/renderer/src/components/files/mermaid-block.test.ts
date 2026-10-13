import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { isMermaidLanguage, mermaidSourceFromPre } from './mermaid-block'

describe('isMermaidLanguage', () => {
  it('accepts the mermaid language token in any case, beside other classes', () => {
    expect(isMermaidLanguage('language-mermaid')).toBe(true)
    expect(isMermaidLanguage('language-Mermaid')).toBe(true)
    expect(isMermaidLanguage('language-mermaid extra')).toBe(true)
    expect(isMermaidLanguage('extra language-mermaid')).toBe(true)
  })

  it('rejects another language, a bare token, and the empty class', () => {
    expect(isMermaidLanguage(undefined)).toBe(false)
    expect(isMermaidLanguage('')).toBe(false)
    expect(isMermaidLanguage('language-ts')).toBe(false)
    expect(isMermaidLanguage('language-mermaidjs')).toBe(false)
    expect(isMermaidLanguage('mermaid')).toBe(false)
  })
})

describe('mermaidSourceFromPre', () => {
  // Mirrors the rendered tree the preview hands over: a `pre` node whose
  // children are the fenced code element.
  const preChildren = (className: string | undefined, text: string): React.ReactNode =>
    createElement(
      'pre',
      null,
      createElement('code', className === undefined ? null : { className }, text),
    ).props.children

  it('returns the fence text of a mermaid block, newlines included', () => {
    const source = 'flowchart LR\n  A --> B\n'
    expect(mermaidSourceFromPre(preChildren('language-mermaid', source))).toBe(source)
  })

  it('returns null for a whitespace-only block', () => {
    expect(mermaidSourceFromPre(preChildren('language-mermaid', '   \n '))).toBeNull()
  })

  it('returns null for another language and for a node without a code child', () => {
    expect(mermaidSourceFromPre(preChildren('language-ts', 'const x = 1'))).toBeNull()
    expect(mermaidSourceFromPre('plain text')).toBeNull()
    expect(mermaidSourceFromPre(null)).toBeNull()
    expect(
      mermaidSourceFromPre([
        createElement('code', { key: 'a' }, 'a'),
        createElement('code', { key: 'b' }, 'b'),
      ]),
    ).toBeNull()
  })
})
