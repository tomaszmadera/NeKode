import { describe, expect, it, vi } from 'vitest'
import type { DictationResult } from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'
import { DictationController, type DictationView } from './controller'
import { encodeWav } from './wav'

function harness(noSpeech = false) {
  let listener!: (result: DictationResult) => void
  const api = {
    start: vi.fn(async () => ({ sessionId: 'session', error: null })),
    audio: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    onResult: (callback: (result: DictationResult) => void) => {
      listener = callback
      return vi.fn()
    },
  } as unknown as AppApi['dictation']
  const recording = {
    discard: vi.fn(),
    stop: vi.fn(async () => ({
      wav: encodeWav([new Float32Array(8000).fill(0.2)], 16000).wav,
      noSpeech,
    })),
  }
  const recorder = { start: vi.fn(async () => recording) }
  const states: DictationView[] = []
  const controller = new DictationController(api, recorder, (view) => states.push(view))
  const emit = (patch: Partial<DictationResult> = {}) =>
    listener({
      sessionId: 'session',
      chatId: 'chat',
      outcome: 'success',
      text: 'hello',
      warning: null,
      error: null,
      retryable: false,
      ...patch,
    })
  return { api, recording, recorder, controller, states, emit }
}

describe('renderer dictation controller', () => {
  it('preserves normalized start errors and ignores an early result from another session', async () => {
    const h = harness()
    ;(h.api.start as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      h.emit({ sessionId: 'old' })
      return { sessionId: null, error: 'no-model' }
    })
    await h.controller.start('chat')
    expect(h.states.at(-1)?.result?.error).toBe('no-model')
    expect(h.recorder.start).not.toHaveBeenCalled()
    h.controller.dispose()
  })
  it('receives a same-take retry result even before start IPC settles', async () => {
    const h = harness()
    ;(h.api.start as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      h.emit()
      return { sessionId: 'session', error: null }
    })
    await h.controller.start('chat', 'timed-out')
    expect(h.states.at(-1)?.result?.text).toBe('hello')
    expect(h.recorder.start).not.toHaveBeenCalled()
    h.controller.dispose()
  })
  it('records only on explicit start, submits once and consumes a result once', async () => {
    const h = harness()
    expect(h.recorder.start).not.toHaveBeenCalled()
    await h.controller.start('chat')
    await h.controller.start('another')
    expect(h.api.start).toHaveBeenCalledTimes(1)
    expect(h.states.at(-1)?.state).toBe('recording')
    await h.controller.stop()
    await h.controller.stop()
    expect(h.api.audio).toHaveBeenCalledTimes(1)
    h.emit()
    const count = h.states.length
    h.emit()
    expect(h.states).toHaveLength(count)
    expect(h.states.at(-1)?.result?.text).toBe('hello')
    h.controller.dispose()
  })
  it('gates short/silent takes without audio IPC', async () => {
    const h = harness(true)
    await h.controller.start('chat')
    await h.controller.stop()
    expect(h.api.audio).not.toHaveBeenCalled()
    expect(h.api.cancel).toHaveBeenCalledWith('session')
    expect(h.states.at(-1)?.result?.outcome).toBe('no-speech')
    h.controller.dispose()
  })
  it('releases microphone and discards late results on cancellation and shutdown', async () => {
    const h = harness()
    await h.controller.start('chat')
    await h.controller.cancel()
    expect(h.recording.discard).toHaveBeenCalled()
    h.emit()
    expect(h.states.at(-1)?.result?.outcome).toBe('cancelled')
    await h.controller.start('chat')
    h.controller.dispose()
    expect(h.api.cancel).toHaveBeenCalledTimes(2)
  })
  it('settles permission denial and a late microphone grant after cancellation', async () => {
    const h = harness()
    h.recorder.start.mockRejectedValueOnce(new Error('denied'))
    await h.controller.start('chat')
    expect(h.states.at(-1)?.result?.error).toBe('microphone-unavailable')
    let resolve!: (value: typeof h.recording) => void
    h.recorder.start.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = h.controller.start('chat')
    await vi.waitFor(() => expect(h.recorder.start).toHaveBeenCalledTimes(2))
    await h.controller.cancel()
    resolve(h.recording)
    await pending
    expect(h.recording.discard).toHaveBeenCalled()
    h.controller.dispose()
  })
  it('tolerates api.cancel rejections across cancel, dispose, and failure paths without unhandled rejection', async () => {
    const h = harness()
    ;(h.api.cancel as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cancel transport failed'),
    )
    await h.controller.start('chat')
    // Cancelling while active: api.cancel rejection must not escape
    await expect(h.controller.cancel()).resolves.toBeUndefined()
    expect(h.states.at(-1)?.result?.outcome).toBe('cancelled')

    // Disposing: void this.cancel() must not throw unhandled rejection
    await h.controller.start('chat')
    expect(() => h.controller.dispose()).not.toThrow()
  })
  it('maps api.start rejections to transport error rather than recording-failure', async () => {
    const h = harness()
    ;(h.api.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('start IPC failed'))
    await h.controller.start('chat')
    expect(h.states.at(-1)?.result?.outcome).toBe('failed')
    expect(h.states.at(-1)?.result?.error).toBe('unreachable')
    expect(h.recorder.start).not.toHaveBeenCalled()
    h.controller.dispose()
  })
  it('maps api.audio rejections to transport error rather than recording-failure', async () => {
    const h = harness()
    ;(h.api.audio as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('audio IPC failed'))
    await h.controller.start('chat')
    await h.controller.stop()
    expect(h.states.at(-1)?.result?.outcome).toBe('failed')
    expect(h.states.at(-1)?.result?.error).toBe('unreachable')
    h.controller.dispose()
  })
})
