import type React from 'react'
import type { DictationResult } from '../../../../shared/dictation-contract'

export interface RawTranscriptBannerProps {
  rawText: string
  editedText?: string
  reverted?: boolean
  onRevert: () => void
  onRestore?: () => void
  onDismiss: () => void
}

export function RawTranscriptBanner({
  rawText,
  reverted = false,
  onRevert,
  onRestore,
  onDismiss,
}: RawTranscriptBannerProps): React.JSX.Element {
  // A guardrail rejection keeps the raw text, so it never reaches this
  // banner; PromptInput shows that warning as a plain status line.
  return (
    <div
      role="status"
      data-testid="raw-transcript-banner"
      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-info/40 bg-panel px-3 py-1.5 text-xs text-ink"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold text-ink-bright">
          {reverted ? 'Using original raw transcript' : 'Post-processing formatted transcript'}
        </span>
        <span className="truncate font-mono text-[11px] text-ink-muted" title={rawText}>
          Original: {rawText}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {reverted ? (
          onRestore ? (
            <button
              type="button"
              onClick={onRestore}
              className="rounded bg-button px-2 py-1 text-xs text-ink hover:bg-button-hover"
              data-testid="restore-edited-transcript"
            >
              Restore formatted
            </button>
          ) : null
        ) : (
          <button
            type="button"
            onClick={onRevert}
            className="rounded bg-button px-2 py-1 text-xs font-medium text-info hover:bg-button-hover"
            data-testid="revert-to-raw-transcript"
          >
            Revert to raw transcript
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-ink"
          aria-label="Dismiss transcript notification"
          data-testid="dismiss-transcript-banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

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
