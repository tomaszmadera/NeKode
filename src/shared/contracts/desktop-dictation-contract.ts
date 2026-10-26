export interface DesktopDictationSettings {
  enabled: boolean
  confirmed: boolean
}

export interface DesktopDictationSetup {
  settings: DesktopDictationSettings
  supported: boolean
}

export function isDesktopDictationSettings(value: unknown): value is DesktopDictationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  return (
    Object.keys(settings).length === 2 &&
    typeof settings.enabled === 'boolean' &&
    typeof settings.confirmed === 'boolean' &&
    (settings.enabled || !settings.confirmed)
  )
}
