import { AppError } from '@shared/ipc-error'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { HandoffPicker } from './HandoffPicker'

afterEach(cleanup)

function setup() {
  const app = createAppApiStub()
  vi.mocked(app.resumeSources.binding).mockResolvedValue({
    projectId: 'p1',
    templateId: 'agent-harness',
  })
  vi.mocked(app.resumeSources.discover).mockResolvedValue({
    projectId: 'p1',
    templateId: 'agent-harness',
    revision: 1,
    candidates: [
      {
        token: 'tok-a',
        id: 'a',
        title: 'a.md',
        displayPath: 'handoffs/a.md',
        modifiedAt: '2026-10-17T10:00:00Z',
      },
    ],
    rejections: [],
  })
  const props = {
    app,
    projectId: 'p1',
    projectPath: 'D:/code/demo',
    onPick: vi.fn(),
    onClose: vi.fn(),
    onConfigure: vi.fn(),
  }
  return { app, props }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('Resume prompt selection', () => {
  it('composes on selection only, suppresses duplicates, and delivers the prepared prompt unchanged', async () => {
    const { app, props } = setup()
    const response = deferred<string>()
    vi.mocked(app.resumeSources.prepare).mockReturnValueOnce(response.promise)
    render(<HandoffPicker {...props} />)
    const entry = await screen.findByTestId(TEST_ID.handoffPickerEntry)
    expect(app.resumeSources.prepare).not.toHaveBeenCalled()
    fireEvent.click(entry)
    fireEvent.click(entry)
    expect(app.resumeSources.prepare).toHaveBeenCalledExactlyOnceWith(
      'p1',
      'tok-a',
      expect.any(String),
    )
    expect((entry as HTMLButtonElement).disabled).toBe(true)
    expect(props.onPick).not.toHaveBeenCalled()
    await act(async () => response.resolve('Read handoffs/a.md\nFollow project instructions.'))
    expect(props.onPick).toHaveBeenCalledExactlyOnceWith(
      'Read handoffs/a.md\nFollow project instructions.',
    )
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows a recoverable configuration or preparation error without hiding the list', async () => {
    const { app, props } = setup()
    vi.mocked(app.resumeSources.prepare)
      .mockRejectedValueOnce(new AppError('config', 'The candidate changed. Refresh.').toPayload())
      .mockResolvedValueOnce('Fixed template')
    render(<HandoffPicker {...props} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    expect((await screen.findByRole('alert')).textContent).toBe('The candidate changed. Refresh.')
    expect(props.onPick).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.handoffPickerEntry) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByTestId(TEST_ID.handoffPickerEntry))
    await waitFor(() => expect(props.onPick).toHaveBeenCalledWith('Fixed template'))
    expect(app.resumeSources.prepare).toHaveBeenCalledTimes(2)
  })

  it.each(['close', 'escape', 'backdrop', 'unmount', 'project'])(
    'ignores a pending response after %s',
    async (change) => {
      const { app, props } = setup()
      const response = deferred<string>()
      vi.mocked(app.resumeSources.prepare).mockReturnValueOnce(response.promise)
      const view = render(<HandoffPicker {...props} />)
      fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
      if (change === 'close')
        fireEvent.click(screen.getByRole('button', { name: 'Close handoff picker' }))
      if (change === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
      if (change === 'backdrop') {
        fireEvent.mouseDown(screen.getByTestId(TEST_ID.handoffPicker).parentElement as HTMLElement)
      }
      if (change === 'unmount') view.unmount()
      if (change === 'project') view.rerender(<HandoffPicker {...props} projectId="p2" />)
      await act(async () => response.resolve('Stale template'))
      expect(props.onPick).not.toHaveBeenCalled()
    },
  )

  it('ignores an old failure after project change while a new selection is pending', async () => {
    const { app, props } = setup()
    const first = deferred<string>()
    const second = deferred<string>()
    vi.mocked(app.resumeSources.prepare)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const view = render(<HandoffPicker {...props} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    view.rerender(<HandoffPicker {...props} projectId="p2" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    await act(async () => first.reject(new Error('Old error')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByTestId(TEST_ID.handoffPickerEntry) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await act(async () => second.resolve('Current template'))
    expect(props.onPick).toHaveBeenCalledExactlyOnceWith('Current template')
  })

  it('shows unconfigured state with configure button and no pathless Resume fallback', async () => {
    const { app, props } = setup()
    vi.mocked(app.resumeSources.binding).mockResolvedValue({ projectId: 'p1', templateId: null })
    render(<HandoffPicker {...props} />)
    await screen.findByTestId(TEST_ID.handoffPickerUnconfigured)
    expect(screen.queryByTestId(TEST_ID.handoffPickerPlainPaste)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.handoffPickerConfigure))
    expect(props.onConfigure).toHaveBeenCalledOnce()
    expect(app.resumeSources.discover).not.toHaveBeenCalled()
  })
})
