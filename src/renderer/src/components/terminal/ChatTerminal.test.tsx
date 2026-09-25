import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../../shared/ipc-contract'
import { mockFitAddonInstances, resetMockFitAddons } from '../../test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from '../../test/xterm-mock'
import { ChatTerminal } from './ChatTerminal'

// xterm.js is mocked at the module boundary (no real canvas in jsdom); these
// tests assert NeKode's wiring: mount → attach → lazy spawn, data/write/exit
// routing, fit on open and resize, and dispose-on-detach.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))

interface AppMockBundle {
  app: AppApi
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
  dataUnsubscribes: Array<() => void>
  exitUnsubscribes: Array<() => void>
}

function createAppMock(options: { createError?: unknown } = {}): AppMockBundle {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(exitCode: number) => void>()
  const dataUnsubscribes: Array<() => void> = []
  const exitUnsubscribes: Array<() => void> = []

  const app: AppApi = {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 't1', projectId: 'p1', name: 'n' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: options.createError
        ? vi.fn().mockRejectedValue(options.createError)
        : vi.fn().mockResolvedValue('t1'),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((_chatId: string, cb: (data: string) => void) => {
        dataListeners.add(cb)
        const unsubscribe = () => {
          dataListeners.delete(cb)
          dataUnsubscribes.push(unsubscribe)
        }
        return unsubscribe
      }),
      onExit: vi.fn((_chatId: string, cb: (exitCode: number) => void) => {
        exitListeners.add(cb)
        const unsubscribe = () => {
          exitListeners.delete(cb)
          exitUnsubscribes.push(unsubscribe)
        }
        return unsubscribe
      }),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({ branch: null, dirty: false }),
    },
  }

  return {
    app,
    emitData: (data) => {
      for (const listener of [...dataListeners]) {
        listener(data)
      }
    },
    emitExit: (exitCode) => {
      for (const listener of [...exitListeners]) {
        listener(exitCode)
      }
    },
    dataUnsubscribes,
    exitUnsubscribes,
  }
}

describe('ChatTerminal lifecycle', () => {
  beforeEach(() => {
    resetMockTerminals()
    resetMockFitAddons()
    // jsdom performs no layout (clientWidth/clientHeight stay 0); stub real
    // container dimensions so the zero-size fit guard behaves like a laid-out
    // view instead of skipping fit/resize everywhere.
    for (const property of ['clientWidth', 'clientHeight'] as const) {
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get: () => 640,
      })
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('mounts xterm, attaches it and lazily spawns the session with the project cwd', async () => {
    const { app } = createAppMock()
    render(
      <ChatTerminal
        app={app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )

    expect(mockTerminalInstances).toHaveLength(1)
    const terminal = mockTerminalInstances[0]
    expect(terminal.open).toHaveBeenCalledTimes(1)
    expect(terminal.openedElement).not.toBeNull()
    expect(terminal.loadedAddons).toHaveLength(1)

    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    await waitFor(() => expect(app.terminals.resize).toHaveBeenCalledWith('t1', 80, 24))
  })

  it('writes session data into xterm and sends user input to the PTY', async () => {
    const bundle = createAppMock()
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    const terminal = mockTerminalInstances[0]

    act(() => {
      bundle.emitData('PS D:\\code\\demo> ')
    })
    expect(terminal.written).toEqual(['PS D:\\code\\demo> '])

    act(() => {
      terminal.emitInput('dir\r')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', 'dir\r'))
  })

  it('reports PTY exit and spawn errors to the host callbacks', async () => {
    const onExit = vi.fn()
    const onSpawnError = vi.fn()
    const bundle = createAppMock({
      createError: {
        nekodeAppError: true,
        code: 'not_found',
        message: 'The project directory does not exist.',
      },
    })
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/gone"
        visible
        onExit={onExit}
        onSpawnError={onSpawnError}
      />,
    )
    await waitFor(() =>
      expect(onSpawnError).toHaveBeenCalledWith('The project directory does not exist.'),
    )
    expect(onExit).not.toHaveBeenCalled()

    const exited = createAppMock()
    render(
      <ChatTerminal
        app={exited.app}
        chatId="t2"
        cwd="D:/code/demo"
        visible
        onExit={onExit}
        onSpawnError={onSpawnError}
      />,
    )
    act(() => {
      exited.emitExit(3)
    })
    expect(onExit).toHaveBeenCalledWith(3)
  })

  it('fits on open and on window resize (ResizeObserver-free environments)', async () => {
    const { app } = createAppMock()
    render(
      <ChatTerminal
        app={app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    await waitFor(() => expect(mockFitAddonInstances[0].fit).toHaveBeenCalled())
    const fitCalls = mockFitAddonInstances[0].fit.mock.calls.length

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(mockFitAddonInstances[0].fit.mock.calls.length).toBeGreaterThan(fitCalls)
  })

  it('detaches on unmount: unsubscribes, disposes xterm, never kills the session here', async () => {
    const bundle = createAppMock()
    const { unmount } = render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const terminal = mockTerminalInstances[0]

    unmount()
    expect(terminal.dispose).toHaveBeenCalledTimes(1)
    // The view detaches its listeners; the PTY itself is main-owned and stays
    // alive for session preservation (killed only by terminateAll on quit).
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1)

    act(() => {
      bundle.emitData('after unmount')
    })
    expect(terminal.written).toEqual([])
  })

  it('hides the view without touching the session (display driven by visibility)', async () => {
    const { app } = createAppMock()
    const { rerender } = render(
      <ChatTerminal
        app={app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    const container = mockTerminalInstances[0].openedElement as HTMLElement
    expect(container.style.display).toBe('block')

    rerender(
      <ChatTerminal
        app={app}
        chatId="t1"
        cwd="D:/code/demo"
        visible={false}
        onExit={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    expect(container.style.display).toBe('none')
    // Re-render must not re-spawn or re-attach the session.
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    expect(mockTerminalInstances).toHaveLength(1)
    expect(mockTerminalInstances[0].dispose).not.toHaveBeenCalled()
  })
})
