import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ISSUE_REPORT_BASE_URL } from '../../lib/issue-report'
import { TEST_ID } from '../../lib/test-ids'
import { PanelFooter } from './PanelFooter'

afterEach(cleanup)

describe('PanelFooter', () => {
  it('links to a pre-filled GitHub issue that opens outside the app', () => {
    render(
      <PanelFooter
        onOpenAppSettings={vi.fn()}
        mascotVisible={false}
        mascotError={null}
        onToggleMascot={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: 'Report an issue on GitHub' })
    expect(link.getAttribute('data-testid')).toBe(TEST_ID.reportIssueLink)
    expect(link.getAttribute('target')).toBe('_blank')
    const url = new URL(link.getAttribute('href') ?? '')
    expect(`${url.origin}${url.pathname}`).toBe(ISSUE_REPORT_BASE_URL)
    expect(url.searchParams.get('body')).toContain('NeKode version: 0.0.0-test')
  })

  it('renders the current application version on the right', () => {
    render(
      <PanelFooter
        onOpenAppSettings={vi.fn()}
        mascotVisible={false}
        mascotError={null}
        onToggleMascot={vi.fn()}
      />,
    )
    const version = screen.getByTestId(TEST_ID.panelAppVersion)
    expect(version.textContent).toBe('v0.0.0-test')
    expect(version.getAttribute('title')).toBe('NeKode v0.0.0-test')
  })
})
