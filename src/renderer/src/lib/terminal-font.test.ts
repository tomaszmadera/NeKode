import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
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
    ['16junk', 15],
    ['8', 8],
    ['33', 15],
  ])('preserves valid saved sizes and rejects malformed values: %s', (saved, expected) => {
    expect(parseTerminalFontSize(saved)).toBe(expected)
  })
})
