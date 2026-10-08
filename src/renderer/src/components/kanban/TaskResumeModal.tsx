import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentProfile,
  AppApi,
  HandoffCandidatesResult,
  HandoffFileInfo,
  HandoffMatchKind,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  KanbanResumeLaunchInput,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

interface TaskResumeModalProps {
  app: AppApi
  projectId: string
  item: WorkItem
  onCancel: () => void
  /** Project Settings on the tab that owns the handoff directory. */
  onConfigureHandoffs: () => void
  /** Project Settings on the Agents tab (no profiles configured). */
  onConfigureAgents?: () => void
  onLaunched?: (result: KanbanLaunchResult & { input: KanbanLaunchTaskInput }) => void
}

/** One selectable row: an automatic candidate or the explicit link. */
interface ResumeOption {
  name: string
  path: string
  modifiedAt: string
  kind: HandoffMatchKind | 'link'
}

type ReadyResult = Extract<HandoffCandidatesResult, { state: 'ready' }>

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

function matchLabel(kind: HandoffMatchKind | 'link'): string {
  if (kind === 'link') {
    return 'Linked'
  }
  return kind === 'metadata' ? 'Metadata match' : 'Filename match'
}

/**
 * Automatic candidates (metadata or filename) plus the explicit link, which
 * wins and moves to the front when it matched nothing automatically.
 */
function candidateOptions(result: ReadyResult): ResumeOption[] {
  const options: ResumeOption[] = result.files
    .filter((file) => file.matchKind === 'metadata' || file.matchKind === 'filename')
    .map((file) => ({ ...file, kind: file.matchKind }))
  const link = result.link
  if (link !== null) {
    const index = options.findIndex((option) => option.name === link.name)
    if (index >= 0) {
      options[index] = { ...options[index], kind: 'link' }
    } else {
      options.unshift({ ...link, kind: 'link' })
    }
  }
  return options
}

/** Newest metadata match, then newest filename match, else the explicit link. */
function defaultSelection(result: ReadyResult): string | null {
  if (result.link !== null) {
    return result.link.name
  }
  const metadata = result.files.find((file) => file.matchKind === 'metadata')
  if (metadata !== undefined) {
    return metadata.name
  }
  const filename = result.files.find((file) => file.matchKind === 'filename')
  return filename?.name ?? null
}

