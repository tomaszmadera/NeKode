import type { DictationResult } from '@shared/contracts/dictation-contract'
import type React from 'react'

export interface OrphanedTranscriptBannerProps {
  transcript: DictationResult
  /** Chat name, with the project when it is known. Falls back to the chat id. */
  label: string
  onInsert: () => void
  onDismiss: () => void
}

export function OrphanedTranscriptBanner({
  transcript,
  label,
  onInsert,
  onDismiss,
}: OrphanedTranscriptBannerProps): React.JSX.Element {
  return (
    <div
      role="status"
      data-testid="orphaned-transcript-banner"
      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-info/40 bg-panel px-3 py-1.5 text-xs text-ink"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold text-ink-bright">Recovered transcript for {label}</span>
        <span className="truncate font-mono text-[11px] text-ink-muted" title={transcript.text}>
          &quot;{transcript.text}&quot;
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onInsert}
          className="rounded bg-button px-2 py-1 text-xs font-medium text-ink hover:bg-button-hover"
          data-testid="insert-orphaned-transcript"
        >
          Insert transcript
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-ink"
          aria-label="Dismiss recovered transcript"
          data-testid="dismiss-orphaned-banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
