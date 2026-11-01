import type { FilePreview } from '@shared/contracts/files-contract'
import { PREVIEW_CHANNEL, type PreviewTarget } from '@shared/contracts/preview-contract'
import { AppError, toTransportError } from '@shared/ipc-error'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BoundPreview } from './preview-windows'

// Preview window IPC (docs/features/file-preview-window/spec.md
// Authorization): served only to the main frame of a registered preview
// window. Payloads are ignored: every call acts on the file main bound to the
// calling window, so a preview renderer can never name another path.

export interface PreviewIpcDeps {
  /** The file bound to a preview window's webContents, or null. */
  targetFor(webContentsId: number): BoundPreview | null
  read(projectId: string, relativePath: string): Promise<FilePreview>
  openExternal(projectId: string, relativePath: string): Promise<void>
}

function boundTarget(
  event: IpcMainInvokeEvent,
  deps: PreviewIpcDeps,
  channel: string,
): BoundPreview {
  const sender = event.sender as unknown as { id: number; mainFrame?: unknown }
  const target = deps.targetFor(sender.id)
  const fromMainFrame =
    event.senderFrame !== null &&
    event.senderFrame !== undefined &&
    event.senderFrame === sender.mainFrame
  if (target === null || !fromMainFrame) {
    throw new AppError('validation', 'Rejected untrusted IPC sender.', channel)
  }
  return target
}

export function registerPreviewIpcHandlers(ipcMain: IpcMain, deps: PreviewIpcDeps): void {
  function handle(channel: string, run: (target: BoundPreview) => unknown): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent) => {
      try {
        return await run(boundTarget(event, deps, channel))
      } catch (error) {
        if (!(error instanceof AppError)) {
          console.error(`[ipc] ${channel} failed:`, error)
        }
        throw toTransportError(error, channel)
      }
    })
  }

  handle(
    PREVIEW_CHANNEL.target,
    (target): PreviewTarget => ({
      projectName: target.projectName,
      relativePath: target.relativePath,
      fileName: target.fileName,
    }),
  )
  handle(PREVIEW_CHANNEL.read, (target) => deps.read(target.projectId, target.relativePath))
  handle(PREVIEW_CHANNEL.openExternal, (target) =>
    deps.openExternal(target.projectId, target.relativePath),
  )
}
