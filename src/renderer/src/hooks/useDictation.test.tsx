import { type DictationResult, isDictationResult } from '@shared/dictation-contract'
import type { AppApi } from '@shared/ipc-contract'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeWav } from '../lib/dictation/wav'
import { useDictation } from './useDictation'

afterEach(cleanup)

function createMockHarness() {
  let resultListener!: (result: DictationResult) => void
  const api = {
    start: vi.fn(async () => ({ sessionId: 'session-123', error: null })),
    audio: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    onResult: vi.fn((callback: (result: DictationResult) => void) => {
      resultListener = callback
      return vi.fn()
    }),
  } as unknown as AppApi['dictation']

  const recording = {
    discard: vi.fn(),
    stop: vi.fn(async () => ({
      wav: encodeWav([new Float32Array(8000).fill(0.2)], 16000).wav,
      noSpeech: false,
    })),
  }

  const recorder = {
    start: vi.fn(async () => recording),
  }

  const emit = (patch: Partial<DictationResult> = {}) => {
    resultListener({
      sessionId: 'session-123',
      chatId: 'chat-1',
      outcome: 'success',
      text: 'hello dictation',
      warning: null,
      error: null,
      retryable: false,
      ...patch,
    })
  }

  return { api, recording, recorder, emit }
}

describe('useDictation hook', () => {
  it('initializes in idle state with no active recording', () => {
    const { api, recorder } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    expect(result.current.state).toBe('idle')
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isTranscribing).toBe(false)
    expect(result.current.isBusy).toBe(false)
    expect(result.current.result).toBeNull()
    expect(result.current.orphanedTranscripts).toEqual([])
  })

  it('starts recording and transitions state to recording', async () => {
    const { api, recorder } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start()
    })

    expect(api.start).toHaveBeenCalledWith('chat-1', null)
    expect(recorder.start).toHaveBeenCalled()
    expect(result.current.state).toBe('recording')
    expect(result.current.isRecording).toBe(true)
    expect(result.current.isBusy).toBe(true)
  })

  it('stops recording and transitions to transcribing, then receives result', async () => {
    const { api, recorder, recording, emit } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      await result.current.stop()
    })

    expect(recording.stop).toHaveBeenCalled()
    expect(api.audio).toHaveBeenCalledWith('session-123', expect.any(ArrayBuffer))
    expect(result.current.state).toBe('transcribing')
    expect(result.current.isTranscribing).toBe(true)

    act(() => {
      emit({ text: 'transcribed message' })
    })

    expect(result.current.state).toBe('idle')
    expect(result.current.isTranscribing).toBe(false)
    expect(result.current.text).toBe('transcribed message')
    expect(result.current.result?.text).toBe('transcribed message')
  })

  it('cancels recording on cancel()', async () => {
    const { api, recorder, recording } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      await result.current.cancel()
    })

    expect(recording.discard).toHaveBeenCalled()
    expect(api.cancel).toHaveBeenCalledWith('session-123')
    expect(result.current.state).toBe('cancelled')
  })

  it('detects modified transcript and handles revert/restore (AC-010)', async () => {
    const { api, recorder, emit } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start()
      await result.current.stop()
    })

    act(() => {
      emit({
        text: 'Formatted technical phrase.',
        rawText: 'formatted technical phrase',
        editedText: 'Formatted technical phrase.',
      })
    })

    expect(result.current.hasModifiedTranscript).toBe(true)
    expect(result.current.rawText).toBe('formatted technical phrase')
    expect(result.current.text).toBe('Formatted technical phrase.')
    expect(result.current.reverted).toBe(false)

    act(() => {
      result.current.revertToRaw()
    })
    expect(result.current.reverted).toBe(true)

    act(() => {
      result.current.restoreEdited()
    })
    expect(result.current.reverted).toBe(false)
  })

  it('handles target loss protection when active chat switches (AC-013)', async () => {
    const { api, recorder, emit } = createMockHarness()
    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start('chat-1')
      await result.current.stop()
    })

    expect(result.current.state).toBe('transcribing')

    // Switch active chat to chat-2
    act(() => {
      result.current.setActiveChatId('chat-2')
    })

    // Result arrives for chat-1
    act(() => {
      emit({ chatId: 'chat-1', text: 'Preserved background transcript' })
    })

    // Active result is null to prevent injecting into chat-2
    expect(result.current.result).toBeNull()
    expect(result.current.orphanedTranscripts).toHaveLength(1)
    expect(result.current.orphanedTranscripts[0].text).toBe('Preserved background transcript')

    // Consuming returns the saved transcript
    let consumed: DictationResult | null = null
    act(() => {
      consumed = result.current.consumeOrphaned('chat-1')
    })
    expect((consumed as DictationResult | null)?.text).toBe('Preserved background transcript')
    expect(result.current.orphanedTranscripts).toHaveLength(0)
  })

  it('handles errors during dictation and exposes error status', async () => {
    const { api, recorder } = createMockHarness()
    ;(api.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: null,
      error: 'microphone-unavailable',
    })

    const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('microphone-unavailable')
  })

  it.each([
    ['cloud-consent-required', 'Settings'],
    ['plan-required', 'Pro or Business'],
    ['forbidden', 'scope'],
    ['audio-rejected', 'new take'],
    ['audio-too-large', 'shorter take'],
    ['concurrency-limit', 'Wait'],
    ['quota-exceeded', 'renewal'],
    ['rate-limited', 'Wait'],
    ['service-unavailable', 'later'],
    ['provider-failure', 'later'],
    ['auth-failed', 'Settings'],
    ['malformed-response', 'invalid response'],
    ['timeout', 'timed out'],
    ['unreachable', 'connection'],
  ] as const)(
    'accepts and presents actionable Cloud %s results, settling busy state',
    async (error, message) => {
      const { api, recorder, emit } = createMockHarness()
      const { result } = renderHook(() => useDictation({ api, recorder, chatId: 'chat-1' }))
      await act(async () => {
        await result.current.start()
        await result.current.stop()
      })
      const failure: DictationResult = {
        sessionId: 'session-123',
        chatId: 'chat-1',
        outcome: 'failed',
        text: '',
        warning: null,
        error,
        retryable: false,
        providerId: 'openwhispr-cloud',
      }
      expect(isDictationResult(failure)).toBe(true)
      act(() => emit(failure))
      expect(result.current.isBusy).toBe(false)
      expect(result.current.state).toBe('error')
      expect(result.current.error).toContain(message)
    },
  )
})
