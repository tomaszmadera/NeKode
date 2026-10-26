import type { AppApi, KanbanHandoffAvailabilityResult } from '@shared/ipc-contract'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { kanbanWorkItem } from '../../test/kanban-fixtures'
import { HandoffNotices, useHandoffAvailability } from './KanbanHandoffNotices'

afterEach(() => {
  cleanup()
})

describe('HandoffNotices', () => {
  it('offers Configure handoffs, Retry, and named warnings by phase', () => {
    const onConfigureHandoffs = vi.fn()
    const onRetry = vi.fn()
    const { rerender, container } = render(
      <HandoffNotices
        phase="not-configured"
        error={null}
        warnings={[]}
        onConfigureHandoffs={onConfigureHandoffs}
        onRetry={onRetry}
      />,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffConfigure))
    expect(onConfigureHandoffs).toHaveBeenCalledTimes(1)

    rerender(<HandoffNotices phase="error" error={null} warnings={[]} onRetry={onRetry} />)
    expect(screen.getByTestId(TEST_ID.kanbanHandoffError).textContent).toContain(
      'Failed to read the handoff directory.',
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffRetry))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <HandoffNotices
        phase="ready"
        error={null}
        warnings={[{ name: 'NK-1.md', path: '/h/NK-1.md', reason: 'Too large' }]}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByTestId(TEST_ID.kanbanHandoffWarnings).textContent).toBe('NK-1.md: Too large')

    rerender(<HandoffNotices phase="ready" error={null} warnings={[]} onRetry={onRetry} />)
    expect(container.textContent).toBe('')
  })
})

describe('useHandoffAvailability', () => {
  it('marks only available items resumable and coalesces an identical in-flight check', async () => {
    let resolve!: (value: KanbanHandoffAvailabilityResult) => void
    const handoffAvailability = vi.fn(
      () =>
        new Promise<KanbanHandoffAvailabilityResult>((yes) => {
          resolve = yes
        }),
    )
    const app = { kanban: { handoffAvailability } } as unknown as AppApi
    const { result } = renderHook(() => useHandoffAvailability(app, 'p1'))
    const items = [
      { itemId: 'id-NK-1', ref: 'NK-1' },
      { itemId: 'id-NK-2', ref: 'NK-2' },
    ]
    act(() => {
      void result.current.load(items)
      void result.current.load(items)
    })
    expect(handoffAvailability).toHaveBeenCalledTimes(1)
    expect(handoffAvailability).toHaveBeenCalledWith({ projectId: 'p1', items })

    await act(async () => {
      resolve({
        state: 'ready',
        items: [
          { itemId: 'id-NK-1', ref: 'NK-1', available: true },
          { itemId: 'id-NK-2', ref: 'NK-2', available: false },
        ],
        rejections: [],
      })
    })
    expect(result.current.phase).toBe('ready')
    expect(result.current.itemResumable(kanbanWorkItem('NK-1', 'A', 's1'))).toBe(true)
    expect(result.current.itemResumable(kanbanWorkItem('NK-2', 'B', 's1'))).toBe(false)

    act(() => {
      result.current.reset()
    })
    expect(result.current.phase).toBe('loading')
    expect(result.current.itemResumable(kanbanWorkItem('NK-1', 'A', 's1'))).toBe(false)
  })

  it('reports the typed error and ignores a result that a reset made stale', async () => {
    const handoffAvailability = vi
      .fn()
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'network', message: 'Offline' })
      .mockResolvedValueOnce({ state: 'not-configured' })
    const app = { kanban: { handoffAvailability } } as unknown as AppApi
    const { result } = renderHook(() => useHandoffAvailability(app, 'p1'))

    await act(async () => {
      await result.current.load([])
    })
    expect(result.current.phase).toBe('error')
    expect(result.current.error).toBe('Offline')

    let pending!: Promise<void>
    act(() => {
      pending = result.current.load([{ itemId: 'a', ref: 'A' }])
      result.current.reset()
    })
    await act(async () => {
      await pending
    })
    await waitFor(() => {
      expect(result.current.phase).toBe('loading')
    })
  })
})
