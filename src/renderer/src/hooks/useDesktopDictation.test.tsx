import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../shared/ipc-contract'
import { createDictationApiStub } from '../test/dictation-api-stub'
import { useDesktopDictation } from './useDesktopDictation'

afterEach(cleanup)
describe('desktop dictation control', () => {
  it('fails closed on load or persistence failure and never cancels an external take on unmount', async () => {
    const dictation = createDictationApiStub()
    const app = { dictation } as AppApi
    vi.mocked(dictation.desktopSetup).mockRejectedValueOnce(new Error('bad stored settings'))
    const failed = renderHook(() => useDesktopDictation(app))
    await waitFor(() => expect(failed.result.current.control.error).toContain('could not load'))
    await act(async () => {
      await failed.result.current.control.activate()
    })
    failed.unmount()
    vi.mocked(dictation.desktopSetup).mockResolvedValue({
      supported: true,
      settings: { enabled: true, confirmed: true },
    })
    const loaded = renderHook(() => useDesktopDictation(app))
    await waitFor(() => expect(loaded.result.current.control.disabledReason).toBeNull())
    vi.mocked(dictation.desktopConfigure).mockRejectedValueOnce(new Error('write failed'))
    await act(async () => {
      await loaded.result.current.configure({ enabled: false, confirmed: false })
    })
    await act(async () => {
      await loaded.result.current.control.activate()
    })
    expect(loaded.result.current.control.disabledReason).toContain('unavailable')
    loaded.unmount()
    expect(dictation.desktopActivate).not.toHaveBeenCalled()
    expect(dictation.cancel).not.toHaveBeenCalled()
  })
  it('restores setup without activating local capture or desktop dispatch, then serializes explicit dispatch only', async () => {
    const dictation = createDictationApiStub()
    vi.mocked(dictation.desktopSetup).mockResolvedValue({
      settings: { enabled: true, confirmed: true },
      supported: true,
    })
    let complete!: () => void
    vi.mocked(dictation.desktopActivate).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const app = { dictation } as AppApi
    const { result } = renderHook(() => useDesktopDictation(app))
    await waitFor(() => expect(result.current.control.disabledReason).toBeNull())
    expect(dictation.desktopActivate).not.toHaveBeenCalled()
    let first!: Promise<void>
    act(() => {
      first = result.current.control.activate()
      void result.current.control.activate()
    })
    expect(result.current.control.busy).toBe(true)
    expect(dictation.desktopActivate).toHaveBeenCalledOnce()
    await act(async () => {
      complete()
      await first
    })
    expect(result.current.control.busy).toBe(false)
    expect(result.current.control.error).toBeNull()
    for (const local of [
      dictation.start,
      dictation.audio,
      dictation.status,
      dictation.testConnection,
      dictation.refreshModels,
      dictation.onResult,
    ])
      expect(local).not.toHaveBeenCalled()
  })
  it('stays disabled before confirmation and reports failure without retry', async () => {
    const dictation = createDictationApiStub()
    const app = { dictation } as AppApi
    const { result } = renderHook(() => useDesktopDictation(app))
    await waitFor(() => expect(result.current.setup.supported).toBe(true))
    await act(async () => {
      await result.current.control.activate()
    })
    expect(dictation.desktopActivate).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.configure({ enabled: true, confirmed: false })
    })
    expect(result.current.control.disabledReason).toContain('Confirm')
    await act(async () => {
      await result.current.configure({ enabled: true, confirmed: true })
    })
    vi.mocked(dictation.desktopActivate).mockRejectedValue(new Error('failure'))
    await act(async () => {
      await result.current.control.activate()
    })
    expect(result.current.control.error).toContain('uncertain')
    expect(result.current.control.busy).toBe(false)
    expect(dictation.desktopActivate).toHaveBeenCalledOnce()
  })
})
