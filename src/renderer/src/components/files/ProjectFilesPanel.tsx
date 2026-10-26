import { shortenHomePath } from '@shared/home-path'
import type { ProjectInfo } from '@shared/ipc-contract'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { Icon } from '../../lib/icons'
import { getProjectColor, getProjectInitials } from '../../lib/project-avatar'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { NoticeBanner } from '../layout/NoticeBanner'
import { FileTree } from './FileTree'
import type { ProjectFilesSession } from './files-types'

interface ProjectFilesPanelProps {
  project: ProjectInfo
  session: ProjectFilesSession
  projectNamesUppercase?: boolean
  showProjectIcons?: boolean
  projectColor?: string
  /** Home directory and host platform (AppApi); the subheader shows home as `~`. */
  homeDir?: string
  platform?: string
  /** Exits Project Files mode (the back affordance, spec Behaviour 12). */
  onBack: () => void
  /** Re-reads the root and every expanded directory (spec Behaviour 25). */
  onRefresh: () => void
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  onShowInFolder: (relativePath: string) => void
  onCopyPath: (relativePath: string) => void
  onCopyRelativePath: (relativePath: string) => void
  onTrash: (relativePath: string) => void
  notice: string | null
  /** Bottom-of-panel strip (App Settings opener), rendered after the
      tree area. The slot owns the resize handle. */
  children?: React.ReactNode
}

export function ProjectFilesPanel({
  project,
  session,
  projectNamesUppercase = true,
  showProjectIcons = true,
  projectColor,
  homeDir,
  platform,
  onBack,
  onRefresh,
  onToggleDirectory,
  onSelectFile,
  onShowInFolder,
  onCopyPath,
  onCopyRelativePath,
  onTrash,
  notice,
  children,
}: ProjectFilesPanelProps): React.JSX.Element {
  const backButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    backButtonRef.current?.focus()
  }, [])

  const color = projectColor ?? getProjectColor(project)
  const initials = getProjectInitials(project.name)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the panel catches Escape to act as back button
    <div
      className="flex h-full min-h-0 w-full flex-col bg-panel"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !document.querySelector('[data-testid="file-tree-context-menu"]')
        ) {
          onBack()
        }
      }}
    >
      {/* Back row: one full-width labelled button (NEKODE-103) */}
      <div className="flex h-control shrink-0 items-center px-2 py-1.5">
        <button
          type="button"
          ref={backButtonRef}
          className="flex h-full w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-panel text-sm text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid={TEST_ID.filesBackButton}
          aria-label="Back to projects"
          onClick={onBack}
        >
          <Icon.back size={14} aria-hidden />
          <span>Back to Projects</span>
        </button>
      </div>
      {/* Project row: avatar and name in active style, refresh button */}
      <div className="flex h-control shrink-0 items-center px-3 py-1.5">
        {showProjectIcons ? (
          <span
            aria-hidden="true"
            data-testid={testIdFor.projectAvatar(project.id)}
            className="mr-2 flex h-5 w-5 shrink-0 select-none items-center justify-center rounded font-mono text-[10px] font-bold leading-none"
            style={{
              color: color,
              backgroundColor: `${color}2e`,
            }}
          >
            {initials}
          </span>
        ) : null}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-project-title"
          data-testid={TEST_ID.filesProjectName}
          title={project.path}
        >
          {projectNamesUppercase ? project.name.toUpperCase() : project.name}
        </span>
        <button
          type="button"
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-transparent text-ink-muted hover:bg-[#232C41] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          data-testid={TEST_ID.filesRefreshButton}
          aria-label={session.refreshing ? 'Refreshing' : 'Refresh'}
          title={session.refreshing ? 'Refreshing' : 'Refresh'}
          aria-busy={session.refreshing}
          disabled={session.refreshing}
          onClick={onRefresh}
        >
          <Icon.retry
            size={12}
            aria-hidden
            className={session.refreshing ? 'animate-spin' : undefined}
          />
        </button>
      </div>
      {/* Subheader: Files label in Projects header style + muted monospace project path */}
      <div className="flex h-[calc(var(--spacing-control)+0.3125rem)] shrink-0 items-center gap-2 px-5">
        <span className="text-sm uppercase text-projects-header shrink-0">Files</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted"
          data-testid={TEST_ID.filesProjectPath}
          title={project.path}
        >
          {shortenHomePath(project.path, homeDir, platform)}
        </span>
      </div>
      <NoticeBanner notice={notice} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid={TEST_ID.fileTree}>
        {session.treeError !== null ? (
          <p
            className="mx-1 rounded-md border border-error/50 bg-error/10 px-2 py-1.5 text-xs leading-relaxed text-error"
            data-testid={TEST_ID.fileTreeError}
            role="alert"
          >
            {session.treeError}
          </p>
        ) : (
          <FileTree
            childrenByPath={session.childrenByPath}
            expandedPaths={session.expandedPaths}
            selectedPath={session.selectedPath}
            statuses={session.gitStatuses}
            onToggleDirectory={onToggleDirectory}
            onSelectFile={onSelectFile}
            onShowInFolder={onShowInFolder}
            onCopyPath={onCopyPath}
            onCopyRelativePath={onCopyRelativePath}
            onTrash={onTrash}
          />
        )}
      </div>
      {children}
    </div>
  )
}
