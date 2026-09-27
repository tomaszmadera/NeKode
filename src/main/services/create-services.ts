import { statSync } from 'node:fs'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { ActionService } from './action-service'
import { AppStateService } from './app-state-service'
import { ChatService } from './chat-service'
import { FilesService } from './files/files-service'
import { GitService } from './git/git-service'
import { ProjectService } from './project-service'
import { createNodePty } from './terminal/node-pty-factory'
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
   * OS default-application open (shell.openPath). Resolves '' on success and
   * an error description on failure (the Electron contract).
   */
  openExternal: (absolutePath: string) => Promise<string>
}

export function createServices(options: CreateServicesOptions): AppServices {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const chats = new ChatService({ db })
  const state = new AppStateService({ db })
  const terminals = new TerminalService({ createPty: createNodePty })
  const git = new GitService()
  const files = new FilesService({ projects, openExternal: options.openExternal })
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
    },
    terminals: {
      create: (chatId, cwd) => terminals.create(chatId, cwd),
      write: (chatId, data) => terminals.write(chatId, data),
      resize: (chatId, cols, rows) => terminals.resize(chatId, cols, rows),
      shellName: () => terminals.shellName(),
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
