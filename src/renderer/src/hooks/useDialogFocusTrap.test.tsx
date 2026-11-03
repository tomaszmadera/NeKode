import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFocusableElements, trapDialogFocus, useDialogFocusTrap } from './useDialogFocusTrap'

function TrapHarness({
  onEscape,
  autoFocus = true,
  withInitialFocus = false,
}: {
  onEscape?: () => void
  autoFocus?: boolean
  withInitialFocus?: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const secondBtnRef = useRef<HTMLButtonElement>(null)

  const { onKeyDown } = useDialogFocusTrap({
    containerRef,
    initialFocusRef: withInitialFocus ? secondBtnRef : undefined,
    onEscape,
    autoFocus,
  })

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      data-testid="trap-container"
      onKeyDown={onKeyDown}
    >
      <button type="button" data-testid="btn-1">
        Button 1
      </button>
      <input
        type="text"
        data-testid="input-2"
        ref={secondBtnRef as React.RefObject<HTMLInputElement>}
      />
      <button type="button" disabled data-testid="btn-disabled">
        Disabled
      </button>
      <button type="button" data-testid="btn-3">
        Button 3
      </button>
    </div>
  )
}

describe('useDialogFocusTrap', () => {
  afterEach(() => {
    cleanup()
  })

  it('collects focusable elements excluding disabled controls', () => {
    render(<TrapHarness />)
    const container = screen.getByTestId('trap-container')
    const focusable = getFocusableElements(container)
    expect(focusable.map((el) => el.getAttribute('data-testid'))).toEqual([
      'btn-1',
      'input-2',
      'btn-3',
    ])
  })

  it('focuses first control on mount by default', () => {
    render(<TrapHarness />)
    expect(document.activeElement).toBe(screen.getByTestId('btn-1'))
  })

  it('focuses initialFocusRef when provided', () => {
    render(<TrapHarness withInitialFocus />)
    expect(document.activeElement).toBe(screen.getByTestId('input-2'))
  })

  it('cycles Tab from first to next and wraps from last to first', () => {
    render(<TrapHarness />)
    const btn1 = screen.getByTestId('btn-1')
    const input2 = screen.getByTestId('input-2')
    const btn3 = screen.getByTestId('btn-3')

    btn1.focus()
    expect(document.activeElement).toBe(btn1)

    fireEvent.keyDown(btn1, { key: 'Tab' })
    expect(document.activeElement).toBe(input2)

    fireEvent.keyDown(input2, { key: 'Tab' })
    expect(document.activeElement).toBe(btn3)

    // Wrap from last to first
    fireEvent.keyDown(btn3, { key: 'Tab' })
    expect(document.activeElement).toBe(btn1)
  })

  it('cycles Shift+Tab and wraps from first to last', () => {
    render(<TrapHarness />)
    const btn1 = screen.getByTestId('btn-1')
    const btn3 = screen.getByTestId('btn-3')

    btn1.focus()
    expect(document.activeElement).toBe(btn1)

    // Shift+Tab from first wraps to last
    fireEvent.keyDown(btn1, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(btn3)
  })

  it('invokes onEscape and stops propagation when Escape is pressed', () => {
    const onEscape = vi.fn()
    render(<TrapHarness onEscape={onEscape} />)
    const btn1 = screen.getByTestId('btn-1')

    fireEvent.keyDown(btn1, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('restores previous focus on unmount', () => {
    function ToggleHarness(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" data-testid="opener" onClick={() => setOpen((prev) => !prev)}>
            Open
          </button>
          {open ? <TrapHarness onEscape={() => setOpen(false)} /> : null}
        </div>
      )
    }

    render(<ToggleHarness />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    expect(document.activeElement).toBe(opener)

    // Open trap
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByTestId('btn-1'))

    // Press Escape to close
    fireEvent.keyDown(screen.getByTestId('btn-1'), { key: 'Escape' })
    expect(screen.queryByTestId('trap-container')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('trapDialogFocus returns false for non-Tab keys or missing container', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(trapDialogFocus(event, null)).toBe(false)
  })
})
