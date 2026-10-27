import type { DictationResult } from '@shared/contracts/dictation-contract'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopDictationControl } from '../../hooks/useDesktopDictation'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { OrphanedTranscriptBanner, RawTranscriptBanner } from './RawTranscriptBanner'

// Styled terminal prompt (UX-UI): a real input below the terminal instead of
// typing at the shell prompt line. Enter submits the line plus CR through the
// host's PTY write path, so shell echo, history and the Ctrl+D emptiness gate
// keep working exactly as with typed input. Desktop dictation only focuses
// this input and dispatches OpenWhispr's fixed shortcut; paste uses onChange.

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

export interface PromptInputProps {
  dictation?: DesktopDictationControl
  dictationControl?: UnifiedDictationControl
  chatId?: string
  /** Names a recovered transcript's chat. An empty result falls back to the id. */
  chatLabel?: (chatId: string) => string
  /** Forces the OpenWhispr desktop shortcut path. By default it is used
      when it is the dictation method selected in Settings (AC-014). */
  useDesktopBypass?: boolean
  /** Submits one input line (without the terminator) to the terminal.
      An empty line is submitted only in `buttons` chrome, and the host sends
      that as Enter. */
  onSubmit: (line: string) => void
  /** `buttons` hides the text field and centers Dictation then Send. The
      field stays mounted so dictation can still insert a draft. */
  chrome?: 'buttons' | 'input'
  /** Placeholder shown while the input is empty. */
  placeholder?: string
  /** Pending draft fill addressed to this input; replaces the whole value. */
  injected?: PromptInjection | null
  /** Reports consumption so the host can drop the pending injection. */
  onInjected?: () => void
}

