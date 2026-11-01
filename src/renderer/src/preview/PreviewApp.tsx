import type { PreviewApi, PreviewTarget } from '@shared/contracts/preview-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { FilePreview, type FilePreviewSource } from '../components/files/FilePreview'
import { MarkdownViewToggle } from '../components/files/MarkdownViewToggle'
import {
  DEFAULT_MARKDOWN_VIEW,
  isMarkdownPath,
  type MarkdownViewMode,
} from '../components/files/markdown-path'
import { TEST_ID } from '../lib/test-ids'
import { resolveStoredThemeId, THEME_STORAGE_KEY } from '../lib/theme'

// Root of a read-only file preview window (docs/features/file-preview-window).
// It talks only to window.preview: the strip with the file name and path,
// then the same preview surface as a file tab. Markdown opens rendered, with a
// Code | Preview switch at the right end of the strip.

function applyStoredTheme(): void {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    // Storage blocked: the default theme applies, like the main window.
  }
  document.documentElement.dataset.theme = resolveStoredThemeId(stored)
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function PreviewApp({ preview }: { preview: PreviewApi }): React.JSX.Element {
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  // Code | Preview for Markdown lives only as long as this window (Behaviour 14).
  const [markdownView, setMarkdownView] = useState<MarkdownViewMode>(DEFAULT_MARKDOWN_VIEW)
  const isMarkdown = target !== null && isMarkdownPath(target.relativePath)

  // The theme follows the main window (Behaviour 8): both windows share the
  // origin's localStorage, and a write in the main window fires `storage` here.
  useEffect(() => {
    applyStoredTheme()
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        applyStoredTheme()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    preview
      .target()
      .then((next) => {
        if (!cancelled) {
          setTarget(next)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTargetError(errorMessage(error, 'Failed to open the file.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [preview])

  useEffect(
    () =>
      preview.onChanged(() => {
        setRefreshToken((value) => value + 1)
      }),
    [preview],
  )

  const files = useMemo<FilePreviewSource>(
    () => ({
      read: () => preview.read(),
      openExternal: () => preview.openExternal(),
    }),
    [preview],
  )

  return (
    <div className="flex h-screen flex-col bg-app text-ink">
      {/* Drag strip with the file identity; the OS caption buttons overlay
          its right end (Behaviour 6), so the text stops short of them. */}
      <div
        className="nk-title-bar drag-region flex h-10 shrink-0 items-center gap-2 bg-app pr-36 pl-4"
        data-testid={TEST_ID.previewTitleBar}
      >
        {target !== null ? (
          <>
            <span className="shrink-0 text-xs font-medium text-ink">{target.fileName}</span>
            <span className="min-w-0 truncate text-xs text-ink-muted">
              {target.projectName} / {target.relativePath}
            </span>
            {isMarkdown ? (
              <MarkdownViewToggle
                className="no-drag ml-auto"
                mode={markdownView}
                onChange={setMarkdownView}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {notice !== null ? (
        <p
          className="border-t border-edge px-4 py-2 text-xs text-error"
          role="alert"
          data-testid={TEST_ID.previewNotice}
        >
          {notice}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 border-t border-edge">
        {targetError !== null ? (
          <p className="px-4 py-3 text-sm text-error" role="alert">
            {targetError}
          </p>
        ) : null}
        {target !== null ? (
          <FilePreview
            files={files}
            projectId="preview"
            relativePath={target.relativePath}
            refreshToken={refreshToken}
            markdownView={markdownView}
            onOpenExternalError={setNotice}
          />
        ) : null}
      </div>
    </div>
  )
}
