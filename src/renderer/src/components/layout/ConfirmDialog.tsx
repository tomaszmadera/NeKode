import type React from 'react'
import { useEffect, useRef } from 'react'
import { TEST_ID } from '../../lib/test-ids'

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  /** Destructive confirmations render the confirm action in the error color. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal confirmation dialog (App Settings idiom): dimmed backdrop, centered
 * panel, Escape closes, focus moves in on mount and returns to the opener on
 * unmount. Confirm runs the destructive action; Cancel / backdrop / Escape
 * keep the app untouched. Text is English (design doc 11); confirmations are
 * one-off surfaces, so no shortcut or App-level chord targets this dialog.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    confirmRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts
          the dismiss gesture (mouse down outside the dialog); the dialog's
          controls are real buttons and it closes on Escape. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        role="presentation"
        onMouseDown={(event) => {
          // Backdrop dismiss: only a pointer-down on the dimmed area itself
          // closes (mousedown survives a text-selection drag that releases
          // outside the dialog; the target check keeps pointer-downs inside
          // the dialog from closing it).
          if (event.target === event.currentTarget) {
            onCancel()
          }
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onCancel()
            }
            // Enter/Space need no handling: the confirm button holds focus,
            // so the browser activates it exactly once.
          }}
          className="w-[min(24rem,90vw)] rounded-lg border border-edge bg-panel p-5 shadow-xl"
          data-testid={TEST_ID.confirmDialog}
        >
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{body}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="h-control rounded-md px-4 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info"
              data-testid={TEST_ID.confirmDialogCancel}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={
                destructive
                  ? 'h-control rounded-md bg-error/20 px-4 text-xs text-error hover:bg-error/30 focus-visible:outline focus-visible:outline-info'
                  : 'h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info'
              }
              data-testid={TEST_ID.confirmDialogConfirm}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
