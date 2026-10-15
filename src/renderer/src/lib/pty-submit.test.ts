import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUBMIT_GAP_MS, writeSubmitLine } from './pty-submit'

describe('writeSubmitLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete window.NEKODE_PROMPT_SUBMIT_GAP_MS
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.NEKODE_PROMPT_SUBMIT_GAP_MS
  })

  it('writes text immediately and schedules CR after SUBMIT_GAP_MS', () => {
    const writes: string[] = []
    const write = vi.fn((data: string) => {
      writes.push(data)
    })

    writeSubmitLine(write, 'echo hello')

    expect(writes).toEqual(['echo hello'])
    expect(write).toHaveBeenCalledTimes(1)

    // Advance right before the submit gap:
    vi.advanceTimersByTime(SUBMIT_GAP_MS - 1)
    expect(writes).toEqual(['echo hello'])
    expect(write).toHaveBeenCalledTimes(1)

    // Advance to the submit gap:
    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['echo hello', '\r'])
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('cancel suppresses the scheduled CR', () => {
    const write = vi.fn()
    const cancel = writeSubmitLine(write, 'git status')

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('git status')

    cancel()

    // Advance past the gap:
    vi.advanceTimersByTime(SUBMIT_GAP_MS + 100)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalledWith('\r')
  })

  it('does not write empty text initially, only schedules CR after gap', () => {
    const writes: string[] = []
    const write = vi.fn((data: string) => {
      writes.push(data)
    })

    writeSubmitLine(write, '')

    expect(write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SUBMIT_GAP_MS)
    expect(writes).toEqual(['\r'])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('supports custom gapMs', () => {
    const writes: string[] = []
    const write = vi.fn((data: string) => {
      writes.push(data)
    })

    writeSubmitLine(write, 'command', 50)

    expect(writes).toEqual(['command'])

    vi.advanceTimersByTime(49)
    expect(writes).toEqual(['command'])

    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['command', '\r'])
  })

  it('uses window.NEKODE_PROMPT_SUBMIT_GAP_MS override when set', () => {
    window.NEKODE_PROMPT_SUBMIT_GAP_MS = 20
    const writes: string[] = []
    const write = vi.fn((data: string) => {
      writes.push(data)
    })

    writeSubmitLine(write, 'test')

    vi.advanceTimersByTime(19)
    expect(writes).toEqual(['test'])

    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['test', '\r'])
  })
})

describe('writeSubmitLine real timer race and session interleavings (C.3)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    delete window.NEKODE_PROMPT_SUBMIT_GAP_MS
  })

  afterEach(() => {
    delete window.NEKODE_PROMPT_SUBMIT_GAP_MS
  })

  it('runs two concurrent chat sessions independently without crosstalk with real timers (gap=100)', async () => {
    const pendingCancels: Record<string, () => void> = {}
    const sessionWrites: Record<string, string[]> = { 'chat-1': [], 'chat-2': [] }

    function submit(chatId: string, text: string): void {
      pendingCancels[chatId]?.()
      pendingCancels[chatId] = writeSubmitLine(
        (data) => {
          sessionWrites[chatId].push(data)
          if (data === '\r') {
            delete pendingCancels[chatId]
          }
        },
        text,
        100,
      )
    }

    try {
      // Both chats submit concurrently
      submit('chat-1', 'ls -la')
      submit('chat-2', 'git status')

      expect(sessionWrites['chat-1']).toEqual(['ls -la'])
      expect(sessionWrites['chat-2']).toEqual(['git status'])

      // Wait past the 100ms gap
      await new Promise((resolve) => setTimeout(resolve, 140))

      expect(sessionWrites['chat-1']).toEqual(['ls -la', '\r'])
      expect(sessionWrites['chat-2']).toEqual(['git status', '\r'])
      expect(pendingCancels['chat-1']).toBeUndefined()
      expect(pendingCancels['chat-2']).toBeUndefined()
    } finally {
      pendingCancels['chat-1']?.()
      pendingCancels['chat-2']?.()
    }
  })

  it('double-submit in the same session within 100ms cancels first line CR and sets a new timer', async () => {
    const pendingCancels: Record<string, () => void> = {}
    const sessionWrites: Record<string, string[]> = { 'chat-1': [] }

    function submit(chatId: string, text: string): void {
      pendingCancels[chatId]?.()
      pendingCancels[chatId] = writeSubmitLine(
        (data) => {
          sessionWrites[chatId].push(data)
          if (data === '\r') {
            delete pendingCancels[chatId]
          }
        },
        text,
        100,
      )
    }

    try {
      submit('chat-1', 'line 1')
      expect(sessionWrites['chat-1']).toEqual(['line 1'])

      // Submit second line within 100ms (at ~30ms)
      await new Promise((resolve) => setTimeout(resolve, 30))
      submit('chat-1', 'line 2')

      // Second line written immediately; first line's CR was cancelled
      expect(sessionWrites['chat-1']).toEqual(['line 1', 'line 2'])

      // At ~80ms (50ms after second submit, 80ms after first), second CR has not fired yet
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sessionWrites['chat-1']).toEqual(['line 1', 'line 2'])

      // At ~160ms (80ms later, 130ms after second submit), second CR has fired
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(sessionWrites['chat-1']).toEqual(['line 1', 'line 2', '\r'])
      expect(pendingCancels['chat-1']).toBeUndefined()
    } finally {
      pendingCancels['chat-1']?.()
    }
  })
})
