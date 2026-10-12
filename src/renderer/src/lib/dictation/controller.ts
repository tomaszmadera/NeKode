import type { DictationError, DictationResult } from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { type DictationRecorder, type Recording, RecordingFailure } from './recorder'

function transportError(error: unknown): DictationError {
  const payload = parseAppErrorPayload(error)
  if (payload?.code === 'timeout') return 'timeout'
  if (payload?.code === 'auth') return 'auth-failed'
  return 'unreachable'
}

export interface DictationView {
  state: 'idle' | 'preparing' | 'recording' | 'transcribing'
  chatId: string | null
  result: DictationResult | null
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
    if (this.active || this.disposed) return
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
      this.update({ state: 'recording', result: null })
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
    }
  }

  async stop(): Promise<void> {
    const active = this.active
    if (!active?.id || !active.recorder || this.view.state !== 'recording') return
    this.update({ state: 'preparing', result: null })
    let take: { wav: ArrayBuffer; noSpeech: boolean }
    try {
      take = await active.recorder.stop()
      active.recorder = null
    } catch {
      active.recorder = null
      if (this.active === active) await this.fail(active, 'recording-failure')
      return
    }
    if (this.active !== active) return
    if (take.noSpeech) {
      this.finish(this.result(active, 'no-speech'))
      await this.api.cancel(active.id).catch(() => undefined)
      return
    }
    this.update({ state: 'transcribing', result: null })
    try {
      await this.api.audio(active.id, take.wav)
    } catch (error) {
      if (this.active === active) await this.fail(active, transportError(error))
    }
  }

  async cancel(): Promise<void> {
    const active = this.active
    if (active) {
      this.finish(this.result(active, 'cancelled'))
      if (active.id) await this.api.cancel(active.id).catch(() => undefined)
    } else if (this.view.result?.retryable) {
      await this.api.cancel(this.view.result.sessionId).catch(() => undefined)
      this.update({ state: 'idle', result: null })
    }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    void this.cancel()
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
    active?.abort.abort()
    active?.recorder?.discard()
    this.update({ state: 'idle', result })
  }

  private update(view: Omit<DictationView, 'chatId'>): void {
    this.view = { ...view, chatId: this.active?.chatId ?? null }
    if (!this.disposed) this.changed(this.view)
  }
}
