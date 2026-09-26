import type React from 'react'
import type { AppApi, ProjectInfo } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { FilePreview } from './FilePreview'

// Center surface of Project Files mode (spec Behaviour 4, 7, 9): the "Files"
// view label (no Kanban tab — post-MVP) and the main area, which shows the
// empty state until a file is selected and the read-only preview afterwards.

interface ProjectFilesSurfaceProps {
  app: AppApi
  project: ProjectInfo
  /** Last selected file of the session (retained per project, Behaviour 14). */
  selectedPath: string | null
  onOpenExternalError: (message: string) => void
}

export function ProjectFilesSurface({
  app,
  project,
  selectedPath,
  onOpenExternalError,
}: ProjectFilesSurfaceProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex h-9 shrink-0 items-center border-b border-neutral-800 px-4"
        data-testid={TEST_ID.filesViewLabel}
      >
        <span className="text-sm font-medium text-neutral-100">Files</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {selectedPath === null ? (
          <div
            className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500"
            data-testid={TEST_ID.filePreviewEmpty}
          >
            Select a file to preview
          </div>
        ) : (
          <FilePreview
            app={app}
            projectId={project.id}
            relativePath={selectedPath}
            onOpenExternalError={onOpenExternalError}
          />
        )}
      </div>
    </div>
  )
}
