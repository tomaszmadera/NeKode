import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'
import { playAttentionChime } from './chime'

// The chime module's own contract (attention-alert-settings spec Errors):
// Web Audio missing or failing degrades SILENTLY — no throw, no state, no
// notice. The App/ChatWorkspace suites stub this module; only here does the
// real module run. jsdom has no AudioContext, which is exactly the degrade
// path; the Web Audio path is exercised through a minimal fake context.

interface FakeScheduled {
  setValueAtTime: (value: number, time: number) => void
  exponentialRampToValueAtTime: (value: number, time: number) => void
}

function fakeNode(name: string) {
  const connections: unknown[] = []
  const node: Record<string, unknown> = {
    connect: vi.fn((target: unknown) => {
      connections.push(target)
      return target
    }),
    disconnect: vi.fn(),
    __connections: connections,
    __name: name,
  }
  return node
}

/** Installs a fake AudioContext and returns its recorded calls. */
function installFakeAudioContext(): {
  contexts: Array<Record<string, unknown>>
  uninstall: () => void
} {
  const contexts: Array<Record<string, unknown>> = []
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = fakeNode('destination')
    // One oscillator/gain per context: the module creates one of each, and
    // the test must observe THE instances the module actually started.
    oscillator: Record<string, unknown>
    gain: Record<string, unknown>
    constructor() {
      contexts.push(this as unknown as Record<string, unknown>)
      this.oscillator = this.buildOscillator()
      this.gain = this.buildGain()
    }
    buildOscillator(): Record<string, unknown> {
      const oscillator = fakeNode('oscillator')
      oscillator.frequency = {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      } satisfies FakeScheduled
      oscillator.start = vi.fn()
      oscillator.stop = vi.fn((_time: number) => {
        // The real onended fires asynchronously when the tone ends — well
        // after the module assigns the handler; a microtask mirrors that.
        queueMicrotask(() => {
          const ended = oscillator.onended as (() => void) | null
          if (ended !== null && ended !== undefined) {
            ended()
          }
        })
      })
      oscillator.onended = null
      return oscillator
    }
    buildGain(): Record<string, unknown> {
      const gain = fakeNode('gain')
      gain.gain = {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      } satisfies FakeScheduled
      return gain
    }
    createOscillator(): Record<string, unknown> {
      return this.oscillator
    }
    createGain(): Record<string, unknown> {
      return this.gain
    }
    resume(): Promise<void> {
      return Promise.resolve()
    }
    close = vi.fn((): Promise<void> => Promise.resolve())
  }
  const globalObject = globalThis as unknown as { AudioContext?: unknown }
  const previous = globalObject.AudioContext
  globalObject.AudioContext = FakeAudioContext
  return {
    contexts,
    uninstall: () => {
      if (previous === undefined) {
        delete globalObject.AudioContext
      } else {
        globalObject.AudioContext = previous
      }
    },
  }
}

describe('playAttentionChime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('degrades silently when AudioContext is unavailable (jsdom default)', () => {
    // No AudioContext on globalThis in jsdom: the guard must swallow it.
    expect(() => playAttentionChime()).not.toThrow()
  })

  it('degrades silently when the AudioContext constructor throws', () => {
    const globalObject = globalThis as unknown as { AudioContext?: unknown }
    globalObject.AudioContext = class {
      constructor() {
        throw new Error('no audio device')
      }
    }
    expect(() => playAttentionChime()).not.toThrow()
    delete globalObject.AudioContext
  })

  it('plays one synthesized tone: starts the oscillator into the destination and tears the graph down when it ends', async () => {
    const { contexts, uninstall } = installFakeAudioContext()
    try {
      expect(() => playAttentionChime()).not.toThrow()
      expect(contexts).toHaveLength(1)
      const context = contexts[0] as unknown as {
        oscillator: Record<string, unknown>
        destination: unknown
        close: Mock<() => Promise<void>>
      }
      const oscillator = context.oscillator
      expect(oscillator.start).toHaveBeenCalledTimes(1)
      expect(oscillator.stop).toHaveBeenCalledTimes(1)
      expect(oscillator.connect).toHaveBeenCalledWith(expect.anything())
      // onended lands on a microtask (as in real Web Audio); let it run.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(oscillator.disconnect).toHaveBeenCalled()
      // The per-play context is released when the tone ends.
      expect(context.close).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
  })
})
