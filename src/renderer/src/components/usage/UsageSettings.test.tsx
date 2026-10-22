import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageSettings as Settings, UsageAdapter } from '../../../../shared/usage-contract'
import { createAppApiStub } from '../../test/app-api-stub'
import { UsageSettings } from './UsageSettings'

afterEach(cleanup)

const base = {
  protocolVersion: 1 as const,
  minimumRefreshSeconds: 60,
}
const FILE: UsageAdapter = {
  ...base,
  id: 'usage-file',
  name: 'Custom JSON file',
  summary: 'Reads limits from a JSON file.',
  invocation: { command: 'Built-in JSON reader', args: [] },
  sourceKind: 'file',
  capabilities: ['window'],
  configSchema: [
    { key: 'path', label: 'JSON input file', type: 'file', required: true },
    { key: 'subscriptionId', label: 'Subscription', type: 'text' },
  ],
}
const CLAUDE: UsageAdapter = {
  ...base,
  id: 'claude-code-snapshots',
  name: 'Claude Code',
  providerId: 'claude',
  summary: 'Reads 5h and 7-day limits.',
  invocation: { command: 'Built-in Claude snapshot reader', args: [] },
  sourceKind: 'file',
  capabilities: ['window'],
  configSchema: [
    { key: 'directory', label: 'Claude snapshot directory', type: 'directory', required: true },
  ],
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
  configSchema: [],
  directory: 'C:/profile/usage-adapters/hub',
}
const BROKEN: UsageAdapter = {
  ...FILE,
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

function setup(settings: Settings = STORED, enabled = true) {
  const app = createAppApiStub()
  vi.mocked(app.usage.listAdapters).mockResolvedValue([
    FILE,
    CLAUDE,
    OPENROUTER,
    CODEX,
    MINE,
    BROKEN,
  ])
  vi.mocked(app.usage.getSettings).mockResolvedValue(structuredClone(settings))
  vi.mocked(app.usage.getEnabled).mockResolvedValue(enabled)
  vi.mocked(app.usage.saveSettings).mockImplementation(async (s) => s)
  render(<UsageSettings app={app} />)
  return app
}
async function pick(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add account' }))
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Choose a service' })).getByRole('button', { name }),
  )
}

describe('Usage settings', () => {
  it('applies the Show usage quota switch immediately', async () => {
    const app = setup(STORED, false)
    const toggle = (await screen.findByRole('switch', {
      name: 'Show usage quota',
    })) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(app.usage.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
  })
  it('lists accounts with service and status and never says connection or Agent Harness', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Accounts' })
    expect(within(list).getByText('Kept account')).toBeTruthy()
    expect(within(list).getByText('OpenRouter account balance')).toBeTruthy()
    expect(within(list).getByText('No reading yet')).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/connection/i)
    expect(text).not.toContain('Agent Harness')
  })
  it('offers usable services with summary and tags, and hides invalid adapters', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Add account' }))
    const picker = screen.getByRole('group', { name: 'Choose a service' })
    expect(within(picker).getByRole('button', { name: /Codex CLI.*Experimental/ })).toBeTruthy()
    expect(within(picker).getByRole('button', { name: /My hub.*Added by you/ })).toBeTruthy()
    expect(within(picker).getByText('Account balance in USD.')).toBeTruthy()
    expect(within(picker).queryByRole('button', { name: /broken/ })).toBeNull()
    fireEvent.click(within(picker).getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('list', { name: 'Accounts' })).toBeTruthy()
  })
  it('saves only the new account without asking for ids and keeps the stored ones', async () => {
    const app = setup()
    await pick(/OpenRouter/)
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
    expect(await screen.findByText('Account saved: Second')).toBeTruthy()
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
    expect(screen.getByText('Turn on Show usage quota to test accounts.')).toBeTruthy()
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
  it('binds a JSON file with one subscription automatically', async () => {
    const app = setup()
    vi.mocked(app.usage.pickFile).mockResolvedValue('C:/data/usage.json')
    vi.mocked(app.usage.inspectFile).mockResolvedValue([
      { id: 'only', providerId: 'hub', label: 'Hub Claude' },
    ])
    await pick(/Custom JSON file/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
    })
    expect(app.usage.inspectFile).toHaveBeenCalledExactlyOnceWith('C:/data/usage.json')
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Hub Claude',
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(vi.mocked(app.usage.saveSettings).mock.calls[0][0].connections[1]).toMatchObject({
      providerId: 'hub',
      config: { path: 'C:/data/usage.json', subscriptionId: 'only' },
    })
  })
  it('asks for a subscription when the file has several and blocks Save until chosen', async () => {
    const app = setup()
    vi.mocked(app.usage.pickFile).mockResolvedValue('C:/data/usage.json')
    vi.mocked(app.usage.inspectFile).mockResolvedValue([
      { id: 'a', providerId: 'pa', label: 'First' },
      { id: 'b', providerId: 'pb', label: 'Second' },
    ])
    await pick(/Custom JSON file/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
    })
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Subscription' }), {
      target: { value: 'b' },
    })
    expect(save.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(save)
    })
    expect(vi.mocked(app.usage.saveSettings).mock.calls[0][0].connections[1]).toMatchObject({
      label: 'Second',
      providerId: 'pb',
      config: { subscriptionId: 'b' },
    })
  })
  it('shows an error and keeps Save blocked for a file without subscriptions', async () => {
    const app = setup()
    vi.mocked(app.usage.pickFile).mockResolvedValue('C:/data/empty.json')
    vi.mocked(app.usage.inspectFile).mockResolvedValue([])
    await pick(/Custom JSON file/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
    })
    expect(screen.getByRole('alert').textContent).toContain('no subscriptions')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('proposes the Claude directory and copies the setup command', async () => {
    const app = setup()
    vi.mocked(app.usage.claudeSetup).mockImplementation(async (id, directory) => ({
      directory: directory ?? `C:/profile/claude-code-usage/${id}`,
      command: `node "setup.cjs" --dir "${directory ?? 'proposed'}"`,
    }))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await pick(/Claude Code/)
    const directory = (await screen.findByDisplayValue(/claude-code-usage/)) as HTMLInputElement
    expect(screen.getByText(/Record each account once on this computer/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }))
    })
    const id = vi.mocked(app.usage.claudeSetup).mock.calls[0][0]
    expect(app.usage.claudeSetup).toHaveBeenLastCalledWith(id, directory.value)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`node "setup.cjs" --dir "${directory.value}"`)
    expect(screen.getByText('Setup command copied.')).toBeTruthy()
  })
  it('saves export settings separately and keeps accounts unchanged', async () => {
    const app = setup()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Write the file' }))
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
  it('shows adapter origin, executable and errors under Advanced and opens the folder', async () => {
    const app = setup()
    const adapters = await screen.findByRole('list', { name: 'Usage adapters' })
    const rows = within(adapters)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(rows).toContain(
      'Claude Code (claude-code-snapshots). Built in. file; window. Executable: Built-in Claude snapshot reader ',
    )
    expect(
      within(adapters).getByText(/Shipped with NeKode\. api; balance\. Executable: C:\/NeKode/),
    ).toBeTruthy()
    expect(
      within(adapters).getByText(/Added by you\. api; window\. Executable: node hub\.cjs/),
    ).toBeTruthy()
    expect(within(adapters).getByText('Invalid usage-adapter.json.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open adapters folder' }))
    })
    expect(app.usage.openAdaptersFolder).toHaveBeenCalledOnce()
  })
})
