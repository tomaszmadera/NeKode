import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopDictationControl } from '../../hooks/useDesktopDictation'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'

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

interface PromptInputProps {
  dictation?: DesktopDictationControl
  /** Submits one input line (without the terminator) to the terminal. */
  onSubmit: (line: string) => void
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
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [focusError, setFocusError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onInjectedRef = useRef(onInjected)
  onInjectedRef.current = onInjected
  const lastAppliedNonceRef = useRef<number | null>(null)

  useEffect(() => {
    if (injected === null || injected.nonce === lastAppliedNonceRef.current) {
      return
    }
    lastAppliedNonceRef.current = injected.nonce
    setValue(injected.text)
    onInjectedRef.current?.()
    inputRef.current?.focus()
  }, [injected])

  function submit(): void {
    if (value.length === 0) {
      return
    }
    onSubmit(value)
    setValue('')
  }

  function activateDictation(): void {
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

  return (
    <form
      className="flex shrink-0 flex-wrap items-center gap-2 bg-terminal pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {/* overflow-hidden clips the segment group's right corners to the frame
          radius, so the group reads as the input's right segment. */}
      <div className="flex h-control min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-control-edge bg-panel pl-3 focus-within:border-info">
        <span aria-hidden="true" className="select-none font-mono text-ink-muted">
          &gt;
        </span>
        <input
          ref={inputRef}
          className="terminal-prompt-input min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-muted"
          data-testid={TEST_ID.terminalPromptInput}
          aria-label="Terminal input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {/* The frame's right end is one segment group (design doc 5): Send and
            Dictation glued over a single bg-button surface with the centered
            hairline between them, and no divider on the input side. */}
        <div className="flex h-full shrink-0 items-stretch bg-button">
          {/* Send submits by click (form submit path, same as Enter). Disabled
              while the input is empty, mirroring the Enter no-op. */}
          <button
            type="submit"
            className="flex h-full shrink-0 items-center gap-1.5 bg-button px-2.5 text-xs text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
            data-testid={TEST_ID.terminalPromptSend}
            disabled={value.length === 0}
          >
            <Icon.send size={14} aria-hidden />
            Send
          </button>
          {/* Toolbar-standard separator (design doc 5): a single low-contrast
              hairline, vertically centered, shorter than the buttons. */}
          <span aria-hidden="true" className="h-4 w-px self-center bg-divider" />
          {/* The button is the frame's right segment:
              square left edge, flush to the frame end. The visible label names
              the control, so the icon is decorative. */}
          <button
            type="button"
            className="flex h-full shrink-0 items-center gap-1.5 bg-button px-2.5 text-xs text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
            data-testid={TEST_ID.terminalPromptDictation}
            aria-label="Dictation"
            title={
              dictation?.disabledReason ??
              (dictation
                ? 'Send Ctrl + Super / Tap to OpenWhispr. It pastes into the currently focused field.'
                : 'Desktop dictation is available in chat prompts after setup in Settings.')
            }
            disabled={!dictation || dictation.disabledReason !== null || dictation.busy}
            aria-busy={dictation?.busy ?? false}
            onClick={activateDictation}
          >
            <Icon.dictation size={14} aria-hidden />
            {dictation?.busy ? 'Sending shortcut...' : 'Dictation'}
          </button>
        </div>
      </div>
      {(focusError ?? dictation?.error) ? (
        <p role="alert" className="w-full text-xs text-error">
          {focusError ?? dictation?.error}
        </p>
      ) : null}
    </form>
  )
}
