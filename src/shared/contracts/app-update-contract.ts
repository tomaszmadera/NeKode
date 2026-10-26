export interface AppUpdateLatest {
  /** True only for a packaged Windows build. */
  canInstall: boolean
  /** Latest published numeric version, or null when it is unknown. */
  version: string | null
  /** Short sentence when the release check failed. Null when the check did not fail. */
  error: string | null
}
