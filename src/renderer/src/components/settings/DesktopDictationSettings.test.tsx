import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopDictationSettings } from './DesktopDictationSettings'

afterEach(cleanup)
describe('desktop dictation settings', () => {
  it('requires a separate configuration assertion and explains external ownership', () => {
    const onChange = vi.fn(async () => {})
    const setup = { supported: true, settings: { enabled: false, confirmed: false } }
    const view = render(
      <DesktopDictationSettings setup={setup} saving={false} onChange={onChange} />,
    )
    const confirm = screen.getByRole('checkbox', { name: /I confirm/ })
    expect((confirm as HTMLInputElement).disabled).toBe(true)
    // Selecting the method lives in the Dictation method select (AC-014).
    expect(screen.queryByRole('checkbox', { name: 'Enable desktop dictation' })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    view.rerender(
      <DesktopDictationSettings
        setup={{ ...setup, settings: { enabled: true, confirmed: false } }}
        saving={false}
        onChange={onChange}
      />,
    )
    fireEvent.click(confirm)
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, confirmed: true })
    expect(screen.getByText(/pastes into the currently focused field/)).toBeTruthy()
    expect(screen.getByText(/does not confirm recording/)).toBeTruthy()
    expect(screen.getByText(/Cloud mode/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    view.rerender(
      <DesktopDictationSettings
        setup={{ ...setup, supported: false }}
        saving={false}
        onChange={onChange}
      />,
    )
    expect((screen.getByRole('checkbox', { name: /I confirm/ }) as HTMLInputElement).disabled).toBe(
      true,
    )
    expect(screen.getByText('Desktop dictation requires Windows.')).toBeTruthy()
  })
})
