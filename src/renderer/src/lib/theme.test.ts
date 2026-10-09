import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const THEMES_DIR = 'src/renderer/src/themes'

const tokenNames = (source: string): string[] =>
  (source.match(/--[\w-]+:/g) ?? []).map((declaration) => declaration.slice(0, -1))

describe('theme palettes', () => {
  const defaultNames = tokenNames(readFileSync(join(THEMES_DIR, 'default.css'), 'utf8'))
  const overrideFiles = readdirSync(THEMES_DIR).filter(
    (file) => file.endsWith('.css') && file !== 'default.css',
  )

  it.each(overrideFiles)(
    'declares every default token in %s (names match, values may differ)',
    (file) => {
      const names = tokenNames(readFileSync(join(THEMES_DIR, file), 'utf8'))
      expect(names.length).toBeGreaterThan(0)
      // A theme override file must cover the full default token surface: a
      // missing name would silently fall back to the default palette there.
      expect(names).toEqual(defaultNames)
    },
  )
})

describe('motion and interaction tokens (NEKODE-9)', () => {
  const defaultSource = readFileSync(join(THEMES_DIR, 'default.css'), 'utf8')
  const indexSource = readFileSync('src/renderer/src/index.css', 'utf8')

  it('declares duration-fast, duration-base, and ease-standard in default.css', () => {
    expect(defaultSource).toContain('--duration-fast: 120ms;')
    expect(defaultSource).toContain('--duration-base: 160ms;')
    expect(defaultSource).toContain('--ease-standard: cubic-bezier(0.2, 0, 0, 1);')
  })

  it('defines a global prefers-reduced-motion media query suppressing transitions and animations', () => {
    expect(indexSource).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*animation-duration:\s*0\.01ms[\s\S]*transition-duration:\s*0\.01ms/,
    )
  })

  it('defines visible focus-visible indicator with theme accent', () => {
    expect(indexSource).toMatch(
      /:focus-visible\s*\{[\s\S]*outline:\s*1px solid var\(--color-info\);[\s\S]*outline-offset:\s*1px;/,
    )
  })

  it('suppresses the terminal prompt input outline so the frame is the only focus indicator', () => {
    // The shared :focus-visible rule is unlayered, so it beats Tailwind
    // outline utilities. The prompt field needs a later, more specific rule.
    const match = indexSource.match(
      /\.terminal-prompt-input:focus,\s*\.terminal-prompt-input:focus-visible\s*\{([^}]*)\}/,
    )
    expect(match).not.toBeNull()
    expect(match?.[1]).toMatch(/outline:\s*none;/)
    expect(match?.[1]).toMatch(/outline-offset:\s*0;/)
    const ruleAt = indexSource.indexOf('.terminal-prompt-input:focus')
    const sharedAt = indexSource.indexOf(':focus-visible {')
    expect(ruleAt).toBeGreaterThan(sharedAt)
  })

  it('defines button micro-interaction transitions', () => {
    expect(indexSource).toMatch(
      /button\s*\{[\s\S]*transition-duration:\s*var\(--duration-fast\);[\s\S]*transition-timing-function:\s*var\(--ease-standard\);/,
    )
  })

  it('sets NeKode Float app color to rgb(16 18 32) and tab strip background to var(--color-app)', () => {
    const floatSource = readFileSync(join(THEMES_DIR, 'nekode-float.css'), 'utf8')
    expect(floatSource).toContain('--color-app: rgb(16 18 32);')
    expect(floatSource).toContain('--color-terminal: rgb(16 18 32);')
    expect(floatSource).toMatch(
      /\[data-theme="nekode-float"\]\s*\[data-testid="tab-strip"\]\s*\{\s*background-color:\s*var\(--color-app\);\s*\}/,
    )
  })
})
