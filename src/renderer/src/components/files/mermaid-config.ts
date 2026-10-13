import type { MermaidConfig } from 'mermaid'

// Mermaid configuration for every diagram render (spec Behaviour 4 and 5, and
// the Business rules). The colour roles are read from the semantic theme
// tokens at render time, so a theme switch applies to the next diagram and no
// stale palette is kept.
//
// The security keys are part of the contract and no caller may loosen them:
// `strict` keeps HTML in diagram text encoded and binds no click handler, and
// `sandbox` is impossible here because it renders in an iframe while the
// renderer CSP sets `frame-src 'none'`. `suppressErrorRendering` keeps
// Mermaid's own error diagram out of the DOM; the preview shows its own
// message instead.

const FALLBACK_FONT_FAMILY =
  '"Recursive Sans Casual", Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'

/** Theme variable to semantic token. Both shipped themes define every token. */
const TOKEN_COLORS: readonly (readonly [string, string])[] = [
  ['background', '--color-panel'],
  ['primaryColor', '--color-highlight'],
  ['mainBkg', '--color-highlight'],
  ['secondaryColor', '--color-highlight'],
  ['tertiaryColor', '--color-panel'],
  ['primaryTextColor', '--color-ink'],
  ['textColor', '--color-ink'],
  ['nodeTextColor', '--color-ink'],
  ['primaryBorderColor', '--color-accent'],
  ['nodeBorder', '--color-accent'],
  ['lineColor', '--color-ink-secondary'],
  ['clusterBkg', '--color-panel'],
  ['clusterBorder', '--color-edge'],
  ['edgeLabelBackground', '--color-panel'],
  ['labelTextColor', '--color-ink-secondary'],
  ['actorBkg', '--color-highlight'],
  ['actorBorder', '--color-edge'],
  ['actorTextColor', '--color-ink'],
  ['signalColor', '--color-ink-secondary'],
  ['signalTextColor', '--color-ink-secondary'],
  ['noteBkgColor', '--color-highlight'],
  ['noteBorderColor', '--color-edge'],
  ['noteTextColor', '--color-ink'],
]

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function fontFamilyOf(element: Element | null): string {
  if (element === null) {
    return FALLBACK_FONT_FAMILY
  }
  const family = getComputedStyle(element).fontFamily.trim()
  return family === '' ? FALLBACK_FONT_FAMILY : family
}

export function buildMermaidConfig(fontSource: Element | null): MermaidConfig {
  const themeVariables = {} as NonNullable<MermaidConfig['themeVariables']>
  const writable = themeVariables as Record<string, string>
  for (const [key, token] of TOKEN_COLORS) {
    const value = readToken(token)
    if (value !== '') {
      writable[key] = value
    }
  }
  writable.fontFamily = fontFamilyOf(fontSource)

  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    darkMode: true,
    themeVariables,
  }
}
