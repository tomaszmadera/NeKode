import type { FilePreview } from '@shared/contracts/files-contract'
import {
  PREVIEW_CHANNEL,
  type PreviewApi,
  type PreviewTarget,
} from '@shared/contracts/preview-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type { IpcRendererLike } from './bridge-types'

// The whole bridge of a file preview window (docs/features/file-preview-window
// spec Data / API). It exposes no other channel: a preview window has no
// window.app and cannot reach terminals, projects, or file writes.
export function createPreviewApi(ipc: IpcRendererLike): PreviewApi {
  async function invoke<T>(channel: string): Promise<T> {
    try {
      return (await ipc.invoke(channel)) as T
    } catch (error) {
      const payload = parseAppErrorPayload(error)
      if (payload !== null) {
        throw payload
      }
      throw error
    }
  }

  return {
    target: () => invoke<PreviewTarget>(PREVIEW_CHANNEL.target),
    read: () => invoke<FilePreview>(PREVIEW_CHANNEL.read),
    openExternal: () => invoke<void>(PREVIEW_CHANNEL.openExternal),
    onChanged: (listener) => {
      const handler = (): void => {
        listener()
      }
      ipc.on(PREVIEW_CHANNEL.changed, handler)
      return () => {
        ipc.off(PREVIEW_CHANNEL.changed, handler)
      }
    },
  }
}
