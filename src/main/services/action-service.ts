import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type Database from 'better-sqlite3'
import { createBottomTabId } from '../../shared/bottom-tab-id'
import type {
  ActionControl,
  ActionExecution,
  ActionInput,
  ChatInfo,
} from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { parseWslPath } from '../../shared/wsl-path'
import { wrapSqliteError } from './project-service'

interface ActionRow {
  id: string
  project_id: string | null
  scope: 'global' | 'project'
  title: string
  icon: string | null
  command: string
  cwd: string | null
  run_mode: 'background' | 'new-terminal' | 'bottom-terminal'
  confirm: number
  sort_order: number
}

export interface BackgroundChild {
  stop(): void
}

export interface ActionServiceDeps {
  db: Database.Database
  startBackground?: (
    command: string,
    cwd: string,
    done: (exitCode: number | null, error?: string) => void,
  ) => BackgroundChild | undefined
  createChat: (projectId: string) => ChatInfo
  /**
   * Kept on the dependency so a test fails if execute spawns the PTY.
   * The chat view spawns after it subscribes to terminal data.
   */
  createTerminal: (chatId: string, cwd: string) => string
  /**
   * Bottom-terminal delivery: one fresh id per execution, `bottom:<projectId>:<token>`
   * (src/shared/bottom-tab-id.ts). The renderer creates the tab, spawns the
   * PTY through terminals:create, and writes the command after it is ready.
   * Injectable for tests; production wiring uses createBottomTabId.
   */
  createBottomTabId?: (projectId: string) => string
  isDirectory?: (path: string) => boolean
}

interface RunningChild {
  stop: () => void
  projectId: string | null
  epoch: number
}

// shell: true is cmd.exe on Windows. Killing only that pid leaves the command.
function killSpawnedShell(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  if (process.platform === 'win32' && pid !== undefined) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    killer.once('error', () => {
      try {
        child.kill()
      } catch {
        // The pid already exited between the check and the signal.
      }
    })
    return
  }
  try {
    child.kill()
  } catch {
    // The pid already exited between the check and the signal.
  }
}

function startBackground(
  command: string,
  cwd: string,
  done: (exitCode: number | null, error?: string) => void,
): BackgroundChild {
  const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: 'ignore' })
  let settled = false
  const finish = (exitCode: number | null, error?: string): void => {
    if (settled) return
    settled = true
    done(exitCode, error)
  }
  child.once('error', (error) => {
    finish(null, error.message)
  })
  child.once('close', (code) => {
    finish(code)
  })
  return {
    stop() {
      killSpawnedShell(child)
    },
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function toControl(row: ActionRow): ActionControl {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    title: row.title,
    icon: row.icon,
    command: row.command,
    cwd: row.cwd,
    runMode: row.run_mode,
    confirm: row.confirm === 1,
    sortOrder: row.sort_order,
  }
}

const idle: ActionExecution = { status: 'idle', exitCode: null, completedAt: null, error: null }

export class ActionService {
  readonly #deps: ActionServiceDeps
  readonly #status = new Map<string, ActionExecution>()
  readonly #runEpoch = new Map<string, number>()
  readonly #runs = new Map<string, RunningChild>()

  constructor(deps: ActionServiceDeps) {
    this.#deps = deps
  }

  list(): ActionControl[] {
    try {
      return (
        this.#deps.db
          .prepare('SELECT * FROM actions ORDER BY sort_order, title, id')
          .all() as ActionRow[]
      ).map(toControl)
    } catch (error) {
      throw wrapSqliteError(error, 'actions:list')
    }
  }

