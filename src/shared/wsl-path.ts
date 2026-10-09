/** Filesystem location and Linux process cwd are deliberately separate. */
export interface WslLocation {
  distribution: string
  linuxPath: string
}

export function wslProjectPath(distribution: string, linuxPath: string): string {
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N}_. -]*$/u.test(distribution) ||
    distribution.endsWith(' ') ||
    distribution.endsWith('.')
  ) {
    throw new Error('Invalid WSL distribution name.')
  }
  const parts = linuxPath.split('/')
  if (
    !linuxPath.startsWith('/') ||
    linuxPath === '/' ||
    parts
      .slice(1)
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.includes('\\') ||
          [...part].some((character) => character.charCodeAt(0) < 32),
      )
  ) {
    throw new Error(
      'Use an absolute Linux project directory without traversal or empty components.',
    )
  }
  return `\\\\wsl.localhost\\${distribution}\\${parts.slice(1).join('\\')}`
}

export function parseWslPath(path: string): WslLocation | null {
  const normalized = path.replace(/\\/g, '/')
  if (!/^\/\/(wsl\$|wsl\.localhost)(\/|$)/i.test(normalized)) return null
  const parts = normalized.split('/')
  const distribution = parts[3] ?? ''
  const linuxPath = `/${parts.slice(4).join('/')}`
  wslProjectPath(distribution, linuxPath)
  return { distribution, linuxPath }
}
