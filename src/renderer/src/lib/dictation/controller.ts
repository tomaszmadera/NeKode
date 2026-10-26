import type { DictationError, DictationResult } from '@shared/dictation-contract'
import type { AppApi } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { type DictationRecorder, type Recording, RecordingFailure } from './recorder'

function transportError(error: unknown): DictationError {
  const payload = parseAppErrorPayload(error)
  if (payload?.code === 'timeout') return 'timeout'
  if (payload?.code === 'auth') return 'auth-failed'
  return 'unreachable'
}

export type DictationState =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'transcribing'
  | 'post_processing'
  | 'error'
  | 'cancelled'

export interface DictationView {
  state: DictationState
  chatId: string | null
  result: DictationResult | null
  orphanedTranscripts?: DictationResult[]
  durationSeconds?: number
}

interface Active {
  id: string | null
  chatId: string
  abort: AbortController
  recorder: Recording | null
}

/** One app-level controller, mounted by useDictation in the UX stage. */
export class DictationController {
  private active: Active | null = null
  private pending: DictationResult | null = null
  private readonly unsubscribe: () => void
  private disposed = false
  private starting = false
  private stopping = false
  private activeChatId: string | null = null
  private targetMounted = true
  private orphanedTranscripts: DictationResult[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private recordingStartTime = 0
  private view: DictationView = { state: 'idle', chatId: null, result: null }

  constructor(
    private readonly api: AppApi['dictation'],
    private readonly recorder: DictationRecorder,
    private readonly changed: (view: DictationView) => void,
  ) {
    this.unsubscribe = api.onResult((result) => {
      const active = this.active
      if (!active) return
      if (active.id === null) {
        this.pending = result
        return
      }
      if (active.id === result.sessionId) this.finish(result)
    })
  }

  async start(chatId: string, retrySessionId: string | null = null): Promise<void> {
    if (this.starting || this.stopping || this.active || this.disposed) return
    this.starting = true
    const active: Active = { id: null, chatId, abort: new AbortController(), recorder: null }
    this.active = active
    this.update({ state: 'preparing', result: null })
    try {
      const started = await this.api.start(chatId, retrySessionId)
      active.id = started.sessionId
      if (this.active !== active) {
        if (active.id) await this.api.cancel(active.id).catch(() => undefined)
        return
      }
      if (started.error) {
        this.finish({ ...this.result(active, 'failed'), error: started.error })
        return
      }
      if (!active.id) {
        this.active = null
        this.update({ state: 'idle', result: null })
        return
      }
      const pending = this.pending
      this.pending = null
      if (pending?.sessionId === active.id) {
        this.finish(pending)
        return
      }
      if (retrySessionId) {
        this.update({ state: 'transcribing', result: null })
        return
      }
      active.recorder = await this.recorder.start(active.abort.signal, () => {
        if (this.active === active) void this.fail(active, 'recording-failure')
      })
      if (this.active !== active) {
        active.recorder.discard()
        return
      }
      this.recordingStartTime = Date.now()
      this.startTimer()
      this.update({ state: 'recording', result: null, durationSeconds: 0 })
    } catch (error) {
      if (this.active === active)
        await this.fail(
          active,
          error instanceof RecordingFailure
            ? 'recording-failure'
            : active.id
              ? 'microphone-unavailable'
              : transportError(error),
        )
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    const active = this.active
    if (
      this.stopping ||
      this.starting ||
      !active?.id ||
      !active.recorder ||
      this.view.state !== 'recording'
    )
      return
    this.stopping = true
    this.stopTimer()
    this.update({ state: 'preparing', result: null })
    let take: { wav: ArrayBuffer; noSpeech: boolean }
    try {
      take = await active.recorder.stop()
      active.recorder = null
    } catch {
      active.recorder = null
      this.stopping = false
      if (this.active === active) await this.fail(active, 'recording-failure')
      return
    }
    if (this.active !== active) {
      this.stopping = false
      return
    }
    if (take.noSpeech) {
      this.stopping = false
      this.finish(this.result(active, 'no-speech'))
      await this.api.cancel(active.id).catch(() => undefined)
      return
    }
    this.update({ state: 'transcribing', result: null })
    try {
      await this.api.audio(active.id, take.wav)
    } catch (error) {
      if (this.active === active) await this.fail(active, transportError(error))
    } finally {
      this.stopping = false
    }
  }

  async cancel(): Promise<void> {
    this.stopTimer()
    this.starting = false
    this.stopping = false
    const active = this.active
    if (active) {
      this.finish(this.result(active, 'cancelled'))
      if (active.id) await this.api.cancel(active.id).catch(() => undefined)
    } else if (this.view.result?.retryable) {
      await this.api.cancel(this.view.result.sessionId).catch(() => undefined)
      this.update({ state: 'idle', result: null })
    }
  }

  setActiveChatId(chatId: string | null): void {
    this.activeChatId = chatId
  }

  setTargetMounted(mounted: boolean): void {
    this.targetMounted = mounted
  }

  dismissOrphaned(sessionId: string): void {
    this.orphanedTranscripts = this.orphanedTranscripts.filter((t) => t.sessionId !== sessionId)
    this.update({ state: this.view.state, result: this.view.result })
  }

  consumeOrphaned(chatId: string): DictationResult | null {
    const index = this.orphanedTranscripts.findIndex((t) => t.chatId === chatId)
    if (index === -1) return null
    const [found] = this.orphanedTranscripts.splice(index, 1)
    this.update({ state: this.view.state, result: this.view.result })
    return found
  }

  setPostProcessing(): void {
    if (this.active) {
      this.update({ state: 'post_processing', result: null })
    }
  }

  reset(): void {
    this.stopTimer()
    this.update({ state: 'idle', result: null })
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
    this.unsubscribe()
    void this.cancel()
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (this.view.state === 'recording' && !this.disposed) {
        const durationSeconds = Math.max(
          0,
          Math.floor((Date.now() - this.recordingStartTime) / 1000),
        )
        this.update({ state: 'recording', result: null, durationSeconds })
      }
    }, 1000)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async fail(active: Active, error: DictationError): Promise<void> {
    this.finish({ ...this.result(active, 'failed'), error })
    if (active.id) await this.api.cancel(active.id).catch(() => undefined)
  }

  private result(active: Active, outcome: DictationResult['outcome']): DictationResult {
    return {
      sessionId: active.id ?? '',
      chatId: active.chatId,
      outcome,
      text: '',
      warning: null,
      error: null,
      retryable: false,
    }
  }

  private finish(result: DictationResult): void {
    const active = this.active
    this.active = null
    this.pending = null
    this.stopTimer()
    this.starting = false
    this.stopping = false
    active?.abort.abort()
    active?.recorder?.discard()

    // Target loss protection (AC-013):
    const targetLost =
      result.outcome === 'success' &&
      result.text.length > 0 &&
      ((this.activeChatId !== null && this.activeChatId !== result.chatId) || !this.targetMounted)

    if (targetLost) {
      this.orphanedTranscripts.push(result)
      this.update({ state: 'idle', result: null })
      return
    }

    let state: DictationState = 'idle'
    if (result.outcome === 'failed') state = 'error'
    else if (result.outcome === 'cancelled') state = 'cancelled'
    this.update({ state, result })
  }

  private update(view: Omit<DictationView, 'chatId'>): void {
    const next: DictationView = {
      state: view.state,
      chatId: this.active?.chatId ?? null,
      result: view.result,
    }
    if (view.durationSeconds !== undefined && view.state === 'recording') {
      next.durationSeconds = view.durationSeconds
    }
    if (this.orphanedTranscripts.length > 0) {
      next.orphanedTranscripts = [...this.orphanedTranscripts]
    }
    this.view = next
    if (!this.disposed) this.changed(this.view)
  }
}
