export const THEMES = ['default', 'default-beta-1'] as const
export type ThemeId = (typeof THEMES)[number]

export const THEME_STORAGE_KEY = 'nekode.theme.v1'

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme === value)
}
