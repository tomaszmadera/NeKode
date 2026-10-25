import type { DesktopDictationSetup } from '../shared/desktop-dictation-contract'
import {
  type DictationDictionaryEntry,
  type DictationPostProcessingSettings,
  type DictationSettings,
  type DictationStart,
  type DictationStatusSnapshot,
  isDictationResult,
  type SttProviderSummary,
} from '../shared/dictation-contract'
import type {
  ActionControl,
  ActionExecution,
  AgentProfilesDocument,
  AgentProfilesLibrary,
  AgentProfileTemplate,
  AgentProjectSelection,
  AppApi,
  ChatInfo,
  FileEntry,
  FilePreview,
  GitFileStatuses,
  GitStatus,
  HandoffCandidatesResult,
  HandoffEntry,
  KanbanAdapterInfo,
  KanbanBoard,
  KanbanComment,
  KanbanHandoffAvailabilityResult,
  KanbanItemWriteResult,
  KanbanLaunchResult,
  KanbanProjectConfig,
  KanbanSkillStatus,
  ProjectInfo,
  ShellInfo,
  TaskProgressAdapterList,
  TaskProgressBinding,
  TaskProgressSnapshot,
  TaskProgressTestResult,
  Unsubscribe,
  WorkItem,
} from '../shared/ipc-contract'
import { IPC_CHANNEL, isTaskProgressChangedEvent } from '../shared/ipc-contract'
import { parseAppErrorPayload } from '../shared/ipc-error'
import type { IpcRendererLike } from './bridge-types'

// Structural subset of Electron's IpcRenderer so the bridge can be unit-tested
// without importing electron (SDD §6: the bridge is the only renderer access path).

