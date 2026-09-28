import type React from 'react'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { TEST_ID } from '../../lib/test-ids'
import { NoticeBanner } from '../layout/NoticeBanner'
import { ResizeHandle } from '../layout/ResizeHandle'
import { FileTree } from './FileTree'
import type { ProjectFilesSession } from './files-types'

// Left panel of Project Files mode (spec Behaviour 4): `← Projects` back
// affordance, the project name, and the project's file tree. The tree area
// carries the inline error state (missing/unreadable project directory — the
// rest of the app keeps working and `← Projects` always exits, spec Errors).

interface ProjectFilesPanelProps {
  width: number
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  project: ProjectInfo
  session: ProjectFilesSession
  /** Exits Project Files mode (`← Projects`, spec Behaviour 12). */
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
      className={cn('flex shrink-0 flex-col border-r border-edge bg-panel')}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <button
          type="button"
          className="rounded px-1.5 py-1 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.filesBackButton}
          onClick={onBack}
        >
          ← Projects
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
