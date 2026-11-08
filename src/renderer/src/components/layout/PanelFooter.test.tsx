import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ISSUE_REPORT_BASE_URL } from '../../lib/issue-report'
import { TEST_ID } from '../../lib/test-ids'
import { PanelFooter } from './PanelFooter'

afterEach(cleanup)

describe('PanelFooter', () => {
  it('opens the existing pre-filled GitHub bug flow from a real button', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <PanelFooter
        onOpenAppSettings={vi.fn()}
        mascotVisible={false}
        mascotError={null}
        onToggleMascot={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: 'Report a bug' })
    expect(button.getAttribute('data-testid')).toBe(TEST_ID.reportIssueLink)
    fireEvent.click(button)
    expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener,noreferrer')
    const url = new URL(String(open.mock.calls[0][0]))
    open.mockRestore()
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
    expect(version.className).toContain('hover:text-ink')
    expect(version.className).toContain('cursor-pointer')
    expect(version.className).not.toContain('hover:bg-')
    expect(version.getAttribute('aria-label')).toBe('Open app settings')
  })

  it('opens app settings from the version without adding a visible control', () => {
    const onOpenAppSettings = vi.fn()
    render(
      <PanelFooter
        onOpenAppSettings={onOpenAppSettings}
        mascotVisible={false}
        mascotError={null}
        onToggleMascot={vi.fn()}
      />,
    )
    const version = screen.getByTestId(TEST_ID.panelAppVersion)
    expect(version.textContent).toBe('v0.0.0-test')
    version.click()
    expect(onOpenAppSettings).toHaveBeenCalledWith({ scrollToUpdate: true })
  })
})

it('names the mascot toggle by its current action and declares the settings dialog', () => {
  const onToggleMascot = vi.fn()
  const props = { onOpenAppSettings: vi.fn(), mascotError: null, onToggleMascot }
  const view = render(<PanelFooter {...props} mascotVisible={true} />)
  fireEvent.click(screen.getByRole('button', { name: 'Hide mascot', pressed: true }))
  expect(onToggleMascot).toHaveBeenCalledOnce()
  view.rerender(<PanelFooter {...props} mascotVisible={false} />)
  expect(screen.getByRole('button', { name: 'Show mascot', pressed: false })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'App settings' }).getAttribute('aria-haspopup')).toBe(
    'dialog',
  )
})
