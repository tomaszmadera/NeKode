import type {
  AgentProfile,
  AppApi,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  KanbanResumeLaunchInput,
  ResumeDiscoveryCandidate,
  ResumeSourceDiscovery,
  WorkItem,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { matchesTaskRef } from './KanbanHandoffNotices'

interface TaskResumeModalProps {
  app: AppApi
  projectId: string
  item: WorkItem
  onCancel: () => void
  /** Project Settings on the tab that owns the Resume template configuration. */
  onConfigureHandoffs: () => void
  /** Project Settings on the Agents tab (no profiles configured). */
  onConfigureAgents?: () => void
  onLaunched?: (result: KanbanLaunchResult & { input: KanbanLaunchTaskInput }) => void
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return parseAppErrorPayload(error)?.message ?? fallback
}

/** The first matching candidate, or null when no candidate matches the ref. */
function defaultSelection(options: ResumeDiscoveryCandidate[]): string | null {
  return options[0]?.token ?? null
}

/**
 * Resume confirmation (Task and file Resume sources, NEKODE-142). The scan
 * runs on open and on Refresh only, never on hover and never on a poll.
 * Without a template selected, offers Configure Resume. A read failure is its own
 * visible state; rejected files/items are named warnings beside valid candidates.
 * Confirm is enabled only after discovery finishes and the user has an agent
 * profile plus a matching candidate. Before chat creation, main revalidates
 * the template binding and candidate fingerprint via prepare.
 */
export function TaskResumeModal({
  app,
  projectId,
  item,
  onCancel,
  onConfigureHandoffs,
  onConfigureAgents,
  onLaunched,
}: TaskResumeModalProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const openRef = useRef(true)
  const busyRef = useRef(false)
  const generation = useRef(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'not-configured'>('loading')
  const [result, setResult] = useState<ResumeSourceDiscovery | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profilePhase, setProfilePhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  const runScan = useCallback(async (): Promise<void> => {
    const requestGeneration = generation.current
    setError(null)
    setScanning(true)
    try {
      const binding = await app.resumeSources.binding(projectId)
      if (requestGeneration !== generation.current || !openRef.current) {
        return
      }
      if (!binding.templateId) {
        setResult(null)
        setPhase('not-configured')
        return
      }
      const requestId = `resume-modal-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const next = await app.resumeSources.discover(projectId, requestId)
      if (requestGeneration !== generation.current || !openRef.current) {
        return
      }
      setResult(next)
      setPhase('ready')
      setSelection((current) => {
        const matching = next.candidates.filter((candidate) =>
          matchesTaskRef(item.ref, candidate.id),
        )
        if (current !== null && matching.some((candidate) => candidate.token === current)) {
          return current
        }
        return defaultSelection(matching)
      })
    } catch (cause) {
      if (requestGeneration !== generation.current || !openRef.current) {
        return
      }
      setResult(null)
      setError(errorMessage(cause, 'Failed to discover Resume sources.'))
      setPhase('error')
    } finally {
      if (requestGeneration === generation.current) {
        setScanning(false)
      }
    }
  }, [app, projectId, item.ref])

  useEffect(() => {
    openRef.current = true
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    return () => {
      openRef.current = false
      generation.current += 1
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  useEffect(() => {
    void runScan()
  }, [runScan])

  useEffect(() => {
    let active = true
    void app.agentProfiles
      .get(projectId)
      .then((loaded) => {
        if (!active || !openRef.current) {
          return
        }
        setProfiles(loaded.profiles)
        const preferred =
          loaded.profiles.find((profile) => profile.id === loaded.defaultId) ?? loaded.profiles[0]
        setSelectedProfileId(preferred?.id ?? null)
        setProfilePhase('ready')
      })
      .catch((loadError: unknown) => {
        if (!active || !openRef.current) {
          return
        }
        setProfilePhase('error')
        setProfileError(errorMessage(loadError, 'Failed to load agent profiles.'))
      })
    return () => {
      active = false
    }
  }, [app, projectId])

  function requestCancel(): void {
    if (busyRef.current) {
      return
    }
    onCancel()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
    event.preventDefault()
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ) ?? [],
    ).filter((control) => control.tabIndex >= 0)
    const index = controls.indexOf(document.activeElement as HTMLElement)
    const next =
      index < 0
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    controls[next]?.focus()
  }

  async function handleConfirm(): Promise<void> {
    if (busyRef.current || phase !== 'ready' || selection === null || selectedProfileId === null) {
      return
    }
    const chosen = options.find((option) => option.token === selection)
    if (chosen === undefined) {
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const requestId = `resume-prep-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const prompt = await app.resumeSources.prepare(projectId, chosen.token, requestId)
      const input: KanbanResumeLaunchInput = {
        projectId,
        itemId: item.id,
        ref: item.ref,
        profileId: selectedProfileId,
        attemptId: crypto.randomUUID(),
        mode: 'resume',
        prompt,
      }
      const launchResult = await app.kanban.launchTask(input)
      if (!openRef.current) {
        return
      }
      onLaunched?.({ ...launchResult, input })
    } catch (launchError: unknown) {
      if (!openRef.current) {
        return
      }
      busyRef.current = false
      setBusy(false)
      setError(errorMessage(launchError, 'Failed to resume the task.'))
    }
  }

  const options =
    result === null
      ? []
      : result.candidates.filter((candidate) => matchesTaskRef(item.ref, candidate.id))
  const canConfirm =
    phase === 'ready' &&
    !busy &&
    !scanning &&
    selection !== null &&
    profilePhase === 'ready' &&
    selectedProfileId !== null &&
    options.some((option) => option.token === selection)

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts the dismiss gesture; the dialog controls are real buttons and it closes on Escape. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            requestCancel()
          }
        }}
      >
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kanban-resume-title"
          aria-describedby="kanban-resume-task"
          aria-busy={busy}
          onKeyDown={handleKeyDown}
          className="w-[min(28rem,92vw)] rounded-lg border border-edge bg-panel p-5 shadow-xl"
          data-testid={TEST_ID.kanbanResumeDialog}
        >
          <h2 id="kanban-resume-title" className="text-[14.7px] font-semibold text-ink">
            Resume task
          </h2>
          <p
            id="kanban-resume-task"
            className="mt-2 whitespace-pre-wrap break-words text-[12.6px] text-ink"
            data-testid={TEST_ID.kanbanResumeTask}
          >
            {item.ref}: {item.title}
          </p>

          {phase === 'loading' ? (
            <p
              className="mt-3 text-[12.6px] text-ink-secondary"
              data-testid={TEST_ID.kanbanResumeLoading}
            >
              Reading resume sources…
            </p>
          ) : null}

          {phase === 'not-configured' ? (
            <div className="mt-3 text-[12.6px]">
              <p className="text-ink-secondary">
                No Resume template is configured for this project.
              </p>
              <button
                type="button"
                className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info"
                data-testid={TEST_ID.kanbanResumeConfigure}
                onClick={onConfigureHandoffs}
              >
                Configure Resume
              </button>
            </div>
          ) : null}

          {phase === 'ready' && result !== null ? (
            <>
              {result.rejections.length > 0 ? (
                <ul
                  className="mt-3 list-none space-y-1 text-[12.6px] text-warning"
                  data-testid={TEST_ID.kanbanResumeWarnings}
                >
                  {result.rejections.map((rejection) => {
                    const label =
                      'name' in rejection && typeof rejection.name === 'string'
                        ? rejection.name
                        : rejection.path
                    return (
                      <li key={rejection.path}>
                        {label}: {rejection.reason}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {options.length === 0 ? (
                <p
                  className="mt-3 text-[12.6px] text-ink-secondary"
                  data-testid={TEST_ID.kanbanResumeEmpty}
                >
                  No linked handoff
                </p>
              ) : (
                <fieldset className="mt-3 min-w-0 border-0 p-0" disabled={busy}>
                  <legend className="text-[12.6px] font-semibold text-ink">Resume source</legend>
                  <div
                    className="mt-2 flex flex-col gap-1"
                    data-testid={TEST_ID.kanbanResumeCandidates}
                  >
                    {options.map((option) => (
                      <label
                        key={option.token}
                        className="flex items-center gap-2 text-[12.6px] text-ink"
                        data-testid={testIdFor.kanbanResumeCandidate(option.id)}
                      >
                        <input
                          type="radio"
                          name="kanban-resume-candidate"
                          value={option.token}
                          checked={selection === option.token}
                          onChange={() => {
                            setSelection(option.token)
                          }}
                        />
                        <span className="truncate">
                          {option.title || option.displayPath || option.id}
                        </span>
                        {option.current_phase ? (
                          <span className="ml-auto text-xs text-ink-secondary">
                            {option.current_phase}
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          ) : null}

          {profilePhase === 'loading' ? (
            <p className="mt-3 text-[12.6px] text-ink-secondary">Loading agent profiles…</p>
          ) : null}
          {profilePhase === 'error' ? (
            <p
              className="mt-3 text-[12.6px] text-error"
              role="alert"
              data-testid={TEST_ID.kanbanResumeProfileError}
            >
              {profileError}
            </p>
          ) : null}
          {profilePhase === 'ready' && profiles.length === 0 ? (
            <div className="mt-3 text-[12.6px]">
              <p className="text-ink-secondary" data-testid={TEST_ID.kanbanResumeProfilesEmpty}>
                No agent profiles are configured for this project.
              </p>
              <button
                type="button"
                className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info"
                data-testid={TEST_ID.kanbanResumeConfigureAgents}
                onClick={onConfigureAgents}
              >
                Configure agents
              </button>
            </div>
          ) : null}
          {profilePhase === 'ready' && profiles.length > 0 ? (
            <fieldset className="mt-3 min-w-0 border-0 p-0" disabled={busy}>
              <legend className="text-[12.6px] font-semibold text-ink">Agent profile</legend>
              <div className="mt-2 flex flex-col gap-1">
                {profiles.map((profile) => (
                  <label
                    key={profile.id}
                    className="flex items-center gap-2 text-[12.6px] text-ink"
                    data-testid={testIdFor.kanbanResumeProfile(profile.id)}
                  >
                    <input
                      type="radio"
                      name="kanban-resume-profile"
                      value={profile.id}
                      checked={selectedProfileId === profile.id}
                      onChange={() => {
                        setSelectedProfileId(profile.id)
                      }}
                    />
                    <span className="truncate">{profile.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {error !== null ? (
            <p
              className="mt-3 text-[12.6px] text-error"
              role="alert"
              data-testid={TEST_ID.kanbanResumeError}
            >
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              disabled={busy}
              className="h-control rounded-md px-4 text-[12.6px] text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info disabled:opacity-50"
              data-testid={TEST_ID.kanbanResumeCancel}
              onClick={requestCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || scanning}
              className="h-control rounded-md px-4 text-[12.6px] text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info disabled:opacity-50"
              data-testid={TEST_ID.kanbanResumeRefresh}
              onClick={() => {
                void runScan()
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="h-control rounded-md bg-button px-4 text-[12.6px] text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info disabled:opacity-50"
              data-testid={TEST_ID.kanbanResumeConfirm}
              disabled={!canConfirm}
              onClick={() => {
                void handleConfirm()
              }}
            >
              Resume
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