/**
 * Resume confirmation (kanban task launch amendment, stages 4 and 5). The scan
 * runs on open and on Refresh only, never on hover and never on a poll. A
 * missing directory offers Configure handoffs; a read failure is its own
 * visible state, never an empty set; a rejected file is a named warning beside
 * the good candidates. Link handoff stores a chosen file name without editing
 * the file. Confirm is enabled only after the scan finishes and the user has an
 * agent profile plus a still-matching file; main rechecks the file and its
 * stamp before it creates the chat, and a changed file refreshes this choice.
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
  const [result, setResult] = useState<ReadyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [pendingLinkName, setPendingLinkName] = useState<string | null>(null)
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
      const next = await app.kanban.handoffCandidates({
        projectId,
        itemId: item.id,
        ref: item.ref,
      })
      if (requestGeneration !== generation.current || !openRef.current) {
        return
      }
      if (next.state === 'not-configured') {
        setResult(null)
        setPhase('not-configured')
        return
      }
      if (next.state === 'error') {
        setResult(null)
        setError(next.message)
        setPhase('error')
        return
      }
      setResult(next)
      setPhase('ready')
      setSelection((current) => {
        const options = candidateOptions(next)
        if (current !== null && options.some((option) => option.name === current)) {
          return current
        }
        return defaultSelection(next)
      })
    } catch (cause) {
      if (requestGeneration !== generation.current || !openRef.current) {
        return
      }
      setResult(null)
      setError(errorMessage(cause, 'Failed to read the handoff directory.'))
      setPhase('error')
    } finally {
      if (requestGeneration === generation.current) {
        setScanning(false)
      }
    }
  }, [app, projectId, item.id, item.ref])

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

  function handleLink(): void {
    if (busyRef.current || pendingLinkName === null) {
      return
    }
    // The link write is persisted in main: while it is in flight the dismiss
    // controls stay locked, so the confirmation always reaches a visible link.
    busyRef.current = true
    setBusy(true)
    setError(null)
    const fileName = pendingLinkName
    void app.kanban
      .linkHandoff({ projectId, itemId: item.id, ref: item.ref, fileName })
      .then((next) => {
        if (!openRef.current) {
          return
        }
        busyRef.current = false
        setBusy(false)
        if (next.state === 'not-configured') {
          setResult(null)
          setPhase('not-configured')
          return
        }
        if (next.state === 'error') {
          setError(next.message)
          return
        }
        setResult(next)
        setPhase('ready')
        setSelection(defaultSelection(next))
        setLinkOpen(false)
        setPendingLinkName(null)
      })
      .catch((cause: unknown) => {
        if (!openRef.current) {
          return
        }
        busyRef.current = false
        setBusy(false)
        setError(errorMessage(cause, 'Failed to link the handoff.'))
      })
  }

  function handleConfirm(): void {
    if (busyRef.current || phase !== 'ready' || selection === null || selectedProfileId === null) {
      return
    }
    const chosen = options.find((option) => option.name === selection)
    if (chosen === undefined) {
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    const input: KanbanResumeLaunchInput = {
      projectId,
      itemId: item.id,
      ref: item.ref,
      profileId: selectedProfileId,
      attemptId: crypto.randomUUID(),
      mode: 'resume',
      fileName: chosen.name,
      stamp: chosen.modifiedAt,
    }
    // While in flight the dismiss controls are locked, so a confirmed resume
    // always reaches onLaunched; main owns the file and the stamp recheck.
    void app.kanban
      .launchTask(input)
      .then((launchResult) => {
        if (!openRef.current) {
          return
        }
        onLaunched?.({ ...launchResult, input })
      })
      .catch((launchError: unknown) => {
        if (!openRef.current) {
          return
        }
        busyRef.current = false
        setBusy(false)
        setError(errorMessage(launchError, 'Failed to resume the task.'))
      })
  }

  const options = result === null ? [] : candidateOptions(result)
  const canConfirm =
    phase === 'ready' &&
    !linkOpen &&
    !busy &&
    !scanning &&
    selection !== null &&
    profilePhase === 'ready' &&
    selectedProfileId !== null &&
    options.some((option) => option.name === selection)

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
              Reading handoffs…
            </p>
          ) : null}

          {phase === 'not-configured' ? (
            <div className="mt-3 text-[12.6px]">
              <p className="text-ink-secondary">
                No handoff directory is configured for this project.
              </p>
              <button
                type="button"
                className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info"
                data-testid={TEST_ID.kanbanResumeConfigure}
                onClick={onConfigureHandoffs}
              >
                Configure handoffs
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
                  {result.rejections.map((rejection) => (
                    <li key={rejection.name}>
                      {rejection.name}: {rejection.reason}
                    </li>
                  ))}
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
                  <legend className="text-[12.6px] font-semibold text-ink">Handoff</legend>
                  <div
                    className="mt-2 flex flex-col gap-1"
                    data-testid={TEST_ID.kanbanResumeCandidates}
                  >
                    {options.map((option) => (
                      <label
                        key={option.name}
                        className="flex items-center gap-2 text-[12.6px] text-ink"
                        data-testid={testIdFor.kanbanResumeCandidate(option.name)}
                      >
                        <input
                          type="radio"
                          name="kanban-resume-file"
                          value={option.name}
                          checked={selection === option.name}
                          onChange={() => {
                            setSelection(option.name)
                          }}
                        />
                        <span className="truncate">{option.name}</span>
                        <span className="shrink-0 text-ink-muted">{matchLabel(option.kind)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {linkOpen ? (
                <div className="mt-3 text-[12.6px]" data-testid={TEST_ID.kanbanResumeLinkList}>
                  {result.files.length === 0 ? (
                    <p className="text-ink-secondary">No files in the handoff directory.</p>
                  ) : (
                    <ul className="list-none space-y-1">
                      {result.files.map((file: HandoffFileInfo) => (
                        <li key={file.name}>
                          <label
                            className="flex items-center gap-2 text-ink"
                            data-testid={testIdFor.kanbanResumeLinkOption(file.name)}
                          >
                            <input
                              type="radio"
                              name="kanban-resume-link-file"
                              value={file.name}
                              checked={pendingLinkName === file.name}
                              onChange={() => {
                                setPendingLinkName(file.name)
                              }}
                            />
                            <span className="truncate">{file.name}</span>
                            <span className="truncate text-ink-muted">{file.path}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info disabled:opacity-50"
                    data-testid={TEST_ID.kanbanResumeLinkConfirm}
                    disabled={pendingLinkName === null || busy}
                    onClick={handleLink}
                  >
                    Link handoff
                  </button>
                </div>
              ) : null}
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
            {phase === 'ready' && !linkOpen ? (
              <button
                type="button"
                disabled={busy}
                className="h-control rounded-md bg-button px-4 text-[12.6px] text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info disabled:opacity-50"
                data-testid={TEST_ID.kanbanResumeLink}
                onClick={() => {
                  setPendingLinkName(selection)
                  setLinkOpen(true)
                }}
              >
                Link handoff
              </button>
            ) : null}
            <button
              type="button"
              className="h-control rounded-md bg-button px-4 text-[12.6px] text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info disabled:opacity-50"
              data-testid={TEST_ID.kanbanResumeConfirm}
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              Resume
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
