import { describe, expect, it } from 'vitest'
import { type DiffLine, diffLines } from './line-diff'

function render(lines: DiffLine[]): string[] {
  const mark = { same: ' ', remove: '-', add: '+' } as const
  return lines.map((line) => `${mark[line.kind]}${line.text}`)
}

describe('diffLines', () => {
  it('equal texts are all unchanged lines', () => {
    expect(render(diffLines('a\nb', 'a\nb'))).toEqual([' a', ' b'])
  })

  it('a replaced middle line keeps the shared context', () => {
    expect(render(diffLines('a\nb\nc', 'a\nx\nc'))).toEqual([' a', '-b', '+x', ' c'])
  })

  it('insertions and deletions follow the longest common subsequence', () => {
    expect(render(diffLines('a\nb\nc\nd', 'a\nc\nd\ne'))).toEqual([' a', '-b', ' c', ' d', '+e'])
    expect(render(diffLines('x\na\ny\nb', 'a\nb'))).toEqual(['-x', ' a', '-y', ' b'])
  })

  it('a new file from an empty one adds every line', () => {
    expect(render(diffLines('', 'a\nb'))).toEqual(['-', '+a', '+b'])
  })

  it('a missing final newline is a visible change', () => {
    expect(render(diffLines('a', 'a\n'))).toEqual([' a', '+'])
  })

  it('a middle too large for the table is shown as removed then added', () => {
    const before = Array.from({ length: 2100 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 2100 }, (_, index) => `new ${index}`).join('\n')
    const lines = diffLines(before, after)
    expect(lines).toHaveLength(4200)
    expect(lines.slice(0, 2100).every((line) => line.kind === 'remove')).toBe(true)
    expect(lines.slice(2100).every((line) => line.kind === 'add')).toBe(true)
  })
})
