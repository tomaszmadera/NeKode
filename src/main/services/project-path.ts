import { posix } from 'node:path'

/** posix.join collapses the leading UNC separator; retain the share root. */
export function joinProjectPath(root: string, ...parts: string[]): string {
  const normalized = root.replace(/\\/g, '/')
  const joined = posix.join(normalized, ...parts)
  return normalized.startsWith('//') ? `/${joined}` : joined
}
