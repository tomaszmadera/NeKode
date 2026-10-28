import type { DictationResult } from '@shared/contracts/dictation-contract'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopDictationControl } from '../../hooks/useDesktopDictation'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { OrphanedTranscriptBanner } from './OrphanedTranscriptBanner'

// Chat terminal actions. Text is pasted into the console; Send presses Enter.

/** External draft fill (Handoff/Resume paste, spec handoff-resume-flow): the
    nonce lets the same text re-inject and the host drop exactly this fill. */
export interface PromptInjection {
  text: string
  nonce: number
}

export interface UnifiedDictationControl {
  state: import('../../lib/dictation/controller').DictationState
  isRecording: boolean
  isTranscribing: boolean
  isBusy: boolean
  durationSeconds?: number
  error: string | null
  warning: string | null
  result: DictationResult | null
  rawText?: string | null
  text?: string | null
  hasModifiedTranscript?: boolean
  reverted?: boolean
  orphanedTranscripts?: DictationResult[]
  start: (chatId?: string, retrySessionId?: string | null) => Promise<void>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  reset?: () => void
  revertToRaw?: () => void
  restoreEdited?: () => void
  dismissOrphaned?: (sessionId: string) => void
  consumeOrphaned?: (chatId: string) => DictationResult | null
  markInserted?: (sessionId: string) => void
  isInserted?: (sessionId: string) => boolean
  disabledReason?: string | null
}

export interface PromptActionsProps {
  /** Presentation only: injection and transcription delivery stay mounted. */
  visible?: boolean
  dictation?: DesktopDictationControl
  dictationControl?: UnifiedDictationControl
  chatId?: string
  /** Names a recovered transcript's chat. An empty result falls back to the id. */
  chatLabel?: (chatId: string) => string
  /** Forces the OpenWhispr desktop shortcut path. By default it is used
      when it is the dictation method selected in Settings (AC-014). */
  useDesktopBypass?: boolean
  onSend: () => void
  onFocusTerminal?: () => boolean
  /** Available once the terminal view can receive pasted text. */
  onPasteToTerminal?: (text: string) => void
  /** Pending text addressed to this console, pasted without submitting. */
  injected?: PromptInjection | null
  /** Reports consumption so the host can drop the pending injection. */
  onInjected?: () => void
}

