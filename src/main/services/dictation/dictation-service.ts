import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DictationResult,
  DictationSettings,
  DictationStart,
} from '../../../shared/dictation-contract'
import { isDictationWav } from '../../../shared/dictation-contract'
import { AppError } from '../../../shared/ipc-error'
import type { OpenWhisprClient } from './openwhispr-client'

interface Session {
  id: string
  chatId: string
  state: 'recording' | 'transcribing'
  settings: DictationSettings
  abort: AbortController
  wav: ArrayBuffer | null
  path: string | null
  retried: boolean
  warning: string | null
  warningKey: string | null
}

const generatedWav = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.wav$/

/** Only ESRCH proves absence. Access denied and reused PIDs retain their files. */
function ownerExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
  }
}

/** Owns exactly one take. Paths and audio never enter renderer results or logs. */
export class DictationService {
  private active: Session | null = null
  private retry: Session | null = null
  private readonly listeners = new Set<(result: DictationResult) => void>()
  private readonly warnedSelections = new Set<string>()
  private readonly directory: string
  private closed = false

  constructor(
    private readonly client: OpenWhisprClient,
    root = join(tmpdir(), 'nekode-dictation'),
    isOwnerExited: (pid: number) => boolean = ownerExited,
  ) {
    this.directory = join(root, `${process.pid}-${randomUUID()}`)
    try {
      mkdirSync(root, { recursive: true })
      const stats = lstatSync(root)
      if (!stats.isDirectory() || stats.isSymbolicLink())
        throw new Error('Invalid temporary directory')
      for (const owner of readdirSync(root)) {
        const match = /^([1-9]\d*)-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.exec(
          owner,
        )
        if (!match || !Number.isSafeInteger(Number(match[1])) || !isOwnerExited(Number(match[1])))
          continue
        const directory = join(root, owner)
        try {
          const ownerStats = lstatSync(directory)
          if (!ownerStats.isDirectory() || ownerStats.isSymbolicLink()) continue
          for (const file of readdirSync(directory)) {
            const path = join(directory, file)
            if (generatedWav.test(file) && lstatSync(path).isFile()) unlinkSync(path)
          }
          if (readdirSync(directory).length === 0) rmdirSync(directory)
        } catch (error) {
          // Another startup can sweep this same exited owner after discovery.
          if (
            !(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ENOENT'
            )
          )
            throw error
        }
      }
      mkdirSync(this.directory)
    } catch {
      throw new AppError('unknown', 'Dictation temporary storage is unavailable.')
    }
  }

  onResult(listener: (result: DictationResult) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(chatId: string, retrySessionId: string | null): DictationStart {
    if (this.closed || this.active) return { sessionId: null, error: null }
    const settings = this.client.getSettings()
    if (!settings.enabled) return { sessionId: null, error: 'disabled' }
    const state = this.client.status().state
    if (state !== 'operational')
      return {
        sessionId: null,
        error: state === 'connected' || state === 'model-available' ? 'no-model' : state,
      }
    const previous =
      retrySessionId !== null &&
      this.retry?.id === retrySessionId &&
      this.retry.chatId === chatId &&
      !this.retry.retried
        ? this.retry
        : null
    if (retrySessionId !== null && !previous)
      throw new AppError('validation', 'This dictation take cannot be retried.')
    this.retry = null
    const stale =
      this.client.status().staleModelSelection && settings.model !== 'default'
        ? JSON.stringify(settings.model)
        : null
    const warning =
      stale && !this.warnedSelections.has(stale)
        ? 'The selected OpenWhispr model is unavailable. Using the OpenWhispr default.'
        : null
    const session: Session = {
      id: randomUUID(),
      chatId,
      state: 'recording',
      settings: previous?.settings ?? settings,
      abort: new AbortController(),
      wav: previous?.wav ?? null,
      path: null,
      retried: previous !== null,
      warning,
      warningKey: stale,
    }
    this.active = session
    if (previous && session.wav)
      queueMicrotask(() => {
        void this.audio(session.id, session.wav as ArrayBuffer)
      })
    return { sessionId: session.id, error: null }
  }

  async audio(id: string, wav: ArrayBuffer): Promise<void> {
    const session = this.active
    if (!session || session.id !== id || session.state !== 'recording') return
    if (!isDictationWav(wav))
      throw new AppError('validation', 'Dictation audio must be mono 16 kHz PCM WAV.')
    session.state = 'transcribing'
    session.wav = wav.slice(0)
    let result: DictationResult = this.result(session, 'failed', 'recording-failure')
    try {
      session.path = join(this.directory, `${randomUUID()}.wav`)
      writeFileSync(session.path, Buffer.from(wav), { flag: 'wx' })
      const response = await this.client.transcribe(
        session.path,
        session.settings,
        session.abort.signal,
      )
      if (this.active !== session) return
      if (response.error === 'cancelled') result = this.result(session, 'cancelled')
      else if (response.error) {
        result = this.result(session, 'failed', response.error)
        if (response.error === 'timeout' && !session.retried) {
          result.retryable = true
          this.retry = session
        }
      } else {
        result = this.result(session, response.text.length ? 'success' : 'no-speech')
        result.text = response.text
        result.warning = [session.warning, response.warning].filter(Boolean).join('\n') || null
      }
    } catch {
      // Filesystem errors may contain temporary paths. Only a normalized result escapes.
      result = this.result(session, 'failed', 'recording-failure')
    } finally {
      if (!this.cleanup(session)) {
        result = this.result(session, 'failed', 'recording-failure')
        this.retry = null
      }
      if (this.active === session) {
        this.active = null
        if (this.retry !== session) session.wav = null
        if (session.warningKey && result.warning) this.warnedSelections.add(session.warningKey)
        this.emit(result)
      }
    }
  }

  cancel(id: string): void {
    if (this.retry?.id === id) {
      this.retry.wav = null
      this.retry = null
    }
    const session = this.active
    if (!session || session.id !== id) return
    this.active = null
    session.abort.abort()
    session.wav = null
    const cleaned = this.cleanup(session)
    this.emit(
      this.result(session, cleaned ? 'cancelled' : 'failed', cleaned ? null : 'recording-failure'),
    )
  }

  shutdown(): void {
    this.closed = true
    this.discard()
  }

  discard(): void {
    if (this.active) this.cancel(this.active.id)
    if (this.retry) {
      this.retry.wav = null
      this.retry = null
    }
  }

  private cleanup(session: Session): boolean {
    if (session.path === null) return true
    try {
      unlinkSync(session.path)
      session.path = null
      return true
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        session.path = null
        return true
      }
      return false
    }
  }

  private result(
    session: Session,
    outcome: DictationResult['outcome'],
    error: DictationResult['error'] = null,
  ): DictationResult {
    return {
      sessionId: session.id,
      chatId: session.chatId,
      outcome,
      error,
      text: '',
      warning: outcome === 'cancelled' ? null : session.warning,
      retryable: false,
    }
  }

  private emit(result: DictationResult): void {
    for (const listener of this.listeners) listener(result)
  }
}
