import type React from 'react'
import { useEffect, useState } from 'react'
import type { AppApi, GitStatus, ProjectInfo } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'

// Center context header (UX-UI §14): project name, absolute path, the static
// runtime label from the project record, and git branch/worktree status
// (UX-UI §16) read via the read-only IPC channel. Refreshes on selection
// change only (no watchers — plan Stage 3 risk boundary). A git failure
// degrades to "no git" instead of failing the workspace (spec Errors).

interface CenterHeaderProps {
  app: AppApi
  project: ProjectInfo | null
}

export function CenterHeader({ app, project }: CenterHeaderProps): React.JSX.Element {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)

  const projectId = project?.id ?? null
  const projectPath = project?.path ?? null

  useEffect(() => {
    if (projectId === null || projectPath === null) {
      setGitStatus(null)
      return
    }
    let cancelled = false
    void app.git
      .getStatus(projectPath)
      .then((status) => {
        if (!cancelled) {
          setGitStatus(status)
        }
      })
      .catch(() => {
        // Spec Errors: git invocation failure degrades the header to "no git".
        if (!cancelled) {
          setGitStatus({ branch: null, dirty: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [app, projectId, projectPath])

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
          <GitStatusBadge status={gitStatus} />
        </>
      )}
    </div>
  )
}

function GitStatusBadge({ status }: { status: GitStatus | null }): React.JSX.Element | null {
  if (status === null) {
    return null
  }
  if (status.branch === null) {
    // Degraded "no git" state (not a repository, git missing, any failure).
    return (
      <span
        className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500"
        data-testid={TEST_ID.headerGitNone}
      >
        no git
      </span>
    )
  }
  return (
    <>
      <span
        className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300"
        data-testid={TEST_ID.headerGitBranch}
      >
        {status.branch}
      </span>
      <span className="shrink-0 text-xs text-neutral-400" data-testid={TEST_ID.headerGitStatus}>
        {status.dirty ? '● dirty' : '✓ clean'}
      </span>
    </>
  )
}
