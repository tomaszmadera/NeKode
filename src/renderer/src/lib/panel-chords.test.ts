import { describe, expect, it } from 'vitest'
import { isLeftPanelChord, isRightPanelChord } from './panel-chords'

const idle = { code: 'KeyB', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }

// [name, event patch, Ctrl+B (left) matches, Ctrl+Alt+B (right) matches]
const cases: Array<[string, Partial<Parameters<typeof isLeftPanelChord>[0]>, boolean, boolean]> = [
  ['Ctrl+KeyB', {}, true, false],
  ['Ctrl+Alt+KeyB', { altKey: true }, false, true],
  ['key b without KeyB code', { code: 'Other', key: 'b' }, true, false],
  ['key B without KeyB code', { code: 'Other', key: 'B' }, true, false],
  ['key b with Ctrl+Alt', { code: 'Other', key: 'b', altKey: true }, false, true],
  ['key B with Ctrl+Alt', { code: 'Other', key: 'B', altKey: true }, false, true],
  ['KeyB without ctrl', { ctrlKey: false }, false, false],
  ['Alt+KeyB without ctrl', { ctrlKey: false, altKey: true }, false, false],
  ['Ctrl+Shift+KeyB', { shiftKey: true }, false, false],
  ['Ctrl+Meta+KeyB', { metaKey: true }, false, false],
  ['Ctrl+Alt+Shift+KeyB', { altKey: true, shiftKey: true }, false, false],
  ['Ctrl+Alt+Meta+KeyB', { altKey: true, metaKey: true }, false, false],
  ['another key', { code: 'KeyC' }, false, false],
  ['another key with Ctrl+Alt', { code: 'KeyC', altKey: true }, false, false],
]

describe('panel chords', () => {
  it.each(cases)('%s', (_name, patch, left, right) => {
    const event = { ...idle, ...patch }
    expect(isLeftPanelChord(event)).toBe(left)
    expect(isRightPanelChord(event)).toBe(right)
  })
})
