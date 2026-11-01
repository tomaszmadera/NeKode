import type { PreviewApi } from '@shared/contracts/preview-contract'
import type { AppApi } from '@shared/ipc-contract'

export type SelectedBridge = { key: 'app'; api: AppApi } | { key: 'preview'; api: PreviewApi }

/**
 * Picks the single bridge a window receives: a preview window never gets
 * window.app, and the main window never gets window.preview.
 */
export function selectBridge(
  isPreviewWindow: boolean,
  factories: { app: () => AppApi; preview: () => PreviewApi },
): SelectedBridge {
  return isPreviewWindow
    ? { key: 'preview', api: factories.preview() }
    : { key: 'app', api: factories.app() }
}
