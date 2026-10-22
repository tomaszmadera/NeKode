import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from '../../../shared/safe-url'
import { buildIssueReportUrl, ISSUE_REPORT_BASE_URL, platformFromUserAgent } from './issue-report'

describe('platformFromUserAgent', () => {
  it('returns the parenthesized platform segment', () => {
    expect(
      platformFromUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      ),
    ).toBe('Windows NT 10.0; Win64; x64')
  })

  it('falls back to unknown when the user agent has no platform segment', () => {
    expect(platformFromUserAgent('custom-agent')).toBe('unknown')
  })
})

describe('buildIssueReportUrl', () => {
  it('opens a new GitHub issue pre-filled with version and platform', () => {
    const url = new URL(buildIssueReportUrl('1.2.3', 'X11; Linux x86_64'))
    expect(`${url.origin}${url.pathname}`).toBe(ISSUE_REPORT_BASE_URL)
    const body = url.searchParams.get('body') ?? ''
    expect(body).toContain('NeKode version: 1.2.3')
    expect(body).toContain('Platform: X11; Linux x86_64')
  })

  it('passes the external URL allowlist', () => {
    expect(isSafeExternalUrl(buildIssueReportUrl('1.2.3', 'unknown'))).toBe(true)
  })
})
