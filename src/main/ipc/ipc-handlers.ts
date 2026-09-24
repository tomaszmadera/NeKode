import { dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNEL } from '../../shared/ipc-contract'
import { AppError, type AppErrorPayload, toTransportError } from '../../shared/ipc-error'
import { type InvokeSenderInfo, isTrustedSender } from '../security/sender-guard'
import { buildValidatedChannels, type ValidatedChannel } from './ipc-validation'
import type { AppServices } from './service-registry'

// Channels served by real Stage 2 services (validated payloads) plus the
// Stage 3 stub channels kept on fixed values. Terminal channels stay stubbed
// here until Stage 3; git:status degrades to "no git" (branch: null) which is
// the honest default before the real read-only parser lands.

const STUB_CHANNELS: ReadonlySet<string> = new Set([
  IPC_CHANNEL.terminalsCreate,
  IPC_CHANNEL.terminalsWrite,
  IPC_CHANNEL.terminalsResize,
  IPC_CHANNEL.terminalsTerminate,
  IPC_CHANNEL.gitStatus,
])

export interface RegisterHandlersOptions {
  /** Native directory picker; injectable for tests. */
  showOpenDialog?: typeof dialog.showOpenDialog
  /**
   * Renderer URLs allowed to invoke IPC (the loaded document or the dev
   * server root). Fail closed: with an empty list every invoke is rejected.
   */
  trustedRendererUrls?: readonly string[]
}

export function registerAppIpcHandlers(
  ipcMain: IpcMain,
  services: AppServices,
  options: RegisterHandlersOptions = {},
): void {
  const trustedRendererUrls = options.trustedRendererUrls ?? []
  const showOpenDialog = options.showOpenDialog ?? dialog.showOpenDialog

  const validated = new Map<string, ValidatedChannel>()
  for (const entry of buildValidatedChannels(services)) {
    validated.set(entry.channel, entry)
  }

  function assertTrustedSender(event: IpcMainInvokeEvent, channel: string): void {
    const senderFrame = event.senderFrame
    const info: InvokeSenderInfo = {
      url: senderFrame?.url ?? null,
      isMainFrame:
        senderFrame !== null &&
        senderFrame !== undefined &&
        senderFrame === (event.sender as unknown as { mainFrame?: unknown }).mainFrame,
    }
    if (!isTrustedSender(info, trustedRendererUrls)) {
      throw new AppError('validation', 'Rejected untrusted IPC sender.', channel)
    }
  }

  function handle(channel: string, run: (payload: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...payload: unknown[]) => {
      try {
        assertTrustedSender(event, channel)
        return run(payload)
      } catch (error) {
        // Full error details stay on the main side; the renderer receives the
        // sanitized typed payload (ipc-error.ts).
        if (!(error instanceof AppError)) {
          console.error(`[ipc] ${channel} failed:`, error)
        }
        throw toTransportError(error, channel)
      }
    })
  }

  // projects:add is special: the directory dialog opens in main. Its payload
  // is empty; a user cancel resolves null (renderer contract).
  handle(IPC_CHANNEL.projectsAdd, (payload) => {
    const entry = validated.get(IPC_CHANNEL.projectsAdd)
    if (entry) {
      entry.parse(payload)
    }
    return showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add Project',
    }).then((result) => {
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return services.projects.add(result.filePaths[0])
    })
  })

  for (const [channel, entry] of validated) {
    if (channel === IPC_CHANNEL.projectsAdd) {
      continue
    }
    handle(channel, (payload) => {
      const args = entry.parse(payload)
      return entry.invoke(args)
    })
  }

  // STUB_CHANNELS share the exact same validation path; the set documents
  // which channels still return fixed Stage 3 placeholder values.
  for (const channel of STUB_CHANNELS) {
    if (!validated.has(channel)) {
      console.error(`[ipc] stub channel ${channel} is missing from the validated registry`)
    }
  }
}

export type { AppErrorPayload }
