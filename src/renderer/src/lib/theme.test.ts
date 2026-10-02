import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('theme palettes', () => {
  it('declares every default token in default-beta-1 (names match, values may differ)', () => {
    const defaultTheme = readFileSync('src/renderer/src/themes/default.css', 'utf8')
    const betaTheme = readFileSync('src/renderer/src/themes/default-beta-1.css', 'utf8')
    const names = (source: string): string[] =>
      (source.match(/--[\w-]+:/g) ?? []).map((declaration) => declaration.slice(0, -1))
    const defaultNames = names(defaultTheme)
    expect(defaultNames.length).toBeGreaterThan(0)
    // A theme override file must cover the full default token surface: a
    // missing name would silently fall back to the default palette there.
    expect(names(betaTheme)).toEqual(defaultNames)
  })
})