  create(input: ActionInput): ActionControl {
    this.#validate(input)
    const id = randomUUID()
    try {
      this.#deps.db
        .prepare(`INSERT INTO actions
        (id, project_id, scope, title, icon, command, cwd, run_mode, confirm, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          input.projectId,
          input.scope,
          input.title.trim(),
          input.icon,
          input.command.trim(),
          input.cwd,
          input.runMode,
          input.confirm ? 1 : 0,
          input.sortOrder,
        )
    } catch (error) {
      throw wrapSqliteError(error, 'actions:create')
    }
    return { ...input, id, title: input.title.trim(), command: input.command.trim() }
  }

  update(id: string, input: ActionInput): ActionControl {
    this.#validate(input)
    try {
      const result = this.#deps.db
        .prepare(`UPDATE actions SET
        project_id = ?, scope = ?, title = ?, icon = ?, command = ?, cwd = ?,
        run_mode = ?, confirm = ?, sort_order = ? WHERE id = ?`)
        .run(
          input.projectId,
          input.scope,
          input.title.trim(),
          input.icon,
          input.command.trim(),
          input.cwd,
          input.runMode,
          input.confirm ? 1 : 0,
          input.sortOrder,
          id,
        )
      if (result.changes === 0)
        throw new AppError('not_found', 'Action not found.', 'actions:update')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw wrapSqliteError(error, 'actions:update')
    }
    return { ...input, id, title: input.title.trim(), command: input.command.trim() }
  }

  delete(id: string): void {
    try {
      const result = this.#deps.db.prepare('DELETE FROM actions WHERE id = ?').run(id)
      if (result.changes === 0)
        throw new AppError('not_found', 'Action not found.', 'actions:delete')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw wrapSqliteError(error, 'actions:delete')
    }
    this.#invalidateRun(id)
    this.#stopChild(id)
    this.#status.delete(id)
  }

  /** Stops background children owned by a project after its row cascade. */
  stopForProject(projectId: string): void {
    const ids = [...this.#runs.entries()]
      .filter(([, run]) => run.projectId === projectId)
      .map(([id]) => id)
    for (const id of ids) {
      this.#invalidateRun(id)
      this.#stopChild(id)
      this.#status.delete(id)
    }
  }

  status(id: string): ActionExecution {
    this.#get(id, 'actions:status')
    return this.#status.get(id) ?? idle
  }

  execute(id: string, projectId: string | null, confirmed: boolean): ActionExecution {
    const action = this.#get(id, 'actions:execute')
    if (action.confirm && !confirmed)
      throw new AppError('validation', 'Action requires confirmation.', 'actions:execute')
    if (action.scope === 'project' && action.projectId !== projectId) {
      throw new AppError(
        'validation',
        'Action does not belong to the active project.',
        'actions:execute',
      )
    }
    if (projectId !== null && !this.#projectPath(projectId)) {
      throw new AppError('not_found', 'Project not found.', 'actions:execute')
    }
    const cwd = action.cwd ?? (projectId === null ? null : this.#projectPath(projectId))
    if (cwd === null)
      throw new AppError(
        'validation',
        'Select a project or configure a working directory.',
        'actions:execute',
      )
    const projectPath = projectId === null ? null : this.#projectPath(projectId)
    const location = projectPath === null ? null : parseWslPath(projectPath)
    const cwdLocation = parseWslPath(cwd)
    if (action.runMode === 'background' && (location !== null || cwdLocation !== null)) {
      throw new AppError(
        'validation',
        'Background actions are unavailable for WSL projects. Use a terminal action.',
        'actions:execute',
      )
    }
    if (location !== null && cwdLocation?.distribution !== location.distribution) {
      throw new AppError(
        'validation',
        'A WSL action must use its project distribution.',
        'actions:execute',
      )
    }
    if (!(this.#deps.isDirectory ?? isDirectory)(cwd)) {
      this.#invalidateRun(id)
      this.#stopChild(id)
      const failed: ActionExecution = {
        status: 'failed',
        exitCode: null,
        completedAt: new Date().toISOString(),
        error: `Working directory does not exist: ${cwd}`,
      }
      this.#status.set(id, failed)
      return failed
    }
    if (action.runMode === 'new-terminal') {
      if (projectId === null) {
        throw new AppError('validation', 'Select a project to open a terminal.', 'actions:execute')
      }
      // The chat view spawns the PTY after onData. Spawning here drops the prompt.
      const chat = this.#deps.createChat(projectId)
      this.#invalidateRun(id)
      this.#stopChild(id)
      const success: ActionExecution = {
        status: 'success',
        exitCode: null,
        completedAt: new Date().toISOString(),
        error: null,
        chat,
        terminalCommand: action.command,
        terminalCwd: cwd,
      }
      this.#status.set(id, success)
      return success
    }
    if (action.runMode === 'bottom-terminal') {
      // Same project rule as new-terminal (spec Behaviour 16).
      if (projectId === null) {
        throw new AppError('validation', 'Select a project to open a terminal.', 'actions:execute')
      }
      this.#invalidateRun(id)
      this.#stopChild(id)
      // Delivery success with a null exit code: nothing here spawns a PTY or
      // creates a chat. The renderer opens the panel, adds a new bottom tab
      // for the fresh id, and writes the command plus CR once that tab's
      // terminal is subscribed (spec Behaviour 16, 18). The shell command's
      // later exit is never tracked.
      const success: ActionExecution = {
        status: 'success',
        exitCode: null,
        completedAt: new Date().toISOString(),
        error: null,
        bottomTabId: (this.#deps.createBottomTabId ?? createBottomTabId)(projectId),
        terminalCommand: action.command,
        terminalCwd: cwd,
      }
      this.#status.set(id, success)
      return success
    }
    const epoch = this.#invalidateRun(id)
    this.#stopChild(id)
    const running: ActionExecution = {
      status: 'running',
      exitCode: null,
      completedAt: null,
      error: null,
    }
    this.#status.set(id, running)
    let settled = false
    try {
      const handle = (this.#deps.startBackground ?? startBackground)(
        action.command,
        cwd,
        (exitCode, error) => {
          settled = true
          const current = this.#runs.get(id)
          if (current?.epoch === epoch) this.#runs.delete(id)
          if (this.#runEpoch.get(id) !== epoch) return
          this.#status.set(id, {
            status: error || exitCode !== 0 ? 'failed' : 'success',
            exitCode,
            completedAt: new Date().toISOString(),
            error: error ?? null,
          })
        },
      )
      if (!settled && handle !== undefined) {
        this.#runs.set(id, { stop: () => handle.stop(), projectId: action.projectId, epoch })
      }
    } catch (error) {
      if (this.#runEpoch.get(id) !== epoch) return this.#status.get(id) ?? running
      const failed: ActionExecution = {
        status: 'failed',
        exitCode: null,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Failed to start command.',
      }
      this.#status.set(id, failed)
    }
    return this.#status.get(id) ?? running
  }

  #invalidateRun(id: string): number {
    const epoch = (this.#runEpoch.get(id) ?? 0) + 1
    this.#runEpoch.set(id, epoch)
    return epoch
  }

  #stopChild(id: string): void {
    const run = this.#runs.get(id)
    if (run === undefined) return
    this.#runs.delete(id)
    run.stop()
  }

  #get(id: string, channel: string): ActionControl {
    const row = this.#deps.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as
      | ActionRow
      | undefined
    if (!row) throw new AppError('not_found', 'Action not found.', channel)
    return toControl(row)
  }

  #projectPath(projectId: string): string | null {
    return (
      (
        this.#deps.db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
          | { path: string }
          | undefined
      )?.path ?? null
    )
  }

  #validate(input: ActionInput): void {
    if (!input.title.trim() || !input.command.trim())
      throw new AppError('validation', 'Title and command are required.', 'actions:create')
    if ((input.scope === 'project') !== (input.projectId !== null))
      throw new AppError('validation', 'Project scope requires a project.', 'actions:create')
    if (input.projectId !== null && !this.#projectPath(input.projectId))
      throw new AppError('not_found', 'Project not found.', 'actions:create')
    if (
      input.cwd !== null &&
      (!isAbsolute(input.cwd) ||
        input.cwd.includes('\u0000') ||
        input.cwd.split(/[\\/]+/).includes('..'))
    )
      throw new AppError(
        'validation',
        'Working directory must be an absolute path without traversal.',
        'actions:create',
      )
  }
}
