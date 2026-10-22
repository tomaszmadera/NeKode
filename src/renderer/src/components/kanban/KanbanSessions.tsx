import type React from 'react'
import { useCallback, useState } from 'react'
import type { AppApi, WorkItem } from '../../../../shared/ipc-contract'
import { KanbanBoard, type KanbanToolbarControls } from './KanbanBoard'

interface Props {
  app: AppApi
  projectIds: ReadonlySet<string>
  activeProjectId: string | null
  versions: Readonly<Record<string, number>>
  onConfigure: () => void
  /** Opens Project Settings on the handoff-directory tab. */
  onConfigureHandoffs?: (projectId: string) => void
  /** Start on a work item. The shell owns the confirmation dialog. */
  onStart?: (projectId: string, item: WorkItem) => void
  /** Start without sending (NEKODE-99). The shell owns the confirmation dialog. */
  onStartDraft?: (projectId: string, item: WorkItem) => void
  /** Resume on a work item. The shell owns the handoff confirmation dialog. */
  onResume?: (projectId: string, item: WorkItem) => void
  /** Reports toolbar controls of the active board. */
  onToolbarControls?: (projectId: string, controls: KanbanToolbarControls | null) => void
}

function KanbanSessionItem({
  app,
  id,
  version,
  active,
  onConfigure,
  onConfigureHandoffs,
  onStart,
  onStartDraft,
  onResume,
  onToolbarControls,
}: {
  app: AppApi
  id: string
  version: number
  active: boolean
  onConfigure: () => void
  onConfigureHandoffs?: (projectId: string) => void
  onStart?: (projectId: string, item: WorkItem) => void
  onStartDraft?: (projectId: string, item: WorkItem) => void
  onResume?: (projectId: string, item: WorkItem) => void
  onToolbarControls?: (projectId: string, controls: KanbanToolbarControls | null) => void
}): React.JSX.Element {
  const handleControls = useCallback(
    (controls: KanbanToolbarControls | null) => {
      onToolbarControls?.(id, controls)
    },
    [id, onToolbarControls],
  )
  const handleConfigureHandoffs = useCallback(() => {
    onConfigureHandoffs?.(id)
  }, [id, onConfigureHandoffs])
  const handleStart = useCallback(
    (item: WorkItem) => {
      onStart?.(id, item)
    },
    [id, onStart],
  )
  const handleStartDraft = useCallback(
    (item: WorkItem) => {
      onStartDraft?.(id, item)
    },
    [id, onStartDraft],
  )
  const handleResume = useCallback(
    (item: WorkItem) => {
      onResume?.(id, item)
    },
    [id, onResume],
  )

  return (
    <div
      key={`${id}:${version}`}
      className="flex min-h-0 flex-1 flex-col"
      style={{ display: active ? 'flex' : 'none' }}
    >
      <KanbanBoard
        key={`${id}:${version}`}
        app={app}
        projectId={id}
        active={active}
        onConfigure={onConfigure}
        onConfigureHandoffs={
          onConfigureHandoffs === undefined ? undefined : handleConfigureHandoffs
        }
        onStart={onStart === undefined ? undefined : handleStart}
        onStartDraft={onStartDraft === undefined ? undefined : handleStartDraft}
        onResume={onResume === undefined ? undefined : handleResume}
        onToolbarControls={onToolbarControls === undefined ? undefined : handleControls}
      />
    </div>
  )
}

/** Lazily visited project boards retain DOM and UI state for this App session. */
export function KanbanSessions({
  app,
  projectIds,
  activeProjectId,
  versions,
  onConfigure,
  onConfigureHandoffs,
  onStart,
  onStartDraft,
  onResume,
  onToolbarControls,
}: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<Readonly<Record<string, number>>>({})
  const retained = Object.fromEntries(
    Object.entries(sessions).filter(
      ([id, version]) => projectIds.has(id) && version === (versions[id] ?? 0),
    ),
  )
  if (activeProjectId !== null && projectIds.has(activeProjectId)) {
    retained[activeProjectId] = versions[activeProjectId] ?? 0
  }
  // Adjust before rendering children so an invalidated snapshot is never painted.
  if (
    Object.keys(retained).length !== Object.keys(sessions).length ||
    Object.entries(retained).some(([id, version]) => sessions[id] !== version)
  ) {
    setSessions(retained)
  }
  return (
    <>
      {Object.entries(retained).map(([id, version]) => (
        <KanbanSessionItem
          key={`${id}:${version}`}
          app={app}
          id={id}
          version={version}
          active={activeProjectId === id}
          onConfigure={onConfigure}
          onConfigureHandoffs={onConfigureHandoffs}
          onStart={onStart}
          onStartDraft={onStartDraft}
          onResume={onResume}
          onToolbarControls={onToolbarControls}
        />
      ))}
    </>
  )
}
