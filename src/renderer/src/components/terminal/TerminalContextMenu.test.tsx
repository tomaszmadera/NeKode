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

  it('focuses the first enabled menu item on mount and traps Tab navigation', () => {
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
        onClose={vi.fn()}
      />,
    )

    const copyBtn = screen.getByTestId(TEST_ID.terminalContextCopy)
    const pasteBtn = screen.getByTestId(TEST_ID.terminalContextPaste)
    const pasteThroughBtn = screen.getByTestId(TEST_ID.terminalContextPasteThroughProgram)
    const selectAllBtn = screen.getByTestId(TEST_ID.terminalContextSelectAll)
    expect((copyBtn as HTMLButtonElement).disabled).toBe(true)
    expect((pasteThroughBtn as HTMLButtonElement).disabled).toBe(true)

    // Copy and Paste-through are disabled, so mount focus lands on Paste.
    expect(document.activeElement).toBe(pasteBtn)

    // Tab skips the disabled Paste-through item and reaches Select All.
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    pasteBtn.dispatchEvent(tabEvent)
    expect(document.activeElement).toBe(selectAllBtn)

    // Shift+Tab from the first enabled item wraps to the last enabled one.
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    pasteBtn.focus()
    pasteBtn.dispatchEvent(shiftTabEvent)
    expect(document.activeElement).toBe(selectAllBtn)
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
