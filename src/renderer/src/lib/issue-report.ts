// GitHub issue report link (NEKODE-105). The body is pre-filled with the
// app version and platform so reports carry the facts needed to diagnose them.

export const ISSUE_REPORT_BASE_URL = 'https://github.com/tomaszmadera/NeKode/issues/new'

/** The platform segment of a user agent, e.g. "Windows NT 10.0; Win64; x64". */
export function platformFromUserAgent(userAgent: string): string {
  const match = /\(([^)]+)\)/.exec(userAgent)
  return match?.[1]?.trim() || 'unknown'
}

export function buildIssueReportUrl(version: string, platform: string): string {
  const body = [
    '<!-- Describe the problem and the steps to reproduce it. -->',
    '',
    '',
    '---',
    `NeKode version: ${version}`,
    `Platform: ${platform}`,
  ].join('\n')
  return `${ISSUE_REPORT_BASE_URL}?${new URLSearchParams({ body }).toString()}`
}