export function PromptActions({
  visible = true,
  onSend,
  injected = null,
  onInjected,
  dictation,
  dictationControl,
  chatId,
  chatLabel,
  useDesktopBypass,
  onFocusTerminal,
  onPasteToTerminal,
}: PromptActionsProps): React.JSX.Element | null {
  const [focusError, setFocusError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const onInjectedRef = useRef(onInjected)
  onInjectedRef.current = onInjected
  const lastAppliedNonceRef = useRef<number | null>(null)

  const lastResultIdRef = useRef<string | null>(null)
  // Latest shared control for the result effect, which re-runs per result only.
  const dictationControlRef = useRef(dictationControl)
  dictationControlRef.current = dictationControl

  // An unknown method choice (null) fails closed onto the disabled desktop
  // path instead of recording with an STT adapter.
  const isDesktopBypass = Boolean(
    useDesktopBypass || dictation?.selected === true || dictation?.selected === null,
  )

  useEffect(() => {
    if (!onPasteToTerminal || injected === null || injected.nonce === lastAppliedNonceRef.current) {
      return
    }
    lastAppliedNonceRef.current = injected.nonce
    onPasteToTerminal(injected.text)
    onInjectedRef.current?.()
  }, [injected, onPasteToTerminal])

  useEffect(() => {
    const res = dictationControl?.result
    if (res?.outcome !== 'success' || !res.text || res.sessionId === lastResultIdRef.current) {
      return
    }
    // The control is shared by every chat prompt: only the addressed chat
    // inserts the take.
    if (chatId !== undefined && res.chatId !== chatId) return
    // A remounted prompt (session retry) sees the same shared result again.
    const control = dictationControlRef.current
    if (control?.isInserted?.(res.sessionId)) return
    if (!onPasteToTerminal) return
    lastResultIdRef.current = res.sessionId
    control?.markInserted?.(res.sessionId)
    onPasteToTerminal(res.text)
  }, [dictationControl?.result, chatId, onPasteToTerminal])

  function activateDesktopDictation(): void {
    if (!dictation || dictation.disabledReason !== null || dictation.busy) return
    setFocusError(null)
    if (!onFocusTerminal?.()) {
      setFocusError('The console cannot receive focus. Select an available chat and try again.')
      return
    }
    void dictation.activate()
  }

  function handleDictationClick(): void {
    if (isDesktopBypass || (!dictationControl && dictation)) {
      activateDesktopDictation()
      return
    }
    if (!dictationControl) return
    if (dictationControl.isRecording) {
      void dictationControl.stop()
    } else if (
      dictationControl.state === 'idle' ||
      dictationControl.state === 'error' ||
      dictationControl.state === 'cancelled'
    ) {
      void dictationControl.start(chatId)
    } else {
      return
    }
    // The button disables while transcribing; keep focus inside the form so
    // Esc still reaches the cancel handler.
    formRef.current?.focus()
  }

  function handleInsertOrphaned(transcript: DictationResult): void {
    if (!onPasteToTerminal) return
    onPasteToTerminal(transcript.text)
    dictationControl?.dismissOrphaned?.(transcript.sessionId)
  }

  const isButtonDisabled = isDesktopBypass
    ? !dictation || dictation.disabledReason !== null || dictation.busy
    : !dictationControl
      ? dictation
        ? dictation.disabledReason !== null || dictation.busy
        : true
      : dictationControl.disabledReason !== null && dictationControl.disabledReason !== undefined
        ? true
        : dictationControl.isTranscribing

  let buttonLabel = 'Dictation'
  let buttonIcon: React.ReactNode = <Icon.dictation size={14} aria-hidden />

  if (isDesktopBypass || (!dictationControl && dictation)) {
    buttonLabel = dictation?.busy ? 'Sending shortcut...' : 'Dictation'
  } else if (dictationControl) {
    if (dictationControl.isRecording) {
      buttonLabel =
        (dictationControl.durationSeconds ?? 0) > 0
          ? `Recording (${dictationControl.durationSeconds}s)...`
          : 'Recording...'
      buttonIcon = <span className="mr-0.5 h-2 w-2 rounded-full bg-error animate-pulse" />
    } else if (dictationControl.state === 'post_processing') {
      buttonLabel = 'Processing...'
      buttonIcon = <Icon.running size={14} className="animate-spin" aria-hidden />
    } else if (dictationControl.isTranscribing) {
      buttonLabel = 'Transcribing...'
      buttonIcon = <Icon.running size={14} className="animate-spin" aria-hidden />
    }
  }

  const buttonTitle =
    isDesktopBypass || (!dictationControl && dictation)
      ? (dictation?.disabledReason ??
        (dictation
          ? 'Send Ctrl + Super / Tap to OpenWhispr. It pastes into the currently focused field.'
          : 'Desktop dictation is available in chat prompts after setup in Settings.'))
      : (dictationControl?.disabledReason ??
        (dictationControl
          ? dictationControl.isRecording
            ? 'Click to stop recording (or press Esc to cancel).'
            : 'Click to dictate.'
          : 'Desktop dictation is available in chat prompts after setup in Settings.'))

  // The control is shared by every chat prompt: a take's error or warning
  // belongs to the chat that recorded it.
  const ownsResult =
    chatId === undefined || !dictationControl?.result || dictationControl.result.chatId === chatId
  const dictationWarning = ownsResult ? dictationControl?.warning : null
  const activeError = isDesktopBypass
    ? dictation?.error
    : ((ownsResult ? dictationControl?.error : null) ?? dictation?.error)
  const sendButton = (
    <button
      type="submit"
      className="nk-prompt-submit flex h-full shrink-0 items-center gap-1.5 bg-button px-2.5 text-xs text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
      data-testid={TEST_ID.terminalPromptSend}
      title="Press Enter in the console."
    >
      <Icon.send size={14} aria-hidden />
      Send
    </button>
  )
  const dictationButton = (
    <button
      type="button"
      className="flex h-full shrink-0 items-center gap-1.5 bg-button px-2.5 text-xs text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
      data-testid={TEST_ID.terminalPromptDictation}
      title={buttonTitle}
      disabled={isButtonDisabled}
      aria-busy={isDesktopBypass ? (dictation?.busy ?? false) : (dictationControl?.isBusy ?? false)}
      onClick={handleDictationClick}
    >
      {buttonIcon}
      {buttonLabel}
    </button>
  )

  if (!visible) return null

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      className="nk-prompt relative flex shrink-0 flex-wrap items-center justify-center gap-2 bg-terminal pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
      onKeyDown={(event) => {
        // Esc cancels capture and aborts in-flight transcription (AC-012),
        // from the action row or the Dictation button.
        if (event.key === 'Escape' && !isDesktopBypass && dictationControl?.isBusy) {
          event.preventDefault()
          void dictationControl.cancel()
        }
      }}
    >
      <div className="nk-prompt-frame relative flex h-control shrink-0 items-stretch overflow-hidden rounded-md border border-control-edge bg-panel focus-within:border-info">
        <div className="flex h-full shrink-0 items-stretch bg-button">
          {dictationButton}
          {/* Toolbar-standard separator (design doc 5): a single low-contrast
              hairline, vertically centered, shorter than the buttons. */}
          <span aria-hidden="true" className="h-4 w-px self-center bg-divider" />
          {sendButton}
        </div>
      </div>
      {dictationControl?.orphanedTranscripts?.map((orphaned) => {
        const named = chatLabel?.(orphaned.chatId)?.trim()
        return (
          <OrphanedTranscriptBanner
            key={orphaned.sessionId}
            transcript={orphaned}
            label={named && named.length > 0 ? named : orphaned.chatId}
            onInsert={() => handleInsertOrphaned(orphaned)}
            onDismiss={() => dictationControl.dismissOrphaned?.(orphaned.sessionId)}
          />
        )
      })}
      {(focusError ?? activeError) ? (
        <p role="alert" className="w-full text-xs text-error">
          {focusError ?? activeError}
        </p>
      ) : null}
      {dictationWarning ? (
        <p role="status" className="w-full text-xs text-warning">
          {dictationWarning === 'post-processing-rejected'
            ? 'Safety guardrails preserved original transcript.'
            : dictationWarning}
        </p>
      ) : null}
    </form>
  )
}
