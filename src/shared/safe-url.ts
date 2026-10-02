// Single allowlist gate for untrusted URLs before shell.openExternal
// (Electron security guidance: treat link handlers and window.open as
// untrusted input). xterm web-links and any future URL surface must go
// through isSafeExternalUrl; only explicit web protocols pass.

export const ALLOWED_EXTERNAL_PROTOCOLS: readonly string[] = ['https:', 'http:']

export function isSafeExternalUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.includes(parsed.protocol)) {
    return false
  }
  // Embedded credentials are a phishing/ambiguity vector in external opens.
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return false
  }
  return true
}
