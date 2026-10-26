import {
  type UsageSettings as Settings,
  USAGE_REMOVED_ADAPTER_MESSAGE,
  type UsageAdapter,
  type UsageSnapshot,
} from '@shared/contracts/usage-contract'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { UsageSettings } from './UsageSettings'

afterEach(cleanup)

const base = {
  protocolVersion: 2 as const,
  minimumRefreshSeconds: 60,
}
const OPENROUTER: UsageAdapter = {
  ...base,
  id: 'openrouter-credits',
  name: 'OpenRouter account balance',
  providerId: 'openrouter',
  summary: 'Account balance in USD.',
  invocation: { command: 'C:/NeKode/nekode.exe', args: ['index.cjs'] },
  sourceKind: 'api',
  capabilities: ['balance'],
  configSchema: [
    {
      key: 'apiKey',
      label: 'Management key',
      type: 'secret',
      required: true,
      description: 'Stored encrypted.',
    },
  ],
  description: 'A Management key can create and delete API keys for your account.',
  directory: 'C:/NeKode/resources/usage-adapters/usage-openrouter',
  bundled: true,
}
const CODEX: UsageAdapter = {
  ...base,
  id: 'codex-app-server',
  name: 'Codex CLI',
  experimental: true,
  invocation: { command: 'C:/NeKode/nekode.exe', args: ['index.cjs'] },
  sourceKind: 'cli',
  capabilities: ['window'],
  configSchema: [],
  directory: 'C:/NeKode/resources/usage-adapters/usage-codex',
  bundled: true,
}
const MINE: UsageAdapter = {
  ...base,
  id: 'hub',
  name: 'My hub',
  invocation: { command: 'node', args: ['hub.cjs'] },
  sourceKind: 'api',
  capabilities: ['window'],
  configSchema: [{ key: 'input', label: 'Hub input file', type: 'file', required: true }],
  directory: 'C:/profile/usage-adapters/hub',
}
const BROKEN: UsageAdapter = {
  ...MINE,
  invocation: { command: '', args: [] },
  configSchema: [],
  id: 'invalid:broken',
  name: 'broken',
  directory: 'C:/profile/usage-adapters/broken',
  error: 'Invalid usage-adapter.json.',
}
const STORED: Settings = {
  connections: [
    {
      id: 'kept',
      label: 'Kept account',
      providerId: 'openrouter',
      adapterId: 'openrouter-credits',
      enabled: true,
      config: {},
      secretKeys: ['apiKey'],
    },
  ],
  pin: null,
  export: { enabled: false, path: null },
}

function setup(settings: Settings = STORED, enabled = true, snapshot?: UsageSnapshot) {
  const app = createAppApiStub()
  vi.mocked(app.usage.listAdapters).mockResolvedValue([OPENROUTER, CODEX, MINE, BROKEN])
  vi.mocked(app.usage.getSettings).mockResolvedValue(structuredClone(settings))
  vi.mocked(app.usage.getEnabled).mockResolvedValue(enabled)
  vi.mocked(app.usage.saveSettings).mockImplementation(async (s) => s)
  if (snapshot) vi.mocked(app.usage.read).mockResolvedValue(snapshot)
  render(<UsageSettings app={app} />)
  return app
}
async function pick(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add source' }))
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Choose an adapter' })).getByRole('button', { name }),
  )
}

