import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  isTerminalFontSize,
  parseTerminalFontFamilies,
  parseTerminalFontSize,
  terminalFontStack,
} from './terminal-font'

describe('terminal font preferences', () => {
  it.each([
    '',
    'null',
    '{}',
    '{"text":"Bad, serif","icons":"Symbols"}',
    '{"text":"Good","icons":""}',
    '{"text":"x; color:red","icons":"Good"}',
  ])('restores defaults for invalid stored preferences: %s', (saved) => {
    expect(parseTerminalFontFamilies(saved)).toEqual(DEFAULT_TERMINAL_FONT_FAMILIES)
  })
  it('restores custom families and builds a quoted stack with bundled/system fallbacks', () => {
    const families = parseTerminalFontFamilies('{"text":"Cascadia Mono","icons":"Custom Symbols"}')
    expect(families).toEqual({ text: 'Cascadia Mono', icons: 'Custom Symbols' })
    expect(terminalFontStack(families)).toBe(
      '"Cascadia Mono", "Custom Symbols", "Symbols Nerd Font Mono", Consolas, "Courier New", monospace',
    )
  })
  it.each([
    ['16', 16],
    ['16junk', DEFAULT_TERMINAL_FONT_SIZE],
    ['7', DEFAULT_TERMINAL_FONT_SIZE], // below min (8)
    ['8', 8], // exact min
    ['32', 32], // exact max
    ['33', DEFAULT_TERMINAL_FONT_SIZE], // above max (32)
    ['0', DEFAULT_TERMINAL_FONT_SIZE],
    ['-5', DEFAULT_TERMINAL_FONT_SIZE],
    ['15.5', DEFAULT_TERMINAL_FONT_SIZE],
  ])(
    'preserves valid saved sizes and rejects malformed or clamped boundary values: %s',
    (saved, expected) => {
      expect(parseTerminalFontSize(saved)).toBe(expected)
    },
  )
  it('rejects a non-number size in isTerminalFontSize', () => {
    // Boundary integers are pinned through the parseTerminalFontSize table above.
    expect(isTerminalFontSize('16')).toBe(false)
  })
})
