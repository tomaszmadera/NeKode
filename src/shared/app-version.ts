const NUMBERED_VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

/** True when `latest` is a higher x.y.z than `installed`. A suffix does not count. */
export function isNewerRelease(latest: string, installed: string): boolean {
  const next = numericVersion(latest)
  const current = numericVersion(installed)
  if (next === null || current === null) return false
  if (next[0] !== current[0]) return next[0] > current[0]
  if (next[1] !== current[1]) return next[1] > current[1]
  return next[2] > current[2]
}

function numericVersion(version: string): [number, number, number] | null {
  const match = NUMBERED_VERSION.exec(version.trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
