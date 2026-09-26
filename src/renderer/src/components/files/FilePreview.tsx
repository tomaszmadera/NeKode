import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { AppApi, FilePreview as FilePreviewData } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID } from '../../lib/test-ids'
import { MonacoPreview } from './MonacoPreview'

// Read-only file preview (spec Behaviour 7–11): breadcrumb of the relative
// path, then the classified preview — text in Monaco, or the too-large /
// binary fallback with the single OS action ("Open externally"). A file that
// vanished between listing and read shows a localized error state; selecting
// another file works (the effect reloads on path change).

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

function breadcrumb(relativePath: string): string {
  return relativePath.split('/').join(' / ')
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
      <div
        className="shrink-0 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-500"
        data-testid={TEST_ID.filePreviewBreadcrumb}
      >
        {breadcrumb(relativePath)}
      </div>
      <div className="min-h-0 flex-1">
        {state.status === 'error' ? (
          <p
            className="px-4 py-3 text-sm text-red-300"
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
      <p className="text-sm text-neutral-300">{children}</p>
      <button
        type="button"
        className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
        data-testid={TEST_ID.filePreviewOpenExternal}
        onClick={onOpenExternal}
      >
        Open externally
      </button>
    </div>
  )
}
