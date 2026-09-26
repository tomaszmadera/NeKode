import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  AppApi,
  GitStatus,
  GitWorktreeStatus,
  ProjectInfo,
} from '../../../../shared/ipc-contract'
import { emptyGitWorktree } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'

// Status bar at the very bottom of the window (UX-UI §14): the project
// context relocated from the removed center context header — project name,
// visually truncated path (full on hover), runtime badges with `+N` collapse
// (UX-UI §15) and Git branch + worktree status in the §16 forms with hover
// details. With no active project the project section is empty and the bar
// itself stays. A git failure degrades to "no git" (no branch, neutral
// status) instead of failing the workspace (spec Errors / Edge cases).

interface StatusBarProps {
  app: AppApi
  /** The active workspace project (Files-mode project, else the selected one). */
  project: ProjectInfo | null
}

/** Branch glyph of the UX-UI §16 form: U+E0A0 + space + branch name. */
const BRANCH_GLYPH = String.fromCharCode(0xe0a0)
const NEWLINE = String.fromCharCode(10)

/** Runtime badges show at most three labels; the rest collapse to `+N` (§15). */
export const MAX_RUNTIME_BADGES = 3

/** The stored runtime label is a comma-separated label list (UX-UI §15). */
export function runtimeLabels(runtimeLabel: string | null): string[] {
  if (runtimeLabel === null) {
    return []
  }
  return runtimeLabel
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** Worktree status form (UX-UI §16): `✓ clean`, `● N changes`, `! N conflicts`. */
export function gitStatusText(worktree: GitWorktreeStatus): string {
  if (worktree.conflicts > 0) {
    return `! ${worktree.conflicts} conflicts`
  }
  const changes = worktree.modified + worktree.added + worktree.deleted + worktree.untracked
  return changes > 0 ? `● ${changes} changes` : '✓ clean'
}

/** Hover details table (UX-UI §16): one `Label value` row per category. */
export function gitHoverDetails(worktree: GitWorktreeStatus): string {
  const rows: Array<[string, number]> = [
    ['Modified', worktree.modified],
    ['Added', worktree.added],
    ['Deleted', worktree.deleted],
    ['Untracked', worktree.untracked],
    ['Conflicts', worktree.conflicts],
    ['Ahead', worktree.ahead],
    ['Behind', worktree.behind],
  ]
  return rows.map(([label, value]) => `${label.padEnd(12)}${value}`).join(NEWLINE)
}

export function StatusBar({ app, project }: StatusBarProps): React.JSX.Element {
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
        // Spec Errors: a git failure degrades to the "no git" state.
        if (!cancelled) {
          setGitStatus({ branch: null, dirty: false, worktree: emptyGitWorktree() })
        }
      })
    return () => {
      cancelled = true
    }
  }, [app, projectId, projectPath])

  const labels = runtimeLabels(project?.runtimeLabel ?? null)
  const visibleLabels = labels.slice(0, MAX_RUNTIME_BADGES)
  const hiddenLabels = labels.slice(MAX_RUNTIME_BADGES)

  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 text-xs"
      data-testid={TEST_ID.statusBar}
    >
      {project !== null ? (
        <>
          <span
            className="shrink-0 font-medium text-neutral-200"
            data-testid={TEST_ID.statusProjectName}
          >
            {project.name}
          </span>
          <span
            className="min-w-0 truncate text-neutral-500"
            data-testid={TEST_ID.statusProjectPath}
            title={project.path}
          >
            {project.path}
          </span>
          {visibleLabels.length > 0 ? (
            <span className="flex shrink-0 items-center gap-1" data-testid={TEST_ID.statusRuntimes}>
              {visibleLabels.map((label) => (
                <span key={label} className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  {label}
                </span>
              ))}
              {hiddenLabels.length > 0 ? (
                <span
                  className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400"
                  data-testid={TEST_ID.statusRuntimeMore}
                  title={hiddenLabels.join(', ')}
                >
                  {`+${hiddenLabels.length}`}
                </span>
              ) : null}
            </span>
          ) : null}
          <GitSection status={gitStatus} />
        </>
      ) : null}
    </footer>
  )
}

function GitSection({ status }: { status: GitStatus | null }): React.JSX.Element | null {
  if (status === null) {
    return null
  }
  if (status.branch === null) {
    // Degraded "no git" state (not a repository, git missing, any failure):
    // no branch, neutral status — never an error banner.
    return (
      <span className="shrink-0 text-neutral-600" data-testid={TEST_ID.statusGitNone}>
        no git
      </span>
    )
  }
  return (
    <>
      <span className="shrink-0 text-neutral-300" data-testid={TEST_ID.statusGitBranch}>
        {`${BRANCH_GLYPH} ${status.branch}`}
      </span>
      <span
        className="shrink-0 text-neutral-400"
        data-testid={TEST_ID.statusGitStatus}
        title={gitHoverDetails(status.worktree)}
      >
        {gitStatusText(status.worktree)}
      </span>
    </>
  )
}
