import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE_THEME_ID, THEMES } from './theme'

const THEMES_DIR = 'src/renderer/src/themes'

const tokenNames = (source: string): string[] =>
  (source.match(/--[\w-]+:/g) ?? []).map((declaration) => declaration.slice(0, -1))

/** Declared value of one theme token; throws when the token is missing. */
const tokenValue = (source: string, name: string): string => {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`))
  const value = match?.[1]
  if (value === undefined) throw new Error(`Missing theme token ${name}`)
  return value.trim()
}

describe('theme registry', () => {
  it('matches the theme CSS files and the theme.css imports one to one', () => {
    // An unregistered file never loads, and a registered id without a file
    // silently runs on the default palette. The base theme maps to default.css.
    const ids = Object.keys(THEMES)
      .map((id) => (id === BASE_THEME_ID ? 'default' : id))
      .sort()
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
      // Float-only structure tokens extend that shared surface.
      expect(names.filter((name) => !name.startsWith('--float-'))).toEqual(defaultNames)
    },
  )
})

describe('motion and interaction tokens (NEKODE-9)', () => {
  const defaultSource = readFileSync(join(THEMES_DIR, 'default.css'), 'utf8')
  const indexSource = readFileSync('src/renderer/src/index.css', 'utf8')

  it('declares duration-fast, duration-base, and ease-standard in default.css', () => {
    // Values are design choices owned by default.css; index.css consumes the
    // token names, so only their declaration is a contract here.
    expect(tokenNames(defaultSource)).toEqual(
      expect.arrayContaining(['--duration-fast', '--duration-base', '--ease-standard']),
    )
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

  it('defines button micro-interaction transitions', () => {
    expect(indexSource).toMatch(
      /button\s*\{[\s\S]*transition-duration:\s*var\(--duration-fast\);[\s\S]*transition-timing-function:\s*var\(--ease-standard\);/,
    )
  })

  it('defines active button background matching active chat and brighter on hover', () => {
    // The user decision is the relation, not the palette value: the active tab
    // surface equals the button surface, and its hover equals the hover pair.
    expect(tokenValue(defaultSource, '--color-button-active')).toBe(
      tokenValue(defaultSource, '--color-button'),
    )
    expect(tokenValue(defaultSource, '--color-button-active-hover')).toBe(
      tokenValue(defaultSource, '--color-button-hover'),
    )
    expect(indexSource).toMatch(
      /\.nk-tb\.active,\s*\.nk-tb\[data-active="true"\][\s\S]*background-color:\s*var\(--color-button-active\);/,
    )
    expect(indexSource).toMatch(
      /\.nk-tb\.active:not\(:disabled\):hover[\s\S]*background-color:\s*var\(--color-button-active-hover\);/,
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
