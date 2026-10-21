import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from './theme'

const THEMES_DIR = 'src/renderer/src/themes'

const tokenNames = (source: string): string[] =>
  (source.match(/--[\w-]+:/g) ?? []).map((declaration) => declaration.slice(0, -1))

describe('theme registry', () => {
  it('matches the theme CSS files and the theme.css imports one to one', () => {
    // An unregistered file never loads, and a registered id without a file
    // silently runs on the default palette.
    const ids = Object.keys(THEMES).sort()
    const files = readdirSync(THEMES_DIR)
      .filter((file) => file.endsWith('.css'))
      .map((file) => file.slice(0, -'.css'.length))
      .sort()
    const imports = [
      ...readFileSync('src/renderer/src/theme.css', 'utf8').matchAll(
        /@import\s+"\.\/themes\/([\w-]+)\.css";/g,
      ),
    ]
      .map((match) => match[1])
      .sort()
    expect(files).toEqual(ids)
    expect(imports).toEqual(ids)
  })
})

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

  it('defines active button background matching active chat (232c41) and brighter on hover', () => {
    expect(defaultSource).toContain('--color-button: rgb(35 44 65);')
    expect(defaultSource).toContain('--color-button-hover: rgb(45 56 82);')
    expect(defaultSource).toContain('--color-button-active: rgb(35 44 65);')
    expect(defaultSource).toContain('--color-button-active-hover: rgb(45 56 82);')
    expect(indexSource).toMatch(
      /\.nk-tb\.active,\s*\.nk-tb\[data-active="true"\][\s\S]*background-color:\s*var\(--color-button-active\);/,
    )
    expect(indexSource).toMatch(
      /\.nk-tb\.active:not\(:disabled\):hover[\s\S]*background-color:\s*var\(--color-button-active-hover\);/,
    )
  })

  it('sets NeKode Float v2 app color to rgb(11 14 26) and tab strip background to transparent', () => {
    const floatV2Source = readFileSync(join(THEMES_DIR, 'nekode-float-v2.css'), 'utf8')
    expect(floatV2Source).toContain('--color-app: rgb(11 14 26);')
    expect(floatV2Source).toContain('--color-terminal: rgb(17 19 23);')
    expect(floatV2Source).toMatch(
      /\[data-theme="nekode-float-v2"\]\s*\.nk-tab-strip\s*\{[^}]*background-color:\s*transparent;/,
    )
  })

  it('sets NeKode Float v2 action row slot to symmetric 14px 16px padding', () => {
    const floatV2Source = readFileSync(join(THEMES_DIR, 'nekode-float-v2.css'), 'utf8')
    expect(floatV2Source).toMatch(
      /\[data-theme="nekode-float-v2"\]\s*\.nk-action-row\s*\{[^}]*padding:\s*14px\s+16px;/,
    )
  })
})

describe('theme hooks (spec themes Behaviour 6 and 7)', () => {
  const themeFiles = readdirSync(THEMES_DIR).filter((file) => file.endsWith('.css'))
  const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '')

  it.each(themeFiles)('%s targets shell elements only through semantic hooks', (file) => {
    // Test ids, utility-class combinations and DOM position break silently
    // when a component changes; theme files use nk- hooks instead.
    const selectors = withoutComments(readFileSync(join(THEMES_DIR, file), 'utf8'))
    expect(selectors).not.toMatch(/data-testid/)
    expect(selectors).not.toMatch(/:nth-of-type|:first-child|:first-of-type|:last-of-type/)
    expect(selectors).not.toMatch(/\b[a-z][a-z0-9]*\.(?:bg|text|border|rounded)-/)
    expect(selectors).not.toMatch(/\.rounded-lg\./)
  })

  it.each(themeFiles)('%s uses !important only to override an inline style', (file) => {
    // Theme files are unlayered, so they already beat Tailwind utilities and
    // @layer components rules. Only an inline style attribute needs !important.
    // Comments are dropped so prose cannot trip the check; a comment naming
    // the inline style leaves a marker on its declaration line.
    const lines = readFileSync(join(THEMES_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => (/inline/i.test(comment) ? 'INLINE_REASON' : ''))
      .split('\n')
    const unexplained = lines.filter(
      (line) => line.includes('!important') && !line.includes('INLINE_REASON'),
    )
    expect(unexplained).toEqual([])
  })
})