export function PromptInput({
  onSubmit,
  placeholder = 'Type a command',
  injected = null,
  onInjected,
  dictation,
  dictationControl,
  chatId,
  chatLabel,
  useDesktopBypass,
  chrome = 'input',
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [focusError, setFocusError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const onInjectedRef = useRef(onInjected)
  onInjectedRef.current = onInjected
  const lastAppliedNonceRef = useRef<number | null>(null)

  const lastResultIdRef = useRef<string | null>(null)
  // Latest shared control for the result effect, which re-runs per result only.
  const dictationControlRef = useRef(dictationControl)
  dictationControlRef.current = dictationControl
  const lastInsertedTextRef = useRef<{ raw: string; edited: string } | null>(null)
  const [showRawBanner, setShowRawBanner] = useState(false)
  const [reverted, setReverted] = useState(false)

  // An unknown method choice (null) fails closed onto the disabled desktop
  // path instead of recording with an STT adapter.
  const isDesktopBypass = Boolean(
    useDesktopBypass || dictation?.selected === true || dictation?.selected === null,
  )

  useEffect(() => {
    if (injected === null || injected.nonce === lastAppliedNonceRef.current) {
      return
    }
    lastAppliedNonceRef.current = injected.nonce
    setValue(injected.text)
    onInjectedRef.current?.()
    inputRef.current?.focus()
  }, [injected])

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
    lastResultIdRef.current = res.sessionId
    control?.markInserted?.(res.sessionId)
    const textToInsert = res.text
    setValue((prev) => {
      if (prev.length === 0) return textToInsert
      return prev.endsWith(' ') ? `${prev}${textToInsert}` : `${prev} ${textToInsert}`
    })
    lastInsertedTextRef.current = {
      raw: res.rawText ?? res.text,
      edited: res.text,
    }
    setReverted(false)
    if (res.rawText && res.rawText.trim() !== res.text.trim()) {
      setShowRawBanner(true)
    } else {
      setShowRawBanner(false)
    }
    inputRef.current?.focus()
  }, [dictationControl?.result, chatId])

  function submit(): void {
    if (value.length === 0) {
      // A hidden field has no keyboard Enter. Send then accepts the console
      // prompt by submitting an empty line, which the host writes as CR.
      if (chrome === 'buttons') onSubmit('')
      return
    }
    onSubmit(value)
    setValue('')
    setShowRawBanner(false)
    lastInsertedTextRef.current = null
  }

  function activateDesktopDictation(): void {
    if (!dictation || dictation.disabledReason !== null || dictation.busy) return
    setFocusError(null)
    const input = inputRef.current
    if (!input?.isConnected || input.disabled || input.readOnly) {
      setFocusError('The prompt cannot receive focus. Select an available chat and try again.')
      return
    }
    try {
      input.focus()
      if (document.activeElement !== input) throw new Error('Focus refused')
      input.setSelectionRange(input.value.length, input.value.length)
    } catch {
      setFocusError('The prompt cannot receive focus. Select its NeKode window and try again.')
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
    inputRef.current?.focus()
  }

  /** Swaps the last occurrence of `from` for `to`. Leaves the prompt as is
      when the user already edited the dictated take away. */
  function swapLastTake(from: string, to: string): void {
    setValue((prev) => {
      const index = prev.lastIndexOf(from)
      if (index === -1) return prev
      return `${prev.slice(0, index)}${to}${prev.slice(index + from.length)}`
    })
  }

  function handleRevertToRaw(): void {
    if (!lastInsertedTextRef.current) return
    const { raw, edited } = lastInsertedTextRef.current
    swapLastTake(edited, raw)
    setReverted(true)
    dictationControl?.revertToRaw?.()
  }

  function handleRestoreEdited(): void {
    if (!lastInsertedTextRef.current) return
    const { raw, edited } = lastInsertedTextRef.current
    swapLastTake(raw, edited)
    setReverted(false)
    dictationControl?.restoreEdited?.()
  }

  function handleInsertOrphaned(transcript: DictationResult): void {
    setValue((prev) => {
      if (prev.length === 0) return transcript.text
      return prev.endsWith(' ') ? `${prev}${transcript.text}` : `${prev} ${transcript.text}`
    })
    if (transcript.sessionId) {
      dictationControl?.dismissOrphaned?.(transcript.sessionId)
    }
    inputRef.current?.focus()
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
  const buttonsOnly = chrome === 'buttons'
  const sendButton = (
    <button
      type="submit"
      className="nk-prompt-submit flex h-full shrink-0 items-center gap-1.5 bg-button px-2.5 text-xs text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
      data-testid={TEST_ID.terminalPromptSend}
      title={buttonsOnly ? 'Send the draft. An empty draft presses Enter.' : undefined}
      disabled={!buttonsOnly && value.length === 0}
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

  return (
    <form
      className={
        buttonsOnly
          ? 'nk-prompt relative flex shrink-0 flex-wrap items-center justify-center gap-2 bg-terminal pt-2'
          : 'nk-prompt flex shrink-0 flex-wrap items-center gap-2 bg-terminal pt-2'
      }
      data-prompt-chrome={chrome}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        // Esc cancels capture and aborts in-flight transcription (AC-012),
        // from the textarea or from the Dictation button.
        if (event.key === 'Escape' && !isDesktopBypass && dictationControl?.isBusy) {
          event.preventDefault()
          void dictationControl.cancel()
        }
      }}
    >
      {/* overflow-hidden clips the segment group's right corners to the frame
          radius, so the group reads as the input's right segment. Buttons-only
          chrome keeps the same frame as a centered pair: the textarea stays
          mounted and focusable for dictation, out of the tab order. */}
      <div
        className={
          buttonsOnly
            ? 'nk-prompt-frame relative flex h-control shrink-0 items-stretch overflow-hidden rounded-md border border-control-edge bg-panel focus-within:border-info'
            : 'nk-prompt-frame flex min-h-control min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-control-edge bg-panel pl-3 focus-within:border-info'
        }
      >
        {buttonsOnly ? null : (
          <span
            aria-hidden="true"
            className="nk-prompt-marker select-none font-mono text-ink-muted"
          >
            &gt;
          </span>
        )}
        <textarea
          ref={inputRef}
          rows={buttonsOnly ? 1 : Math.min(5, value.split('\n').length)}
          tabIndex={buttonsOnly ? -1 : undefined}
          className={
            buttonsOnly
              ? 'terminal-prompt-input sr-only'
              : 'terminal-prompt-input min-w-0 flex-1 resize-none bg-transparent py-1 font-mono text-[13px] text-ink outline-none placeholder:text-ink-muted'
          }
          data-testid={TEST_ID.terminalPromptInput}
          aria-label="Terminal input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {/* The frame's right end is one segment group (design doc 5): Send and
            Dictation glued over a single bg-button surface with the centered
            hairline between them, and no divider on the input side. */}
        <div
          className={
            buttonsOnly
              ? 'flex h-full shrink-0 items-stretch bg-button'
              : 'flex shrink-0 items-stretch self-stretch bg-button'
          }
        >
          {/* With the text field, Send stays left of Dictation. Buttons-only
              chrome puts Send on the right. Send is disabled while a visible
              field is empty. An empty buttons-only draft presses Enter. */}
          {buttonsOnly ? dictationButton : sendButton}
          {/* Toolbar-standard separator (design doc 5): a single low-contrast
              hairline, vertically centered, shorter than the buttons. */}
          <span aria-hidden="true" className="h-4 w-px self-center bg-divider" />
          {buttonsOnly ? sendButton : dictationButton}
        </div>
      </div>
      {showRawBanner && (lastInsertedTextRef.current?.raw || dictationControl?.rawText) ? (
        <RawTranscriptBanner
          rawText={lastInsertedTextRef.current?.raw ?? dictationControl?.rawText ?? ''}
          editedText={lastInsertedTextRef.current?.edited ?? dictationControl?.text ?? undefined}
          reverted={reverted}
          onRevert={handleRevertToRaw}
          onRestore={handleRestoreEdited}
          onDismiss={() => setShowRawBanner(false)}
        />
      ) : null}
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
      {!showRawBanner && dictationWarning ? (
        <p role="status" className="w-full text-xs text-warning">
          {dictationWarning === 'post-processing-rejected'
            ? 'Safety guardrails preserved original transcript.'
            : dictationWarning}
        </p>
      ) : null}
    </form>
  )
}
