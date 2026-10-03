import type React from 'react'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { NoticeBanner } from '../layout/NoticeBanner'
import { ResizeHandle } from '../layout/ResizeHandle'
import { FileTree } from './FileTree'
import type { ProjectFilesSession } from './files-types'

// Left panel of Project Files mode (spec Behaviour 4): a header with the
// project name and a labelled "Back to Projects" button,
// then the project's file tree. The application brand lives in the window
// title bar. The tree area carries the inline error state (missing/unreadable
// project directory — the rest of the app keeps working and the back
// affordance always exits, spec Errors).

interface ProjectFilesPanelProps {
  width: number
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  project: ProjectInfo
  session: ProjectFilesSession
  /** Exits Project Files mode (the back affordance, spec Behaviour 12). */
  onBack: () => void
  onToggleDirectory: (relativePath: string) => void
  onSelectFile: (relativePath: string) => void
  notice: string | null
  /** Bottom-of-panel strip (App Settings opener), rendered after the
      tree area and above the resize handle. */
  children?: React.ReactNode
}

export function ProjectFilesPanel({
  width,
  onResizeStart,
  onResizeNudge,
  project,
  session,
  onBack,
  onToggleDirectory,
  onSelectFile,
  notice,
  children,
}: ProjectFilesPanelProps): React.JSX.Element {
  return (
    <aside
      className={cn('slide-in-from-right flex shrink-0 flex-col border-r border-edge bg-panel')}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      {/* Separate rows keep the destination readable at the minimum panel
          width. The back button opts out of window dragging. */}
      <div className="drag-region flex shrink-0 flex-col gap-2 bg-app px-4 py-2">
        <button
          type="button"
          className="no-drag flex items-center gap-1.5 self-start rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid={TEST_ID.filesBackButton}
          aria-label="Back to Projects"
          title="Back to Projects"
          onClick={onBack}
        >
          <Icon.back size={12} aria-hidden />
          Back to Projects
        </button>
        <span
          className="min-w-0 truncate text-xs font-medium text-ink"
          data-testid={TEST_ID.filesProjectName}
          title={project.path}
        >
          {project.name}
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
            onToggleDirectory={onToggleDirectory}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
      {children}
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
