import type React from 'react'
import { TEST_ID } from '../../App'
import { cn } from '../../lib/cn'
import { ResizeHandle } from './ResizeHandle'

interface LeftNavigationProps {
  width: number
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  projects: Array<{ id: string; name: string }>
  onAddProject: () => void
}

export function LeftNavigation({
  width,
  onResizeStart,
  projects,
  onAddProject,
}: LeftNavigationProps): React.JSX.Element {
  return (
    <aside
      className={cn('flex shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40')}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
          Projects
        </h2>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
          data-testid={TEST_ID.addProjectButton}
          onClick={onAddProject}
        >
          Add Project
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <p
            className="px-2 py-3 text-xs leading-relaxed text-neutral-500"
            data-testid={TEST_ID.emptyProjectList}
          >
            No projects yet. Add a local project to start working.
          </p>
        ) : (
          <ul data-testid={TEST_ID.projectList}>
            {projects.map((project) => (
              <li key={project.id} className="rounded px-2 py-1 text-sm text-neutral-200">
                {project.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ResizeHandle axis="x" onResizeStart={onResizeStart} testId={TEST_ID.leftResizeHandle} />
    </aside>
  )
}
