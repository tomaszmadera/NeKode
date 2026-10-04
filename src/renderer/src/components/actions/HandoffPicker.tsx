import type React from 'react'
import { useEffect, useState } from 'react'
import type { AppApi, HandoffEntry } from '../../../../shared/ipc-contract'
import { projectHandoffDirKey, relativeToProject } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID } from '../../lib/test-ids'

// Resume handoff picker (spec handoff-resume-flow Behaviour 4-5): the list
// loads lazily at open - one state read for the configured directory plus one
// handoffs:list call. Selecting an entry hands the English command (naming
// the file relative to the project root; absolute when it lies outside it)
// to the host, which pastes it into the prompt input or sends it straight
// when auto-send is on. The picker never reads file content and never
// persists anything.

interface HandoffPickerProps {
  app: AppApi
  /** Active tab project; the picker opens only with a project bound. */
  projectId: string
  /** Project root: relative display paths and Resume commands against it. */
  projectPath: string | null
  /** Delivers the composed Resume command (paste or auto-send upstream). */
  onPick: (text: string) => void
  /** Opens Project Settings for this project (unconfigured state). */
  onConfigure: () => void
  onClose: () => void
}

/** Plain fallback command (no path): the agent finds the handoff itself. */
const PLAIN_RESUME_COMMAND = 'Resume from handoff'

/** Project-root-relative path when inside the root; absolute otherwise. */
function displayPath(entry: HandoffEntry, projectPath: string | null): string {
  if (projectPath === null) {
    return entry.path
  }
  return relativeToProject(projectPath, entry.path) ?? entry.path
}

function resumeCommand(entry: HandoffEntry, projectPath: string | null): string {
  return `Resume from handoff ${displayPath(entry, projectPath)}`
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function HandoffPicker({
  app,
  projectId,
  projectPath,
  onPick,
  onConfigure,
  onClose,
}: HandoffPickerProps): React.JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'unconfigured' | 'ready' | 'error'>('loading')
  const [entries, setEntries] = useState<HandoffEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load(): Promise<void> {
      try {
        const configured = await app.state.get(projectHandoffDirKey(projectId))
        if (!alive) return
        if (configured === null || configured.trim().length === 0) {
          setPhase('unconfigured')
          return
        }
        const list = await app.handoffs.list(projectId)
        if (!alive) return
        setEntries(list)
        setPhase('ready')
      } catch (cause) {
        if (!alive) return
        setError(errorMessage(cause, 'Failed to load handoffs.'))
        setPhase('error')
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [app, projectId])

  // Escape closes the picker from anywhere: the trigger button keeps focus
  // when the dialog opens, so a dialog-level onKeyDown would never see the
  // key (same window-level idiom as the context menus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  function pick(text: string): void {
    onPick(text)
    onClose()
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts the dismiss gesture (mouse down outside the dialog); the dialog's controls are real buttons and inputs and it closes on Escape. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        role="presentation"
        onMouseDown={(event) => {
          // Backdrop dismiss: only a pointer-down on the dimmed area itself
          // closes. mousedown (not click) survives a text-selection drag that
          // releases outside the dialog; the target check keeps pointer-downs
          // inside the dialog from closing it.
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Resume from handoff"
          className="max-h-[85vh] w-[min(32rem,90vw)] overflow-y-auto rounded-lg border border-edge bg-panel p-5 shadow-xl"
          data-testid={TEST_ID.handoffPicker}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Resume from handoff</h2>
            <button
              type="button"
              aria-label="Close handoff picker"
              className="rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          {phase === 'loading' ? (
            <p
              className="mt-4 text-xs text-ink-secondary"
              data-testid={TEST_ID.handoffPickerLoading}
            >
              Loading handoffs...
            </p>
          ) : null}
          {phase === 'unconfigured' ? (
            <div className="mt-4 text-xs" data-testid={TEST_ID.handoffPickerUnconfigured}>
              <p className="text-ink-secondary">
                No handoff directory is configured for this project. Set it in Project Settings to
                pick from past handoffs.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
                  data-testid={TEST_ID.handoffPickerConfigure}
                  onClick={onConfigure}
                >
                  Configure
                </button>
                <button
                  type="button"
                  className="h-control rounded-md px-4 text-ink-secondary hover:bg-highlight hover:text-ink"
                  data-testid={TEST_ID.handoffPickerPlainPaste}
                  onClick={() => {
                    pick(PLAIN_RESUME_COMMAND)
                  }}
                >
                  Paste without path
                </button>
              </div>
            </div>
          ) : null}
          {phase === 'error' ? (
            <p
              className="mt-4 text-xs text-error"
              role="alert"
              data-testid={TEST_ID.handoffPickerError}
            >
              {error}
            </p>
          ) : null}
          {phase === 'ready' ? (
            entries.length === 0 ? (
              <p
                className="mt-4 text-xs text-ink-secondary"
                data-testid={TEST_ID.handoffPickerEmpty}
              >
                No handoffs in the configured directory.
              </p>
            ) : (
              <ul className="mt-3 space-y-1" data-testid={TEST_ID.handoffPickerList}>
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded border border-edge px-2 py-1.5 text-left text-xs hover:bg-highlight"
                      title={entry.path}
                      data-testid={TEST_ID.handoffPickerEntry}
                      onClick={() => {
                        pick(resumeCommand(entry, projectPath))
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                      <span
                        className="shrink-0 text-ink-muted"
                        title={displayPath(entry, projectPath)}
                      >
                        {displayPath(entry, projectPath)}
                      </span>
                      <span className="shrink-0 text-ink-muted">
                        {new Date(entry.modifiedAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      </div>
    </>
  )
}
