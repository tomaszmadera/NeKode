import type {
  ActionControl,
  ActionExecution,
  AppApi,
  ChatInfo,
  FileEntry,
  FilePreview,
  GitStatus,
  HandoffEntry,
  ProjectInfo,
  Unsubscribe,
} from '../shared/ipc-contract'
import { IPC_CHANNEL } from '../shared/ipc-contract'
import { parseAppErrorPayload } from '../shared/ipc-error'
import type { IpcRendererLike } from './bridge-types'

// Structural subset of Electron's IpcRenderer so the bridge can be unit-tested
// without importing electron (SDD §6: the bridge is the only renderer access path).

export function createAppApi(ipc: IpcRendererLike): AppApi {
  // The main process serializes typed AppError rejections into the error
  // message; decode them so the renderer always sees structured payloads.
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    try {
      return (await ipc.invoke(channel, ...args)) as T
    } catch (error) {
      const payload = parseAppErrorPayload(error)
      if (payload !== null) {
        throw payload
      }
      throw error
    }
  }

  function subscribe<T>(
    channel: string,
    chatId: string,
    callback: (payload: T) => void,
    guard: (payload: unknown) => payload is T,
  ): Unsubscribe {
    const listener = (...args: unknown[]) => {
      const [, eventChatId, payload] = args // event, chatId, payload
      if (eventChatId === chatId && guard(payload)) {
        callback(payload)
      }
    }
    ipc.on(channel, listener)
    return () => {
      ipc.off(channel, listener)
    }
  }

  return {
    actions: {
      list: () => invoke<ActionControl[]>(IPC_CHANNEL.actionsList),
      create: (input) => invoke<ActionControl>(IPC_CHANNEL.actionsCreate, input),
      update: (id, input) => invoke<ActionControl>(IPC_CHANNEL.actionsUpdate, id, input),
      delete: (id) => invoke<void>(IPC_CHANNEL.actionsDelete, id),
      execute: (id, projectId, confirmed) =>
        invoke<ActionExecution>(IPC_CHANNEL.actionsExecute, id, projectId, confirmed),
      status: (id) => invoke<ActionExecution>(IPC_CHANNEL.actionsStatus, id),
    },
    projects: {
      list: () => invoke<ProjectInfo[]>(IPC_CHANNEL.projectsList),
      // No path argument: the native directory dialog opens in main.
      // Resolves null when the user cancels the dialog.
      add: () => invoke<ProjectInfo | null>(IPC_CHANNEL.projectsAdd),
      remove: (projectId) => invoke<void>(IPC_CHANNEL.projectsRemove, projectId),
    },
    chats: {
      list: (projectId) => invoke<ChatInfo[]>(IPC_CHANNEL.chatsList, projectId),
      // No name argument: the main process derives it from the shell.
      create: (projectId) => invoke<ChatInfo>(IPC_CHANNEL.chatsCreate, projectId),
      remove: (chatId) => invoke<void>(IPC_CHANNEL.chatsRemove, chatId),
    },
    state: {
      get: (key) => invoke<string | null>(IPC_CHANNEL.stateGet, key),
      set: (key, value) => invoke<void>(IPC_CHANNEL.stateSet, key, value),
    },
    terminals: {
      create: (chatId, cwd) => invoke<string>(IPC_CHANNEL.terminalsCreate, chatId, cwd),
      write: (chatId, data) => invoke<void>(IPC_CHANNEL.terminalsWrite, chatId, data),
      resize: (chatId, cols, rows) => invoke<void>(IPC_CHANNEL.terminalsResize, chatId, cols, rows),
      shellName: () => invoke<string>(IPC_CHANNEL.terminalsShellName),
      terminate: (bottomTabId) => invoke<void>(IPC_CHANNEL.terminalsTerminate, bottomTabId),
      onData: (chatId, callback) =>
        subscribe<string>(
          IPC_CHANNEL.terminalsData,
          chatId,
          callback,
          (p): p is string => typeof p === 'string',
        ),
      onExit: (chatId, callback) =>
        subscribe<number>(
          IPC_CHANNEL.terminalsExit,
          chatId,
          callback,
          (p): p is number => typeof p === 'number',
        ),
    },
    git: {
      getStatus: (projectPath) => invoke<GitStatus>(IPC_CHANNEL.gitStatus, projectPath),
    },
    files: {
      list: (projectId, relativePath) =>
        invoke<FileEntry[]>(IPC_CHANNEL.filesList, projectId, relativePath),
      read: (projectId, relativePath) =>
        invoke<FilePreview>(IPC_CHANNEL.filesRead, projectId, relativePath),
      openExternal: (projectId, relativePath) =>
        invoke<void>(IPC_CHANNEL.filesOpenExternal, projectId, relativePath),
    },
    handoffs: {
      list: (projectId) => invoke<HandoffEntry[]>(IPC_CHANNEL.handoffsList, projectId),
    },
    dialogs: {
      pickDirectory: (defaultPath) =>
        invoke<string | null>(IPC_CHANNEL.dialogsPickDirectory, defaultPath),
    },
  }
}
