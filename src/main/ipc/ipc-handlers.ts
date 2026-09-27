import { dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNEL } from '../../shared/ipc-contract'
import { AppError, type AppErrorPayload, toTransportError } from '../../shared/ipc-error'
import { type InvokeSenderInfo, isTrustedSender } from '../security/sender-guard'
import { buildValidatedChannels, type ValidatedChannel } from './ipc-validation'
import type { AppServices } from './service-registry'

// All channels are served by real services behind validated payloads (Stage 2
// persistence, Stage 3 terminals/git). Terminal data/exit events are pushed to
// the renderer through the injectable broadcast hook (the real one targets
// every BrowserWindow webContents).

export interface RegisterHandlersOptions {
  /** Native directory picker; injectable for tests. */
  showOpenDialog?: typeof dialog.showOpenDialog
  /**
   * Renderer URLs allowed to invoke IPC (the loaded document or the dev
   * server root). Fail closed: with an empty list every invoke is rejected.
   */
  trustedRendererUrls?: readonly string[]
  /**
   * Main → renderer event fan-out for terminals:data / terminals:exit
   * (channel, chatId, payload). Injectable for tests; main/index.ts targets
   * every BrowserWindow webContents.
   */
  broadcast?: (channel: string, chatId: string, payload: string | number) => void
}

export function registerAppIpcHandlers(
  ipcMain: IpcMain,
  services: AppServices,
  options: RegisterHandlersOptions = {},
): void {
  const trustedRendererUrls = options.trustedRendererUrls ?? []
  const showOpenDialog = options.showOpenDialog ?? dialog.showOpenDialog
  const broadcast = options.broadcast ?? (() => undefined)

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
        const result = run(payload)
        if (result instanceof Promise) {
          // Async service failures serialize like sync ones: the typed
          // AppError becomes the transport payload, never a raw rejection
          // (spec Errors: no raw stack traces over the bridge).
          return result.catch((error: unknown) => {
            if (!(error instanceof AppError)) {
              console.error(`[ipc] ${channel} failed:`, error)
            }
            throw toTransportError(error, channel)
          })
        }
        return result
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

  // projects:remove tears down the removed project's terminal sessions and
  // background action children. Chat ids are resolved before the cascade
  // (the FK wipes the rows). Children are stopped only after the delete
  // succeeds, from the in-memory set the cascade cannot see.
  handle(IPC_CHANNEL.projectsRemove, (payload) => {
    const entry = validated.get(IPC_CHANNEL.projectsRemove)
    const args = entry !== undefined ? entry.parse(payload) : payload
    const projectId = args[0]
    if (typeof projectId !== 'string') {
      throw new AppError('validation', 'projects:remove arg[0] must be a string')
    }
    const chatIds = services.chats.list(projectId).map((chat) => chat.id)
    const result = services.projects.remove(projectId)
    services.actions.stopForProject(projectId)
    for (const chatId of chatIds) {
      services.terminals.terminate(chatId)
    }
    services.terminals.terminateProjectBottom(projectId)
    return result
  })

  // chats:remove is the terminal-exit close flow (spec Behaviour 11): the chat
  // row is deleted and its terminal session record is dropped here in main
  // (the PTY is already dead in this flow; terminate stays idempotent).
  // Application quit never reaches this handler — quit teardown suppresses
  // terminals:exit forwarding (TerminalService.terminateAll) so the renderer
  // never starts this close flow while quitting (spec Behaviour 8).
  handle(IPC_CHANNEL.chatsRemove, (payload) => {
    const entry = validated.get(IPC_CHANNEL.chatsRemove)
    const args = entry !== undefined ? entry.parse(payload) : payload
    const chatId = args[0]
    if (typeof chatId !== 'string') {
      throw new AppError('validation', 'chats:remove arg[0] must be a string')
    }
    services.chats.remove(chatId)
    services.terminals.terminate(chatId)
  })

  for (const [channel, entry] of validated) {
    if (
      channel === IPC_CHANNEL.projectsAdd ||
      channel === IPC_CHANNEL.projectsRemove ||
      channel === IPC_CHANNEL.chatsRemove
    ) {
      continue
    }
    handle(channel, (payload) => {
      const args = entry.parse(payload)
      return entry.invoke(args)
    })
  }

  // Terminal session events (main → renderer), keyed by chatId so hidden
  // chat terminals keep receiving their own data (spec Edge cases). Exit
  // events drive the renderer-side chat close flow (spec Behaviour 11); the
  // TerminalService suppresses them during quit teardown so quitting can
  // never delete chats (spec Behaviour 8).
  services.terminals.onData((chatId, data) => {
    broadcast(IPC_CHANNEL.terminalsData, chatId, data)
  })
  services.terminals.onExit((chatId, exitCode) => {
    broadcast(IPC_CHANNEL.terminalsExit, chatId, exitCode)
  })
}

export type { AppErrorPayload }
