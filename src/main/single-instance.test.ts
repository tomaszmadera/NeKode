import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type MainWindowFocusTarget,
  type PrimaryInstanceDeps,
  runPrimaryInstance,
} from './single-instance'

const scratch: string[] = []

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'nekode-single-instance-'))
  scratch.push(path)
  return path
}

function windowStub(state: { minimized: boolean; visible: boolean; destroyed?: boolean }): {
  calls: string[]
  window: MainWindowFocusTarget
} {
  const calls: string[] = []
  return {
    calls,
    window: {
      isDestroyed: () => state.destroyed === true,
      isMinimized: () => state.minimized,
      isVisible: () => state.visible,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    },
  }
}

function launch(
  rawUserData: string | undefined,
  windows: readonly MainWindowFocusTarget[],
  lockGranted: boolean,
): {
  listener?: () => void
  setPath: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  openDatabase: ReturnType<typeof vi.fn>
  createServices: ReturnType<typeof vi.fn>
  createWindow: ReturnType<typeof vi.fn>
  requestSingleInstanceLock: ReturnType<typeof vi.fn>
} {
  let listener: (() => void) | undefined
  const setPath = vi.fn()
  const quit = vi.fn()
  const openDatabase = vi.fn()
  const createServices = vi.fn()
  const createWindow = vi.fn()
  const start = vi.fn(() => {
    openDatabase()
    createServices()
    createWindow()
  })
  const requestSingleInstanceLock = vi.fn(() => lockGranted)
  const deps: PrimaryInstanceDeps = {
    rawUserData,
    setPath,
    requestSingleInstanceLock,
    quit,
    onSecondInstance: (callback) => {
      listener = callback
    },
    getMainWindows: () => windows,
    start,
  }
  runPrimaryInstance(deps)
  return {
    listener,
    setPath,
    quit,
    start,
    openDatabase,
    createServices,
    createWindow,
    requestSingleInstanceLock,
  }
}

