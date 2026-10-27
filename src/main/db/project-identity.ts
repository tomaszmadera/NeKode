import { posix, win32 } from 'node:path'
import { parseWslPath, wslProjectPath } from '@shared/wsl-path'

// String identity only. No symlink or filesystem lookup: WSL Linux case must
// survive even when the host platform is win32.

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

function normalizedLocalPath(projectPath: string, platform: NodeJS.Platform): string {
  const api = pathApi(platform)
  const normalized = api.normalize(projectPath)
  const root = api.parse(normalized).root
  if (root.length > 0 && normalized === root) return normalized
  return normalized.replace(platform === 'win32' ? /[\\/]+$/u : /\/+$/u, '')
}

export function projectPathIdentity(projectPath: string, platform: NodeJS.Platform): string {
  const wsl = parseWslPath(projectPath)
  if (wsl !== null) return wslProjectPath(wsl.distribution, wsl.linuxPath)
  const normalized = normalizedLocalPath(projectPath, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function projectDirectoryName(projectPath: string, platform: NodeJS.Platform): string {
  return pathApi(platform).basename(projectPath)
}
