import { statSync } from 'node:fs'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { AppStateService } from './app-state-service'
import { GitService } from './git/git-service'
import { ProjectService } from './project-service'
import { TaskService } from './task-service'
import { createNodePty } from './terminal/node-pty-factory'
import { TerminalService } from './terminal/terminal-service'

// Wires the persistence, terminal and git stacks to the typed service registry
// consumed by the IPC handlers. DB path is injected so tests use :memory: or a
// temp dir; the terminal/git services are constructed here with their real
// OS-facing implementations (node-pty, git CLI).

export interface CreateServicesOptions {
  dbPath: string
}

export function createServices(options: CreateServicesOptions): AppServices {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const tasks = new TaskService({ db })
  const state = new AppStateService({ db })
  const terminals = new TerminalService({ createPty: createNodePty })
  const git = new GitService()
  return {
    projects: {
      // Stale selection keys are cleaned on every list read (spec Edge cases:
      // a selection pointing at a removed project/task falls back to the
      // default empty state and the keys are removed).
      list: () => {
        state.cleanupSelection()
        return projects.list()
      },
      add: (path) => projects.add(path),
      remove: (projectId) => projects.remove(projectId),
    },
    tasks: {
      list: (projectId) => tasks.list(projectId),
      create: (projectId, name) => tasks.create(projectId, name),
    },
    state: {
      get: (key) => state.get(key),
      set: (key, value) => state.set(key, value),
    },
    terminals: {
      create: (taskId, cwd) => terminals.create(taskId, cwd),
      write: (taskId, data) => terminals.write(taskId, data),
      resize: (taskId, cols, rows) => terminals.resize(taskId, cols, rows),
      terminate: (taskId) => terminals.terminate(taskId),
      terminateAll: () => terminals.terminateAll(),
      onData: (listener) => terminals.onData(listener),
      onExit: (listener) => terminals.onExit(listener),
    },
    git: {
      getStatus: (projectPath) => git.getStatus(projectPath),
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
