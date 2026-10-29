import type { AppApi, HandoffEntry } from '@shared/ipc-contract'
import { projectHandoffDirKey, relativeToProject } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { focusRing, primaryClass, secondaryClass } from '../settings/settings-ui'

// Resume handoff picker (spec handoff-resume-flow Behaviour 4-5): the list
// loads lazily at open - one state read for the configured directory plus one
// handoffs:list call. Selecting an entry asks main to compose the prompt
// using the latest optional Resume template, then delivers it through the
// existing paste/auto-send path. The picker reads no files and persists nothing.

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
  const [pending, setPending] = useState(false)
  const requestRef = useRef<object | null>(null)
  const onPickRef = useRef(onPick)
  // An in-flight reply must use the current chat's live-session delivery guard.
  onPickRef.current = onPick

  useEffect(() => {
    let alive = true
    requestRef.current = null
    setPending(false)
    setError(null)
    setPhase('loading')
    setEntries([])
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
      requestRef.current = null
    }
  }, [app, projectId])

  // Escape closes the picker from anywhere: the trigger button keeps focus
  // when the dialog opens, so a dialog-level onKeyDown would never see the
  // key (same window-level idiom as the context menus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestRef.current = null
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  function pick(text: string): void {
    onPickRef.current(text)
    onClose()
  }

  function close(): void {
    requestRef.current = null
    onClose()
  }

  async function pickEntry(entry: HandoffEntry): Promise<void> {
    if (requestRef.current !== null) return
    const request = {}
    requestRef.current = request
    setPending(true)
    setError(null)
    try {
      const text = await app.handoffs.resumePrompt(projectId, entry.path)
      if (requestRef.current !== request) return
      pick(text)
    } catch (cause) {
      if (requestRef.current === request) {
        setError(errorMessage(cause, 'Failed to compose the Resume prompt.'))
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null
        setPending(false)
      }
    }
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts the dismiss gesture (mouse down outside the dialog); the dialog's controls are real buttons and inputs and it closes on Escape. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        role="presentation"
        onMouseDown={(event) => {
          // Backdrop dismiss: only a pointer-down on the dimmed area itself
          // closes. mousedown (not click) survives a text-selection drag that
          // releases outside the dialog; the target check keeps pointer-downs
          // inside the dialog from closing it.
          if (event.target === event.currentTarget) {
            close()
          }
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Resume from handoff"
          className="flex max-h-[85vh] w-[min(40rem,calc(100%-48px))] flex-col overflow-hidden rounded-[12px] border border-edge bg-dialog text-ink shadow-xl"
          data-testid={TEST_ID.handoffPicker}
        >
          <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-edge pr-2.5 pl-5">
            <h2 className="text-[15px] font-semibold text-project-title">Resume from handoff</h2>
            <button
              type="button"
              aria-label="Close handoff picker"
              title="Close handoff picker"
              className={`flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-highlight hover:text-ink ${focusRing}`}
              onClick={close}
            >
              <Icon.close size={16} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-7 pt-6 pb-8">
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
                    className={primaryClass}
                    data-testid={TEST_ID.handoffPickerConfigure}
                    onClick={onConfigure}
                  >
                    Configure
                  </button>
                  <button
                    type="button"
                    className={secondaryClass}
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
            {error !== null ? (
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
                <ul
                  className="overflow-hidden rounded-[10px] border border-edge bg-group"
                  data-testid={TEST_ID.handoffPickerList}
                >
                  {entries.map((entry) => (
                    <li key={entry.path} className="border-edge not-first:border-t">
                      <button
                        type="button"
                        className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-highlight disabled:opacity-50 ${focusRing}`}
                        title={entry.path}
                        data-testid={TEST_ID.handoffPickerEntry}
                        disabled={pending}
                        onClick={() => {
                          void pickEntry(entry)
                        }}
                      >
                        <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                          {entry.name}
                        </span>
                        <span
                          className="col-start-1 min-w-0 truncate text-xs text-ink-muted"
                          title={displayPath(entry, projectPath)}
                        >
                          {displayPath(entry, projectPath)}
                        </span>
                        <span className="col-start-2 row-span-2 row-start-1 self-center text-xs text-ink-muted">
                          {new Date(entry.modifiedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </section>
      </div>
    </>
  )
}
