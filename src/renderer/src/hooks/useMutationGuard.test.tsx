import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMutationGuard } from './useMutationGuard'

afterEach(cleanup)

function SharedGuardTestComponent({
  onSave,
  onDelete,
  isCurrent,
}: {
  onSave: () => Promise<void>
  onDelete: () => Promise<void>
  isCurrent?: () => boolean
}): React.JSX.Element {
  const guard = useMutationGuard()
  return (
    <div>
      <button type="button" disabled={guard.busy} onClick={() => void guard.run(onSave, isCurrent)}>
        Save
      </button>
      <button type="button" disabled={guard.busy} onClick={() => void guard.run(onDelete)}>
        Delete
      </button>
      <button type="button" onClick={guard.reset}>
        Reset
      </button>
      <span data-testid="guard-in-flight">{guard.inFlight() ? 'yes' : 'no'}</span>
    </div>
  )
}

describe('useMutationGuard', () => {
  it('enforces mutual exclusion across different buttons sharing the same guard', async () => {
    let resolveSave!: () => void
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    const onSave = vi.fn().mockImplementation(() => savePromise)
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(<SharedGuardTestComponent onSave={onSave} onDelete={onDelete} />)

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const deleteButton = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement

    expect(saveButton.disabled).toBe(false)
    expect(deleteButton.disabled).toBe(false)
    expect(screen.getByTestId('guard-in-flight').textContent).toBe('no')

    // Click Save: initiates Save mutation
    fireEvent.click(saveButton)
    expect(onSave).toHaveBeenCalledOnce()
    expect(saveButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
    expect(screen.getByTestId('guard-in-flight').textContent).toBe('yes')

    // Click Delete while Save is in flight: Delete must be ignored
    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()

    // Resolve Save mutation: both buttons should unlock
    resolveSave()
    await waitFor(() => expect(saveButton.disabled).toBe(false))
    expect(deleteButton.disabled).toBe(false)
    expect(screen.getByTestId('guard-in-flight').textContent).toBe('no')

    // Now clicking Delete succeeds
    fireEvent.click(deleteButton)
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('keeps the guard latched when isCurrent returns false until reset is called', async () => {
    let resolveTask!: () => void
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve
    })
    const onSave = vi.fn().mockImplementation(() => taskPromise)
    const onDelete = vi.fn().mockResolvedValue(undefined)

    // isCurrent returns false when the task settles (simulating superseded run, e.g. project switch)
    let current = true
    render(
      <SharedGuardTestComponent onSave={onSave} onDelete={onDelete} isCurrent={() => current} />,
    )

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const deleteButton = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    const resetButton = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement

    fireEvent.click(saveButton)
    expect(onSave).toHaveBeenCalledOnce()

    // Mark as superseded before task resolves
    current = false
    resolveTask()
    await Promise.resolve()

    // Latched-release contract: release is skipped, so guard remains busy
    expect(saveButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
    expect(screen.getByTestId('guard-in-flight').textContent).toBe('yes')

    // Clicking Delete is still blocked
    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()

    // Explicit reset unlocks the guard
    fireEvent.click(resetButton)
    expect(saveButton.disabled).toBe(false)
    expect(deleteButton.disabled).toBe(false)
    expect(screen.getByTestId('guard-in-flight').textContent).toBe('no')
  })
})
