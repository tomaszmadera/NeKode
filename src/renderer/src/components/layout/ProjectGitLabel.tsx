import type { AppApi, GitStatus } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect, useState } from 'react'

export function ProjectGitLabel({
  app,
  projectId,
}: {
  app: AppApi
  projectId: string
}): React.JSX.Element | null {
  const [result, setResult] = useState<{ status: GitStatus | null; error: string | null }>({
    status: null,
    error: null,
  })
  useEffect(() => {
    let cancelled = false
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const status = await app.git.getStatus(projectId)
        if (!cancelled) setResult({ status, error: null })
      } catch (error) {
        if (!cancelled)
          setResult({ status: null, error: error instanceof Error ? error.message : String(error) })
      } finally {
        pending = false
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [app, projectId])

  const unavailableReason =
    result.error ??
    (result.status !== null && result.status.branch === null ? 'Git status is unavailable.' : null)
  if (unavailableReason !== null)
    return (
      <span className="nk-project-git" title={unavailableReason}>
        Git unavailable
      </span>
    )
  const status = result.status
  if (!status?.branch) return null
  const { modified, added, deleted, untracked, conflicts } = status.worktree
  const count = modified + added + deleted + untracked + conflicts
  return (
    <span
      className="nk-project-git"
      data-dirty={status.dirty}
      title={`${status.branch}, ${count} changed files`}
    >
      {status.branch}
      {count > 0 ? `  ${count}` : ''}
    </span>
  )
}
