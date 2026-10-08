import { useState } from 'react'
import type { AppApi, WorkItem } from '../../../../shared/ipc-contract'
import { KanbanBoard } from './KanbanBoard'

interface Props {
  app: AppApi
  projectIds: ReadonlySet<string>
  activeProjectId: string | null
  versions: Readonly<Record<string, number>>
  onConfigure: () => void
  /** Start on a work item. The shell owns the confirmation dialog. */
  onStart?: (projectId: string, item: WorkItem) => void
  /** Resume on a work item. The shell owns the handoff confirmation dialog. */
  onResume?: (projectId: string, item: WorkItem) => void
}

/** Lazily visited project boards retain DOM and UI state for this App session. */
export function KanbanSessions({
  app,
  projectIds,
  activeProjectId,
  versions,
  onConfigure,
  onStart,
  onResume,
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
        <div
          key={`${id}:${version}`}
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: activeProjectId === id ? 'flex' : 'none' }}
        >
          <KanbanBoard
            app={app}
            projectId={id}
            active={activeProjectId === id}
            onConfigure={onConfigure}
            onStart={
              onStart === undefined
                ? undefined
                : (item) => {
                    onStart(id, item)
                  }
            }
            onResume={
              onResume === undefined
                ? undefined
                : (item) => {
                    onResume(id, item)
                  }
            }
          />
        </div>
      ))}
    </>
  )
}
