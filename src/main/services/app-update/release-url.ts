import { AppError } from '../../../shared/ipc-error'

export const UPDATE_OWNER = 'tomaszmadera'
export const UPDATE_REPO = 'NeKode'

const NUMBERED_TAG = /^\d+\.\d+\.\d+$/
const ASSET_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
])

export function installerName(tag: string): string {
  return `NeKode-Setup-${tag}.exe`
}

export function releaseApiUrl(): string {
  return `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
}

export function releaseDownloadUrl(tag: string, fileName: string): string {
  return `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`
}

/** Accept only the GitHub API or this repository's release files, including asset redirects. */
export function isAllowedReleaseUrl(url: URL, kind: 'api' | 'download'): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false
  if (kind === 'api') {
    return (
      url.host === 'api.github.com' &&
      url.pathname === `/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
    )
  }
  if (url.host === 'github.com') {
    return url.pathname.startsWith(`/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/`)
  }
  return ASSET_HOSTS.has(url.host)
}

export function parseLatestTag(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new AppError('validation', 'The latest release is not a numbered version.')
  }
  const record = body as { tag_name?: unknown; draft?: unknown; prerelease?: unknown }
  if (record.draft === true || record.prerelease === true) {
    throw new AppError('validation', 'The latest release is not a published version.')
  }
  if (typeof record.tag_name !== 'string' || !NUMBERED_TAG.test(record.tag_name)) {
    throw new AppError('validation', 'The latest release is not a numbered version.')
  }
  return record.tag_name
}

/** sha256sum lines: 64 hex digits, then a space or an asterisk, then the file name. */
export function checksumFor(sums: string, fileName: string): string {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) ([ *])(.+)$/.exec(line.trim())
    if (match === null) continue
    const name = match[3].trim()
    if (name === fileName) return match[1].toLowerCase()
  }
  throw new AppError('validation', 'The checksum file has no line for the installer.')
}
