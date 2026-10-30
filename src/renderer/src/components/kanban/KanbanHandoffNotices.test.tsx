import type { AppApi, ResumeSourceBinding, ResumeSourceDiscovery } from '@shared/ipc-contract'
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
import { HandoffNotices, matchesTaskRef, useHandoffAvailability } from './KanbanHandoffNotices'

afterEach(() => {
  cleanup()
})

describe('matchesTaskRef', () => {
  it('matches exact equality case-insensitively', () => {
    expect(matchesTaskRef('NEKODE-2', 'nekode-2')).toBe(true)
    expect(matchesTaskRef('nekode-2', 'NEKODE-2')).toBe(true)
  })

  it('matches prefix followed by a hyphen', () => {
    expect(matchesTaskRef('NEKODE-2', 'nekode-2-stage-3')).toBe(true)
    expect(matchesTaskRef('demo-1', 'DEMO-1-fix-bug')).toBe(true)
  })

  it('rejects numbers that continue without a hyphen', () => {
    expect(matchesTaskRef('NEKODE-2', 'nekode-20')).toBe(false)
    expect(matchesTaskRef('NEKODE-2', 'nekode-21-slug')).toBe(false)
  })

  it('rejects non-prefix or suffix candidates', () => {
    expect(matchesTaskRef('NEKODE-2', 'old-nekode-2')).toBe(false)
    expect(matchesTaskRef('NEKODE-2', 'prefix-nekode-2-notes')).toBe(false)
  })
})

describe('HandoffNotices', () => {
  it('offers Configure Resume, Retry, and named warnings by phase', () => {
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
    expect(screen.getByTestId(TEST_ID.kanbanHandoffNotConfigured).textContent).toContain(
      'No Resume template is configured for this project.',
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffConfigure))
    expect(onConfigureHandoffs).toHaveBeenCalledTimes(1)

    rerender(<HandoffNotices phase="error" error={null} warnings={[]} onRetry={onRetry} />)
    expect(screen.getByTestId(TEST_ID.kanbanHandoffError).textContent).toContain(
      'Failed to discover Resume sources.',
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanHandoffRetry))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <HandoffNotices
        phase="ready"
        error={null}
        warnings={[{ name: 'NK-1.md', path: 'h/NK-1.md', reason: 'Too large' }]}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByTestId(TEST_ID.kanbanHandoffWarnings).textContent).toBe('NK-1.md: Too large')

    rerender(<HandoffNotices phase="ready" error={null} warnings={[]} onRetry={onRetry} />)
    expect(container.textContent).toBe('')
  })
})

describe('useHandoffAvailability', () => {
  it('marks only matching candidates available and coalesces an identical in-flight check', async () => {
    let resolveBinding!: (value: ResumeSourceBinding) => void
    let resolveDiscovery!: (value: ResumeSourceDiscovery) => void
    const binding = vi.fn(
      () =>
        new Promise<ResumeSourceBinding>((yes) => {
          resolveBinding = yes
        }),
    )
    const discover = vi.fn(
      () =>
        new Promise<ResumeSourceDiscovery>((yes) => {
          resolveDiscovery = yes
        }),
    )
    let _changeListener: ((event: unknown) => void) | undefined
    const onChanged = vi.fn((cb: (event: unknown) => void) => {
      _changeListener = cb
      return () => {
        _changeListener = undefined
      }
    })
    const app = {
      resumeSources: { binding, discover, onChanged },
    } as unknown as AppApi
    const { result } = renderHook(() => useHandoffAvailability(app, 'p1'))
    const items = [
      { itemId: 'id-NK-1', ref: 'NK-1' },
      { itemId: 'id-NK-2', ref: 'NK-2' },
    ]
    act(() => {
      void result.current.load(items)
      void result.current.load(items)
    })
    expect(binding).toHaveBeenCalledTimes(1)
    expect(binding).toHaveBeenCalledWith('p1')

    await act(async () => {
      resolveBinding({ projectId: 'p1', templateId: 'tmpl-1' })
    })

    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith('p1', expect.stringMatching(/^kanban-avail-/))

    await act(async () => {
      resolveDiscovery({
        projectId: 'p1',
        templateId: 'tmpl-1',
        revision: 1,
        candidates: [
          {
            token: 'tok-1',
            id: 'nk-1-notes',
            title: 'NK 1 notes',
            displayPath: 'h/nk-1-notes.md',
            modifiedAt: new Date(100).toISOString(),
          },
          {
            token: 'tok-2',
            id: 'nk-20',
            title: 'NK 20 other',
            displayPath: 'h/nk-20.md',
            modifiedAt: new Date(100).toISOString(),
          },
        ],
        rejections: [],
      })
    })
    expect(result.current.phase).toBe('ready')
    expect(result.current.itemResumable(kanbanWorkItem('NK-1', 'A', 's1'))).toBe(true)
    // NK-2 did not match nk-20
    expect(result.current.itemResumable(kanbanWorkItem('NK-2', 'B', 's1'))).toBe(false)

    act(() => {
      result.current.reset()
    })
    expect(result.current.phase).toBe('loading')
    expect(result.current.itemResumable(kanbanWorkItem('NK-1', 'A', 's1'))).toBe(false)
  })

  it('sets not-configured when no template is bound', async () => {
    const binding = vi.fn().mockResolvedValue({ projectId: 'p1', templateId: null })
    const discover = vi.fn()
    const app = {
      resumeSources: { binding, discover, onChanged: vi.fn() },
    } as unknown as AppApi
    const { result } = renderHook(() => useHandoffAvailability(app, 'p1'))

    await act(async () => {
      await result.current.load([{ itemId: 'a', ref: 'A' }])
    })
    expect(result.current.phase).toBe('not-configured')
    expect(discover).not.toHaveBeenCalled()
  })

  it('reports the typed error and ignores a result that a reset made stale', async () => {
    const binding = vi.fn().mockResolvedValue({ projectId: 'p1', templateId: 'tmpl-1' })
    const discover = vi
      .fn()
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'network', message: 'Offline' })
      .mockResolvedValueOnce({
        projectId: 'p1',
        templateId: 'tmpl-1',
        revision: 1,
        candidates: [],
        rejections: [],
      })
    const app = {
      resumeSources: { binding, discover, onChanged: vi.fn() },
    } as unknown as AppApi
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
