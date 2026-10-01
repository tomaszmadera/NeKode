/**
 * Read a CSS custom property from the document root — the mount point of the
 * active theme (`[data-theme]`) in src/renderer/src/themes/. xterm.js paints
 * onto a canvas and cannot consume CSS variables, so terminal-facing colors
 * (ChatTerminal) must be resolved to concrete values at mount time.
 */
export function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}
