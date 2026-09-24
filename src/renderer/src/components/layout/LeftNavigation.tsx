import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo, TaskInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { ResizeHandle } from './ResizeHandle'

// Left navigation (UX-UI §9–10): project rows expand to their task lists,
// with Add Project, Remove Project and a New Task input under the active
// project.

interface LeftNavigationProps {
  width: number
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  projects: ProjectInfo[]
  tasksByProject: Record<string, TaskInfo[]>
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  selectedTaskId: string | null
  onSelectProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onSelectTask: (projectId: string, taskId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  onCreateTask: (projectId: string, name: string) => Promise<boolean>
  notice: string | null
}

export function LeftNavigation({
  width,
  onResizeStart,
  onResizeNudge,
  projects,
  tasksByProject,
  expandedProjectIds,
  selectedProjectId,
  selectedTaskId,
  onSelectProject,
  onToggleProject,
  onSelectTask,
  onAddProject,
  onRemoveProject,
  onCreateTask,
  notice,
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
      {notice !== null ? (
        <p
          className="mx-2 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs leading-relaxed text-red-300"
          data-testid={TEST_ID.actionNotice}
          role="alert"
        >
          {notice}
        </p>
      ) : null}
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
            {projects.map((project) => {
              const isExpanded = expandedProjectIds.has(project.id)
              const isSelected = project.id === selectedProjectId
              const tasks = tasksByProject[project.id] ?? []
              return (
                <li key={project.id} className="py-0.5">
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded px-1 py-1',
                      isSelected && 'bg-neutral-800/80',
                    )}
                    data-testid={testIdFor.projectRow(project.id)}
                    data-selected={isSelected ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                      data-testid={testIdFor.projectToggle(project.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${project.name}`}
                      onClick={() => onToggleProject(project.id)}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm text-neutral-200 hover:bg-neutral-800 hover:text-neutral-100"
                      data-testid={testIdFor.projectSelect(project.id)}
                      title={project.path}
                      onClick={() => onSelectProject(project.id)}
                    >
                      {project.name}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
                      data-testid={testIdFor.removeProject(project.id)}
                      aria-label={`Remove Project ${project.name}`}
                      onClick={() => onRemoveProject(project.id)}
                    >
                      Remove
                    </button>
                  </div>
                  {isExpanded ? (
                    <div
                      className="ml-4 border-l border-neutral-800 pl-2"
                      data-testid={testIdFor.projectTasks(project.id)}
                    >
                      {tasks.length === 0 ? (
                        <p className="px-1 py-1 text-xs leading-relaxed text-neutral-500">
                          No tasks yet.
                        </p>
                      ) : (
                        <ul>
                          {tasks.map((task) => {
                            const isTaskSelected = task.id === selectedTaskId && isSelected
                            return (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    'w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100',
                                    isTaskSelected && 'bg-neutral-800 text-neutral-100',
                                  )}
                                  data-testid={testIdFor.taskRow(task.id)}
                                  data-selected={isTaskSelected ? 'true' : 'false'}
                                  onClick={() => onSelectTask(project.id, task.id)}
                                >
                                  {task.name}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {isSelected ? (
                        <NewTaskForm projectId={project.id} onCreateTask={onCreateTask} />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ResizeHandle
        axis="x"
        size={width}
        minSize={LEFT_REGION_SIZE.min}
        maxSize={LEFT_REGION_SIZE.max}
        onResizeStart={onResizeStart}
        onResizeNudge={onResizeNudge}
        testId={TEST_ID.leftResizeHandle}
      />
    </aside>
  )
}

function NewTaskForm({
  projectId,
  onCreateTask,
}: {
  projectId: string
  onCreateTask: (projectId: string, name: string) => Promise<boolean>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const mountedRef = useRef(true)

  // A create that resolves after unmount (task switch mid-submit) must not
  // write state into a dead component.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void onCreateTask(projectId, name).then((created) => {
      if (created && mountedRef.current) {
        setName('')
      }
    })
  }

  return (
    <form
      className="mt-1 flex items-center gap-1 px-1 py-1"
      data-testid={TEST_ID.newTaskForm}
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
        data-testid={TEST_ID.newTaskInput}
        placeholder="New Task"
        aria-label="New task name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="submit"
        className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
        data-testid={TEST_ID.newTaskSubmit}
      >
        Add
      </button>
    </form>
  )
}
