import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '@shared/bottom-tab-id'
import {
  APP_STATE_KEY,
  IPC_CHANNEL,
  projectHandoffDirKey,
  projectShellKey,
  projectWslShellsKey,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { parseWslPath } from '@shared/wsl-path'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { ActionService } from './action-service'
import { AgentChatLaunchService } from './agent-chat-launch-service'
import { AgentProfilesService } from './agent-profiles/agent-profiles-service'
import { AppStateService } from './app-state-service'
import { AppUpdateService, createAppUpdateIo } from './app-update/app-update-service'
import { ChatService } from './chat-service'
import { ElevenLabsAdapter } from './dictation/adapters/elevenlabs-adapter'
import { LocalOpenAiAdapter } from './dictation/adapters/local-openai-adapter'
import { OpenRouterAdapter } from './dictation/adapters/openrouter-adapter'
import { OpenWhisprAdapter } from './dictation/adapters/openwhispr-adapter'
import { OpenWhisprCloudAdapter } from './dictation/adapters/openwhispr-cloud-adapter'
import { DesktopDictation } from './dictation/desktop-dictation'
import { DictationService } from './dictation/dictation-service'
import { DictationDictionaryService } from './dictation/dictionary/dictation-dictionary-service'
import { OpenWhisprClient } from './dictation/openwhispr-client'
import { PostProcessor } from './dictation/post-processing/post-processor'
import { ProviderRegistry } from './dictation/registry/provider-registry'
import { FilesService } from './files/files-service'
import { GitService } from './git/git-service'
import { HandoffMatcherService } from './handoffs/handoff-matcher-service'
import { HandoffsService } from './handoffs/handoffs-service'
import { ResumeTemplateService } from './handoffs/resume-template-service'
import { KanbanService, type SafeStorageLike } from './kanban/kanban-service'
import { buildResumePrompt, TaskLaunchService } from './kanban/task-launch-service'
import { ProjectService } from './project-service'
import { TASK_PROGRESS_ADAPTERS_DIR_NAME } from './task-progress/adapter-manifest'
import { TaskProgressService } from './task-progress/task-progress-service'
import { createNodePty } from './terminal/node-pty-factory'
import { ShellService } from './terminal/shell-service'
import { type ShellSpec, TerminalService } from './terminal/terminal-service'
import {
  listWslDirectories,
  listWslDistributions,
  prepareWslAgent,
  requireWslSupport,
  validatedWslProjectPath,
  wslSupported,
} from './terminal/wsl'
import { UsageService } from './usage/usage-service'

// Wires the persistence, terminal and git stacks to the typed service registry
// consumed by the IPC handlers. DB path is injected so tests use :memory: or a
// temp dir; the terminal/git services are constructed here with their real
// OS-facing implementations (node-pty, git CLI). The file service's external
// open is injected too (shell.openPath in main/index.ts) — this module stays
// free of electron imports.

export interface CreateServicesOptions {
  dbPath: string
  desktopShortcut?: (handle: string) => Promise<void>
  /**
   * userData directory (default location of the kanban adapters dir).
   */
  userDataPath: string
  /**
   * OS default-application open (shell.openPath). Resolves '' on success and
   * an error description on failure (the Electron contract).
   */
  openExternal: (absolutePath: string) => Promise<string>
  /** Reveals a path in Explorer (shell.showItemInFolder). */
  showInFolder: (absolutePath: string) => void
  /** Moves a path to the Windows Recycle Bin (shell.trashItem). */
  trashItem: (absolutePath: string) => Promise<void>
  /**
   * Native directory picker (dialog.showOpenDialog in main/index.ts).
   * Resolves the chosen absolute path, or null when the user cancels.
   */
  pickDirectory: (defaultPath: string | null) => Promise<string | null>
  pickUsageFile?: (output: boolean) => Promise<string | null>
  safeStorage?: SafeStorageLike
  /** `app.isPackaged` (main/index.ts); gates development-only seams such as the usage test URL. */
  packaged?: boolean
  /** `app.getVersion()`. The update user agent uses it. */
  appVersion?: string
  /** `app.getPath('temp')`. The checked installer is written here. */
  tempDir?: string
  /** `app.quit`. Called only after the installer process has started. */
  quitApp?: () => void
  /** Subscribe to `app` `before-quit` so an in-flight download stops. */
  subscribeAppQuit?: (listener: () => void) => () => void
  /** Shipped usage adapter directories (`bundledUsageAdapterDirectories`, main/index.ts). */
  bundledUsageAdapterDirectories?: readonly string[]
}

export function createServices(options: CreateServicesOptions): AppServices {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const state = new AppStateService({ db })
  const usage = new UsageService({
    state,
    userDataPath: options.userDataPath,
    bundledAdapterDirectories: options.bundledUsageAdapterDirectories,
    safeStorage: options.safeStorage,
    packaged: options.packaged,
    openPath: (path) => options.openExternal(path),
  })
  const desktopDictation = new DesktopDictation(
    state,
    options.desktopShortcut ??
      (() =>
        Promise.reject(
          new AppError(
            'not_found',
            'The desktop dictation helper is unavailable. Repair your NeKode installation.',
          ),
        )),
  )
  const dictation = new OpenWhisprClient({ state })
  // Shell selection (spec project-shell-selection): one service owns
  // detection, resolution and labels. Custom paths persist app-level in
  // shells.custom; per-project choices live under project.shell:<id>.
  const shells = new ShellService()
  const readCustomShellPaths = (key = APP_STATE_KEY.customShells as string): string[] => {
    const raw = state.get(key)
    if (raw === null || raw.length === 0) {
      return []
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      return []
    }
  }
  const writeCustomShellPaths = (paths: readonly string[]): void => {
    state.set(APP_STATE_KEY.customShells, JSON.stringify(paths))
  }
  /** The project's stored shell choice, resolved to a spawnable spec. */
  const projectShell = (projectId: string) =>
    shells.resolve(state.get(projectShellKey(projectId)), projects.get(projectId)?.path)
  const chats = new ChatService({
    db,
    // The chat prefix is the compact shell code (spec project-shell-selection
    // Behaviour 6), e.g. `[PS7] Codex`; the verbose label stays in the Shell
    // settings list and the bottom-tab text.
    chatNameForProject: (projectId) =>
      shells.chatLabel(state.get(projectShellKey(projectId)), projects.get(projectId)?.path),
  })

  const dictationRegistry = new ProviderRegistry()
  dictationRegistry.register(new OpenWhisprAdapter(dictation))
  dictationRegistry.register(new OpenWhisprCloudAdapter())
  dictationRegistry.register(new ElevenLabsAdapter())
  dictationRegistry.register(new OpenRouterAdapter())
  dictationRegistry.register(new LocalOpenAiAdapter())

  const dictationDictionaryService = new DictationDictionaryService({ db })
  const postProcessor = new PostProcessor()

  const dictationSessions = new DictationService({
    client: dictation,
    registry: dictationRegistry,
    dictionaryService: dictationDictionaryService,
    postProcessor,
    state,
    safeStorage: options.safeStorage,
    resolveChatProjectId: (chatId) => chats.get(chatId)?.projectId ?? null,
  })
  const terminals = new TerminalService({ createPty: createNodePty })
  const git = new GitService({ projects })
  const files = new FilesService({
    projects,
    openExternal: options.openExternal,
    showInFolder: options.showInFolder,
    trashItem: options.trashItem,
  })
  const handoffs = new HandoffsService({ projects, state, handoffDirKey: projectHandoffDirKey })
  const resumeTemplates = new ResumeTemplateService({
    projects,
    userDataPath: options.userDataPath,
  })
  // Handoff match (stage 4): a shallow, read-only scan beside HandoffsService.
  // HandoffsService.list keeps its own contract; this service only reads the
  // configured directory and returns file metadata.
  const handoffMatcher = new HandoffMatcherService({ projects, state })
  const kanban = new KanbanService({
    projects,
    state,
    // One fixed adapters directory under userData, without an override (spec
    // kanban-adapter-interface Behaviour 1).
    adaptersDir: () => join(options.userDataPath, 'kanban-adapters'),
    safeStorage: options.safeStorage,
  })
  // One fixed adapters directory without a setting or override (spec
  // task-progress-adapters Behaviour 1).
  const taskProgress = new TaskProgressService({
    projects,
    state,
    adaptersDir: join(options.userDataPath, TASK_PROGRESS_ADAPTERS_DIR_NAME),
  })
  const agentProfiles = new AgentProfilesService({ projects, state })
  // Both profile launch flows resolve the current execution environment only for a new PTY.
  const agentTerminals = {
    create: (chatId: string, cwd: string, command?: ShellSpec) =>
      terminals.create(
        chatId,
        cwd,
        command === undefined
          ? undefined
          : () => {
              const projectId = chats.get(chatId)?.projectId
              const choice = projectId ? state.get(projectShellKey(projectId)) : null
              return prepareWslAgent(cwd, command, choice)
            },
      ),
  }
  const agentChats = new AgentChatLaunchService({
    projects,
    profiles: agentProfiles,
    // The chat name and its errors belong to this flow, not to a task launch.
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, IPC_CHANNEL.chatsCreateWithAgent, identity),
    removeChat: (chatId) => chats.remove(chatId),
    terminals: agentTerminals,
  })
  const taskLaunch = new TaskLaunchService({
    projects,
    profiles: agentProfiles,
    kanban,
    // Resume rechecks its chosen file through the stage 4 matcher before the
    // chat is created (spec Resume.3).
    handoffs: handoffMatcher,
    resumePrompt: (path) => resumeTemplates.format(path, buildResumePrompt(path)),
    handoffDir: (projectId) => {
      const value = state.get(projectHandoffDirKey(projectId))
      if (value === null || value.trim().length === 0) {
        return null
      }
      return value
    },
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, IPC_CHANNEL.kanbanLaunchTask, identity),
    terminals: agentTerminals,
  })
  const appUpdate = new AppUpdateService(
    createAppUpdateIo({
      packaged: options.packaged === true,
      platform: process.platform,
      version: options.appVersion ?? '0.0.0',
      tempDir: options.tempDir ?? tmpdir(),
      quit: options.quitApp ?? (() => undefined),
      subscribeQuit: options.subscribeAppQuit ?? (() => () => undefined),
    }),
  )
  const actions = new ActionService({
    db,
    createChat: (projectId) => chats.create(projectId),
    createTerminal: (chatId, cwd) => terminals.create(chatId, cwd),
  })
  function requireProjectPath(projectId: string): string {
    const project = projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    return project.path
  }
  return {
    usage: {
      listAdapters: () => usage.listAdapters(),
      getSettings: () => usage.getSettings(),
      saveSettings: (settings) => usage.saveSettings(settings),
      read: () => usage.read(),
      refresh: () => usage.refresh(),
      test: (connection) => usage.test(connection),
      getEnabled: () => usage.getEnabled(),
      setEnabled: (enabled) => usage.setEnabled(enabled),
      openAdaptersFolder: () => usage.openAdaptersFolder(),
      setVisible: (visible) => usage.setVisible(visible),
      shutdown: () => usage.shutdown(),
      pickFile: (output) => options.pickUsageFile?.(output) ?? Promise.resolve(null),
    },
    appUpdate,
    dictation: {
      desktopSetup: () => desktopDictation.get(),
      desktopConfigure: (settings) => desktopDictation.set(settings),
      desktopActivate: (handle) => desktopDictation.activate(handle),
      status: () => dictation.status(),
      testConnection: () => dictation.testConnection(),
      refreshModels: () => dictation.refreshModels(),
      dictionaryList: (projectId?: string) => dictationSessions.dictionaryList(projectId),
      getSettings: () => dictation.getSettings(),
      setSettings: (settings) => {
        const result = dictation.setSettings(settings)
        if (!settings.enabled) dictationSessions.discard()
        return result
      },
      start: (chatId, retrySessionId) => dictationSessions.start(chatId, retrySessionId),
      audio: (sessionId, wav) => dictationSessions.audio(sessionId, wav),
      cancel: (sessionId) => dictationSessions.cancel(sessionId),
      onResult: (callback) => dictationSessions.onResult(callback),
      shutdown: () => dictationSessions.shutdown(),

      providersList: () => dictationSessions.providersList(),
      providersTestConnection: (providerId, config) =>
        dictationSessions.providersTestConnection(providerId, config),
      providersDiscoverModels: (providerId, config) =>
        dictationSessions.providersDiscoverModels(providerId, config),
      providersGetConfig: (providerId) => dictationSessions.providersGetConfig(providerId),
      providersSetConfig: (providerId, config) =>
        dictationSessions.providersSetConfig(providerId, config),
      getActiveProvider: () => dictationSessions.getActiveProvider(),
      setActiveProvider: (providerId) => dictationSessions.setActiveProvider(providerId),
      dictionaryAdd: (entry) => dictationSessions.dictionaryAdd(entry),
      dictionaryUpdate: (id, updates) => dictationSessions.dictionaryUpdate(id, updates),
      dictionaryDelete: (id) => dictationSessions.dictionaryDelete(id),
      dictionaryToggle: (id, enabled) => dictationSessions.dictionaryToggle(id, enabled),
      postProcessingGetSettings: () => dictationSessions.postProcessingGetSettings(),
      postProcessingSetSettings: (settings) =>
        dictationSessions.postProcessingSetSettings(settings),
    },
    actions: {
      list: () => actions.list(),
      create: (input) => actions.create(input),
      update: (id, input) => actions.update(id, input),
      delete: (id) => actions.delete(id),
      execute: (id, projectId, confirmed) => actions.execute(id, projectId, confirmed),
      status: (id) => actions.status(id),
      stopForProject: (projectId) => actions.stopForProject(projectId),
      stopAll: () => actions.stopAll(),
    },
    projects: {
      // Stale selection keys are cleaned on every list read (spec Edge cases:
      // a selection pointing at a removed project/chat falls back to the
      // default empty state and the keys are removed).
      list: () => {
        state.cleanupSelection()
        return projects.list()
      },
      add: (path) => projects.add(path),
      // WSL is a Windows-host integration; on Linux (also inside WSL) it is
      // hidden: no distributions, and directory listing/registration refuse.
      wslDistributions: () => (wslSupported() ? listWslDistributions() : []),
      wslDirectories: (distribution, linuxPath) => {
        requireWslSupport()
        return listWslDirectories(distribution, linuxPath)
      },
      addWsl: (distribution, linuxPath) => {
        requireWslSupport()
        return projects.add(validatedWslProjectPath(distribution, linuxPath))
      },
      remove: (projectId) => projects.remove(projectId),
    },
    chats: {
      list: (projectId) => chats.list(projectId),
      create: (projectId) => chats.create(projectId),
      createWithAgent: (projectId, profileId) => agentChats.createWithAgent(projectId, profileId),
      remove: (chatId) => chats.remove(chatId),
    },
    state: {
      get: (key) => state.get(key),
      set: (key, value) => state.set(key, value),
      delete: (key) => state.delete(key),
    },
    terminals: {
      // Chat terminals and bottom tabs both spawn with the project's shell
      // (spec project-shell-selection Behaviour 7): bottom tab ids encode
      // their project, chat ids resolve through the chat row. Resolve the
      // shell only for a new PTY; reattachment keeps the running process.
      // An unknown id uses the platform default.
      create: (chatId, cwd) => {
        const projectId = isBottomTabId(chatId)
          ? bottomTabProjectId(chatId)
          : (chats.get(chatId)?.projectId ?? null)
        if (projectId !== null) {
          const path = requireProjectPath(projectId)
          const location = parseWslPath(path)
          const cwdLocation = parseWslPath(cwd)
          if (location !== null && cwdLocation?.distribution !== location.distribution)
            throw new AppError('validation', 'A WSL terminal must use its project distribution.')
        }
        return terminals.create(
          chatId,
          cwd,
          projectId !== null ? () => projectShell(projectId) : undefined,
        )
      },
      write: (chatId, data) => terminals.write(chatId, data),
      resize: (chatId, cols, rows) => terminals.resize(chatId, cols, rows),
      shellName: (projectId) =>
        shells.label(state.get(projectShellKey(projectId)), projects.get(projectId)?.path),
      shellList: (projectId) =>
        shells.list(projectId == null ? undefined : requireProjectPath(projectId)),
      shellDetect: (projectId) => {
        const projectPath = projectId == null ? undefined : requireProjectPath(projectId)
        if (projectPath !== undefined && parseWslPath(projectPath) !== null) {
          const result = shells.detect(
            readCustomShellPaths(projectWslShellsKey(projectId as string)),
            projectPath,
          )
          if (result.prunedCustomPaths.length > 0)
            state.set(
              projectWslShellsKey(projectId as string),
              JSON.stringify(
                readCustomShellPaths(projectWslShellsKey(projectId as string)).filter(
                  (path) => !result.prunedCustomPaths.includes(path),
                ),
              ),
            )
          return result.shells
        }
        const result = shells.detect(readCustomShellPaths())
        try {
          if (result.prunedCustomPaths.length > 0) {
            writeCustomShellPaths(shells.customPaths())
          }
          return result.shells
        } finally {
          shells.endDetect()
        }
      },
      shellAddCustom: (path, projectId) => {
        const projectPath = projectId == null ? undefined : requireProjectPath(projectId)
        if (projectPath !== undefined && parseWslPath(projectPath) !== null) {
          const entry = shells.addCustomPath(path, projectPath)
          const key = projectWslShellsKey(projectId as string)
          state.set(key, JSON.stringify([...new Set([...readCustomShellPaths(key), path])]))
          return entry
        }
        const entry = shells.addCustomPath(path)
        const paths = shells.customPaths()
        const stored = readCustomShellPaths()
        if (!stored.includes(entry.id.slice('custom:'.length))) {
          writeCustomShellPaths([...stored, ...paths.filter((item) => !stored.includes(item))])
        }
        return entry
      },
      terminate: (chatId) => terminals.terminate(chatId),
      terminateProjectBottom: (projectId) => terminals.terminateProjectBottom(projectId),
      terminateAll: () => terminals.terminateAll(),
      shutdown: (reportTimeout) => terminals.shutdown(reportTimeout),
      onData: (listener) => terminals.onData(listener),
      onExit: (listener) => terminals.onExit(listener),
    },
    git: {
      getStatus: (projectId) => git.getStatus(projectId),
      fileStatuses: (projectId) => git.getFileStatuses(projectId),
      sync: (projectId) => git.sync(projectId),
    },
    files: {
      list: (projectId, relativePath) => files.list(projectId, relativePath),
      read: (projectId, relativePath) => files.read(projectId, relativePath),
      openExternal: (projectId, relativePath) => files.openExternal(projectId, relativePath),
      openRoot: (projectId) => files.openRoot(projectId),
      showInFolder: (projectId, relativePath) => files.showInFolder(projectId, relativePath),
      trash: (projectId, relativePath) => files.trash(projectId, relativePath),
    },
    handoffs: {
      list: (projectId) => handoffs.list(projectId),
      resumePrompt: (projectId, handoffPath) =>
        resumeTemplates.resumePrompt(projectId, handoffPath),
    },
    kanban: {
      adaptersList: () => kanban.adaptersList(),
      getConfig: (projectId) => kanban.getConfig(projectId),
      setConfig: (projectId, config) => kanban.setConfig(projectId, config),
      test: (projectId, values) => kanban.test(projectId, values),
      listBoard: (projectId) => kanban.listBoard(projectId),
      createItem: (projectId, input, revision) => kanban.createItem(projectId, input, revision),
      updateItem: (projectId, ref, patch, revision) =>
        kanban.updateItem(projectId, ref, patch, revision),
      bindLocalFile: (projectId) => kanban.bindLocalFile(projectId),
      skillStatus: (projectId) => kanban.skillStatus(projectId),
      writeSkill: (projectId) => kanban.writeSkill(projectId),
      getItem: (projectId, ref) => kanban.getItem(projectId, ref),
      getComments: (projectId, ref) => kanban.getComments(projectId, ref),
      launchTask: (input) => taskLaunch.launch(input),
      handoffCandidates: (input) => handoffMatcher.candidates(input),
      handoffAvailability: (input) => handoffMatcher.availability(input),
      cleanupProject: (projectId) => kanban.cleanupProject(projectId),
      dropLaunchProject: (projectId) => taskLaunch.dropProject(projectId),
      blocksProjectShell: (chatId) => taskLaunch.blocksProjectShell(chatId),
    },
    taskProgress: {
      adaptersList: () => taskProgress.adaptersList(),
      getBinding: (projectId) => taskProgress.getBinding(projectId),
      saveBinding: (projectId, adapterId, config) =>
        taskProgress.saveBinding(projectId, adapterId, config),
      test: (projectId, adapterId, config) => taskProgress.test(projectId, adapterId, config),
      observe: (projectIds) => taskProgress.observe(projectIds),
      get: (projectId) => taskProgress.get(projectId),
      onChanged: (callback) => taskProgress.onChanged(callback),
      setVisible: (visible) => taskProgress.setVisible(visible),
      shutdown: () => taskProgress.shutdown(),
      cleanupProject: (projectId) => taskProgress.cleanupProject(projectId),
    },
    agentProfiles: {
      get: (projectId) => agentProfiles.get(projectId),
      libraryGet: () => agentProfiles.libraryGet(),
      templatesGet: () => agentProfiles.templatesGet(),
      put: (input) => agentProfiles.put(input),
      delete: (profileId) => agentProfiles.delete(profileId),
      selectionGet: (projectId) => agentProfiles.selectionGet(projectId),
      selectionSet: (projectId, input) => agentProfiles.selectionSet(projectId, input),
      cleanupProject: (projectId) => agentProfiles.cleanupProject(projectId),
    },
    dialogs: {
      pickDirectory: (defaultPath) => options.pickDirectory(defaultPath),
    },
    closeDatabase: () => {
      if (db.open) db.close()
    },
  }
}

function safeStat(path: string): { isDirectory(): boolean } | null {
  try {
    const stats = statSync(path)
    return { isDirectory: () => stats.isDirectory() }
  } catch {
    return null
  }
}
