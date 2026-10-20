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
