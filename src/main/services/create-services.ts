import { statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '@shared/bottom-tab-id'
import {
  DEFAULT_RESUME_INSTRUCTION,
  DEFAULT_START_INSTRUCTION,
  resolveInstruction,
} from '@shared/contracts/action-instructions-contract'
import {
  APP_STATE_KEY,
  IPC_CHANNEL,
  projectShellKey,
  projectWslShellsKey,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import {
  type ProjectEnvironment,
  projectEnvironment,
  projectWslLocation,
} from '@shared/project-environment'
import { type SshTarget, sshTargetFromInput, validateSshLocation } from '@shared/ssh-target'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { ActionService } from './action-service'
import { AgentChatLaunchService } from './agent-chat-launch-service'
import { AgentProfilesService } from './agent-profiles/agent-profiles-service'
import { AgentSessionRegistry } from './agent-session-registry'
import { AppStateService } from './app-state-service'
import { AppUpdateService, createAppUpdateIo } from './app-update/app-update-service'
import { ChatService } from './chat-service'
import { ContextUsageService } from './context-usage/context-usage-service'
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
import { SshFilesAdapter } from './files/ssh-files-adapter'
import { GitService } from './git/git-service'
import { createSshGitRunner } from './git/git-ssh-runner'
import { ResumeSourcesService } from './handoffs/resume-sources-service'
import { ResumeTemplateService } from './handoffs/resume-template-service'
import { KanbanService, type SafeStorageLike } from './kanban/kanban-service'
import { TaskLaunchService } from './kanban/task-launch-service'
import { ProjectService } from './project-service'
import { SshClient } from './ssh/ssh-client'
import { TASK_PROGRESS_ADAPTERS_DIR_NAME } from './task-progress/adapter-manifest'
import { TaskProgressService } from './task-progress/task-progress-service'
import { createNodePty } from './terminal/node-pty-factory'
import { ShellService } from './terminal/shell-service'
import { type ShellSpec, TerminalService } from './terminal/terminal-service'
import {
  listWslDirectoriesAsync,
  listWslDistributionsAsync,
  prepareWslAgentAsync,
  requireWslSupport,
  validatedWslProjectPathAsync,
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
  /**
   * SSH client of the service graph (spec ssh-projects Business rules).
   * Injectable so tests substitute a fake runner; production uses the real
   * system OpenSSH client.
   */
  ssh?: SshClient
  /** Local directory of an SSH terminal PTY (`os.homedir()` by default). */
  homeDir?: string
}

/** The transport a spawn entry point resolves from the project row. */
interface ProjectLaunch {
  transport: 'local' | 'ssh'
  /** Environment the stored project path resolves to (spec project-environment-clarity 5). */
  environment: ProjectEnvironment
  projectId: string | null
  /** Registered project path; null when the caller has no project. */
  path: string | null
  /** Parsed SSH location of an SSH project. */
  target: SshTarget | null
}

/**
 * Main-process-only services beside the IPC surface: the file preview window
 * registry needs the validated target and the change fingerprint of one file
 * (docs/features/file-preview-window). Not reachable from any renderer.
 */
export interface PreviewFileServices {
  target(
    projectId: string,
    relativePath: string,
  ): Promise<{ projectId: string; projectName: string; relativePath: string; fileName: string }>
  fingerprint(projectId: string, relativePath: string): Promise<string | null>
}

export function createServices(
  options: CreateServicesOptions,
): AppServices & { preview: PreviewFileServices } {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const sshClient = options.ssh ?? new SshClient()
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
    shells.resolveAsync(state.get(projectShellKey(projectId)), projects.get(projectId)?.path)

  /**
   * One launch resolver for every spawn entry point (spec ssh-projects
   * Behaviour 5 and Data/API; spec project-environment-clarity 5-6). The
   * persisted project path alone selects the transport and the environment: an
   * SSH project requires the renderer cwd to equal its path, a WSL project
   * requires its own distribution in the cwd, and a foreign `ssh://` cwd is
   * rejected before any process starts. A null cwd means the caller has no
   * renderer-supplied directory (actions, Kanban) and only the transport is
   * resolved.
   */
  function resolveLaunch(projectId: string | null, cwd: string | null): ProjectLaunch {
    if (projectId === null) {
      if (cwd !== null && projectEnvironment(cwd).kind === 'ssh') {
        throw new AppError('validation', 'The working directory does not belong to this project.')
      }
      return {
        transport: 'local',
        environment: { kind: 'local' },
        projectId: null,
        path: null,
        target: null,
      }
    }
    const project = projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    const environment = projectEnvironment(project.path)
    if (environment.kind === 'ssh') {
      if (cwd !== null && cwd !== project.path) {
        throw new AppError('validation', 'The working directory does not belong to this project.')
      }
      return {
        transport: 'ssh',
        environment,
        projectId,
        path: project.path,
        target: environment.target,
      }
    }
    if (cwd !== null && projectEnvironment(cwd).kind === 'ssh') {
      throw new AppError('validation', 'The working directory does not belong to this project.')
    }
    // Both paths go through the throwing helper: this site called `parseWslPath`
    // before the resolver existed, so a malformed WSL path keeps the parser's own
    // error instead of surfacing as a distribution mismatch or falling through to
    // Local (spec project-environment-clarity Errors).
    const location = projectWslLocation(project.path)
    // A null cwd is a transport-only call (Actions, Kanban, task progress): it has
    // no directory to compare, so only a supplied path can mismatch.
    if (cwd !== null) {
      const cwdLocation = projectWslLocation(cwd)
      if (location !== null && cwdLocation?.distribution !== location.distribution) {
        throw new AppError('validation', 'A WSL terminal must use its project distribution.')
      }
    }
    return { transport: 'local', environment, projectId, path: project.path, target: null }
  }

  /** `unsupported` for a surface an SSH project does not have in this stage. */
  function requireLocalProject(projectId: string | null, channel: string): void {
    if (resolveLaunch(projectId, null).transport === 'ssh') {
      throw new AppError('unsupported', 'This action is not available for SSH projects.', channel)
    }
  }

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
  const terminals = new TerminalService({
    createPty: createNodePty,
    ssh: { client: sshClient, localCwd: options.homeDir ?? homedir() },
  })
  // Read-only Git over SSH: the same porcelain commands on the remote host,
  // one invocation per call, with sanitized logging (spec ssh-projects
  // Behaviour 12).
  const git = new GitService({ projects, remote: createSshGitRunner(sshClient) })
  const files = new FilesService({
    projects,
    // The stored path selects the transport: an SSH project gets the remote
    // adapter, a Local or WSL project keeps node:fs (spec Behaviour 10).
    remote: (target) => new SshFilesAdapter(sshClient, target),
    openExternal: options.openExternal,
    showInFolder: options.showInFolder,
    trashItem: options.trashItem,
  })
  const resumeTemplates = new ResumeTemplateService({
    projects,
    userDataPath: options.userDataPath,
  })
  const resumeSources = new ResumeSourcesService({
    projects,
    state,
    readLegacyTemplate: () => resumeTemplates.readLegacyTemplate(),
    resumeInstruction: () =>
      resolveInstruction(
        state.get(APP_STATE_KEY.resumeInstruction),
        DEFAULT_RESUME_INSTRUCTION,
        'resume',
      ),
  })
  // One-time NEKODE-187 migration before any renderer reads the instructions.
  // A failure is logged and retried at the next start; the default applies meanwhile.
  try {
    resumeSources.migrateResumeInstruction()
  } catch (error) {
    console.error('[resume-sources] Resume instruction migration failed', error)
  }
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
    create: (chatId: string, cwd: string, command?: ShellSpec) => {
      const projectId = chats.get(chatId)?.projectId ?? null
      const launch = resolveLaunch(projectId, cwd)
      if (launch.transport === 'ssh') {
        // The agent executable and argv run on the remote host as positional
        // arguments; there is no local fallback and no remote preflight
        // (spec ssh-projects Behaviour 7).
        return terminals.createAsync(chatId, cwd, command)
      }
      return terminals.createAsync(
        chatId,
        cwd,
        command === undefined
          ? undefined
          : () => {
              const id = chats.get(chatId)?.projectId
              // The effective choice, not the raw one: a stored `wsl:<distro>`
              // that detection no longer lists must not wrap the agent either
              // (spec project-shell-selection Behaviour 7).
              const choice = id
                ? shells.effectiveChoice(state.get(projectShellKey(id)), projects.get(id)?.path)
                : null
              return prepareWslAgentAsync(cwd, command, choice)
            },
      )
    },
  }
  const agentSessions = new AgentSessionRegistry()
  const agentChats = new AgentChatLaunchService({
    projects,
    profiles: agentProfiles,
    // The chat name and its errors belong to this flow, not to a task launch.
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, IPC_CHANNEL.chatsCreateWithAgent, identity),
    removeChat: (chatId) => chats.remove(chatId),
    sessions: agentSessions,
    terminals: agentTerminals,
  })
  const taskLaunch = new TaskLaunchService({
    projects,
    profiles: agentProfiles,
    kanban,
    createChat: (projectId, name, identity) =>
      chats.createNamed(projectId, name, IPC_CHANNEL.kanbanLaunchTask, identity),
    sessions: agentSessions,
    terminals: agentTerminals,
    startInstruction: () =>
      resolveInstruction(
        state.get(APP_STATE_KEY.startInstruction),
        DEFAULT_START_INSTRUCTION,
        'start',
      ),
  })
  const contextUsage = new ContextUsageService({
    projects,
    chats,
    launch: (chatId) => agentSessions.launch(chatId),
    // The agents' own config roots: the CLI env override wins, else the home default.
    claudeConfigDir: () =>
      process.env.CLAUDE_CONFIG_DIR?.trim() || join(options.homeDir ?? homedir(), '.claude'),
    codexConfigDir: () =>
      process.env.CODEX_HOME?.trim() || join(options.homeDir ?? homedir(), '.codex'),
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
      refresh: (request) => usage.refresh(request),
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
      // Actions stay local-only: an SSH project has no local shell, no local
      // cwd and no background child (spec ssh-projects Data/API).
      execute: (id, projectId, confirmed) => {
        requireLocalProject(projectId, IPC_CHANNEL.actionsExecute)
        return actions.execute(id, projectId, confirmed)
      },
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
      wslDistributions: () => (wslSupported() ? listWslDistributionsAsync() : []),
      wslDirectories: (distribution, linuxPath) => {
        requireWslSupport()
        return listWslDirectoriesAsync(distribution, linuxPath)
      },
      addWsl: (distribution, linuxPath) => {
        requireWslSupport()
        return validatedWslProjectPathAsync(distribution, linuxPath).then((path) =>
          projects.add(path),
        )
      },
      // SSH registration (spec ssh-projects Data/API): validate, prove the
      // host answers and the remote directory exists, then insert. The check
      // is asynchronous and runs before any row is written.
      addSsh: async (input) => {
        const invalid = validateSshLocation(input)
        if (invalid !== null) {
          throw new AppError('validation', invalid.message, IPC_CHANNEL.projectsAddSsh)
        }
        const target = sshTargetFromInput(input)
        const remotePath = await sshClient.requireDirectory(target)
        return projects.addSsh(target, remotePath)
      },
      remove: (projectId) => projects.remove(projectId),
    },
    chats: {
      list: (projectId) => chats.list(projectId),
      create: (projectId) => chats.create(projectId),
      createWithAgent: (projectId, profileId) => agentChats.createWithAgent(projectId, profileId),
      remove: (chatId) => {
        agentChats.removeChat(chatId)
      },
      contextUsage: () => contextUsage.usage(),
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
        const launch = resolveLaunch(projectId, cwd)
        if (launch.transport === 'ssh') {
          // The SSH project path alone selects the remote login shell; the
          // renderer supplies no shell, host, user or port (Behaviour 5-6).
          return terminals.createAsync(chatId, cwd)
        }
        return terminals.createAsync(
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
      shellDetect: async (projectId) => {
        const projectPath = projectId == null ? undefined : requireProjectPath(projectId)
        if (projectPath !== undefined && projectEnvironment(projectPath).kind === 'ssh') {
          // No host or WSL probe for an SSH project (spec Behaviour 9).
          throw new AppError(
            'unsupported',
            'This action is not available for SSH projects.',
            IPC_CHANNEL.terminalsShellDetect,
          )
        }
        if (projectPath !== undefined && projectWslLocation(projectPath) !== null) {
          const result = await shells.detectAsync(
            readCustomShellPaths(projectWslShellsKey(projectId as string)),
            projectPath,
          )
          requireProjectPath(projectId as string)
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
        const result = await shells.detectAsync(readCustomShellPaths())
        try {
          if (result.prunedCustomPaths.length > 0) {
            writeCustomShellPaths(shells.customPaths())
          }
          return result.shells
        } finally {
          shells.endDetect()
        }
      },
      shellAddCustom: async (path, projectId) => {
        const projectPath = projectId == null ? undefined : requireProjectPath(projectId)
        if (projectPath !== undefined && projectEnvironment(projectPath).kind === 'ssh') {
          // No custom remote shell path and no host custom-shell write
          // (spec Behaviour 9).
          throw new AppError(
            'unsupported',
            'This action is not available for SSH projects.',
            IPC_CHANNEL.terminalsShellAddCustom,
          )
        }
        if (projectPath !== undefined && projectWslLocation(projectPath) !== null) {
          const entry = await shells.addCustomPathAsync(path, projectPath)
          requireProjectPath(projectId as string)
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
    resumeSources,
    kanban: {
      adaptersList: () => kanban.adaptersList(),
      getConfig: (projectId) => kanban.getConfig(projectId),
      setConfig: (projectId, config) => kanban.setConfig(projectId, config),
      test: (projectId, values) => kanban.test(projectId, values),
      listBoard: (projectId) => kanban.listBoard(projectId),
      createItem: (projectId, input, revision) => kanban.createItem(projectId, input, revision),
      updateItem: (projectId, ref, patch, revision) =>
        kanban.updateItem(projectId, ref, patch, revision),
      // Local-file surfaces (spec ssh-projects Non-goals): an SSH project has
      // no local task file or agent-skill file, and no local path is derived
      // from the SSH URL.
      bindLocalFile: (projectId) => {
        requireLocalProject(projectId, IPC_CHANNEL.kanbanBindLocalFile)
        return kanban.bindLocalFile(projectId)
      },
      skillPreview: (projectId) => {
        requireLocalProject(projectId, IPC_CHANNEL.kanbanSkillPreview)
        return kanban.skillPreview(projectId)
      },
      writeSkill: (projectId, token) => {
        requireLocalProject(projectId, IPC_CHANNEL.kanbanWriteSkill)
        return kanban.writeSkill(projectId, token)
      },
      getItem: (projectId, ref) => kanban.getItem(projectId, ref),
      getComments: (projectId, ref) => kanban.getComments(projectId, ref),
      // Kanban launch is a local-only surface (spec ssh-projects Non-goals):
      // an SSH project has no local task files or agent-skill files.
      launchTask: async (input) => {
        requireLocalProject(input.projectId, IPC_CHANNEL.kanbanLaunchTask)
        return taskLaunch.launch(input)
      },
      cleanupProject: (projectId) => kanban.cleanupProject(projectId),
      dropLaunchProject: (projectId) => taskLaunch.dropProject(projectId),
      blocksProjectShell: (chatId) => taskLaunch.blocksProjectShell(chatId),
    },
    taskProgress: {
      adaptersList: () => taskProgress.adaptersList(),
      getBinding: (projectId) => taskProgress.getBinding(projectId),
      // Task progress sidecars are local files (spec ssh-projects Non-goals).
      saveBinding: (projectId, adapterId, config) => {
        requireLocalProject(projectId, IPC_CHANNEL.taskProgressSaveBinding)
        return taskProgress.saveBinding(projectId, adapterId, config)
      },
      test: (projectId, adapterId, config) => {
        requireLocalProject(projectId, IPC_CHANNEL.taskProgressTest)
        return taskProgress.test(projectId, adapterId, config)
      },
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
    preview: {
      target: async (projectId, relativePath) => {
        const { fileName } = await files.previewTarget(projectId, relativePath)
        const project = projects.get(projectId)
        if (project === null) {
          throw new AppError('not_found', 'Project not found.', 'files:openInWindow')
        }
        return { projectId, projectName: project.name, relativePath, fileName }
      },
      fingerprint: (projectId, relativePath) => files.fingerprint(projectId, relativePath),
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
