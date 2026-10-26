import type { UsageSnapshot } from '@shared/usage-contract'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { UsageToolbar } from './UsageToolbar'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const snapshot = (): UsageSnapshot => ({
  connections: [
    {
      connection: {
        id: 'account',
        label: 'Fixture account',
        providerId: 'test',
        adapterId: 'source',
        enabled: true,
      },
      subscription: {
        id: 'account',
        providerId: 'test',
        label: 'Fixture account',
        sourceKind: 'api',
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
      nextRefreshAt: null,
    },
  ],
  pin: null,
  cacheError: null,
  exportError: null,
})
describe('Usage panel', () => {
  it.each(['interval', 'backoff'] as const)(
    'explains %s skips and keeps feedback across polling and repeated clicks',
    async (reason) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
      const api = createAppApiStub().usage,
        s = snapshot()
      const until = new Date(Date.now() + 42_000).toISOString()
      s.connections[0].nextRefreshAt = until
      vi.mocked(api.read).mockResolvedValue(s)
      vi.mocked(api.refresh).mockResolvedValue({
        ...s,
        refresh: {
          read: [],
          skipped: [{ connectionId: 'account', until, reason }],
        },
      })
      render(<UsageToolbar api={api} onConfigure={() => {}} />)
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
      const button = screen.getByRole('button', { name: 'Refresh usage' })
      expect(button.getAttribute('aria-description')).toContain('42 s')
      await act(async () => {
        fireEvent.click(button)
      })
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('Fixture account can refresh again in 42 s')
      expect(status.textContent).toContain(reason === 'backoff' ? 'backoff' : '60-second limit')
      expect(status.textContent).toContain(
        `Fixture account was skipped (${reason === 'backoff' ? 'provider backoff' : '60-second limit'}).`,
      )
      expect(button.hasAttribute('disabled')).toBe(false)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(status.textContent).toContain('37 s')
      expect(button.getAttribute('title')).toContain('37 s')
      await act(async () => {
        fireEvent.click(button)
      })
      expect(api.refresh).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('status').textContent).toContain('37 s')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(37_000)
      })
      expect(button.getAttribute('aria-description')).toContain('ready to refresh')
      expect(screen.getByRole('status').textContent).not.toContain('in 0 s')
      expect(screen.getByRole('status').textContent).toContain(
        'Fixture account is ready to refresh.',
      )
      expect(screen.getByRole('status').textContent).not.toContain('ready to refresh (')
    },
  )
  it('uses the current automatic read deadline instead of the last skipped request deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    const api = createAppApiStub().usage,
      s = snapshot()
    const until = new Date(Date.now() + 42_000).toISOString()
    s.connections[0].nextRefreshAt = until
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({
      ...s,
      refresh: { read: [], skipped: [{ connectionId: 'account', until, reason: 'interval' }] },
    })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    const current = structuredClone(s)
    current.connections[0].nextRefreshAt = new Date(Date.now() + 65_000).toISOString()
    vi.mocked(api.read).mockResolvedValue(current)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(42_000)
    })
    const button = screen.getByRole('button', { name: 'Refresh usage' })
    expect(button.getAttribute('aria-description')).toContain('can refresh again in 23 s')
    expect(screen.getByRole('status').textContent).toContain('can refresh again in 23 s')
    expect(screen.getByRole('status').textContent).not.toContain('ready to refresh')
    expect(api.refresh).toHaveBeenCalledTimes(1)
  })
  it('reports an automatic read in progress instead of readiness from a previous skipped click', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    const until = new Date(Date.now() - 1000).toISOString()
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({
      ...s,
      connections: [{ ...s.connections[0], refreshing: true }],
      refresh: { read: [], skipped: [{ connectionId: 'account', until, reason: 'interval' }] },
    })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    expect(screen.getByRole('status').textContent).toContain('Fixture account is refreshing.')
    expect(screen.getByRole('status').textContent).not.toContain('ready to refresh')
    expect(
      screen.getByRole('button', { name: 'Refresh usage' }).getAttribute('aria-description'),
    ).toBe('Fixture account is refreshing.')
  })
  it('keeps pending feedback through polling then reports an unchanged successful read', async () => {
    vi.useFakeTimers()
    const api = createAppApiStub().usage,
      s = snapshot()
    vi.mocked(api.read).mockResolvedValue(s)
    let finish: (s: UsageSnapshot) => void = () => {}
    vi.mocked(api.refresh).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const button = screen.getByRole('button', { name: 'Refresh usage' })
    fireEvent.click(button)
    expect(screen.getByRole('status').textContent).toBe('Refreshing usage...')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('status').textContent).toBe('Refreshing usage...')
    expect(button.hasAttribute('disabled')).toBe(true)
    await act(async () => {
      finish({ ...s, refresh: { read: ['account'], skipped: [] } })
    })
    expect(screen.getByRole('status').textContent).toBe('Usage refreshed.')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Fixture account, 7d, 47%/ })).toBeDefined()
  })
  it('reports mixed read and skipped outcomes without claiming that cached data is current', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    const until = new Date(Date.now() + 120_000).toISOString()
    s.connections.push({
      ...s.connections[0],
      connection: { ...s.connections[0].connection, id: 'other', label: 'Other' },
      nextRefreshAt: until,
    })
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({
      ...s,
      refresh: {
        read: ['account'],
        skipped: [
          {
            connectionId: 'other',
            until,
            reason: 'backoff',
          },
        ],
      },
    })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    expect(screen.getByRole('status').textContent).toContain('Usage refreshed.')
    expect(screen.getByRole('status').textContent).toContain('Other can refresh again in')
    expect(screen.getByRole('status').textContent).toContain('backoff')
    expect(screen.getByRole('status').textContent).not.toContain('Up to date')
  })
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
  it('shows a rejected manual request and allows retry, including the empty state', async () => {
    const api = createAppApiStub().usage
    vi.mocked(api.refresh).mockRejectedValueOnce(new Error('Fixture refresh failed'))
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const button = screen.getByRole('button', { name: 'Refresh usage' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByRole('alert').textContent).toContain('Fixture refresh failed')
    expect(button.hasAttribute('disabled')).toBe(false)
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByRole('status').textContent).toBe('No usage accounts enabled.')
    expect(screen.queryByRole('alert')).toBeNull()
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
  it('pins the explicit row globally, closes the panel, and preserves row focus during refresh failures', async () => {
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
    const trigger = screen.getByRole('button', { name: 'Usage quota' })
    fireEvent.click(trigger)
    const row = await screen.findByRole('button', { name: /Fixture account, 7d, 47%, Age unknown/ })
    row.focus()
    fireEvent.click(row)
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ pin: { connectionId: 'account', metricId: 'week' } }),
      ),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    const failed: UsageSnapshot = {
      ...s,
      pin: { connectionId: 'account', metricId: 'week' },
      refresh: { read: ['account'], skipped: [] },
      connections: [
        { ...s.connections[0], error: { code: 'io' as const, message: 'Cannot read usage file' } },
      ],
    }
    vi.mocked(api.read).mockResolvedValue(failed)
    vi.mocked(api.refresh).mockResolvedValue(failed)
    fireEvent.click(trigger)
    const refreshedRow = await screen.findByRole('button', {
      name: /Fixture account, 7d, 47%/,
    })
    refreshedRow.focus()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    expect(screen.getByRole('button', { name: /Fixture account, 7d, 47%, Error/ })).toBe(
      refreshedRow,
    )
    expect(document.activeElement).toBe(refreshedRow)
    expect(screen.getByText(/Cannot read usage file/)).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('1 source(s) failed')
  })
  it('separates a source error that already ends with a period by one period', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    s.connections[0].error = {
      code: 'config',
      message: 'Usage source config. Check the account and retry.',
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
    expect(note.textContent).toBe('Usage source config. Check the account and retry.')
  })
  it('gives every row its own avatar and freshness badge and no per-row source note', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      sub = s.connections[0].subscription
    if (!sub) throw new Error('Fixture subscription is missing')
    const now = Date.now()
    sub.metrics = [
      {
        ...sub.metrics[0],
        id: 'claude-5h',
        label: 'Claude 5h',
        providerId: 'claude',
        observedAt: new Date(now - 60_000).toISOString(),
      },
      {
        ...sub.metrics[0],
        id: 'codex-weekly',
        label: 'Codex weekly',
        providerId: 'codex',
        observedAt: new Date(now - 3 * 3_600_000).toISOString(),
      },
      { ...sub.metrics[0], id: 'other', label: 'Other' },
    ]
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const rows = await screen.findAllByRole('button', { name: /^Fixture account, / })
    const avatars = rows.map((row) => row.querySelector('.usage-avatar'))
    expect(avatars.map((a) => a?.textContent)).toEqual(['CL', 'CO', 'TE'])
    expect(avatars[0]?.classList.contains('usage-fresh')).toBe(true)
    expect(avatars[1]?.classList.contains('usage-stale')).toBe(true)
    expect(document.querySelector('.usage-source-note')).toBeNull()
  })
  it('closes on an outside pointer click', () => {
    render(<UsageToolbar api={createAppApiStub().usage} onConfigure={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const backdrop = document.querySelector('.usage-backdrop')
    if (!backdrop) throw new Error('Usage backdrop is missing')
    fireEvent.mouseDown(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('closes on an outside window pointerdown anywhere outside the dialog', () => {
    const api = createAppApiStub().usage
    render(
      <div>
        <div data-testid="outside-element">Outside area</div>
        <UsageToolbar api={api} onConfigure={() => {}} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    const outside = screen.getByTestId('outside-element')
    fireEvent.pointerDown(outside)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('toggles closed when clicking the trigger button while open', () => {
    const api = createAppApiStub().usage
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Usage quota' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('shows partial refresh detail per source and window and keeps it across polling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    const api = createAppApiStub().usage,
      s = snapshot(),
      sub = s.connections[0].subscription
    if (!sub) throw new Error('Fixture subscription is missing')
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString(),
      deadline = new Date(Date.now() + 5 * 60_000).toISOString()
    sub.metrics = [
      { ...sub.metrics[0], id: 'claude-5h', label: 'Claude 5h', observedAt: old, usedPercent: 30 },
      { ...sub.metrics[0], id: 'claude-weekly', label: 'Claude weekly', observedAt: old },
    ]
    s.connections[0].refreshResult = {
      status: 'partial',
      requestId: 'request-1',
      measurementId: 'measurement-1',
      reportId: 'report-1',
      sources: [
        {
          sourceId: 'claude',
          status: 'succeeded',
          windows: [
            { metricId: 'claude-5h', status: 'succeeded' },
            { metricId: 'claude-weekly', status: 'failed', errorCode: 'network' },
          ],
        },
        {
          sourceId: 'codex',
          status: 'rate_limited',
          errorCode: 'rate_limited',
          nextAllowedAt: deadline,
          windows: [
            {
              metricId: 'codex-weekly',
              status: 'rate_limited',
              errorCode: 'rate_limited',
              nextAllowedAt: deadline,
            },
          ],
        },
      ],
    }
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({ ...s, refresh: { read: ['account'], skipped: [] } })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Usage refresh partially completed')
    expect(status.textContent).toContain('1 source(s) and 2 window(s) failed')
    expect(screen.getByText('claude: updated.')).toBeDefined()
    expect(screen.getByText('claude-5h: updated.')).toBeDefined()
    const retained = screen.getByText(
      'claude-weekly: failed (network error). Earlier value Stale - 2h 0m old.',
    )
    expect(retained).toBeDefined()
    expect(screen.getByText('codex: rate limited. Retry in 5m.')).toBeDefined()
    const missing = screen.getByText('codex-weekly: rate limited. Retry in 5m. No earlier value.')
    expect(missing).toBeDefined()
    expect(missing.getAttribute('title')).toBe(deadline)
    // The fixed text contains no provider payload and the rows keep their earlier values.
    expect(document.body.textContent).not.toContain('raw provider')
    expect(screen.getByRole('button', { name: /Claude weekly, 47%, Stale/ })).toBeDefined()
    // Ordinary polling may return a snapshot without the attempt metadata; the click feedback stays.
    vi.mocked(api.read).mockResolvedValue({
      ...s,
      connections: s.connections.map((connection) => ({ ...connection, refreshResult: null })),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText(/claude-weekly: failed \(network error\)/)).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('Usage refresh partially completed')
  })
  it('does not repeat a partial summary when the next request reads no source', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    const api = createAppApiStub().usage,
      s = snapshot()
    const until = new Date(Date.now() + 42_000).toISOString()
    s.connections[0].refreshResult = {
      status: 'partial',
      requestId: 'request-1',
      sources: [
        {
          sourceId: 'claude',
          status: 'succeeded',
          windows: [{ metricId: 'claude-weekly', status: 'failed', errorCode: 'network' }],
        },
      ],
    }
    s.connections[0].nextRefreshAt = until
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh)
      .mockResolvedValueOnce({ ...s, refresh: { read: ['account'], skipped: [] } })
      .mockResolvedValueOnce({
        ...s,
        refresh: { read: [], skipped: [{ connectionId: 'account', until, reason: 'interval' }] },
      })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const button = screen.getByRole('button', { name: 'Refresh usage' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByRole('status').textContent).toContain('Usage refresh partially completed')
    expect(
      screen.getByText('claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
    // A second click inside the 60-second minimum reads no source and must not claim a partial one.
    await act(async () => {
      fireEvent.click(button)
    })
    const second = screen.getByRole('status').textContent ?? ''
    expect(second).toContain('Last refresh request read no sources.')
    expect(second).not.toContain('partially completed')
    expect(second).toContain(
      'Fixture account was skipped (60-second limit). Fixture account can refresh again in 42 s.',
    )
    // The stored per-source detail from the first attempt remains visible.
    expect(
      screen.getByText('claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
  })
  it('reports a failed connection as a partial refresh when another connection succeeds', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    const other = structuredClone(s.connections[0])
    other.connection = { ...other.connection, id: 'other', label: 'Other account' }
    other.refreshResult = {
      status: 'success',
      requestId: 'request-3',
      sources: [
        {
          sourceId: 'codex',
          status: 'succeeded',
          windows: [{ metricId: 'week', status: 'succeeded' }],
        },
      ],
    }
    s.connections[0].refreshResult = {
      status: 'failed',
      requestId: 'request-3',
      sources: [
        {
          sourceId: 'claude',
          status: 'failed',
          errorCode: 'network',
          windows: [{ metricId: 'week', status: 'failed', errorCode: 'network' }],
        },
      ],
    }
    s.connections.push(other)
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({
      ...s,
      refresh: { read: ['account', 'other'], skipped: [] },
    })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    const status = screen.getByRole('status').textContent ?? ''
    // One connection failed outright and the other succeeded, so a clean summary is wrong.
    expect(status).toContain('Usage refresh partially completed')
    expect(status).toContain('1 source(s) and 1 window(s) failed')
    expect(status).not.toContain('Usage refreshed.')
  })
  it('reports a failed refresh with no numbers and explicit missing history', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    s.connections[0].refreshResult = {
      status: 'failed',
      requestId: 'request-2',
      sources: [
        {
          sourceId: 'claude',
          status: 'failed',
          errorCode: 'network',
          windows: [{ metricId: 'claude-weekly', status: 'failed', errorCode: 'network' }],
        },
      ],
    }
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({ ...s, refresh: { read: ['account'], skipped: [] } })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    })
    expect(screen.getByRole('status').textContent).toContain(
      'Usage refresh failed; earlier values were kept.',
    )
    expect(screen.getByText('claude: failed (network error).')).toBeDefined()
    expect(
      screen.getByText('claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
    // The existing row remains visible rather than becoming zero.
    expect(screen.getByRole('button', { name: /Fixture account, 7d, 47%/ })).toBeDefined()
  })
})
