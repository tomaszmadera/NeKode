import type React from 'react'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../App'

// Center context header (UX-UI §14): project name, absolute path and the
// static runtime label from the project record. Git branch/worktree status
// lands in Stage 3 and is intentionally absent here.

interface CenterHeaderProps {
  project: ProjectInfo | null
}

export function CenterHeader({ project }: CenterHeaderProps): React.JSX.Element {
  return (
    <div
      className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800 px-4"
      data-testid={TEST_ID.centerHeader}
    >
      {project === null ? (
        <>
          <span className="text-sm font-medium text-neutral-200">NeKode</span>
          <span className="truncate text-xs text-neutral-500">
            Select a project to see its context
          </span>
        </>
      ) : (
        <>
          <span
            className="shrink-0 text-sm font-medium text-neutral-100"
            data-testid={TEST_ID.headerProjectName}
          >
            {project.name}
          </span>
          <span
            className="min-w-0 truncate text-xs text-neutral-500"
            data-testid={TEST_ID.headerProjectPath}
            title={project.path}
          >
            {project.path}
          </span>
          {project.runtimeLabel !== null ? (
            <span
              className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300"
              data-testid={TEST_ID.headerRuntimeLabel}
            >
              {project.runtimeLabel}
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}
