import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { UsageSettings } from './UsageSettings'

afterEach(cleanup)
describe('Usage settings', () => {
  it('keeps the new connection id focused while editing and locks it after save', async () => {
    const app = createAppApiStub()
    vi.mocked(app.usage.saveSettings).mockImplementation(async (settings) => settings)
    render(<UsageSettings app={app} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
    const id = screen.getByRole('textbox', { name: 'Connection id 1' }) as HTMLInputElement
    id.focus()
    fireEvent.change(id, { target: { value: 'first' } })
    expect(screen.getByRole('textbox', { name: 'Connection id 1' })).toBe(id)
    expect(document.activeElement).toBe(id)
    fireEvent.change(id, { target: { value: 'first-account' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save usage settings' }))
    })
    expect(id.disabled).toBe(true)
    expect(id.value).toBe('first-account')
  })
  it('shows the Show usage quota switch off by default and applies a change immediately', async () => {
    const app = createAppApiStub()
    const onSaved = vi.fn()
    render(<UsageSettings app={app} onSaved={onSaved} />)
    const toggle = (await screen.findByRole('switch', {
      name: 'Show usage quota',
    })) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(app.usage.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(app.usage.saveSettings).not.toHaveBeenCalled()
    expect(toggle.checked).toBe(true)
    expect(onSaved).toHaveBeenCalledOnce()
  })
  it('disables Test connection with a visible hint while Show usage quota is off', async () => {
    const app = createAppApiStub()
    render(<UsageSettings app={app} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
    const test = screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement
    expect(test.disabled).toBe(true)
    expect(screen.getByText('Turn on Show usage quota to test connections.')).toBeTruthy()
    fireEvent.click(test)
    expect(app.usage.test).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Show usage quota' }))
    })
    expect(test.disabled).toBe(false)
    expect(screen.queryByText('Turn on Show usage quota to test connections.')).toBeNull()
    await act(async () => {
      fireEvent.click(test)
    })
    expect(app.usage.test).toHaveBeenCalledOnce()
  })
  it('shows the adapter privilege explanation and field help before the Enabled switch', async () => {
    const app = createAppApiStub()
    vi.mocked(app.usage.listAdapters).mockResolvedValue([
      {
        id: 'openrouter-credits',
        name: 'OpenRouter account balance',
        protocolVersion: 1,
        invocation: { command: 'node', args: ['index.cjs'] },
        sourceKind: 'api',
        capabilities: ['balance'],
        minimumRefreshSeconds: 300,
        configSchema: [
          {
            key: 'apiKey',
            label: 'Management key',
            type: 'secret',
            required: true,
            description: 'Stored encrypted; sent only to the credits endpoint.',
          },
          {
            key: 'region',
            label: 'Region',
            type: 'choice',
            choices: ['eu', 'us'],
            description: 'Region help.',
          },
          {
            key: 'verbose',
            label: 'Verbose',
            type: 'boolean',
            description: 'Verbose help.',
          },
        ],
        description: 'A Management key can create and delete API keys for your account.',
        directory: 'C:/fixture/usage-openrouter',
      },
    ])
    render(<UsageSettings app={app} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
    expect(
      screen.queryByText('A Management key can create and delete API keys for your account.'),
    ).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Usage source 1' }), {
      target: { value: 'openrouter-credits' },
    })
    const explanation = screen.getByText(
      'A Management key can create and delete API keys for your account.',
    )
    const help = screen.getByText('Stored encrypted; sent only to the credits endpoint.')
    const key = screen.getByLabelText('Management key 1')
    expect(key.getAttribute('aria-describedby')).toBe(help.id)
    expect(screen.getByLabelText('Region 1').getAttribute('aria-describedby')).toBe(
      screen.getByText('Region help.').id,
    )
    expect(screen.getByLabelText('Verbose 1').getAttribute('aria-describedby')).toBe(
      screen.getByText('Verbose help.').id,
    )
    const enabled = screen.getByRole('checkbox', { name: 'Enabled' })
    expect(
      explanation.compareDocumentPosition(enabled) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
  it('preserves the edited form after a failed save and reports the error', async () => {
    const app = createAppApiStub()
    vi.mocked(app.usage.saveSettings).mockRejectedValue(new Error('Cannot save fixture settings'))
    render(<UsageSettings app={app} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Account label 1' }), {
      target: { value: 'Fixture account' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save usage settings' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Cannot save fixture settings'),
    )
    expect(
      (screen.getByRole('textbox', { name: 'Account label 1' }) as HTMLInputElement).value,
    ).toBe('Fixture account')
    expect(
      (screen.getByRole('textbox', { name: 'Connection id 1' }) as HTMLInputElement).disabled,
    ).toBe(false)
  })
})