describe('Usage settings', () => {
  it('applies the Show usage quota switch immediately', async () => {
    const app = setup(STORED, false)
    const toggle = await screen.findByRole('switch', {
      name: 'Show usage quota',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(app.usage.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
  })
  it('lists sources with adapter and status and explains account and hub sources', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Sources' })
    expect(within(list).getByText('Kept account')).toBeTruthy()
    expect(within(list).getByText('OpenRouter account balance')).toBeTruthy()
    expect(within(list).getByText('No reading yet')).toBeTruthy()
    expect(within(list).getByText('No limits yet')).toBeTruthy()
    expect(
      screen.getByText(
        'Each source reads quota limits through an adapter and shows them in the title bar. One source can report one account or, like a hub, several agents.',
      ),
    ).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/connection/i)
    expect(text).not.toContain('Agent Harness')
  })
  it('offers usable services with summary and tags, and hides invalid adapters', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Add source' }))
    const picker = screen.getByRole('group', { name: 'Choose an adapter' })
    expect(
      within(picker).getByRole('button', { name: /Codex CLI.*Shipped.*Experimental/ }),
    ).toBeTruthy()
    expect(within(picker).getByRole('button', { name: /My hub.*Added by you/ })).toBeTruthy()
    expect(within(picker).getByText('Account balance in USD.')).toBeTruthy()
    expect(within(picker).queryByRole('button', { name: /broken/ })).toBeNull()
    expect(within(picker).queryByText('Built-in')).toBeNull()
    fireEvent.click(within(picker).getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('list', { name: 'Sources' })).toBeTruthy()
  })
  it('saves only the new account without asking for ids and keeps the stored ones', async () => {
    const app = setup()
    await pick(/OpenRouter/)
    const adapter = screen.getByRole('textbox', { name: 'Adapter' }) as HTMLInputElement
    expect(adapter.value).toBe(OPENROUTER.name)
    expect(adapter.readOnly).toBe(true)
    expect(screen.queryByRole('textbox', { name: /id/i })).toBeNull()
    expect(
      screen.getByText('A Management key can create and delete API keys for your account.'),
    ).toBeTruthy()
    expect(screen.getByLabelText('Management key').getAttribute('aria-describedby')).toBe(
      screen.getByText('Stored encrypted.').id,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Second' },
    })
    fireEvent.change(screen.getByLabelText('Management key'), { target: { value: 'k' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    const sent = vi.mocked(app.usage.saveSettings).mock.calls[0][0]
    expect(sent.connections).toHaveLength(2)
    expect(sent.connections[0]).toEqual(STORED.connections[0])
    expect(sent.connections[1]).toMatchObject({
      label: 'Second',
      adapterId: 'openrouter-credits',
      enabled: true,
      config: { apiKey: 'k' },
    })
    expect(sent.connections[1].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Source saved: Second')).toBeTruthy()
  })
  it('keeps the editor and reports the error after a failed save', async () => {
    const app = setup()
    vi.mocked(app.usage.saveSettings).mockRejectedValue(new Error('Cannot save fixture settings'))
    await pick(/Codex/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Fixture account' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Cannot save fixture settings'),
    )
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Fixture account',
    )
  })
  it('disables Test with a visible hint while Show usage quota is off', async () => {
    const app = setup(STORED, false)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kept account' }))
    const test = screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement
    expect(test.disabled).toBe(true)
    expect(screen.getByText('Turn on Show usage quota to test sources.')).toBeTruthy()
    fireEvent.click(test)
    expect(app.usage.test).not.toHaveBeenCalled()
  })
  it('removes an account only after confirmation', async () => {
    const app = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Kept account' }))
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Kept account' }))
    })
    expect(vi.mocked(app.usage.saveSettings).mock.calls[0][0].connections).toEqual([])
  })
  it('offers no JSON file or Claude snapshot service and no Claude setup (LA4)', async () => {
    const app = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Add source' }))
    const picker = screen.getByRole('group', { name: 'Choose an adapter' })
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining('OpenRouter account balance'),
      expect.stringContaining('Codex CLI'),
      expect.stringContaining('My hub'),
      'Back',
    ])
    // A user adapter's file field takes a picked path without reading the file.
    vi.mocked(app.usage.pickFile).mockResolvedValue('C:/data/hub.json')
    fireEvent.click(within(picker).getByRole('button', { name: /My hub/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
    })
    expect(app.usage.pickFile).toHaveBeenCalledExactlyOnceWith(false)
    expect(screen.getByDisplayValue('C:/data/hub.json')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Subscription' })).toBeNull()
    expect(screen.queryByRole('button', { name: /setup command|directory/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/snapshot/i)
  })
  it('shows the removed-service message for a stored JSON file or Claude account (L7)', async () => {
    const legacy: Settings = {
      ...STORED,
      connections: [
        {
          id: 'old-claude',
          label: 'Old Claude',
          providerId: 'claude',
          adapterId: 'claude-code-snapshots',
          enabled: true,
          config: { directory: 'C:/data/claude' },
          secretKeys: [],
        },
      ],
    }
    const app = createAppApiStub()
    vi.mocked(app.usage.listAdapters).mockResolvedValue([OPENROUTER])
    vi.mocked(app.usage.getSettings).mockResolvedValue(structuredClone(legacy))
    vi.mocked(app.usage.getEnabled).mockResolvedValue(true)
    vi.mocked(app.usage.read).mockResolvedValue({
      connections: [
        {
          connection: legacy.connections[0],
          subscription: null,
          refreshing: false,
          error: { code: 'config', message: USAGE_REMOVED_ADAPTER_MESSAGE },
          nextRefreshAt: null,
        },
      ],
      pin: null,
      cacheError: null,
      exportError: null,
    })
    render(<UsageSettings app={app} />)
    const list = await screen.findByRole('list', { name: 'Sources' })
    expect(within(list).getByText(USAGE_REMOVED_ADAPTER_MESSAGE)).toBeTruthy()
    expect(USAGE_REMOVED_ADAPTER_MESSAGE).toBe(
      'This adapter is no longer available. Remove the source and add it again with a supported adapter.',
    )
    expect(within(list).getByText('claude-code-snapshots')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old Claude' }))
    expect(screen.getByRole('alert').textContent).toBe(USAGE_REMOVED_ADAPTER_MESSAGE)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
  it('saves export settings separately and keeps accounts unchanged', async () => {
    const app = setup()
    fireEvent.click(await screen.findByRole('switch', { name: 'Write usage to a JSON file' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Usage export output file' }), {
      target: { value: 'C:/data/export.json' },
    })
    expect(screen.queryByText(/hosted consumer/)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save export settings' }))
    })
    const sent = vi.mocked(app.usage.saveSettings).mock.calls[0][0]
    expect(sent.connections).toEqual(STORED.connections)
    expect(sent.export).toMatchObject({ enabled: true, path: 'C:/data/export.json' })
  })
  it('shows adapter origin, executable and errors under Adapters and opens the folder', async () => {
    const app = setup()
    const summary = await screen.findByRole('button', { name: 'Adapters' })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    const adapters = await screen.findByRole('list', { name: 'Usage adapters' })
    const rows = within(adapters).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Shipped')
    expect(rows[1].textContent).toContain('Shipped')
    expect(rows[2].textContent).toContain('Added by you')
    expect(rows[1].textContent).toContain('Executable: C:/NeKode/nekode.exe index.cjs')
    expect(rows[2].textContent).toContain('Executable: node hub.cjs')
    expect(within(adapters).getByText(MINE.directory as string)).toBeTruthy()
    expect(within(adapters).getByText('Invalid usage-adapter.json.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open adapters folder' }))
    })
    expect(app.usage.openAdaptersFolder).toHaveBeenCalledOnce()
  })

  it.each([
    {
      count: 7,
      enabled: true,
      error: null,
      observedAt: '2026-10-24T05:00:00Z',
      status: /Last reading \d/,
    },
    { count: 1, enabled: true, error: null, observedAt: null, status: /Last reading, age unknown/ },
    {
      count: 7,
      enabled: true,
      error: { code: 'network' as const, message: 'Source fixture is offline.' },
      observedAt: null,
      status: /Source fixture is offline/,
    },
    {
      count: 7,
      enabled: false,
      error: { code: 'network' as const, message: 'Source fixture is offline.' },
      observedAt: null,
      status: /Disabled/,
    },
    { count: 0, enabled: true, error: null, observedAt: null, status: /No reading yet/ },
  ])(
    'shows $count retained limits and correct status (enabled=$enabled)',
    async ({ count, enabled, error, observedAt, status }) => {
      const connection = { ...STORED.connections[0], label: 'PDH', adapterId: MINE.id, enabled }
      setup({ ...STORED, connections: [connection] }, true, {
        connections: [
          {
            connection,
            subscription: {
              id: connection.id,
              label: 'PDH',
              providerId: 'hub',
              sourceKind: 'api',
              status: 'available',
              metrics: Array.from({ length: count }, (_, i) => ({
                id: `limit-${i}`,
                label: `Agent ${i}`,
                kind: 'window',
                state: i === 0 ? 'unavailable' : 'expired',
                observedAt,
              })),
            },
            error,
            refreshing: false,
            nextRefreshAt: null,
          },
        ],
        pin: null,
        cacheError: null,
        exportError: null,
      })
      const list = await screen.findByRole('list', { name: 'Sources' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
      expect(within(list).getByText(count === 1 ? '1 limit' : `${count} limits`)).toBeTruthy()
      expect(within(list).getByText(status)).toBeTruthy()
    },
  )

  it('discards an edited source on Cancel and saves only that source on Save', async () => {
    const other = { ...STORED.connections[0], id: 'other', label: 'Other source' }
    const app = setup({ ...STORED, connections: [...STORED.connections, other] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kept account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Discarded' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kept account' }))
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Kept account',
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Renamed source' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    const saved = vi.mocked(app.usage.saveSettings).mock.calls[0][0]
    expect(saved.connections[0].label).toBe('Renamed source')
    expect(saved.connections[1]).toEqual(other)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Renamed source' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Renamed source' }))
    })
    expect(vi.mocked(app.usage.saveSettings).mock.calls[1][0].connections).toEqual([other])
  })

  it('chooses an export path without saving and keeps it when the picker is cancelled', async () => {
    const app = setup({ ...STORED, connections: [] })
    expect(await screen.findByRole('button', { name: 'Add source' })).toBeTruthy()
    const choose = screen.getByRole('button', { name: 'Choose output file' })
    vi.mocked(app.usage.pickFile)
      .mockResolvedValueOnce('C:/data/output.json')
      .mockResolvedValueOnce(null)
    await act(async () => {
      fireEvent.click(choose)
    })
    expect(app.usage.pickFile).toHaveBeenCalledWith(true)
    expect(screen.getByDisplayValue('C:/data/output.json')).toBeTruthy()
    await act(async () => {
      fireEvent.click(choose)
    })
    expect(screen.getByDisplayValue('C:/data/output.json')).toBeTruthy()
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save export settings' }))
    })
    expect(vi.mocked(app.usage.saveSettings).mock.calls[0][0].export.path).toBe(
      'C:/data/output.json',
    )
  })

  it('names the missing adapter and source without offering an editable form', async () => {
    setup({ ...STORED, connections: [{ ...STORED.connections[0], adapterId: 'missing' }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kept account' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'The adapter of this source (missing) is unavailable. Remove the source or restore its adapter.',
    )
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
