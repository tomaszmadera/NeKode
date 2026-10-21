import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageSnapshot } from '../../../../shared/usage-contract'
import { createAppApiStub } from '../../test/app-api-stub'
import { UsageToolbar } from './UsageToolbar'

afterEach(cleanup)
const snapshot = (): UsageSnapshot => ({
  connections: [
    {
      connection: {
        id: 'account',
        label: 'Fixture account',
        providerId: 'test',
        adapterId: 'usage-file',
        enabled: true,
      },
      subscription: {
        id: 'account',
        providerId: 'test',
        label: 'Fixture account',
        sourceKind: 'file',
        status: 'available',
        metrics: [
          {
            id: 'week',
            label: '7d',
            kind: 'window',
            state: 'available',
            usedPercent: 47,
            observedAt: null,
          },
        ],
      },
      error: null,
      refreshing: false,
    },
  ],
  pin: null,
  cacheError: null,
  exportError: null,
})
describe('Usage panel', () => {
  it('moves focus into the panel while the first source read is pending', async () => {
    const api = createAppApiStub().usage
    const pending = snapshot()
    pending.connections[0].refreshing = true
    pending.connections[0].subscription = null
    vi.mocked(api.read).mockResolvedValue(pending)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    const trigger = screen.getByRole('button', { name: 'Usage quota' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close usage panel' }))
  })
  it('accepts the first snapshot under StrictMode without waiting for the polling interval', async () => {
    const api = createAppApiStub().usage
    let resolveRead: (value: UsageSnapshot) => void = () => {
      throw new Error('Usage read did not start')
    }
    vi.mocked(api.read).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    render(
      <StrictMode>
        <UsageToolbar api={api} onConfigure={() => {}} />
      </StrictMode>,
    )
    await act(async () => {
      resolveRead(snapshot())
    })
    expect(api.read).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(
      screen.getByRole('button', { name: /Fixture account, 7d, 47%, Age unknown/ }),
    ).toBeDefined()
  })
  it('opens an accessible empty state, contains focus, closes with Escape and restores trigger focus', async () => {
    const api = createAppApiStub().usage,
      configure = vi.fn()
    render(<UsageToolbar api={api} onConfigure={configure} />)
    const trigger = screen.getByRole('button', { name: 'Usage quota' })
    trigger.focus()
    fireEvent.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'Usage' })
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: 'Refresh usage' }),
      ),
    )
    const buttons = within(panel).getAllByRole('button')
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Configure usage' }),
    )
    expect(configure).toHaveBeenCalledOnce()
  })
  it('pins the explicit row globally and preserves row focus during refresh failures', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.getSettings).mockResolvedValue({
      connections: [],
      pin: null,
      export: { enabled: false, path: null },
    })
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const row = await screen.findByRole('button', { name: /Fixture account, 7d, 47%, Age unknown/ })
    row.focus()
    fireEvent.click(row)
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ pin: { connectionId: 'account', metricId: 'week' } }),
      ),
    )
    const failed = {
      ...s,
      connections: [
        { ...s.connections[0], error: { code: 'io' as const, message: 'Cannot read usage file' } },
      ],
    }
    vi.mocked(api.refresh).mockResolvedValue(failed)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    expect(screen.getByRole('button', { name: /Fixture account, 7d, 47%, Error/ })).toBe(row)
    expect(document.activeElement).toBe(row)
    expect(screen.getByText(/Cannot read usage file/)).toBeDefined()
  })
  it('separates a source error that already ends with a period by one period', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    s.connections[0].error = {
      code: 'config',
      message: 'Usage source config. Check the connection and retry.',
    }
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const note = await waitFor(() => {
      const element = document.querySelector('.usage-source-note')
      if (!element) throw new Error('Usage source note is missing')
      return element
    })
    expect(note.textContent).toBe(
      'usage-file: Usage source config. Check the connection and retry. 7d: Age unknown',
    )
  })
  it('closes on an outside pointer click', () => {
    render(<UsageToolbar api={createAppApiStub().usage} onConfigure={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const backdrop = document.querySelector('.usage-backdrop')
    if (!backdrop) throw new Error('Usage backdrop is missing')
    fireEvent.mouseDown(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
