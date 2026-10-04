// Theme registry: every theme's id, its display label in App Settings and the
// shell layout variant it drives. Token values live in the theme CSS files
// (themes/*.css); this record is the single source of truth for membership.
//
// Layout variants (App.tsx consumes the flag, the CSS files never do):
// - `attached`: panels fill the window edge to edge under the title bar strip.
// - `floating`: the title bar strip stays (without its hairline), the left
//   panel floats detached with rounded corners and the center content below
//   the tab strip sits in a rounded frame with the tabs attached to its top.
export const THEMES = {
  default: { label: 'NeKode Light', layout: 'attached' },
  'default-beta-1': { label: 'default-beta-1', layout: 'attached' },
  'nekode-float': { label: 'NeKode Float', layout: 'floating' },
} as const

export type ThemeId = keyof typeof THEMES
export type ThemeLayout = (typeof THEMES)[ThemeId]['layout']

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

export const THEME_STORAGE_KEY = 'nekode.theme.v1'

export function isThemeId(value: string | null): value is ThemeId {
  return THEME_IDS.some((theme) => theme === value)
}
