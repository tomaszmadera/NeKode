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
