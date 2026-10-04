// Terminal font size setting (App Settings). Persisted in localStorage like
// the theme (lib/theme); applied to every xterm view (chat and bottom panel)
// at mount and live while a session is open (ChatTerminal).

export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 32
export const DEFAULT_TERMINAL_FONT_SIZE = 15
export const TERMINAL_FONT_SIZE_STORAGE_KEY = 'nekode.terminal-font-size.v1'

/** Every selectable size, ascending (the App Settings select options). */
export const TERMINAL_FONT_SIZES: readonly number[] = Array.from(
  { length: TERMINAL_FONT_SIZE_MAX - TERMINAL_FONT_SIZE_MIN + 1 },
  (_unused, index) => TERMINAL_FONT_SIZE_MIN + index,
)

export function isTerminalFontSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= TERMINAL_FONT_SIZE_MIN &&
    value <= TERMINAL_FONT_SIZE_MAX
  )
}

/** Saved-value parse: anything invalid falls back to the default (theme idiom). */
export function parseTerminalFontSize(saved: string | null): number {
  if (saved === null) {
    return DEFAULT_TERMINAL_FONT_SIZE
  }
  const parsed = Number(saved)
  return isTerminalFontSize(parsed) ? parsed : DEFAULT_TERMINAL_FONT_SIZE
}

export const DEFAULT_TERMINAL_TEXT_FONT = 'Recursive Mono Casual'
export const DEFAULT_TERMINAL_ICON_FONT = 'Symbols Nerd Font Mono'
export const TERMINAL_FONT_FAMILIES_STORAGE_KEY = 'nekode.terminal-font-families.v1'
export const TERMINAL_ICON_PREVIEW = '\ue70f \uf07b \ue0a0 \uf017'

export interface TerminalFontFamilies {
  text: string
  icons: string
}

export const DEFAULT_TERMINAL_FONT_FAMILIES: TerminalFontFamilies = {
  text: DEFAULT_TERMINAL_TEXT_FONT,
  icons: DEFAULT_TERMINAL_ICON_FONT,
}

/** A single family name, never a CSS declaration or a user-supplied stack. */
export function isTerminalFontFamily(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    /^[\p{L}\p{N} ._()+-]{1,100}$/u.test(value) &&
    /[\p{L}\p{N}]/u.test(value)
  )
}

export function parseTerminalFontFamilies(saved: string | null): TerminalFontFamilies {
  if (saved === null) return DEFAULT_TERMINAL_FONT_FAMILIES
  try {
    const value: unknown = JSON.parse(saved)
    if (
      typeof value === 'object' &&
      value !== null &&
      'text' in value &&
      'icons' in value &&
      isTerminalFontFamily(value.text) &&
      isTerminalFontFamily(value.icons)
    ) {
      return { text: value.text, icons: value.icons }
    }
  } catch {
    // Invalid stored JSON restores the declared preferences.
  }
  return DEFAULT_TERMINAL_FONT_FAMILIES
}

export function terminalFontStack(families: TerminalFontFamilies): string {
  const safe =
    isTerminalFontFamily(families.text) && isTerminalFontFamily(families.icons)
      ? families
      : DEFAULT_TERMINAL_FONT_FAMILIES
  const selected = [...new Set([safe.text, safe.icons, DEFAULT_TERMINAL_ICON_FONT])]
    .map((family) => `"${family}"`)
    .join(', ')
  return `${selected}, Consolas, "Courier New", monospace`
}

/** null means this renderer has no Font Loading API (for example jsdom). */
export function loadTerminalFonts(
  families: TerminalFontFamilies,
  size: number,
): Promise<void> | null {
  if (typeof document.fonts?.load !== 'function') return null
  return Promise.all([
    document.fonts.load(`${size}px "${families.text}"`, 'Terminal'),
    document.fonts.load(`${size}px "${families.icons}"`, TERMINAL_ICON_PREVIEW),
    document.fonts
      .load(`${size}px "${DEFAULT_TERMINAL_ICON_FONT}"`, TERMINAL_ICON_PREVIEW)
      .then((faces) => {
        if (faces.length === 0) throw new Error('Bundled symbols font is unavailable.')
      }),
  ]).then(() => undefined)
}
