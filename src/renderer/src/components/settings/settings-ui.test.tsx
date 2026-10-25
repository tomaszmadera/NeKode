import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaskedKeyControl, SettingsSwitch } from './settings-ui'

describe('SettingsSwitch', () => {
  it('exposes a switch and reports the next value', () => {
    const onChange = vi.fn()
    const view = render(
      <SettingsSwitch id="demo-switch" label="Project icons" checked={false} onChange={onChange} />,
    )
    const control = screen.getByRole('switch', { name: 'Project icons' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)

    view.rerender(
      <SettingsSwitch id="demo-switch" label="Project icons" checked={true} onChange={onChange} />,
    )
    expect(screen.getByRole('switch', { name: 'Project icons' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })
})

describe('MaskedKeyControl', () => {
  it('shows the mask with Change and Clear, then the password field while editing', () => {
    const onEdit = vi.fn()
    const onClear = vi.fn()
    const onValueChange = vi.fn()
    const onCancel = vi.fn()
    const view = render(
      <MaskedKeyControl
        masked="••••••••uPdI"
        value=""
        onValueChange={onValueChange}
        onEdit={onEdit}
        onClear={onClear}
        previewTestId="secret-preview"
        editTestId="secret-change"
        clearTestId="secret-clear"
      />,
    )
    expect(screen.getByTestId('secret-preview').textContent).toContain('••••••••uPdI')
    expect(screen.queryByTestId('secret-input')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(onEdit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledOnce()

    view.rerender(
      <MaskedKeyControl
        masked={null}
        value=""
        inputId="secret-field"
        inputTestId="secret-input"
        onValueChange={onValueChange}
        onEdit={onEdit}
        onCancel={onCancel}
        cancelTestId="secret-cancel"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    const input = screen.getByTestId('secret-input') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'next-key' } })
    expect(onValueChange).toHaveBeenCalledWith('next-key')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
