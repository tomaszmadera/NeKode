import type { UsageRefreshResult, UsageSnapshot } from '@shared/contracts/usage-contract'
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
        serviceId: 'test',
        adapterId: 'source',
        enabled: true,
      },
      subscription: {
        id: 'account',
        serviceId: 'test',
        label: 'Fixture account',
        sourceKind: 'api',
        status: 'available',
        subscriptions: [{ id: 'test', label: 'Test' }],
        metrics: [
          {
            id: 'week',
            label: '7d',
            subscriptionId: 'test',
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
async function openGroupMenu(label: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: `Refresh options for ${label}` }))
  await act(async () => {})
  return screen.getByRole('menu')
}
function refreshMenuItem(label: string): HTMLElement {
  return screen.getByRole('menuitem', { name: `Refresh ${label}` })
}
async function clickRefresh(label: string): Promise<void> {
  await openGroupMenu(label)
  fireEvent.click(refreshMenuItem(label))
}
function closeOpenMenu(): void {
  const menu = screen.queryByRole('menu')
  if (menu) fireEvent.keyDown(menu, { key: 'Escape' })
}
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
      await openGroupMenu('Fixture account')
      expect(refreshMenuItem('Fixture account').getAttribute('aria-description')).toContain('42 s')
      await act(async () => {
        fireEvent.click(refreshMenuItem('Fixture account'))
      })
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('Fixture account can refresh again in 42 s')
      expect(status.textContent).toContain(reason === 'backoff' ? 'backoff' : '60-second limit')
      expect(status.textContent).toContain(
        `Fixture account was skipped (${reason === 'backoff' ? 'provider backoff' : '60-second limit'}).`,
      )
      await openGroupMenu('Fixture account')
      expect(refreshMenuItem('Fixture account').hasAttribute('disabled')).toBe(false)
      closeOpenMenu()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(status.textContent).toContain('37 s')
      await openGroupMenu('Fixture account')
      expect(refreshMenuItem('Fixture account').getAttribute('title')).toContain('37 s')
      await act(async () => {
        fireEvent.click(refreshMenuItem('Fixture account'))
      })
      expect(api.refresh).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('status').textContent).toContain('37 s')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(37_000)
      })
      await openGroupMenu('Fixture account')
      expect(refreshMenuItem('Fixture account').getAttribute('aria-description')).toContain(
        'ready to refresh',
      )
      closeOpenMenu()
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
      await clickRefresh('Fixture account')
    })
    const current = structuredClone(s)
    current.connections[0].nextRefreshAt = new Date(Date.now() + 65_000).toISOString()
    vi.mocked(api.read).mockResolvedValue(current)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(42_000)
    })
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').getAttribute('aria-description')).toContain(
      'can refresh again in 23 s',
    )
    closeOpenMenu()
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
      await clickRefresh('Fixture account')
    })
    expect(screen.getByRole('status').textContent).toContain('Fixture account is refreshing.')
    expect(screen.getByRole('status').textContent).not.toContain('ready to refresh')
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').getAttribute('aria-description')).toBe(
      'Fixture account is refreshing.',
    )
    closeOpenMenu()
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
    await clickRefresh('Fixture account')
    expect(screen.getByRole('status').textContent).toBe('Refreshing Fixture account...')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('status').textContent).toBe('Refreshing Fixture account...')
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').hasAttribute('disabled')).toBe(true)
    closeOpenMenu()
    await act(async () => {
      finish({ ...s, refresh: { read: ['account'], skipped: [] } })
    })
    expect(screen.getByRole('status').textContent).toBe('Fixture account refreshed.')
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
    expect(screen.getByRole('button', { name: /Fixture account, Test 7d, 47%/ })).toBeDefined()
  })
  it('refreshes one account and leaves the other account menu with its own state (A4)', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    const until = new Date(Date.now() + 120_000).toISOString()
    s.connections.push({
      ...s.connections[0],
      connection: { ...s.connections[0].connection, id: 'other', label: 'Other' },
      nextRefreshAt: until,
    })
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({ ...s, refresh: { read: ['account'], skipped: [] } })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.queryByRole('button', { name: 'Refresh usage' })).toBeNull()
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    expect(api.refresh).toHaveBeenCalledWith({ connectionId: 'account' })
    expect(screen.getByRole('status').textContent).toBe('Fixture account refreshed.')
    await openGroupMenu('Other')
    expect(refreshMenuItem('Other').getAttribute('aria-description')).toContain(
      'Other can refresh again in',
    )
    expect(refreshMenuItem('Other').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
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
  it('shows a rejected manual request and allows retry', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh)
      .mockRejectedValueOnce(new Error('Fixture refresh failed'))
      .mockResolvedValueOnce({ ...s, refresh: { read: ['account'], skipped: [] } })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    expect(screen.getByText('Fixture refresh failed')).toBeDefined()
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    expect(screen.getByRole('status').textContent).toBe('Fixture account refreshed.')
    expect(screen.queryByText('Fixture refresh failed')).toBeNull()
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
      screen.getByRole('button', { name: /Fixture account, Test 7d, 47%, Age unknown/ }),
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
        within(panel).getByRole('button', { name: 'Close usage panel' }),
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
  it('pins the explicit row globally, closes the panel, and preserves menu focus during refresh failures', async () => {
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
    const row = await screen.findByRole('button', {
      name: /Fixture account, Test 7d, 47%, Age unknown/,
    })
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
      name: /Fixture account, Test 7d, 47%/,
    })
    refreshedRow.focus()
    const menuButton = screen.getByRole('button', {
      name: 'Refresh options for Fixture account',
    })
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    expect(screen.getByRole('button', { name: /Fixture account, Test 7d, 47%, Error/ })).toBe(
      refreshedRow,
    )
    expect(document.activeElement).toBe(menuButton)
    expect(screen.getByText(/Cannot read usage file/)).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Fixture account refresh failed.')
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
      const element = document.querySelector('.usage-errors-body')
      if (!element) throw new Error('Usage error console is missing')
      return element
    })
    expect(note.textContent).toBe(
      'Fixture account: Usage source config. Check the account and retry.',
    )
    expect(document.querySelector('.usage-group-error')?.textContent).toBe('Error')
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
        subscriptionId: 'claude',
        observedAt: new Date(now - 60_000).toISOString(),
      },
      {
        ...sub.metrics[0],
        id: 'chatgpt-weekly',
        label: 'ChatGPT weekly',
        subscriptionId: 'chatgpt',
        observedAt: new Date(now - 3 * 3_600_000).toISOString(),
      },
      { ...sub.metrics[0], id: 'other', label: 'Test other' },
    ]
    sub.subscriptions = [
      { id: 'claude', label: 'Claude' },
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'test', label: 'Test' },
    ]
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const rows = await screen.findAllByRole('button', { name: /^Fixture account, / })
    const avatars = rows.map((row) => row.querySelector('.usage-avatar'))
    expect(avatars.map((a) => a?.textContent)).toEqual(['CL', 'CH', 'TE'])
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
          sourceId: 'hub-chatgpt',
          status: 'rate_limited',
          errorCode: 'rate_limited',
          nextAllowedAt: deadline,
          windows: [
            {
              metricId: 'chatgpt-weekly',
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
      await clickRefresh('Fixture account')
    })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Fixture account refresh partially completed')
    expect(status.textContent).toContain('1 source(s) and 2 window(s) failed')
    // Successful source and window lines are not errors and stay out of the console.
    expect(screen.queryByText('claude: updated.')).toBeNull()
    expect(screen.queryByText('claude-5h: updated.')).toBeNull()
    const retained = screen.getByText(
      'Test in Fixture account: claude-weekly: failed (network error). Earlier value Stale - 2h 0m old.',
    )
    expect(retained).toBeDefined()
    expect(
      screen.getByText('Fixture account: source hub-chatgpt: rate limited. Retry in 5m.'),
    ).toBeDefined()
    const missing = screen.getByText(
      'Fixture account: chatgpt-weekly: rate limited. Retry in 5m. No earlier value.',
    )
    expect(missing).toBeDefined()
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
    expect(
      screen.getByText(/Test in Fixture account: claude-weekly: failed \(network error\)/),
    ).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain(
      'Fixture account refresh partially completed',
    )
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
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    expect(screen.getByRole('status').textContent).toContain(
      'Fixture account refresh partially completed',
    )
    expect(
      screen.getByText('Fixture account: claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
    // A second click inside the 60-second minimum reads no source and must not claim a partial one.
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    const second = screen.getByRole('status').textContent ?? ''
    expect(second).not.toContain('partially completed')
    expect(second).toContain(
      'Fixture account was skipped (60-second limit). Fixture account can refresh again in 42 s.',
    )
    // The stored per-source detail from the first attempt remains visible.
    expect(
      screen.getByText('Fixture account: claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
  })
  it('groups an account by declared subscription labels in report order with one menu each (A2-A5, U11)', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      sub = s.connections[0].subscription
    if (!sub) throw new Error('Fixture subscription is missing')
    sub.metrics = [
      { ...sub.metrics[0], id: 'claude-5h', label: 'Claude 5h', subscriptionId: 'claude' },
      { ...sub.metrics[0], id: 'chatgpt-5h', label: 'ChatGPT 5h', subscriptionId: 'chatgpt' },
      { ...sub.metrics[0], id: 'claude-weekly', label: 'Claude weekly', subscriptionId: 'claude' },
    ]
    // Report order comes from the declarations, not from the first metric.
    sub.subscriptions = [
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'claude', label: 'Claude' },
    ]
    const until = new Date(Date.now() + 30_000).toISOString()
    s.connections[0].subscriptions = [
      { subscriptionId: 'claude', nextRefreshAt: null },
      { subscriptionId: 'chatgpt', nextRefreshAt: until },
    ]
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
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'ChatGPT',
      'Claude',
    ])
    await openGroupMenu('Claude in Fixture account')
    expect(refreshMenuItem('Claude in Fixture account').getAttribute('aria-description')).toBe(
      'Claude in Fixture account is ready to refresh.',
    )
    closeOpenMenu()
    await openGroupMenu('ChatGPT in Fixture account')
    expect(refreshMenuItem('ChatGPT in Fixture account').getAttribute('title')).toContain(
      'ChatGPT in Fixture account can refresh again in',
    )
    closeOpenMenu()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh options for Claude in Fixture account',
      }),
    )
    fireEvent.click(refreshMenuItem('Claude in Fixture account'))
    expect(api.refresh).toHaveBeenCalledWith({ connectionId: 'account', subscriptionId: 'claude' })
    expect(screen.getByRole('status').textContent).toBe('Refreshing Claude in Fixture account...')
    await openGroupMenu('Claude in Fixture account')
    expect(refreshMenuItem('Claude in Fixture account').hasAttribute('disabled')).toBe(true)
    expect(refreshMenuItem('Claude in Fixture account').getAttribute('aria-description')).toBe(
      'Claude in Fixture account is refreshing.',
    )
    closeOpenMenu()
    await openGroupMenu('ChatGPT in Fixture account')
    expect(refreshMenuItem('ChatGPT in Fixture account').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
    await openGroupMenu('Fixture account')
    expect(refreshMenuItem('Fixture account').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
    await act(async () => {
      finish({ ...s, refresh: { read: ['account'], skipped: [] } })
    })
    expect(screen.getByRole('status').textContent).toBe('Claude in Fixture account refreshed.')
    await openGroupMenu('Claude in Fixture account')
    expect(refreshMenuItem('Claude in Fixture account').hasAttribute('disabled')).toBe(false)
    closeOpenMenu()
  })
  it('shows the declared subscription heading without a menu when the adapter cannot refresh one subscription', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      sub = s.connections[0].subscription
    if (!sub) throw new Error('Fixture subscription is missing')
    // An account whose report declares a subscription always shows its heading (U11).
    sub.subscriptions = [{ id: 'opencode-go', label: 'OpenCode Go' }]
    sub.metrics = [
      {
        ...sub.metrics[0],
        id: 'opencode-go-5h',
        label: 'OpenCode Go 5h',
        subscriptionId: 'opencode-go',
      },
    ]
    s.connections[0].subscriptions = null
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'OpenCode Go',
    ])
    expect(screen.queryByRole('button', { name: /Refresh options for OpenCode Go/ })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Refresh options for Fixture account' }),
    ).toBeDefined()
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
      await clickRefresh('Fixture account')
    })
    expect(screen.getByRole('status').textContent).toContain(
      'Fixture account refresh failed; earlier values were kept.',
    )
    expect(
      screen.getByText('Fixture account: source claude: failed (network error).'),
    ).toBeDefined()
    expect(
      screen.getByText('Fixture account: claude-weekly: failed (network error). No earlier value.'),
    ).toBeDefined()
    // The existing row remains visible rather than becoming zero.
    expect(screen.getByRole('button', { name: /Fixture account, Test 7d, 47%/ })).toBeDefined()
  })
  it.each(['account', 'subscription'] as const)(
    'reports a failed %s refresh when its source has no windows',
    async (target) => {
      const api = createAppApiStub().usage,
        s = snapshot(),
        source = s.connections[0]
      if (!source.subscription) throw new Error('Fixture subscription is missing')
      source.subscription.metrics[0].subscriptionId = 'claude'
      source.subscription.subscriptions = [{ id: 'claude', label: 'Claude' }]
      source.subscriptions = [{ subscriptionId: 'claude', nextRefreshAt: null }]
      source.refreshResult = {
        status: 'failed',
        requestId: 'empty-windows',
        sources: [
          { sourceId: 'opaque-source', status: 'failed', errorCode: 'network', windows: [] },
        ],
      }
      vi.mocked(api.read).mockResolvedValue(s)
      vi.mocked(api.refresh).mockResolvedValue({
        ...s,
        refresh: { read: ['account'], skipped: [] },
      })
      render(<UsageToolbar api={api} onConfigure={() => {}} />)
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
      const label = target === 'subscription' ? 'Claude in Fixture account' : 'Fixture account'
      await act(async () => {
        await openGroupMenu(label)
        fireEvent.click(refreshMenuItem(label))
      })
      expect(api.refresh).toHaveBeenCalledWith({
        connectionId: 'account',
        ...(target === 'subscription' ? { subscriptionId: 'claude' } : {}),
      })
      expect(screen.getByRole('status').textContent).toBe(
        `${label} refresh failed; earlier values were kept.`,
      )
      expect(
        screen.getByText('Fixture account: source opaque-source: failed (network error).'),
      ).toBeDefined()
    },
  )
  it('keeps an earlier subscription failure in detail without attributing it to the next successful subscription', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      source = s.connections[0]
    if (!source.subscription) throw new Error('Fixture subscription is missing')
    source.subscription.metrics = [
      { ...source.subscription.metrics[0], id: 'claude-5h', subscriptionId: 'claude' },
      { ...source.subscription.metrics[0], id: 'chatgpt-5h', subscriptionId: 'chatgpt' },
    ]
    source.subscription.subscriptions = [
      { id: 'claude', label: 'Claude' },
      { id: 'chatgpt', label: 'ChatGPT' },
    ]
    source.subscriptions = [
      { subscriptionId: 'claude', nextRefreshAt: null },
      { subscriptionId: 'chatgpt', nextRefreshAt: null },
    ]
    const failed: UsageRefreshResult = {
      status: 'failed',
      requestId: 'request-1',
      sources: [{ sourceId: 'hub-claude', status: 'failed', windows: [] }],
    }
    const succeeded: UsageRefreshResult = {
      status: 'success',
      requestId: 'request-2',
      measurementId: 'measurement-2',
      reportId: 'report-2',
      sources: [
        {
          sourceId: 'hub-chatgpt',
          status: 'succeeded',
          windows: [{ metricId: 'chatgpt-5h', status: 'succeeded' }],
        },
      ],
    }
    const first = structuredClone(s),
      second = structuredClone(s)
    first.connections[0].refreshResult = failed
    second.connections[0].refreshResult = {
      ...succeeded,
      status: 'partial',
      sources: [...failed.sources, ...succeeded.sources],
    }
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh)
      .mockResolvedValueOnce({
        ...first,
        refresh: { read: ['account'], skipped: [], result: failed },
      })
      .mockResolvedValueOnce({
        ...second,
        refresh: { read: ['account'], skipped: [], result: succeeded },
      })
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      await clickRefresh('Claude in Fixture account')
    })
    expect(screen.getByRole('status').textContent).toBe(
      'Claude in Fixture account refresh failed; earlier values were kept.',
    )
    await act(async () => {
      await clickRefresh('ChatGPT in Fixture account')
    })
    expect(api.refresh).toHaveBeenLastCalledWith({
      connectionId: 'account',
      subscriptionId: 'chatgpt',
    })
    expect(screen.getByRole('status').textContent).toBe('ChatGPT in Fixture account refreshed.')
    expect(screen.getByText('Fixture account: source hub-claude: failed.')).toBeDefined()
  })
  it('opens the group menu by right-click and keyboard, then restores focus on Escape', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    fireEvent.contextMenu(screen.getByRole('group', { name: 'Fixture account' }), {
      clientX: 20,
      clientY: 20,
    })
    await act(async () => {})
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Refresh Fixture account' }),
    )
    fireEvent.keyDown(menu, { key: 'Escape' })
    const menuButton = screen.getByRole('button', {
      name: 'Refresh options for Fixture account',
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(menuButton)
    fireEvent.keyDown(menuButton, { key: 'ContextMenu' })
    await act(async () => {})
    const keyboardMenu = screen.getByRole('menu')
    fireEvent.keyDown(keyboardMenu, { key: 'ArrowDown' })
    fireEvent.keyDown(keyboardMenu, { key: 'End' })
    fireEvent.keyDown(keyboardMenu, { key: 'Home' })
    fireEvent.keyDown(keyboardMenu, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(menuButton)
    fireEvent.keyDown(menuButton, { key: 'ContextMenu' })
    await act(async () => {})
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog')).toBeDefined()
  })
  it('puts cache, export and rejected request failures in the error console', async () => {
    const api = createAppApiStub().usage,
      s = snapshot()
    s.cacheError = 'Cannot write usage cache.'
    s.exportError = 'Export failed.'
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockRejectedValueOnce(new Error('Request failed'))
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await act(async () => {
      await clickRefresh('Fixture account')
    })
    const body = document.querySelector('.usage-errors-body')
    expect(body?.textContent).toContain('Cannot write usage cache.')
    expect(body?.textContent).toContain('Export failed.')
    expect(body?.textContent).toContain('Request failed')
  })
  it('shows a disabled reason for a known empty or unlisted refresh subscription', async () => {
    vi.useFakeTimers()
    const api = createAppApiStub().usage,
      s = snapshot()
    s.connections[0].subscriptions = []
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    await openGroupMenu('Fixture account')
    expect(screen.getByRole('menuitem').textContent).toBe('No refresh source in the Hub')
    expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(true)
    closeOpenMenu()

    s.connections[0].subscriptions = [{ subscriptionId: 'chatgpt', nextRefreshAt: null }]
    const report = s.connections[0].subscription
    if (!report) throw new Error('Fixture subscription is missing')
    report.subscriptions = [{ id: 'claude', label: 'Claude' }]
    for (const metric of report.metrics) metric.subscriptionId = 'claude'
    vi.mocked(api.read).mockResolvedValue(structuredClone(s))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await openGroupMenu('Claude in Fixture account')
    expect(screen.getByRole('menuitem').textContent).toBe(
      'No refresh source for this subscription in the Hub',
    )
    expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(true)
  })
  it('does not restart the error-console timer when a derived detail text changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    const api = createAppApiStub().usage,
      s = snapshot(),
      metric = s.connections[0].subscription?.metrics[0]
    if (!metric) throw new Error('Fixture metric is missing')
    metric.observedAt = new Date(Date.now() - 2 * 3_600_000).toISOString()
    s.connections[0].refreshResult = {
      status: 'failed',
      requestId: 'request-1',
      sources: [
        {
          sourceId: 'fixture-source',
          status: 'failed',
          errorCode: 'network',
          windows: [{ metricId: 'week', status: 'failed', errorCode: 'network' }],
        },
      ],
    }
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getByRole('region', { name: 'Usage errors' })).toBeDefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.queryByRole('region', { name: 'Usage errors' })).toBeNull()
  })
  it('auto-collapses the error console after 60 seconds and reopens it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    const api = createAppApiStub().usage,
      s = snapshot()
    s.connections[0].error = { code: 'io', message: 'Cannot read usage file' }
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getByRole('region', { name: 'Usage errors' })).toBeDefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(screen.getByRole('region', { name: 'Usage errors' })).toBeDefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.queryByRole('region', { name: 'Usage errors' })).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Errors (1)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('region', { name: 'Usage errors' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close usage errors' }))
    expect(screen.queryByRole('region', { name: 'Usage errors' })).toBeNull()

    const next = structuredClone(s)
    next.connections[0].error = { code: 'io', message: 'Another usage failure' }
    vi.mocked(api.read).mockResolvedValue(next)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByRole('region', { name: 'Usage errors' })).toBeDefined()
  })
  it('shows four declared hub subscriptions, refreshes one and pins its row (U4, U11, acceptance 1)', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      source = s.connections[0]
    source.connection = { ...source.connection, label: 'PDH', serviceId: 'personal-data-hub' }
    const declared = [
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'claude', label: 'Claude' },
      { id: 'google-ai', label: 'Google AI' },
      { id: 'opencode-go', label: 'OpenCode Go' },
    ]
    const base = {
      kind: 'window' as const,
      state: 'available' as const,
      usedPercent: 20,
      observedAt: null,
    }
    source.subscription = {
      id: 'account',
      serviceId: 'personal-data-hub',
      label: 'PDH',
      sourceKind: 'api',
      status: 'available',
      subscriptions: declared,
      // Metrics arrive in another order; headings follow the declarations.
      metrics: [...declared].reverse().map((item) => ({
        ...base,
        id: `${item.id}-5h`,
        label: `${item.label} 5h`,
        subscriptionId: item.id,
      })),
    }
    // Google AI has no refresh source in the Hub.
    source.subscriptions = [
      { subscriptionId: 'chatgpt', nextRefreshAt: null },
      { subscriptionId: 'claude', nextRefreshAt: null },
      { subscriptionId: 'opencode-go', nextRefreshAt: null },
    ]
    vi.mocked(api.read).mockResolvedValue(s)
    vi.mocked(api.refresh).mockResolvedValue({ ...s, refresh: { read: ['account'], skipped: [] } })
    vi.mocked(api.getSettings).mockResolvedValue({
      connections: [],
      pin: null,
      export: { enabled: false, path: null },
    })
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'ChatGPT',
      'Claude',
      'Google AI',
      'OpenCode Go',
    ])
    expect(screen.queryByRole('heading', { name: 'OpenCode' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Opencode-go' })).toBeNull()
    await openGroupMenu('Google AI in PDH')
    expect(screen.getByRole('menuitem').textContent).toBe(
      'No refresh source for this subscription in the Hub',
    )
    closeOpenMenu()
    await act(async () => {
      await clickRefresh('OpenCode Go in PDH')
    })
    expect(api.refresh).toHaveBeenCalledWith({
      connectionId: 'account',
      subscriptionId: 'opencode-go',
    })
    expect(screen.getByRole('status').textContent).toBe('OpenCode Go in PDH refreshed.')
    expect(document.body.textContent).not.toMatch(/agent/i)
    // After the pin is saved, the next read reports it.
    vi.mocked(api.read).mockResolvedValue({
      ...s,
      pin: { connectionId: 'account', metricId: 'opencode-go-5h' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^PDH, OpenCode Go 5h, 20%/ }))
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ pin: { connectionId: 'account', metricId: 'opencode-go-5h' } }),
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Usage quota: PDH; OpenCode Go 5h; 20%/ }),
      ).toBeDefined(),
    )
    const pinned = screen.getByRole('button', { name: /^Usage quota: PDH; OpenCode Go 5h/ })
    expect(pinned.querySelector('.usage-avatar')?.textContent).toBe('OP')
    expect(pinned.textContent).toContain('OpenCode Go 5h')
  })
  it('names the subscription and account of a failed window in the error console (U11)', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      source = s.connections[0]
    if (!source.subscription) throw new Error('Fixture subscription is missing')
    source.subscription.subscriptions = [{ id: 'opencode-go', label: 'OpenCode Go' }]
    source.subscription.metrics = [
      {
        ...source.subscription.metrics[0],
        id: 'opencode-go-5h',
        label: 'OpenCode Go 5h',
        subscriptionId: 'opencode-go',
      },
    ]
    source.refreshResult = {
      status: 'failed',
      requestId: 'request-1',
      sources: [
        {
          sourceId: 'opencode',
          status: 'failed',
          errorCode: 'network',
          windows: [{ metricId: 'opencode-go-5h', status: 'failed', errorCode: 'network' }],
        },
      ],
    }
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    const body = document.querySelector('.usage-errors-body')
    expect(body?.textContent).toContain(
      'OpenCode Go in Fixture account: source opencode: failed (network error).',
    )
    expect(body?.textContent).toContain(
      'OpenCode Go in Fixture account: opencode-go-5h: failed (network error).',
    )
  })
  it.each([
    ['available', 'No usage data yet'],
    ['unavailable', 'Unavailable'],
  ] as const)(
    'shows the %s empty message when declared subscriptions have no metrics (rule 11)',
    async (status, message) => {
      const api = createAppApiStub().usage,
        s = snapshot(),
        sub = s.connections[0].subscription
      if (!sub) throw new Error('Fixture subscription is missing')
      sub.status = status
      sub.subscriptions = [{ id: 'chatgpt', label: 'ChatGPT' }]
      sub.metrics = []
      vi.mocked(api.read).mockResolvedValue(s)
      render(<UsageToolbar api={api} onConfigure={() => {}} />)
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
      expect(screen.getByText(message)).toBeDefined()
      expect(screen.queryAllByRole('heading', { level: 4 })).toEqual([])
    },
  )
  it('places an undeclared retained subscription after the declared ones under its raw id (U4, U11)', async () => {
    const api = createAppApiStub().usage,
      s = snapshot(),
      sub = s.connections[0].subscription
    if (!sub) throw new Error('Fixture subscription is missing')
    sub.subscriptions = [{ id: 'chatgpt', label: 'ChatGPT' }]
    // The undeclared metric appears first, yet its group follows the declared subscriptions.
    sub.metrics = [
      { ...sub.metrics[0], id: 'legacy-5h', label: '5h', subscriptionId: 'legacy-plan' },
      { ...sub.metrics[0], id: 'chatgpt-5h', label: 'ChatGPT 5h', subscriptionId: 'chatgpt' },
    ]
    vi.mocked(api.read).mockResolvedValue(s)
    render(<UsageToolbar api={api} onConfigure={() => {}} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Usage quota' }))
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'ChatGPT',
      'legacy-plan',
    ])
    expect(
      screen.getByRole('button', { name: /^Fixture account, legacy-plan 5h, 47%, / }),
    ).toBeDefined()
    expect(
      screen.getByRole('button', { name: /^Fixture account, ChatGPT 5h, 47%, / }),
    ).toBeDefined()
  })
})
