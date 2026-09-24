import { statSync } from 'node:fs'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import type { AppServices } from '../ipc/service-registry'
import { AppStateService } from './app-state-service'
import { ProjectService } from './project-service'
import { TaskService } from './task-service'

// Wires the persistence stack to the typed service registry consumed by the
// IPC handlers. DB path is injected so tests use :memory: or a temp dir.

export interface CreateServicesOptions {
  dbPath: string
}

export function createServices(options: CreateServicesOptions): AppServices {
  const db = openDatabase(options.dbPath)
  runMigrations(db)
  const projects = new ProjectService({ db, fs: { stat: (path) => safeStat(path) } })
  const tasks = new TaskService({ db })
  const state = new AppStateService({ db })
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
