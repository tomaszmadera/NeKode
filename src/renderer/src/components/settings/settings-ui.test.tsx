import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSwitch } from './settings-ui'

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
