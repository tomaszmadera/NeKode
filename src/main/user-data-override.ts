import { resolve } from 'node:path'

/**
 * Resolves the userData path override from the provided environment variable or string.
 * Strips wrapping quotes, trims whitespace, and ensures relative paths are resolved to absolute paths.
 * Returns null if the value is empty, whitespace-only, or undefined.
 */
export function resolveUserDataPath(rawPath: string | undefined): string | null {
  if (rawPath === undefined) {
    return null
  }
  const stripped = rawPath
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  if (stripped.length === 0) {
    return null
  }
  return resolve(stripped)
}

/**
 * Applies the userData path override before the app is ready.
 * Ensures the target path is absolute to prevent Electron's
 * 'Path must be absolute' unhandled exception.
 */
export function applyUserDataOverride(
  rawPath: string | undefined,
  setPath: (name: string, path: string) => void,
): string | null {
  const resolved = resolveUserDataPath(rawPath)
  if (resolved !== null) {
    setPath('userData', resolved)
  }
  return resolved
}
