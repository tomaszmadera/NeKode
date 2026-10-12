import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { TerminalContextMenu } from './TerminalContextMenu'

describe('TerminalContextMenu', () => {
  afterEach(cleanup)

  it('closes on Escape at the window level and prevents propagation', () => {
    const onClose = vi.fn()
    render(
      <TerminalContextMenu
        x={100}
        y={100}
        hasSelection={false}
        canPasteThroughProgram={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onPasteThroughProgram={vi.fn()}
        onSelectAll={vi.fn()}
        onClose={onClose}
      />,
    )

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('swallows keys typed while focus is outside the context menu', () => {
    const onClose = vi.fn()
    render(
      <TerminalContextMenu
        x={100}
        y={100}
        hasSelection={false}
        canPasteThroughProgram={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onPasteThroughProgram={vi.fn()}
        onSelectAll={vi.fn()}
        onClose={onClose}
      />,
    )

    // A keystroke dispatched on the document / outside the menu (e.g. from an xterm textarea)
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('allows keystrokes when focus is inside the context menu items', () => {
    const onSelectAll = vi.fn()
    render(
      <TerminalContextMenu
        x={100}
        y={100}
        hasSelection={false}
        canPasteThroughProgram={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onPasteThroughProgram={vi.fn()}
        onSelectAll={onSelectAll}
        onClose={vi.fn()}
      />,
    )

    const selectAllBtn = screen.getByTestId(TEST_ID.terminalContextSelectAll)
    selectAllBtn.focus()

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    selectAllBtn.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('clamps left and top coordinates against viewport boundaries', () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

      render(
        <TerminalContextMenu
          x={780}
          y={580}
          hasSelection={false}
          canPasteThroughProgram={false}
          onCopy={vi.fn()}
          onPaste={vi.fn()}
          onPasteThroughProgram={vi.fn()}
          onSelectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const menu = screen.getByTestId(TEST_ID.terminalContextMenu)
      // Clamped against 800 - 220 - 8 = 572, 600 - 150 - 8 = 442
      expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(572)
      expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(442)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })
})
