import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders title, body, and buttons with initial focus on confirm', () => {
    render(
      <ConfirmDialog
        title="Delete project"
        body="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('Delete project')).toBeTruthy()
    expect(screen.getByText('Are you sure?')).toBeTruthy()
    const confirmBtn = screen.getByTestId(TEST_ID.confirmDialogConfirm)
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('closes on Escape or backdrop click', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog
        title="Title"
        body="Body"
        confirmLabel="OK"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    const confirmBtn = screen.getByTestId(TEST_ID.confirmDialogConfirm)
    fireEvent.keyDown(confirmBtn, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    // Backdrop click
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.mouseDown(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('triggers onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Title"
        body="Body"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('restores focus to opener on unmount', () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" data-testid="opener" onClick={() => setOpen((prev) => !prev)}>
            Open Dialog
          </button>
          {open ? (
            <ConfirmDialog
              title="Title"
              body="Body"
              confirmLabel="OK"
              onConfirm={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          ) : null}
        </div>
      )
    }

    render(<Harness />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.confirmDialogConfirm))

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
