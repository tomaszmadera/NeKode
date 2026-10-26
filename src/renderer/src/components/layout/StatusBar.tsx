import { shortenHomePath } from '@shared/home-path'
import type { AppApi, GitStatus, GitWorktreeStatus, ProjectInfo } from '@shared/ipc-contract'
import { emptyGitWorktree } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { BASE_THEME_ID, nextThemeId, THEMES, type ThemeId } from '../../lib/theme'
import './StatusBar.css'

// Status bar at the very bottom of the window (UX-UI §14): the project
// context relocated from the removed center context header — project name,
// visually truncated path (full on hover), runtime badges with `+N` collapse
// (UX-UI §15) and Git branch + worktree status in the §16 forms with hover
// details. With no active project the project section is empty and the bar
// itself stays. A git failure degrades to "no git" (no branch, neutral
// status) instead of failing the workspace (spec Errors / Edge cases).

export const STATUS_BAR_GIT_REFRESH_INTERVAL_MS = 10_000

export interface StatusBarProps {
  app: AppApi
  /** The active workspace project (Files-mode project, else the selected one). */
  project: ProjectInfo | null
  /** Optional external refresh trigger / version nonce. */
  refreshTrigger?: unknown
  /** Active theme ID. */
  theme?: ThemeId
  /** Whether the quick theme switcher in the status bar is enabled. */
  quickThemeSwitch?: boolean
  /** Callback when the user switches theme from the status bar. */
  onThemeChange?: (theme: ThemeId) => void
  /** Optional error callback for git sync failures (surfaced to workspace notice banner). */
  onError?: (message: string) => void
  /** Whether the bottom panel (terminal) is currently open. */
  bottomOpen?: boolean
  /** Callback to toggle opening and closing the bottom terminal. */
  onToggleBottom?: () => void
}

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

export function StatusBar({
  app,
  project,
  refreshTrigger,
  theme,
  quickThemeSwitch = false,
  onThemeChange,
  onError,
  bottomOpen = false,
  onToggleBottom,
}: StatusBarProps): React.JSX.Element {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [syncingProjects, setSyncingProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [syncNonce, setSyncNonce] = useState(0)

  const projectId = project?.id ?? null
  const syncing = projectId !== null && syncingProjects.has(projectId)

  const handleSync = async () => {
    if (projectId === null || syncingProjects.has(projectId)) return
    const activeId = projectId
    setSyncingProjects((prev) => {
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
    try {
      await app.git.sync(activeId)
    } catch (error) {
      const message =
        parseAppErrorPayload(error)?.message ??
        (error instanceof Error ? error.message : 'Git sync failed.')
      onError?.(message)
    } finally {
      setSyncingProjects((prev) => {
        const next = new Set(prev)
        next.delete(activeId)
        return next
      })
      setSyncNonce((n) => n + 1)
    }
  }

  useEffect(() => {
    if (projectId === null) {
      setGitStatus(null)
      return
    }
    let cancelled = false
    void refreshTrigger
    void syncNonce

    const fetchStatus = () => {
      void app.git
        .getStatus(projectId)
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
    }

    fetchStatus()

    const onFocus = () => {
      fetchStatus()
    }
    window.addEventListener('focus', onFocus)

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchStatus()
      }
    }, STATUS_BAR_GIT_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [app, projectId, refreshTrigger, syncNonce])

  const labels = runtimeLabels(project?.runtimeLabel ?? null)
  const visibleLabels = labels.slice(0, MAX_RUNTIME_BADGES)
  const hiddenLabels = labels.slice(MAX_RUNTIME_BADGES)

  return (
    <footer
      className="nk-status-bar flex h-7 shrink-0 items-center gap-3 border-t border-edge bg-panel px-3 text-xs"
      data-testid={TEST_ID.statusBar}
      data-slide-state={project !== null ? 'open' : 'closed'}
      data-panel-visible={project !== null ? 'true' : 'false'}
    >
      {project !== null ? (
        <>
          <span
            className="nk-status-project shrink-0 font-medium text-ink"
            data-testid={TEST_ID.statusProjectName}
          >
            {project.name}
          </span>
          <span
            className="status-bar-section min-w-0 truncate font-mono text-ink-muted"
            data-testid={TEST_ID.statusProjectPath}
            title={project.path}
          >
            {shortenHomePath(project.path, app.homeDir, app.platform)}
          </span>
          {visibleLabels.length > 0 ? (
            <span
              className="status-bar-section flex shrink-0 items-center gap-1"
              data-testid={TEST_ID.statusRuntimes}
            >
              {visibleLabels.map((label) => (
                <span key={label} className="rounded bg-highlight px-1.5 py-0.5 text-ink-secondary">
                  {label}
                </span>
              ))}
              {hiddenLabels.length > 0 ? (
                <span
                  className="rounded bg-highlight px-1.5 py-0.5 text-ink-muted"
                  data-testid={TEST_ID.statusRuntimeMore}
                  title={hiddenLabels.join(', ')}
                >
                  {`+${hiddenLabels.length}`}
                </span>
              ) : null}
            </span>
          ) : null}
          <GitSection status={gitStatus} syncing={syncing} onSync={handleSync} />
        </>
      ) : null}
      {quickThemeSwitch && onThemeChange && theme ? (
        <ThemeSwitchSection theme={theme} onThemeChange={onThemeChange} />
      ) : null}
      {onToggleBottom ? (
        <TerminalToggleSection
          open={bottomOpen}
          onToggle={onToggleBottom}
          hasLeadingRightItem={Boolean(quickThemeSwitch && onThemeChange && theme)}
        />
      ) : null}
    </footer>
  )
}

function TerminalToggleSection({
  open,
  onToggle,
  hasLeadingRightItem,
}: {
  open: boolean
  onToggle: () => void
  hasLeadingRightItem: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'status-bar-terminal-toggle flex h-5 w-5 shrink-0 cursor-pointer select-none items-center justify-center rounded transition-colors focus-visible:outline focus-visible:outline-info',
        !hasLeadingRightItem && 'ml-auto',
        open ? 'bg-highlight text-ink' : 'text-ink-muted hover:bg-highlight hover:text-ink',
      )}
      data-testid={TEST_ID.statusTerminalToggle}
      aria-label={open ? 'Close bottom terminal' : 'Open bottom terminal'}
      aria-pressed={open}
      title={open ? 'Close bottom terminal (Ctrl+`)' : 'Open bottom terminal (Ctrl+`)'}
      onClick={onToggle}
    >
      <Icon.terminal size={13} aria-hidden />
    </button>
  )
}

