import { statSync } from 'node:fs'
import { join } from 'node:path'
import { bottomTabProjectId, isBottomTabId } from '../../shared/bottom-tab-id'
import { APP_STATE_KEY, projectHandoffDirKey, projectShellKey } from '../../shared/ipc-contract'
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
  const readCustomShellPaths = (): string[] => {
    const raw = state.get(APP_STATE_KEY.customShells)
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
  const projectShell = (projectId: string) => shells.resolve(state.get(projectShellKey(projectId)))
  const chats = new ChatService({
    db,
    chatNameForProject: (projectId) => shells.label(state.get(projectShellKey(projectId))),
  })
  const terminals = new TerminalService({ createPty: createNodePty })
  const git = new GitService()
  const files = new FilesService({ projects, openExternal: options.openExternal })
  const handoffs = new HandoffsService({ projects, state, handoffDirKey: projectHandoffDirKey })
  // Handoff match and link (stage 4): a shallow scan beside HandoffsService.
  // HandoffsService.list keeps its own contract; this service is read-only
  // apart from the explicit link document it owns.
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
      // their project, chat ids resolve through the chat row. An unknown id
      // falls back to the platform default (spawn never fails on shell
      // resolution).
      create: (chatId, cwd) => {
        const projectId = isBottomTabId(chatId)
          ? bottomTabProjectId(chatId)
          : (chats.get(chatId)?.projectId ?? null)
        return terminals.create(
          chatId,
          cwd,
          projectId !== null ? projectShell(projectId) : undefined,
        )
      },
      write: (chatId, data) => terminals.write(chatId, data),
      resize: (chatId, cols, rows) => terminals.resize(chatId, cols, rows),
      shellName: (projectId) => shells.label(state.get(projectShellKey(projectId))),
      shellList: () => shells.list(),
      shellDetect: () => {
        const result = shells.detect(readCustomShellPaths())
        if (result.prunedCustomPaths.length > 0) {
          writeCustomShellPaths(shells.customPaths())
        }
        const list = result.shells
        shells.endDetect()
        return list
      },
      shellAddCustom: (path) => {
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
      linkHandoff: (input) => handoffMatcher.link(input),
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
