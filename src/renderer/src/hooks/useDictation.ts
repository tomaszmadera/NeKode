import { useEffect, useRef, useState } from 'react'
import type { DictationResult } from '../../../shared/dictation-contract'
import type { AppApi } from '../../../shared/ipc-contract'
import {
  DictationController,
  type DictationState,
  type DictationView,
} from '../lib/dictation/controller'
import { type DictationRecorder, microphoneRecorder } from '../lib/dictation/recorder'

export interface UseDictationOptions {
  api?: AppApi['dictation']
  recorder?: DictationRecorder
  chatId?: string
}

export interface UseDictationReturn {
  state: DictationState
  chatId: string | null
  result: DictationResult | null
  durationSeconds: number
  orphanedTranscripts: DictationResult[]
  isRecording: boolean
  isTranscribing: boolean
  isBusy: boolean
  error: string | null
  warning: string | null
  rawText: string | null
  text: string | null
  hasModifiedTranscript: boolean
  reverted: boolean
  start: (chatId?: string, retrySessionId?: string | null) => Promise<void>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  revertToRaw: () => void
  restoreEdited: () => void
  setActiveChatId: (chatId: string | null) => void
  setTargetMounted: (mounted: boolean) => void
  dismissOrphaned: (sessionId: string) => void
  consumeOrphaned: (chatId: string) => DictationResult | null
  /** Shared across every prompt using this control, so a remounted prompt
      never inserts the same take twice. */
  markInserted: (sessionId: string) => void
  isInserted: (sessionId: string) => boolean
}

export function useDictation(options?: UseDictationOptions): UseDictationReturn {
  const [view, setView] = useState<DictationView>({ state: 'idle', chatId: null, result: null })
  const [reverted, setReverted] = useState(false)
  const controller = useRef<DictationController | null>(null)
  const insertedSessionIds = useRef(new Set<string>())
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const api = options?.api ?? (typeof window !== 'undefined' ? window.app?.dictation : undefined)
    const recorder = options?.recorder ?? microphoneRecorder
    if (!api) return

    const current = new DictationController(api, recorder, (nextView) => {
      setView(nextView)
      if (nextView.result) {
        setReverted(false)
      }
    })
    controller.current = current

    if (optionsRef.current?.chatId) {
      current.setActiveChatId(optionsRef.current.chatId)
    }

    const discard = () => current.dispose()
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', discard)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', discard)
      }
      if (current) {
        current.setTargetMounted(false)
        current.dispose()
      }
      controller.current = null
    }
  }, [options?.api, options?.recorder])

  useEffect(() => {
    if (options?.chatId && controller.current) {
      controller.current.setActiveChatId(options.chatId)
    }
  }, [options?.chatId])

  const hasModifiedTranscript = Boolean(
    view.result?.outcome === 'success' &&
      view.result?.rawText &&
      view.result.rawText.trim() !== view.result.text.trim(),
  )

  const activeRawText = view.result?.rawText ?? null
  const activeText = view.result?.text ?? null

  const isRecording = view.state === 'recording'
  const isTranscribing = view.state === 'transcribing' || view.state === 'post_processing'
  const isBusy = view.state === 'preparing' || isRecording || isTranscribing

  const error = view.result?.error ?? (view.state === 'error' ? 'Dictation error occurred.' : null)

  const warning = view.result?.warning ?? null

  return {
    state: view.state,
    chatId: view.chatId,
    result: view.result,
    durationSeconds: view.durationSeconds ?? 0,
    orphanedTranscripts: view.orphanedTranscripts ?? [],
    isRecording,
    isTranscribing,
    isBusy,
    error,
    warning,
    rawText: activeRawText,
    text: activeText,
    hasModifiedTranscript,
    reverted,
    start: async (chatId?: string, retrySessionId: string | null = null) => {
      const target = chatId ?? optionsRef.current?.chatId ?? ''
      await controller.current?.start(target, retrySessionId)
    },
    stop: async () => {
      await controller.current?.stop()
    },
    cancel: async () => {
      await controller.current?.cancel()
    },
    reset: () => {
      setReverted(false)
      controller.current?.reset()
    },
    revertToRaw: () => {
      setReverted(true)
    },
    restoreEdited: () => {
      setReverted(false)
    },
    setActiveChatId: (chatId: string | null) => {
      controller.current?.setActiveChatId(chatId)
    },
    setTargetMounted: (mounted: boolean) => {
      controller.current?.setTargetMounted(mounted)
    },
    dismissOrphaned: (sessionId: string) => {
      controller.current?.dismissOrphaned(sessionId)
    },
    consumeOrphaned: (chatId: string) => {
      return controller.current?.consumeOrphaned(chatId) ?? null
    },
    markInserted: (sessionId: string) => {
      insertedSessionIds.current.add(sessionId)
    },
    isInserted: (sessionId: string) => insertedSessionIds.current.has(sessionId),
  }
}
