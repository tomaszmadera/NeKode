/**
 * Test-only helpers for host-dependent fixture paths.
 *
 * Main-process validation uses the host's `path.isAbsolute`, so a drive path
 * such as `D:/code/demo` is absolute on Windows but relative on Linux. Tests
 * keep their Windows literals and wrap them in `hostPath`: on win32 the literal
 * is returned unchanged (Windows coverage stays byte-identical), elsewhere it
 * maps to an equivalent POSIX absolute path (`D:\a\b` and `D:/a/b` -> `/d/a/b`).
 */

export const isWindowsHost = process.platform === 'win32'

export function hostPath(windowsPath: string): string {
  if (isWindowsHost) return windowsPath
  const match = /^([A-Za-z]):(?:[\\/](.*))?$/s.exec(windowsPath)
  if (match === null) {
    throw new Error(
      `hostPath expects a drive-rooted Windows path, got ${JSON.stringify(windowsPath)}`,
    )
  }
  const rest = (match[2] ?? '').replace(/\\/g, '/')
  return `/${match[1].toLowerCase()}${rest.length > 0 ? `/${rest}` : ''}`
}