export function createAppApi(ipc: IpcRendererLike, platform?: string, homeDir?: string): AppApi {
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
    platform,
    homeDir,
    usage: {
      listAdapters: () => invoke(IPC_CHANNEL.usageListAdapters),
      getSettings: () => invoke(IPC_CHANNEL.usageGetSettings),
      saveSettings: (settings) => invoke(IPC_CHANNEL.usageSaveSettings, settings),
      read: () => invoke(IPC_CHANNEL.usageRead),
      refresh: () => invoke(IPC_CHANNEL.usageRefresh),
      test: (connection) => invoke(IPC_CHANNEL.usageTest, connection),
      pickFile: (output) => invoke(IPC_CHANNEL.usagePickFile, output),
      getEnabled: () => invoke(IPC_CHANNEL.usageGetEnabled),
      setEnabled: (enabled) => invoke(IPC_CHANNEL.usageSetEnabled, enabled),
      openAdaptersFolder: () => invoke(IPC_CHANNEL.usageOpenAdaptersFolder),
    },
    dictation: {
      desktopSetup: () => invoke<DesktopDictationSetup>(IPC_CHANNEL.dictationDesktopSetup),
      desktopConfigure: (settings) =>
        invoke<DesktopDictationSetup>(IPC_CHANNEL.dictationDesktopConfigure, settings),
      desktopActivate: () => invoke<void>(IPC_CHANNEL.dictationDesktopActivate),
      status: () => invoke<DictationStatusSnapshot>(IPC_CHANNEL.dictationStatus),
      testConnection: () => invoke<DictationStatusSnapshot>(IPC_CHANNEL.dictationTestConnection),
      refreshModels: () => invoke<DictationStatusSnapshot>(IPC_CHANNEL.dictationRefreshModels),
      dictionaryList: (projectId?: string) =>
        invoke<DictationDictionaryEntry[]>(
          IPC_CHANNEL.dictationDictionaryList,
          ...(projectId !== undefined ? [projectId] : []),
        ),
      getSettings: () => invoke<DictationSettings>(IPC_CHANNEL.dictationGetSettings),
      setSettings: (settings) =>
        invoke<DictationSettings>(IPC_CHANNEL.dictationSetSettings, settings),
      start: (chatId, retrySessionId) =>
        invoke<DictationStart>(IPC_CHANNEL.dictationStart, chatId, retrySessionId),
      audio: (sessionId, wav) => invoke<void>(IPC_CHANNEL.dictationAudio, sessionId, wav),
      cancel: (sessionId) => invoke<void>(IPC_CHANNEL.dictationCancel, sessionId),
      onResult: (callback) => {
        const listener = (...args: unknown[]) => {
          if (isDictationResult(args[1])) callback(args[1])
        }
        ipc.on(IPC_CHANNEL.dictationResult, listener)
        return () => ipc.off(IPC_CHANNEL.dictationResult, listener)
      },

      providersList: () => invoke<SttProviderSummary[]>(IPC_CHANNEL.dictationProvidersList),
      providersTestConnection: (providerId, config) =>
        invoke<{ ok: boolean; message: string }>(
          IPC_CHANNEL.dictationProvidersTestConnection,
          ...(config !== undefined ? [providerId, config] : [providerId]),
        ),
      providersDiscoverModels: (providerId, config) =>
        invoke<Array<{ id: string; name: string }>>(
          IPC_CHANNEL.dictationProvidersDiscoverModels,
          ...(config !== undefined ? [providerId, config] : [providerId]),
        ),
      providersGetConfig: (providerId) =>
        invoke<Record<string, unknown>>(IPC_CHANNEL.dictationProvidersGetConfig, providerId),
      providersSetConfig: (providerId, config) =>
        invoke<void>(IPC_CHANNEL.dictationProvidersSetConfig, providerId, config),
      getActiveProvider: () => invoke<string>(IPC_CHANNEL.dictationGetActiveProvider),
      setActiveProvider: (providerId) =>
        invoke<void>(IPC_CHANNEL.dictationSetActiveProvider, providerId),
      dictionaryAdd: (entry) =>
        invoke<DictationDictionaryEntry>(IPC_CHANNEL.dictationDictionaryAdd, entry),
      dictionaryUpdate: (id, updates) =>
        invoke<DictationDictionaryEntry>(IPC_CHANNEL.dictationDictionaryUpdate, id, updates),
      dictionaryDelete: (id) => invoke<void>(IPC_CHANNEL.dictationDictionaryDelete, id),
      dictionaryToggle: (id, enabled) =>
        invoke<DictationDictionaryEntry>(IPC_CHANNEL.dictationDictionaryToggle, id, enabled),
      postProcessingGetSettings: () =>
        invoke<DictationPostProcessingSettings>(IPC_CHANNEL.dictationPostProcessingGetSettings),
      postProcessingSetSettings: (settings) =>
        invoke<void>(IPC_CHANNEL.dictationPostProcessingSetSettings, settings),
    },
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
      wslDistributions: () => invoke<string[]>(IPC_CHANNEL.projectsWslDistributions),
      wslDirectories: (distribution, linuxPath) =>
        invoke<string[]>(IPC_CHANNEL.projectsWslDirectories, distribution, linuxPath),
      addWsl: (distribution, linuxPath) =>
        invoke<ProjectInfo>(IPC_CHANNEL.projectsAddWsl, distribution, linuxPath),
      remove: (projectId) => invoke<void>(IPC_CHANNEL.projectsRemove, projectId),
    },
    chats: {
      list: (projectId) => invoke<ChatInfo[]>(IPC_CHANNEL.chatsList, projectId),
      // No name argument: the main process derives it from the shell.
      create: (projectId) => invoke<ChatInfo>(IPC_CHANNEL.chatsCreate, projectId),
      // The profile choice is an AgentProfile.id; main owns the name and the
      // agent process (spec Data/API).
      createWithAgent: (projectId, profileId) =>
        invoke<ChatInfo>(IPC_CHANNEL.chatsCreateWithAgent, projectId, profileId),
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
      // Shell selection (spec project-shell-selection): the label resolves
      // the project's stored choice; list reads the cache, detect runs one
      // explicit detection, addCustom validates the path in main.
      shellName: (projectId) => invoke<string>(IPC_CHANNEL.terminalsShellName, projectId),
      shellList: (projectId) =>
        projectId == null
          ? invoke<ShellInfo[]>(IPC_CHANNEL.terminalsShellList)
          : invoke<ShellInfo[]>(IPC_CHANNEL.terminalsShellList, projectId),
      shellDetect: (projectId) =>
        projectId == null
          ? invoke<ShellInfo[]>(IPC_CHANNEL.terminalsShellDetect)
          : invoke<ShellInfo[]>(IPC_CHANNEL.terminalsShellDetect, projectId),
      shellAddCustom: (path, projectId) =>
        projectId == null
          ? invoke<ShellInfo>(IPC_CHANNEL.terminalsShellAddCustom, path)
          : invoke<ShellInfo>(IPC_CHANNEL.terminalsShellAddCustom, path, projectId),
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
      getStatus: (projectId) => invoke<GitStatus>(IPC_CHANNEL.gitStatus, projectId),
      fileStatuses: (projectId) => invoke<GitFileStatuses>(IPC_CHANNEL.gitFileStatuses, projectId),
      sync: (projectId) => invoke<void>(IPC_CHANNEL.gitSync, projectId),
    },
    files: {
      list: (projectId, relativePath) =>
        invoke<FileEntry[]>(IPC_CHANNEL.filesList, projectId, relativePath),
      read: (projectId, relativePath) =>
        invoke<FilePreview>(IPC_CHANNEL.filesRead, projectId, relativePath),
      openExternal: (projectId, relativePath) =>
        invoke<void>(IPC_CHANNEL.filesOpenExternal, projectId, relativePath),
      openRoot: (projectId) => invoke<void>(IPC_CHANNEL.filesOpenRoot, projectId),
      showInFolder: (projectId, relativePath) =>
        invoke<void>(IPC_CHANNEL.filesShowInFolder, projectId, relativePath),
      trash: (projectId, relativePath) =>
        invoke<void>(IPC_CHANNEL.filesTrash, projectId, relativePath),
    },
    handoffs: {
      list: (projectId) => invoke<HandoffEntry[]>(IPC_CHANNEL.handoffsList, projectId),
      resumePrompt: (projectId, handoffPath) =>
        invoke<string>(IPC_CHANNEL.handoffsResumePrompt, projectId, handoffPath),
    },
    kanban: {
      adaptersList: () => invoke<KanbanAdapterInfo[]>(IPC_CHANNEL.kanbanAdaptersList),
      getConfig: (projectId) => invoke<KanbanProjectConfig>(IPC_CHANNEL.kanbanGetConfig, projectId),
      setConfig: (projectId, config) =>
        invoke<void>(IPC_CHANNEL.kanbanSetConfig, projectId, config),
      test: (projectId, values) => invoke<void>(IPC_CHANNEL.kanbanTest, projectId, values),
      listBoard: (projectId) => invoke<KanbanBoard>(IPC_CHANNEL.kanbanListBoard, projectId),
      // The `local-file` revision is sent only when the caller has one, so a
      // process-adapter write keeps its original arity.
      createItem: (projectId, input, revision) =>
        revision === undefined
          ? invoke<KanbanItemWriteResult>(IPC_CHANNEL.kanbanCreateItem, projectId, input)
          : invoke<KanbanItemWriteResult>(IPC_CHANNEL.kanbanCreateItem, projectId, input, revision),
      updateItem: (projectId, ref, patch, revision) =>
        revision === undefined
          ? invoke<KanbanItemWriteResult>(IPC_CHANNEL.kanbanUpdateItem, projectId, ref, patch)
          : invoke<KanbanItemWriteResult>(
              IPC_CHANNEL.kanbanUpdateItem,
              projectId,
              ref,
              patch,
              revision,
            ),
      getItem: (projectId, ref) => invoke<WorkItem>(IPC_CHANNEL.kanbanGetItem, projectId, ref),
      getComments: (projectId, ref) =>
        invoke<KanbanComment[]>(IPC_CHANNEL.kanbanGetComments, projectId, ref),
      bindLocalFile: (projectId) => invoke<void>(IPC_CHANNEL.kanbanBindLocalFile, projectId),
      skillStatus: (projectId) =>
        invoke<KanbanSkillStatus>(IPC_CHANNEL.kanbanSkillStatus, projectId),
      writeSkill: (projectId) => invoke<void>(IPC_CHANNEL.kanbanWriteSkill, projectId),
      launchTask: (input) => invoke<KanbanLaunchResult>(IPC_CHANNEL.kanbanLaunchTask, input),
      handoffCandidates: (input) =>
        invoke<HandoffCandidatesResult>(IPC_CHANNEL.kanbanHandoffCandidates, input),
      handoffAvailability: (input) =>
        invoke<KanbanHandoffAvailabilityResult>(IPC_CHANNEL.kanbanHandoffAvailability, input),
    },
    taskProgress: {
      adaptersList: () => invoke<TaskProgressAdapterList>(IPC_CHANNEL.taskProgressAdaptersList),
      getBinding: (projectId) =>
        invoke<TaskProgressBinding>(IPC_CHANNEL.taskProgressGetBinding, projectId),
      saveBinding: (projectId, adapterId, config) =>
        invoke<void>(IPC_CHANNEL.taskProgressSaveBinding, projectId, adapterId, config),
      test: (projectId, adapterId, config) =>
        invoke<TaskProgressTestResult>(IPC_CHANNEL.taskProgressTest, projectId, adapterId, config),
      observe: (projectIds) => invoke<void>(IPC_CHANNEL.taskProgressObserve, projectIds),
      get: (projectId) =>
        invoke<TaskProgressSnapshot | null>(IPC_CHANNEL.taskProgressGet, projectId),
      onChanged: (callback) => {
        const listener = (...args: unknown[]) => {
          if (isTaskProgressChangedEvent(args[1])) callback(args[1])
        }
        ipc.on(IPC_CHANNEL.taskProgressChanged, listener)
        return () => ipc.off(IPC_CHANNEL.taskProgressChanged, listener)
      },
    },
    agentProfiles: {
      get: (projectId) => invoke<AgentProfilesDocument>(IPC_CHANNEL.agentProfilesGet, projectId),
      libraryGet: () => invoke<AgentProfilesLibrary>(IPC_CHANNEL.agentProfilesLibraryGet),
      templatesGet: () => invoke<AgentProfileTemplate[]>(IPC_CHANNEL.agentProfilesTemplatesGet),
      put: (input) => invoke<AgentProfilesLibrary>(IPC_CHANNEL.agentProfilesPut, input),
      delete: (profileId) =>
        invoke<AgentProfilesLibrary>(IPC_CHANNEL.agentProfilesDelete, profileId),
      selectionGet: (projectId) =>
        invoke<AgentProjectSelection>(IPC_CHANNEL.agentProfilesSelectionGet, projectId),
      selectionSet: (projectId, input) =>
        invoke<AgentProjectSelection>(IPC_CHANNEL.agentProfilesSelectionSet, projectId, input),
    },
    dialogs: {
      pickDirectory: (defaultPath) =>
        invoke<string | null>(IPC_CHANNEL.dialogsPickDirectory, defaultPath),
    },
  }
}
