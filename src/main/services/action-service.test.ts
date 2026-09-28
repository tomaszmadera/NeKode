import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { ActionService } from './action-service'

function setup() {
  const db = openDatabase(':memory:')
  runMigrations(db)
  db.prepare(
    'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('p1', 'Demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
  const startBackground = vi.fn(
    (
      _command: string,
      _cwd: string,
      done: (exitCode: number | null, error?: string) => void,
    ): undefined => {
      done(0)
      return undefined
    },
  )
  const createChat = vi.fn(() => ({ id: 't2', projectId: 'p1', name: 'PowerShell' }))
  const createTerminal = vi.fn(() => 't2')
  const createBottomTabId = vi.fn((projectId: string) => `bottom:${projectId}:test-tab`)
  const service = new ActionService({
    db,
    startBackground,
    createChat,
    createTerminal,
    createBottomTabId,
    isDirectory: () => true,
  })
  return { db, service, startBackground, createChat, createTerminal, createBottomTabId }
}

describe('ActionService', () => {
  it('preserves action rows across a file database reopen and cascades project removal', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-action-test-'))
    const path = join(directory, 'actions.db')
    try {
      const first = openDatabase(path)
      runMigrations(first)
      first
        .prepare(
          'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('p1', 'Demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
      const deps = {
        createChat: vi.fn(),
        createTerminal: vi.fn(),
        isDirectory: () => true,
      }
      new ActionService({ db: first, ...deps }).create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: false,
        sortOrder: 0,
      })
      first.close()
      const reopened = openDatabase(path)
      try {
        expect(runMigrations(reopened)).toBe(5)
        expect(
          new ActionService({ db: reopened, ...deps }).list().map((action) => action.title),
        ).toEqual(['Build'])
        reopened.prepare('DELETE FROM projects WHERE id = ?').run('p1')
        expect(new ActionService({ db: reopened, ...deps }).list()).toEqual([])
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('persists ordered project and global actions, edits, and deletes', () => {
    const { db, service } = setup()
    try {
      const global = service.create({
        scope: 'global',
        projectId: null,
        title: 'Global',
        icon: null,
        command: 'echo global',
        cwd: null,
        runMode: 'background',
        confirm: false,
        sortOrder: 2,
      })
      const project = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: true,
        sortOrder: 1,
      })
      expect(service.list().map((action) => action.id)).toEqual([project.id, global.id])
      expect(
        service.update(project.id, { ...project, title: 'Test', command: 'pnpm test' }).title,
      ).toBe('Test')
      expect(service.list().find((action) => action.id === project.id)?.command).toBe('pnpm test')
      service.delete(project.id)
      expect(service.list().map((action) => action.id)).toEqual([global.id])
    } finally {
      db.close()
    }
  })

  it('requires explicit confirmation and reports background completion', () => {
    const { db, service, startBackground } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: true,
        sortOrder: 0,
      })
      expect(() => service.execute(action.id, 'p1', false)).toThrow(/confirm/i)
      expect(startBackground).not.toHaveBeenCalled()
      service.execute(action.id, 'p1', true)
      expect(startBackground).toHaveBeenCalledWith(
        'pnpm build',
        'D:/code/demo',
        expect.any(Function),
      )
      expect(service.status(action.id)).toMatchObject({ status: 'success', exitCode: 0 })
    } finally {
      db.close()
    }
  })

  it('rejects another project at execution and invalid configured cwd', () => {
    const { db, service, startBackground } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: false,
        sortOrder: 0,
      })
      expect(() => service.execute(action.id, 'p2', false)).toThrow(/active project/)
      expect(startBackground).not.toHaveBeenCalled()
      expect(() => service.create({ ...action, cwd: '../outside' })).toThrow(/working directory/i)
    } finally {
      db.close()
    }
  })

  it('reports a nonzero background exit and missing working directory as failed', () => {
    const { db, service, startBackground } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: false,
        sortOrder: 0,
      })
      startBackground.mockImplementationOnce((_command, _cwd, done) => {
        done(7)
        return undefined
      })
      service.execute(action.id, 'p1', false)
      expect(service.status(action.id)).toMatchObject({ status: 'failed', exitCode: 7 })
      service.update(action.id, { ...action, cwd: 'D:/code/missing' })
      const missing = new ActionService({
        db,
        startBackground,
        createChat: vi.fn(),
        createTerminal: vi.fn(),
        isDirectory: (path) => path !== 'D:/code/missing',
      })
      expect(missing.execute(action.id, 'p1', false)).toMatchObject({
        status: 'failed',
        exitCode: null,
        error: expect.stringContaining('D:/code/missing'),
      })
    } finally {
      db.close()
    }
  })

  it('ignores a background completion from an older run', () => {
    const { db, service, startBackground } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Build',
        icon: null,
        command: 'pnpm build',
        cwd: null,
        runMode: 'background',
        confirm: false,
        sortOrder: 0,
      })
      let finishFirst: ((exitCode: number | null, error?: string) => void) | undefined
      startBackground.mockImplementationOnce((_command, _cwd, done) => {
        finishFirst = done
        return undefined
      })
      expect(service.execute(action.id, 'p1', false).status).toBe('running')
      startBackground.mockImplementationOnce((_command, _cwd, done) => {
        done(0)
        return undefined
      })
      expect(service.execute(action.id, 'p1', false)).toMatchObject({
        status: 'success',
        exitCode: 0,
      })
      finishFirst?.(7)
      expect(service.status(action.id)).toMatchObject({ status: 'success', exitCode: 0 })
    } finally {
      db.close()
    }
  })

  it('executes bottom-terminal by addressing a new bottom tab without a chat or a PTY', () => {
    const { db, service, createChat, createTerminal, createBottomTabId } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Watch',
        icon: null,
        command: 'pnpm test',
        cwd: 'D:/code/demo/app',
        runMode: 'bottom-terminal',
        confirm: false,
        sortOrder: 0,
      })
      const result = service.execute(action.id, 'p1', false)
      // Delivery success with a null exit code: the shell command's later exit
      // is never tracked (bottom-auxiliary-terminal spec Behaviour 18).
      expect(result).toEqual({
        status: 'success',
        exitCode: null,
        completedAt: expect.any(String),
        error: null,
        bottomTabId: 'bottom:p1:test-tab',
        terminalCommand: 'pnpm test',
        terminalCwd: 'D:/code/demo/app',
      })
      expect(createBottomTabId).toHaveBeenCalledWith('p1')
      expect(createChat).not.toHaveBeenCalled()
      expect(createTerminal).not.toHaveBeenCalled()
      expect(service.status(action.id)).toMatchObject({ status: 'success', exitCode: null })

      // No configured cwd falls back to the project path.
      const rooted = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Rooted',
        icon: null,
        command: 'pnpm lint',
        cwd: null,
        runMode: 'bottom-terminal',
        confirm: false,
        sortOrder: 1,
      })
      expect(service.execute(rooted.id, 'p1', false).terminalCwd).toBe('D:/code/demo')
      // Every execution gets a fresh id: no reuse of an existing tab.
      expect(createBottomTabId).toHaveBeenCalledTimes(2)
      expect(createChat).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('bottom-terminal needs a project and fails on a missing working directory without a tab', () => {
    const { db, service, createChat, createTerminal, createBottomTabId } = setup()
    try {
      // projectId null: the same validation error as new-terminal, no tab.
      const global = service.create({
        scope: 'global',
        projectId: null,
        title: 'Global watch',
        icon: null,
        command: 'pnpm test',
        cwd: 'D:/code/anywhere',
        runMode: 'bottom-terminal',
        confirm: false,
        sortOrder: 0,
      })
      expect(() => service.execute(global.id, null, false)).toThrow(
        /Select a project to open a terminal\./,
      )
      expect(createChat).not.toHaveBeenCalled()
      expect(createTerminal).not.toHaveBeenCalled()
      expect(createBottomTabId).not.toHaveBeenCalled()

      // Missing working directory: failed status, no tab id in the result.
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Watch',
        icon: null,
        command: 'pnpm test',
        cwd: 'D:/code/missing',
        runMode: 'bottom-terminal',
        confirm: false,
        sortOrder: 1,
      })
      const missing = new ActionService({
        db,
        startBackground: vi.fn(),
        createChat,
        createTerminal: vi.fn(),
        isDirectory: (path) => path !== 'D:/code/missing',
      })
      const result = missing.execute(action.id, 'p1', false)
      expect(result.status).toBe('failed')
      expect(result.error).toContain('D:/code/missing')
      expect(result.bottomTabId).toBeUndefined()
      expect(createChat).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('creates a chat for new-terminal mode and does not spawn the PTY', () => {
    const { db, service, createChat, createTerminal } = setup()
    try {
      const action = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Watch',
        icon: null,
        command: 'pnpm dev',
        cwd: 'D:/code/demo/app',
        runMode: 'new-terminal',
        confirm: false,
        sortOrder: 0,
      })
      const result = service.execute(action.id, 'p1', false)
      expect(result.chat).toEqual({ id: 't2', projectId: 'p1', name: 'PowerShell' })
      expect(createChat).toHaveBeenCalledWith('p1')
      // Spawning inside execute drops shell startup output: the view subscribes
      // to terminals:data only after this call returns.
      expect(createTerminal).not.toHaveBeenCalled()
      expect(result).toMatchObject({ terminalCommand: 'pnpm dev', terminalCwd: 'D:/code/demo/app' })
      const rooted = service.create({
        scope: 'project',
        projectId: 'p1',
        title: 'Test',
        icon: null,
        command: 'pnpm test',
        cwd: null,
        runMode: 'new-terminal',
        confirm: false,
        sortOrder: 1,
      })
      expect(service.execute(rooted.id, 'p1', false).terminalCwd).toBe('D:/code/demo')
      expect(createTerminal).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('stops a running child when its action or project is removed', () => {
    const stops = { owned: vi.fn(), other: vi.fn(), global: vi.fn(), finished: vi.fn() }
    const db = openDatabase(':memory:')
    runMigrations(db)
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'Demo', 'D:/code/demo', null, '2026-01-01T00:00:00Z')
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p2', 'Other', 'D:/code/other', null, '2026-01-01T00:00:00Z')
    const startBackground = vi.fn((command: string) => {
      if (command === 'finished') {
        return { stop: stops.finished }
      }
      return {
        stop: command === 'owned' ? stops.owned : command === 'other' ? stops.other : stops.global,
      }
    })
    const service = new ActionService({
      db,
      startBackground: (command, _cwd, done) => {
        if (command === 'finished') done(0)
        return startBackground(command)
      },
      createChat: vi.fn(),
      createTerminal: vi.fn(),
      isDirectory: () => true,
    })
    try {
      const input = {
        icon: null,
        cwd: null,
        runMode: 'background' as const,
        confirm: false,
        sortOrder: 0,
      }
      const owned = service.create({
        ...input,
        scope: 'project',
        projectId: 'p1',
        title: 'Owned',
        command: 'owned',
      })
      const other = service.create({
        ...input,
        scope: 'project',
        projectId: 'p2',
        title: 'Other',
        command: 'other',
        sortOrder: 1,
      })
      const global = service.create({
        ...input,
        scope: 'global',
        projectId: null,
        title: 'Global',
        command: 'global',
        sortOrder: 2,
      })
      const finished = service.create({
        ...input,
        scope: 'project',
        projectId: 'p1',
        title: 'Finished',
        command: 'finished',
        sortOrder: 3,
      })
      service.execute(owned.id, 'p1', false)
      service.execute(other.id, 'p2', false)
      service.execute(global.id, 'p1', false)
      service.execute(finished.id, 'p1', false)
      service.delete(finished.id)
      expect(stops.finished).not.toHaveBeenCalled()
      service.stopForProject('p1')
      expect(stops.owned).toHaveBeenCalledTimes(1)
      expect(stops.other).not.toHaveBeenCalled()
      expect(stops.global).not.toHaveBeenCalled()
      service.delete(other.id)
      expect(stops.other).toHaveBeenCalledTimes(1)
      expect(stops.global).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('kills the retained shell process when the action is deleted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-action-kill-'))
    const pidFile = join(directory, 'pid')
    const scriptPath = join(directory, 'stay.cjs')
    writeFileSync(
      scriptPath,
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`,
    )
    const db = openDatabase(':memory:')
    runMigrations(db)
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'Demo', directory, null, '2026-01-01T00:00:00Z')
    const service = new ActionService({
      db,
      createChat: vi.fn(),
      createTerminal: vi.fn(),
    })
    const action = service.create({
      scope: 'project',
      projectId: 'p1',
      title: 'Stay',
      icon: null,
      command: `"${process.execPath}" "${scriptPath}"`,
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    })
    let pid = 0
    try {
      expect(service.execute(action.id, 'p1', false).status).toBe('running')
      await waitUntil(() => existsSync(pidFile))
      pid = Number(readFileSync(pidFile, 'utf8'))
      expect(pid).toBeGreaterThan(0)
      expect(isPidAlive(pid)).toBe(true)
      service.delete(action.id)
      await waitUntil(() => !isPidAlive(pid))
      expect(isPidAlive(pid)).toBe(false)
    } finally {
      const retainedAlive = pid > 0 && isPidAlive(pid)
      if (retainedAlive) forceKill(pid)
      db.close()
      // A live pid must fail above. EPERM after it is dead is only the Windows cwd lock.
      if (!retainedAlive) await removeDirectoryWhenReleased(directory)
    }
  }, 20000)
})

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function forceKill(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

function isDirectoryLock(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
}

async function removeDirectoryWhenReleased(directory: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (!isDirectoryLock(error) || Date.now() - started >= 5000) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 8000) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out waiting for the shell child')
}
