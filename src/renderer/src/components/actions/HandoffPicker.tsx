import type { AppApi, ResumeDiscoveryCandidate } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { focusRing, primaryClass, secondaryClass } from '../settings/settings-ui'

// Resume picker (spec handoff-resume-flow Behaviour 4-5, NEKODE-142): the list
// loads lazily at open from the project's configured reusable Resume source.
// Selecting a candidate validates the selection fingerprint and asks main to
// compose the prompt, then delivers it through the existing paste/auto-send path.

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

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function HandoffPicker({
  app,
  projectId,
  onPick,
  onConfigure,
  onClose,
}: HandoffPickerProps): React.JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'unconfigured' | 'ready' | 'error'>('loading')
  const [candidates, setCandidates] = useState<ResumeDiscoveryCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const requestRef = useRef<object | null>(null)
  const discoveryIdRef = useRef<string | null>(null)
  const onPickRef = useRef(onPick)
  // An in-flight reply must use the current chat's live-session delivery guard.
  onPickRef.current = onPick

  const load = useCallback(async (): Promise<void> => {
    requestRef.current = null
    setPending(false)
    setError(null)
    setPhase('loading')
    setCandidates([])
    const requestId = crypto.randomUUID()
    discoveryIdRef.current = requestId
    try {
      const binding = await app.resumeSources.binding(projectId)
      if (discoveryIdRef.current !== requestId) return
      if (binding.templateId === null) {
        setPhase('unconfigured')
        return
      }
      const discovery = await app.resumeSources.discover(projectId, requestId)
      if (discoveryIdRef.current !== requestId) return
      setCandidates(discovery.candidates)
      setPhase('ready')
    } catch (cause) {
      if (discoveryIdRef.current !== requestId) return
      setError(errorMessage(cause, 'Failed to discover Resume candidates.'))
      setPhase('error')
    }
  }, [app, projectId])

  useEffect(() => {
    void load()
    return () => {
      const pendingReq = discoveryIdRef.current
      discoveryIdRef.current = null
      requestRef.current = null
      if (pendingReq !== null) {
        void app.resumeSources.cancel(pendingReq).catch(() => undefined)
      }
    }
  }, [app, load])

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

  async function pickCandidate(candidate: ResumeDiscoveryCandidate): Promise<void> {
    if (requestRef.current !== null) return
    const request = {}
    requestRef.current = request
    setPending(true)
    setError(null)
    try {
      const text = await app.resumeSources.prepare(projectId, candidate.token, crypto.randomUUID())
      if (requestRef.current !== request) return
      pick(text)
    } catch (cause) {
      if (requestRef.current === request) {
        setError(errorMessage(cause, 'Failed to prepare the Resume prompt.'))
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss on mouse down outside dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            close()
          }
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Resume task"
          className="flex max-h-[85vh] w-[min(40rem,calc(100%-48px))] flex-col overflow-hidden rounded-[12px] border border-edge bg-dialog text-ink shadow-xl"
          data-testid={TEST_ID.handoffPicker}
        >
          <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-edge pr-2.5 pl-5">
            <h2 className="text-[15px] font-semibold text-project-title">Resume task</h2>
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
                Loading Resume candidates...
              </p>
            ) : null}
            {phase === 'unconfigured' ? (
              <div className="mt-4 text-xs" data-testid={TEST_ID.handoffPickerUnconfigured}>
                <p className="text-ink-secondary">
                  No Resume template is configured for this project. Set it in Project Settings to
                  resume tasks.
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
                </div>
              </div>
            ) : null}
            {error !== null ? (
              <div className="mt-4 flex flex-col gap-2">
                <p
                  className="text-xs text-error"
                  role="alert"
                  data-testid={TEST_ID.handoffPickerError}
                >
                  {error}
                </p>
                <button
                  type="button"
                  className={`${secondaryClass} self-start text-xs`}
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {phase === 'ready' ? (
              candidates.length === 0 ? (
                <div
                  className="mt-4 flex flex-col gap-2 text-xs text-ink-secondary"
                  data-testid={TEST_ID.handoffPickerEmpty}
                >
                  <p>No candidates found for the configured Resume source.</p>
                  <button
                    type="button"
                    className={`${secondaryClass} self-start text-xs`}
                    onClick={() => void load()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <ul
                  className="overflow-hidden rounded-[10px] border border-edge bg-group"
                  data-testid={TEST_ID.handoffPickerList}
                >
                  {candidates.map((candidate) => (
                    <li key={candidate.token} className="border-edge not-first:border-t">
                      <button
                        type="button"
                        className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-highlight disabled:opacity-50 ${focusRing}`}
                        title={candidate.displayPath}
                        data-testid={TEST_ID.handoffPickerEntry}
                        disabled={pending}
                        onClick={() => {
                          void pickCandidate(candidate)
                        }}
                      >
                        <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                          {candidate.title || candidate.id}
                        </span>
                        <span
                          className="col-start-1 min-w-0 truncate text-xs text-ink-muted"
                          title={candidate.displayPath}
                        >
                          {candidate.displayPath}
                          {candidate.status ? ` · ${candidate.status}` : ''}
                          {candidate.next_action ? ` · ${candidate.next_action}` : ''}
                        </span>
                        <span className="col-start-2 row-span-2 row-start-1 self-center text-xs text-ink-muted">
                          {new Date(candidate.modifiedAt).toLocaleString()}
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