function ThemeSwitchSection({
  theme,
  onThemeChange,
}: {
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
}): React.JSX.Element {
  const currentTheme = THEMES[theme] ?? THEMES[BASE_THEME_ID]
  const next = nextThemeId(theme)
  const nextLabel = THEMES[next]?.label ?? next

  return (
    <button
      type="button"
      className="status-bar-theme-switcher ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border border-edge bg-button px-2 py-0.5 text-xs text-ink transition-colors hover:bg-button-hover hover:text-ink focus-visible:outline focus-visible:outline-info"
      data-testid={TEST_ID.statusThemeSwitcher}
      aria-label={`Current theme: ${currentTheme.label}. Click to switch to ${nextLabel}`}
      title={`Current theme: ${currentTheme.label} (click to switch to ${nextLabel})`}
      onClick={() => onThemeChange(next)}
    >
      <Icon.theme size={12} aria-hidden className="text-ink-secondary" />
      <span className="font-medium">{currentTheme.label}</span>
    </button>
  )
}

function GitSection({
  status,
  syncing,
  onSync,
}: {
  status: GitStatus | null
  syncing: boolean
  onSync: () => void
}): React.JSX.Element | null {
  if (status === null) {
    return null
  }
  if (status.branch === null) {
    // Degraded "no git" state (not a repository, git missing, any failure):
    // no branch, neutral status — never an error banner.
    return (
      <span
        className="status-bar-section shrink-0 text-ink-disabled"
        data-testid={TEST_ID.statusGitNone}
      >
        no git
      </span>
    )
  }
  const { worktree } = status
  const changes = worktree.modified + worktree.added + worktree.deleted + worktree.untracked
  const statusColor =
    worktree.conflicts > 0 ? 'text-error' : changes > 0 ? 'text-warning' : 'text-success'
  return (
    <>
      <span
        className="status-bar-section flex shrink-0 items-center gap-1 font-mono text-ink-secondary"
        data-testid={TEST_ID.statusGitBranch}
      >
        <Icon.git size={12} aria-hidden />
        {status.branch}
      </span>
      <span
        className={`shrink-0 ${statusColor}`}
        data-testid={TEST_ID.statusGitStatus}
        title={gitHoverDetails(status.worktree)}
      >
        {gitStatusText(status.worktree)}
      </span>
      <button
        type="button"
        className="status-bar-git-sync flex shrink-0 cursor-pointer select-none items-center gap-1 rounded border border-edge bg-button px-1.5 py-0.5 text-xs text-ink transition-colors hover:bg-button-hover hover:text-ink focus-visible:outline focus-visible:outline-info disabled:cursor-not-allowed disabled:opacity-50"
        data-testid={TEST_ID.statusGitSync}
        aria-label={syncing ? 'Syncing...' : 'Sync'}
        title={syncing ? 'Syncing repository...' : 'Sync repository (pull, push, push tags)'}
        disabled={syncing}
        onClick={onSync}
      >
        <Icon.retry
          size={12}
          aria-hidden
          className={syncing ? 'animate-spin text-ink-secondary' : 'text-ink-secondary'}
        />
        <span className="font-medium">Sync</span>
      </button>
    </>
  )
}
