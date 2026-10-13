import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMermaidConfig } from './mermaid-config'

// The token mapping is pure data read from the theme CSS, so it is stubbed
// here instead of loaded from a stylesheet (spec Behaviour 4 and the
// Business rule that the palette comes from existing semantic tokens).
const TOKENS: Record<string, string> = {
  '--color-panel': 'rgb(21 25 41)',
  '--color-highlight': 'rgb(31 44 63)',
  '--color-accent': 'rgb(139 147 248)',
  '--color-edge': 'rgb(38 44 66)',
  '--color-ink': 'rgb(230 232 242)',
  '--color-ink-secondary': 'rgb(163 169 194)',
}

function stubComputedStyle(tokens: Record<string, string>, fontFamily: string): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => tokens[name] ?? '',
        fontFamily,
      }) as unknown as CSSStyleDeclaration,
  )
}

describe('buildMermaidConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps the semantic tokens and keeps every security key fixed', () => {
    stubComputedStyle(TOKENS, '"Recursive Sans Casual", Inter, sans-serif')

    const config = buildMermaidConfig(document.createElement('div'))
    const variables = config.themeVariables as Record<string, string>

    expect(config).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      darkMode: true,
    })
    expect(variables.background).toBe('rgb(21 25 41)')
    expect(variables.primaryColor).toBe('rgb(31 44 63)')
    expect(variables.primaryBorderColor).toBe('rgb(139 147 248)')
    expect(variables.textColor).toBe('rgb(230 232 242)')
    expect(variables.lineColor).toBe('rgb(163 169 194)')
    expect(variables.clusterBorder).toBe('rgb(38 44 66)')
    expect(variables.fontFamily).toBe('"Recursive Sans Casual", Inter, sans-serif')
  })

  it('omits unset tokens and falls back to the application font stack', () => {
    stubComputedStyle({}, '')

    const config = buildMermaidConfig(null)

    expect(Object.keys(config.themeVariables ?? {})).toEqual(['fontFamily'])
    expect((config.themeVariables as Record<string, string>).fontFamily).toContain(
      'Recursive Sans Casual',
    )
  })
})
