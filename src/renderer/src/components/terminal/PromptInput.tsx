import type React from 'react'
import { useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'

// Styled terminal prompt (UX-UI): a real input below the terminal instead of
// typing at the shell prompt line. Enter submits the line plus CR through the
// host's PTY write path, so shell echo, history and the Ctrl+D emptiness gate
// keep working exactly as with typed input. The Dictation button is the
// design doc 21 idle state: rendered and themed, disabled until a recognizer
// is wired (none exists yet in the app).
interface PromptInputProps {
  /** Submits one input line (without the terminator) to the terminal. */
  onSubmit: (line: string) => void
  /** Placeholder shown while the input is empty. */
  placeholder?: string
}

export function PromptInput({
  onSubmit,
  placeholder = 'Type a command',
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState('')

  function submit(): void {
    if (value.length === 0) {
      return
    }
    onSubmit(value)
    setValue('')
  }

  return (
    <form
      className="flex shrink-0 items-center gap-2 border-t border-edge bg-terminal px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex h-control min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-panel px-3 focus-within:border-info">
        <span aria-hidden="true" className="select-none font-mono text-ink-muted">
          &gt;
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-muted"
          data-testid={TEST_ID.terminalPromptInput}
          aria-label="Terminal input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="flex size-6 shrink-0 cursor-not-allowed items-center justify-center rounded-sm text-ink-disabled"
          data-testid={TEST_ID.terminalPromptDictation}
          aria-label="Dictation"
          title="Dictation is not wired up yet."
          disabled
        >
          <Icon.dictation size={14} aria-hidden />
        </button>
      </div>
    </form>
  )
}
