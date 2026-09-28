import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { AppApi, FilePreview as FilePreviewData } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import { MonacoPreview } from './MonacoPreview'

// Read-only file preview of one file tab (spec Behaviour 6–7): the classified
// preview — text in Monaco, or the too-large / binary fallback with the single
// OS action ("Open externally"). The breadcrumb is superseded by the tab model
// (the tab tooltip carries the relative path). A file that vanished between
// listing and read shows a localized error state inside this tab only; other
// tabs are unaffected (each tab owns its preview view).

interface FilePreviewProps {
  app: AppApi
  projectId: string
  relativePath: string
  /** Failed Open externally: the host shows the notice banner. */
  onOpenExternalError: (message: string) => void
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: FilePreviewData }

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function FilePreview({
  app,
  projectId,
  relativePath,
  onOpenExternalError,
}: FilePreviewProps): React.JSX.Element {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void app.files
      .read(projectId, relativePath)
      .then((preview) => {
        if (!cancelled) {
          setState({ status: 'ready', preview })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: errorMessage(error, 'Failed to read the file.'),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [app, projectId, relativePath])

  const handleOpenExternal = useCallback((): void => {
    void app.files.openExternal(projectId, relativePath).catch((error: unknown) => {
      onOpenExternalError(errorMessage(error, 'Failed to open the file externally.'))
    })
  }, [app, projectId, relativePath, onOpenExternalError])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {state.status === 'error' ? (
          <p
            className="px-4 py-3 text-sm text-error"
            data-testid={TEST_ID.filePreviewError}
            role="alert"
          >
            {state.message}
          </p>
        ) : null}
        {state.status === 'ready' && state.preview.kind === 'too-large' ? (
          <FallbackState testId={TEST_ID.filePreviewTooLarge} onOpenExternal={handleOpenExternal}>
            This file is too large for preview.
          </FallbackState>
        ) : null}
        {state.status === 'ready' && state.preview.kind === 'binary' ? (
          <FallbackState testId={TEST_ID.filePreviewBinary} onOpenExternal={handleOpenExternal}>
            Binary file
          </FallbackState>
        ) : null}
        {state.status === 'ready' && state.preview.kind === 'text' ? (
          <div className="h-full min-h-0">
            <MonacoPreview content={state.preview.content} language={state.preview.language} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FallbackState({
  testId,
  onOpenExternal,
  children,
}: {
  testId: string
  onOpenExternal: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid={testId}
    >
      <p className="text-sm text-ink-secondary">{children}</p>
      <button
        type="button"
        className="flex h-control items-center gap-1.5 rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
        data-testid={TEST_ID.filePreviewOpenExternal}
        onClick={onOpenExternal}
      >
        <Icon.external size={14} aria-hidden />
        Open externally
      </button>
    </div>
  )
}
