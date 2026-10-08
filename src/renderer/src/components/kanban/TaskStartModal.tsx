import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  AgentProfile,
  AppApi,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID, testIdFor } from '../../lib/test-ids'

interface TaskStartModalProps {
  app: AppApi
  projectId: string
  item: WorkItem
  onCancel: () => void
  /** Project Settings on the Agents tab. Creates no chat. */
  onConfigureAgents: () => void
  onLaunched: (result: KanbanLaunchResult & { input: KanbanLaunchTaskInput }) => void
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

/**
 * Start confirmation (kanban task launch amendment). The host renders this
 * outside the board so a hidden Kanban session cannot hide the dialog.
 * Cancel, Escape, and the backdrop create no chat when idle. While a launch
 * is in flight its dismiss controls are locked, so a confirmed launch always
 * reaches onLaunched; a result arriving after a real unmount is dropped.
 */
export function TaskStartModal({
  app,
  projectId,
  item,
  onCancel,
  onConfigureAgents,
  onLaunched,
}: TaskStartModalProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const openRef = useRef(true)
  const busyRef = useRef(false)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    openRef.current = true
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    return () => {
      openRef.current = false
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    void app.agentProfiles
      .get(projectId)
      .then((loaded) => {
        if (!active || !openRef.current) {
          return
        }
        setProfiles(loaded.profiles)
        setDefaultId(loaded.defaultId)
        const preferred =
          loaded.profiles.find((profile) => profile.id === loaded.defaultId) ?? loaded.profiles[0]
        setSelectedId(preferred?.id ?? null)
        setPhase('ready')
      })
      .catch((loadError: unknown) => {
        if (!active || !openRef.current) {
          return
        }
        setPhase('error')
        setError(errorMessage(loadError, 'Failed to load agent profiles.'))
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

  function handleConfirm(): void {
    if (busyRef.current || selectedId === null || phase !== 'ready') {
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    const input: KanbanLaunchTaskInput = {
      projectId,
      itemId: item.id,
      ref: item.ref,
      profileId: selectedId,
      attemptId: crypto.randomUUID(),
      mode: 'start',
    }
    void app.kanban
      .launchTask(input)
      .then((result) => {
        if (!openRef.current) {
          return
        }
        onLaunched({ ...result, input })
      })
      .catch((launchError: unknown) => {
        if (!openRef.current) {
          return
        }
        busyRef.current = false
        setBusy(false)
        setError(errorMessage(launchError, 'Failed to start the task.'))
      })
  }

  const ready = phase === 'ready'
  const empty = ready && profiles.length === 0

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
          aria-labelledby="kanban-start-title"
          aria-describedby="kanban-start-task"
          aria-busy={busy}
          onKeyDown={handleKeyDown}
          className="w-[min(28rem,92vw)] rounded-lg border border-edge bg-panel p-5 shadow-xl"
          data-testid={TEST_ID.kanbanStartDialog}
        >
          <h2 id="kanban-start-title" className="text-[14.7px] font-semibold text-ink">
            Start task
          </h2>
          <p
            id="kanban-start-task"
            className="mt-2 whitespace-pre-wrap break-words text-[12.6px] text-ink"
            data-testid={TEST_ID.kanbanStartTask}
          >
            {item.ref}: {item.title}
          </p>
          {phase === 'loading' ? (
            <p
              className="mt-3 text-[12.6px] text-ink-secondary"
              data-testid={TEST_ID.kanbanStartLoading}
            >
              Loading agent profiles…
            </p>
          ) : null}
          {empty ? (
            <p
              className="mt-3 text-[12.6px] text-ink-secondary"
              data-testid={TEST_ID.kanbanStartEmpty}
            >
              No agent profiles are configured for this project.
            </p>
          ) : null}
          {ready && profiles.length > 0 ? (
            <fieldset className="mt-3 min-w-0 border-0 p-0" disabled={busy}>
              <legend className="text-[12.6px] font-semibold text-ink">Agent profile</legend>
              <div className="mt-2 flex flex-col gap-1">
                {profiles.map((profile) => (
                  <label
                    key={profile.id}
                    className="flex items-center gap-2 text-[12.6px] text-ink"
                    data-testid={testIdFor.kanbanStartProfile(profile.id)}
                  >
                    <input
                      type="radio"
                      name="task-start-profile"
                      value={profile.id}
                      checked={selectedId === profile.id}
                      onChange={() => {
                        setSelectedId(profile.id)
                      }}
                    />
                    <span className="truncate">{profile.name}</span>
                    {profile.id === defaultId ? (
                      <span className="text-ink-muted">Default</span>
                    ) : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {error !== null ? (
            <p
              className="mt-3 text-[12.6px] text-error"
              role="alert"
              data-testid={TEST_ID.kanbanStartError}
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
              data-testid={TEST_ID.kanbanStartCancel}
              onClick={requestCancel}
            >
              Cancel
            </button>
            {empty ? (
              <button
                type="button"
                className="h-control rounded-md bg-button px-4 text-[12.6px] text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info"
                data-testid={TEST_ID.kanbanStartConfigure}
                onClick={onConfigureAgents}
              >
                Configure agents
              </button>
            ) : (
              <button
                type="button"
                className="h-control rounded-md bg-button px-4 text-[12.6px] text-ink hover:bg-button-hover focus-visible:outline focus-visible:outline-info disabled:opacity-50"
                data-testid={TEST_ID.kanbanStartConfirm}
                disabled={!ready || selectedId === null || busy}
                onClick={handleConfirm}
              >
                Start
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
