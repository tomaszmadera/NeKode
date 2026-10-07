import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'

// Styled terminal prompt (UX-UI): a real input below the terminal instead of
// typing at the shell prompt line. Enter submits the line plus CR through the
// host's PTY write path, so shell echo, history and the Ctrl+D emptiness gate
// keep working exactly as with typed input. The Dictation button is the
// design doc 21 idle state: rendered and themed, disabled until a recognizer
// is wired (none exists yet in the app).

/** External draft fill (Handoff/Resume paste, spec handoff-resume-flow): the
    nonce lets the same text re-inject and the host drop exactly this fill. */
export interface PromptInjection {
  text: string
  nonce: number
}

interface PromptInputProps {
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
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onInjectedRef = useRef(onInjected)
  onInjectedRef.current = onInjected

  useEffect(() => {
    if (injected === null) {
      return
    }
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

  return (
    <form
      className="flex shrink-0 items-center gap-2 bg-terminal pt-2"
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
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-muted"
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
          {/* Design doc 21 idle state: rendered, recognizable, disabled until a
              recognizer is wired. The button is the frame's right segment:
              square left edge, flush to the frame end. The visible label names
              the control, so the icon is decorative. */}
          <button
            type="button"
            className="flex h-full shrink-0 cursor-not-allowed items-center gap-1.5 bg-button px-2.5 text-xs text-ink-disabled"
            data-testid={TEST_ID.terminalPromptDictation}
            aria-label="Dictation"
            title="Dictation is not wired up yet."
            disabled
          >
            <Icon.dictation size={14} aria-hidden />
            Dictation
          </button>
        </div>
      </div>
    </form>
  )
}
