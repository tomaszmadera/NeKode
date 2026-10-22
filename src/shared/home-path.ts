// Display-only `~` for paths under the user's home directory (status bar and
// Project Files header). Copy, hover, and every path operation keep the full
// path; only the visible text changes.

/** An unknown platform means Windows, the app's primary platform (AppApi.platform). */
function isWindows(platform: string | undefined): boolean {
  return platform === undefined || platform === 'win32'
}

/** The user's home directory: USERPROFILE on Windows, HOME elsewhere. */
export function homeDirFromEnv(
  platform: string | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  const value = (isWindows(platform) ? env.USERPROFILE : env.HOME)?.trim()
  return value ? value : undefined
}

/**
 * `path` with a leading home directory replaced by `~`, matching whole path
 * segments only. Windows compares case-insensitively and treats `\` and `/`
 * alike; the rest of the path keeps its own separators. A missing home, a
 * filesystem-root home, or a path outside home returns `path` unchanged.
 */
export function shortenHomePath(
  path: string,
  homeDir: string | undefined,
  platform: string | undefined,
): string {
  if (homeDir === undefined) {
    return path
  }
  const windows = isWindows(platform)
  const separators = windows ? /[\\/]/ : /\//
  const home = homeDir.replace(windows ? /[\\/]+$/ : /\/+$/, '')
  // Root-like homes ("/", "C:\") would turn every absolute path into `~`.
  if (home.length === 0 || (windows && /^[A-Za-z]:$/.test(home))) {
    return path
  }
  const normalize = (value: string): string =>
    windows ? value.replace(/\\/g, '/').toLowerCase() : value
  if (normalize(path.slice(0, home.length)) !== normalize(home)) {
    return path
  }
  const rest = path.slice(home.length)
  if (rest.length === 0) {
    return '~'
  }
  return separators.test(rest[0]) ? `~${rest}` : path
}