describe('single-instance startup', () => {
  it('creates the selected userData directory before one Electron lock and startup', () => {
    const target = join(tempDir(), 'nested', 'profile-a')
    const events: string[] = []
    runPrimaryInstance({
      rawUserData: `  "${target}"  `,
      setPath: (name, path) => {
        expect(existsSync(path)).toBe(true)
        events.push(`${name}:${path}`)
      },
      requestSingleInstanceLock: () => {
        events.push('lock')
        return true
      },
      quit: () => events.push('quit'),
      onSecondInstance: () => events.push('listen'),
      getMainWindows: () => [],
      start: () => events.push('start'),
    })

    expect(events).toEqual([`userData:${resolve(target)}`, 'lock', 'listen', 'start'])
  })

  it('keeps a separate lock scope for each isolated userData profile', () => {
    const first = join(tempDir(), 'profile-a')
    const second = join(tempDir(), 'profile-b')
    const events: string[] = []
    for (const rawUserData of [first, second]) {
      runPrimaryInstance({
        rawUserData,
        setPath: (_name, path) => events.push(`path:${path}`),
        requestSingleInstanceLock: () => {
          events.push('lock')
          return true
        },
        quit: vi.fn(),
        onSecondInstance: vi.fn(),
        getMainWindows: () => [],
        start: () => events.push('start'),
      })
    }

    expect(events).toEqual([
      `path:${resolve(first)}`,
      'lock',
      'start',
      `path:${resolve(second)}`,
      'lock',
      'start',
    ])
    expect(resolve(first)).not.toBe(resolve(second))
  })

  it('does not select a fallback profile when the override is empty', () => {
    const launched = launch('   ', [], true)

    expect(launched.setPath).not.toHaveBeenCalled()
    expect(launched.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(launched.requestSingleInstanceLock).toHaveBeenCalledWith()
    expect(launched.start).toHaveBeenCalledOnce()
    expect(launched.quit).not.toHaveBeenCalled()
  })

  it('propagates directory creation failure without a profile, lock, or startup', () => {
    const parent = tempDir()
    const blockingFile = join(parent, 'not-a-directory')
    writeFileSync(blockingFile, 'x')
    const setPath = vi.fn()
    const requestSingleInstanceLock = vi.fn(() => true)
    const quit = vi.fn()
    const start = vi.fn()

    expect(() =>
      runPrimaryInstance({
        rawUserData: join(blockingFile, 'profile'),
        setPath,
        requestSingleInstanceLock,
        quit,
        onSecondInstance: vi.fn(),
        getMainWindows: () => [],
        start,
      }),
    ).toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(setPath).not.toHaveBeenCalled()
    expect(requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('selects the override before a denied lock and still does not start', () => {
    const target = join(tempDir(), 'profile')
    const events: string[] = []
    runPrimaryInstance({
      rawUserData: target,
      setPath: (_name, path) => {
        expect(existsSync(path)).toBe(true)
        events.push(`path:${path}`)
      },
      requestSingleInstanceLock: () => {
        events.push('lock')
        return false
      },
      quit: () => events.push('quit'),
      onSecondInstance: () => events.push('listen'),
      getMainWindows: () => [],
      start: () => events.push('start'),
    })

    expect(events).toEqual([`path:${resolve(target)}`, 'lock', 'quit'])
  })

  it('quits without opening the database, creating services, or creating a window when the lock is denied', () => {
    const launched = launch(undefined, [], false)

    expect(launched.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(launched.requestSingleInstanceLock).toHaveBeenCalledWith()
    expect(launched.quit).toHaveBeenCalledOnce()
    expect(launched.openDatabase).not.toHaveBeenCalled()
    expect(launched.createServices).not.toHaveBeenCalled()
    expect(launched.createWindow).not.toHaveBeenCalled()
    expect(launched.start).not.toHaveBeenCalled()
    expect(launched.listener).toBeUndefined()
  })

  it('restores a minimized window, shows a hidden window, and focuses it', () => {
    const minimizedHidden = windowStub({ minimized: true, visible: false })
    const destroyed = windowStub({ minimized: true, visible: false, destroyed: true })
    const launched = launch(undefined, [destroyed.window, minimizedHidden.window], true)

    expect(launched.listener).toEqual(expect.any(Function))
    launched.listener?.()

    expect(minimizedHidden.calls).toEqual(['restore', 'show', 'focus'])
    expect(destroyed.calls).toEqual([])
    expect(launched.createWindow).toHaveBeenCalledOnce()
  })

  it('restores a minimized visible window without showing it', () => {
    const minimized = windowStub({ minimized: true, visible: true })
    const launched = launch(undefined, [minimized.window], true)

    launched.listener?.()

    expect(minimized.calls).toEqual(['restore', 'focus'])
  })

  it('focuses a visible window without restoring or showing it', () => {
    const visible = windowStub({ minimized: false, visible: true })
    const launched = launch(undefined, [visible.window], true)

    launched.listener?.()

    expect(visible.calls).toEqual(['focus'])
  })

  it('shows a hidden window that is not minimized', () => {
    const hidden = windowStub({ minimized: false, visible: false })
    const launched = launch(undefined, [hidden.window], true)

    launched.listener?.()

    expect(hidden.calls).toEqual(['show', 'focus'])
  })

  it('does not create a window when second-instance arrives before the main window exists', () => {
    const windows: MainWindowFocusTarget[] = []
    const launched = launch(undefined, windows, true)

    expect(launched.listener).toEqual(expect.any(Function))
    expect(launched.start).toHaveBeenCalledOnce()
    expect(launched.createWindow).toHaveBeenCalledOnce()
    launched.listener?.()

    expect(windows).toEqual([])
    expect(launched.start).toHaveBeenCalledOnce()
    expect(launched.createWindow).toHaveBeenCalledOnce()
  })
})
