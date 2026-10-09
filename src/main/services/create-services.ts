import { statSync } from 'node:fs'
import { join } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '../../shared/bottom-tab-id'
import {
  APP_STATE_KEY,
  projectHandoffDirKey,
  projectShellKey,
  projectWslShellsKey,
} from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { parseWslPath } from '../../shared/wsl-path'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { ActionService } from './action-service'
import { AgentProfilesService } from './agent-profiles/agent-profiles-service'
import { AppStateService } from './app-state-service'
import { ChatService } from './chat-service'
import { FilesService } from './files/files-service'
import { GitService } from './git/git-service'
import { HandoffMatcherService } from './handoffs/handoff-matcher-service'
import { HandoffsService } from './handoffs/handoffs-service'
import { KanbanService } from './kanban/kanban-service'
import { TaskLaunchService } from './kanban/task-launch-service'
import { ProjectService } from './project-service'
import { createNodePty } from './terminal/node-pty-factory'
import { ShellService } from './terminal/shell-service'
import { TerminalService } from './terminal/terminal-service'
import { listWslDistributions, validatedWslProjectPath } from './terminal/wsl'

// Wires the persistence, terminal and git stacks to the typed service registry
// consumed by the IPC handlers. DB path is injected so tests use :memory: or a
// temp dir; the terminal/git services are constructed here with their real
// OS-facing implementations (node-pty, git CLI). The file service's external
// open is injected too (shell.openPath in main/index.ts) — this module stays
// free of electron imports.

export interface CreateServicesOptions {
  dbPath: string
  /**
   * userData directory (default location of the kanban adapters dir).
   */
  userDataPath: string
  /**
   * OS default-application open (shell.openPath). Resolves '' on success and
   * an error description on failure (the Electron contract).
   */
  openExternal: (absolutePath: string) => Promise<string>
  /**
   * Native directory picker (dialog.showOpenDialog in main/index.ts).
   * Resolves the chosen absolute path, or null when the user cancels.
   */
  pickDirectory: (defaultPath: string | null) => Promise<string | null>
}

export function createServices(options: CreateServicesOptions): AppServices {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const state = new AppStateService({ db })
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
  const terminals = new TerminalService({ createPty: createNodePty })
  const git = new GitService()
  const files = new FilesService({ projects, openExternal: options.openExternal })
  const handoffs = new HandoffsService({ projects, state, handoffDirKey: projectHandoffDirKey })
  // Handoff match (stage 4): a shallow, read-only scan beside HandoffsService.
  // HandoffsService.list keeps its own contract; this service only reads the
  // configured directory and returns file metadata.
  const handoffMatcher = new HandoffMatcherService({ projects, state })
  const kanban = new KanbanService({
    projects,
    state,
    // Default adapters dir lives under userData; the stored app_state key
    // overrides it (spec kanban-adapter-interface Behaviour 1).
    adaptersDir: () => {
      const override = state.get(APP_STATE_KEY.kanbanAdaptersDir)
      return override !== null && override.trim().length > 0
        ? override
        : join(options.userDataPath, 'kanban-adapters')
    },
  })
  const agentProfiles = new AgentProfilesService({ projects, state })
  const taskLaunch = new TaskLaunchService({
    projects,
    profiles: agentProfiles,
    kanban,
    // Resume rechecks its chosen file through the stage 4 matcher before the
    // chat is created (spec Resume.3).
    handoffs: handoffMatcher,
    handoffDir: (projectId) => {
      const value = state.get(projectHandoffDirKey(projectId))
      if (value === null || value.trim().length === 0) {
        return null
      }
      return value
    },
    createChat: (projectId, name) => chats.createNamed(projectId, name),
    terminals,
  })
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
    actions: {
      list: () => actions.list(),
      create: (input) => actions.create(input),
      update: (id, input) => actions.update(id, input),
      delete: (id) => actions.delete(id),
      execute: (id, projectId, confirmed) => actions.execute(id, projectId, confirmed),
      status: (id) => actions.status(id),
      stopForProject: (projectId) => actions.stopForProject(projectId),
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
      wslDistributions: listWslDistributions,
      addWsl: (distribution, linuxPath) =>
        projects.add(validatedWslProjectPath(distribution, linuxPath)),
      remove: (projectId) => projects.remove(projectId),
    },
    chats: {
      list: (projectId) => chats.list(projectId),
      create: (projectId) => chats.create(projectId),
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
        if (result.prunedCustomPaths.length > 0) {
          writeCustomShellPaths(shells.customPaths())
        }
        const list = result.shells
        shells.endDetect()
        return list
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
      onData: (listener) => terminals.onData(listener),
      onExit: (listener) => terminals.onExit(listener),
    },
    git: {
      getStatus: (projectPath) => git.getStatus(projectPath),
    },
    files: {
      list: (projectId, relativePath) => files.list(projectId, relativePath),
      read: (projectId, relativePath) => files.read(projectId, relativePath),
      openExternal: (projectId, relativePath) => files.openExternal(projectId, relativePath),
      openRoot: (projectId) => files.openRoot(projectId),
    },
    handoffs: {
      list: (projectId) => handoffs.list(projectId),
    },
    kanban: {
      adaptersList: () => kanban.adaptersList(),
      getConfig: (projectId) => kanban.getConfig(projectId),
      setConfig: (projectId, config) => kanban.setConfig(projectId, config),
      test: (projectId, values) => kanban.test(projectId, values),
      listBoard: (projectId) => kanban.listBoard(projectId),
      createItem: (projectId, input) => kanban.createItem(projectId, input),
      updateItem: (projectId, ref, patch) => kanban.updateItem(projectId, ref, patch),
      getItem: (projectId, ref) => kanban.getItem(projectId, ref),
      launchTask: (input) => taskLaunch.launch(input),
      handoffCandidates: (input) => handoffMatcher.candidates(input),
      handoffAvailability: (input) => handoffMatcher.availability(input),
      cleanupProject: (projectId) => kanban.cleanupProject(projectId),
      dropLaunchProject: (projectId) => taskLaunch.dropProject(projectId),
      blocksProjectShell: (chatId) => taskLaunch.blocksProjectShell(chatId),
    },
    agentProfiles: {
      get: (projectId) => agentProfiles.get(projectId),
      put: (projectId, input) => agentProfiles.put(projectId, input),
      delete: (projectId, profileId) => agentProfiles.delete(projectId, profileId),
      cleanupProject: (projectId) => agentProfiles.cleanupProject(projectId),
    },
    dialogs: {
      pickDirectory: (defaultPath) => options.pickDirectory(defaultPath),
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
