// Terminal font size setting (App Settings). Persisted in localStorage like
// the theme (lib/theme); applied to every xterm view (chat and bottom panel)
// at mount and live while a session is open (ChatTerminal).

export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 32
export const DEFAULT_TERMINAL_FONT_SIZE = 13
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
  const parsed = Number.parseInt(saved, 10)
  return isTerminalFontSize(parsed) ? parsed : DEFAULT_TERMINAL_FONT_SIZE
}
