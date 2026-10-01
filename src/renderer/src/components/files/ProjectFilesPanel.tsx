import type React from 'react'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { AppBrand } from '../layout/AppBrand'
import { NoticeBanner } from '../layout/NoticeBanner'
import { ResizeHandle } from '../layout/ResizeHandle'
import { FileTree } from './FileTree'
import type { ProjectFilesSession } from './files-types'

// Left panel of Project Files mode (spec Behaviour 4): the application brand
// (AppBrand, same strip as the default navigation), the project name, an
// icon-only back affordance (tooltip "Back to Projects") and the project's
// file tree. The tree area carries the inline error state (missing/unreadable
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
}: ProjectFilesPanelProps): React.JSX.Element {
  return (
    <aside
      className={cn('slide-in-from-right flex shrink-0 flex-col border-r border-edge bg-panel')}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      {/* Window drag surface (title bar): the top strip is the base app
          background; the back button opts out of dragging. Fixed 40px height
          and padding so the strip matches the default navigation header. */}
      <div className="drag-region flex h-10 items-center gap-2 bg-app px-4">
        <AppBrand />
        <button
          type="button"
          className="no-drag flex items-center rounded p-1 text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.filesBackButton}
          aria-label="Back to Projects"
          title="Back to Projects"
          onClick={onBack}
        >
          <Icon.back size={12} aria-hidden />
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
