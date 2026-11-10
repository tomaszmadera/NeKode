import { posix, win32 } from 'node:path'
import { projectWslLocation } from '@shared/project-environment'
import { sshProjectPathIdentity } from '@shared/ssh-target'
import { wslProjectPath } from '@shared/wsl-path'

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
  // SSH locations must be checked before the local branch: a local path
  // normalizer would rewrite the URL instead of canonicalizing it (lowercase
  // host, omitted port 22, preserved user and remote path).
  const ssh = sshProjectPathIdentity(projectPath)
  if (ssh !== null) return ssh
  const wsl = projectWslLocation(projectPath)
  if (wsl !== null) return wslProjectPath(wsl.distribution, wsl.linuxPath)
  const normalized = normalizedLocalPath(projectPath, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function projectDirectoryName(projectPath: string, platform: NodeJS.Platform): string {
  return pathApi(platform).basename(projectPath)
}
