import type { FilePreview } from './files-contract'

// File preview window bridge (docs/features/file-preview-window/spec.md
// Data / API). These channels belong to preview windows only: they are
// registered apart from IPC_CHANNEL, served to registered preview windows
// only, and never take a project id or path from the renderer (main binds
// each window to one file when it creates the window).
export const PREVIEW_CHANNEL = {
  target: 'preview:target',
  read: 'preview:read',
  openExternal: 'preview:openExternal',
  /** Main to preview window: the bound file changed on disk (or vanished/returned). */
  changed: 'preview:changed',
} as const

/**
 * webPreferences additionalArguments flag main sets on preview windows only.
 * The shared preload exposes window.preview instead of window.app for it.
 */
export const PREVIEW_WINDOW_ARGUMENT = '--nekode-file-preview'

/** Renderer query value that selects the preview root instead of the main app. */
export const PREVIEW_VIEW_QUERY = 'file-preview'

export interface PreviewTarget {
  projectName: string
  relativePath: string
  fileName: string
}

/** `window.preview` in a preview window (src/preload/preview-api.ts). */
export interface PreviewApi {
  target(): Promise<PreviewTarget>
  read(): Promise<FilePreview>
  openExternal(): Promise<void>
  /** Subscribes to change notices; returns the unsubscribe function. */
  onChanged(listener: () => void): () => void
}
