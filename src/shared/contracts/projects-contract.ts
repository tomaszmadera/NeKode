export interface ProjectInfo {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}

function toPosixSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Project-root-relative '/'-separated form of an absolute path, or null when
 * the path lies outside the root (the absolute form stays the fallback).
 * Segment-boundary prefix match: a sibling directory sharing only the root's
 * string prefix never resolves. The root itself resolves to ''. The match is
 * case-sensitive: on a case-insensitive volume a casing mismatch degrades to
 * the absolute form (correct, just not the shorter display).
 */
export function relativeToProject(projectRoot: string, absolutePath: string): string | null {
  const root = toPosixSlashes(projectRoot).replace(/\/+$/, '')
  const target = toPosixSlashes(absolutePath)
  if (target === root) {
    return ''
  }
  const prefix = `${root}/`
  if (!target.startsWith(prefix)) {
    return null
  }
  return target.slice(prefix.length)
}
