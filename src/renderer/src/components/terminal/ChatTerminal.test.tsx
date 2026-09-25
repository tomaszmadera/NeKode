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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
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
        onClose={() => undefined}
        onSpawnError={() => undefined}
      />,
    )
    expect(container.style.display).toBe('none')
    // Re-render must not re-spawn or re-attach the session.
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    expect(mockTerminalInstances).toHaveLength(1)
    expect(mockTerminalInstances[0].dispose).not.toHaveBeenCalled()
  })

  // Ctrl+D shortcut (spec Behaviour 11 / AC9): the app closes the chat at an
  // empty input line outside full-screen programs — including while a
  // normal-buffer program (python REPL) runs (contract decision); otherwise
  // the key reaches the PTY as \x04 (a line edit on a non-empty line).
  function pressKey(
    terminal: (typeof mockTerminalInstances)[number],
    init: KeyboardEventInit,
  ): boolean {
    const handler = terminal.keyHandler
    expect(handler).not.toBeNull()
    return (handler as (event: KeyboardEvent) => boolean)(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    )
  }

  it('Ctrl+D at an empty input line closes the chat (same flow as terminal exit)', async () => {
    const onClose = vi.fn()
    const bundle = createAppMock()
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onClose={onClose}
        onSpawnError={() => undefined}
      />,
    )
    const terminal = mockTerminalInstances[0]
    expect(terminal.keyHandler).not.toBeNull()

    // Typing reaches the PTY as data (xterm encodes every keystroke); Enter
    // submits the line, putting the input line back to empty.
    expect(pressKey(terminal, { key: 'l' })).toBe(true)
    act(() => {
      terminal.emitInput('l')
    })
    expect(pressKey(terminal, { key: 'Enter' })).toBe(true)
    act(() => {
      terminal.emitInput('\r')
    })

    const writesBefore = vi.mocked(bundle.app.terminals.write).mock.calls.length
    const allowed = pressKey(terminal, { key: 'd', ctrlKey: true })
    // Swallowed: no EOF reaches the PTY — the chat closes instead.
    expect(allowed).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(vi.mocked(bundle.app.terminals.write).mock.calls.length).toBe(writesBefore)
  })

  it('Ctrl+D with text on the line passes through to the PTY (never closes)', async () => {
    const onClose = vi.fn()
    const bundle = createAppMock()
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onClose={onClose}
        onSpawnError={() => undefined}
      />,
    )
    const terminal = mockTerminalInstances[0]

    expect(pressKey(terminal, { key: 'l' })).toBe(true)
    act(() => {
      terminal.emitInput('l')
    })
    const allowed = pressKey(terminal, { key: 'd', ctrlKey: true })
    // Not intercepted: xterm forwards \x04 to the PTY, where on a non-empty
    // line it deletes a character — it is EOF only at an empty line, which is
    // exactly the state the gate requires.
    expect(allowed).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      terminal.emitInput('\x04')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', '\x04'))
  })

  it('Ctrl+D inside a full-screen program (alternate buffer) passes through', async () => {
    const onClose = vi.fn()
    const bundle = createAppMock()
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onClose={onClose}
        onSpawnError={() => undefined}
      />,
    )
    const terminal = mockTerminalInstances[0]
    terminal.buffer.active.type = 'alternate'

    // Even at an empty line: vim/htop use Ctrl+D for scrolling (spec AC9).
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  function renderTerminal(onClose: () => void): {
    terminal: (typeof mockTerminalInstances)[number]
    bundle: AppMockBundle
  } {
    const bundle = createAppMock()
    render(
      <ChatTerminal
        app={bundle.app}
        chatId="t1"
        cwd="D:/code/demo"
        visible
        onExit={() => undefined}
        onClose={onClose}
        onSpawnError={() => undefined}
      />,
    )
    return { terminal: mockTerminalInstances[mockTerminalInstances.length - 1], bundle }
  }

  it('Backspace at an empty line does not change the empty-line state', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Backspace at an empty line deletes nothing: the line stays empty, so
    // Ctrl+D still closes (spec AC9).
    expect(pressKey(terminal, { key: 'Backspace' })).toBe(true)
    act(() => {
      terminal.emitInput('\x7f')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pasted text (no printable keydown) makes Ctrl+D pass through — never closes', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Ctrl+V / right-click / Shift+Insert paste produces data only — no
    // printable keydown ever fires for the pasted text (bracketed paste).
    act(() => {
      terminal.emitInput('\x1b[200~git status\x1b[201~')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('history recall (ArrowUp) puts content on the line: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Arrow keys are not printable keydowns; xterm sends the escape sequence
    // and the shell recalls a history line onto the input line.
    expect(pressKey(terminal, { key: 'ArrowUp' })).toBe(true)
    act(() => {
      terminal.emitInput('\x1b[A')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('typed input erased with Backspace leaves an empty line: Ctrl+D closes', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    expect(pressKey(terminal, { key: 'a' })).toBe(true)
    act(() => {
      terminal.emitInput('a')
    })
    expect(pressKey(terminal, { key: 'Backspace' })).toBe(true)
    act(() => {
      terminal.emitInput('\x7f')
    })
    // Typed-and-erased is an empty line again: the shortcut closes the chat.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('AltGr characters (ctrlKey+altKey) fill the line: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Polish-layout AltGr+a → 'ą': both ctrlKey and altKey are true, and the
    // character reaches the PTY as data — the old keydown flag missed it.
    expect(pressKey(terminal, { key: 'ą', ctrlKey: true, altKey: true })).toBe(true)
    act(() => {
      terminal.emitInput('ą')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    // AltGr+d itself is never the Ctrl+D shortcut (altKey is held).
    expect(pressKey(terminal, { key: 'd', ctrlKey: true, altKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Ctrl+U clears the input line: Ctrl+D closes afterwards', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    act(() => {
      terminal.emitInput('abc')
    })
    act(() => {
      terminal.emitInput('\x15')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C aborts the input line: Ctrl+D closes afterwards', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    act(() => {
      terminal.emitInput('abc')
    })
    act(() => {
      terminal.emitInput('\x03')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pasted text erased with Backspace returns the line to empty: Ctrl+D closes', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    act(() => {
      terminal.emitInput('\x1b[200~ls\x1b[201~')
    })
    act(() => {
      terminal.emitInput('\x7f\x7f')
    })
    // Paste markers are not line content: two Backspaces erase the two pasted
    // characters exactly, leaving an empty line.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D is matched on the physical key (non-Latin layouts)', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Cyrillic layout: Ctrl+physical-D reports event.key 'в' — the shortcut
    // must still fire through event.code === 'KeyD'.
    expect(pressKey(terminal, { code: 'KeyD', key: 'в', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Regression: the emptiness gate is a tri-state machine, not a character
  // counter — a counter can reach zero while the line still holds text and
  // then destructively close the chat (DB row + sessions).

  it('double Ctrl+D at a non-empty line never closes (the forwarded \\x04 is not a delete)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)

    act(() => {
      terminal.emitInput('a')
    })
    // First Ctrl+D is not intercepted: xterm forwards \x04 to the PTY, where
    // on a non-empty line it deletes under the cursor — at the end of the
    // line it deletes nothing, so 'a' stays on the line.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    act(() => {
      terminal.emitInput('\x04')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', '\x04'))
    // The line still holds 'a': a second Ctrl+D must pass through, never close.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('history recall + partial erase leaves an unknown line: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // ArrowUp recalls 'git status' (10 characters) — the recalled text comes
    // back as terminal output; the input stream only sees the escape sequence,
    // which rewrites the line in ways the stream cannot account for.
    act(() => {
      terminal.emitInput('\x1b[A')
    })
    // 3 Backspaces leave 7 characters on the line — nothing may claim 0 here.
    act(() => {
      terminal.emitInput('\x7f\x7f\x7f')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('an unknown line stays blocked; only Enter / Ctrl+C reset it', async () => {
    const resets: Array<{ init: KeyboardEventInit; data: string }> = [
      { init: { key: 'Enter' }, data: '\r' },
      { init: { key: 'c', ctrlKey: true }, data: '\x03' },
    ]
    for (const reset of resets) {
      const onClose = vi.fn()
      const { terminal } = renderTerminal(onClose)

      act(() => {
        terminal.emitInput('\x1b[A')
      })
      act(() => {
        terminal.emitInput('\x7f\x7f\x7f')
      })
      // Unaccountable rewrite + deletes: emptiness is unknown, never close.
      expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
      expect(onClose).not.toHaveBeenCalled()

      // A line reset (Enter submits, Ctrl+C aborts) makes the line known
      // empty again — then the shortcut closes. Ctrl+U is deliberately not a
      // reset here: from an unknown cursor it is a backward-only line discard.
      expect(pressKey(terminal, reset.init)).toBe(true)
      act(() => {
        terminal.emitInput(reset.data)
      })
      expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('Ctrl+U after a cursor move never claims the line empty: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    act(() => {
      terminal.emitInput('abc')
    })
    // ArrowLeft moves the cursor before 'c': the escape sequence makes the
    // line unaccountable (state 'unknown').
    act(() => {
      terminal.emitInput('\x1b[D')
    })
    // Ctrl+U is unix-line-discard: it kills only backward from the cursor, so
    // 'c' survives behind it. It must NOT reset 'unknown' to 'empty'.
    act(() => {
      terminal.emitInput('\x15')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Control pair: the same keystrokes with the cursor known at the end
    // ('abc' + Backspace → counted{2}) — Ctrl+U really clears the whole line.
    const onClose2 = vi.fn()
    const { terminal: terminal2 } = renderTerminal(onClose2)
    act(() => {
      terminal2.emitInput('abc')
    })
    act(() => {
      terminal2.emitInput('\x7f')
    })
    act(() => {
      terminal2.emitInput('\x15')
    })
    expect(pressKey(terminal2, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose2).toHaveBeenCalledTimes(1)
  })

  it('bracketed-paste markers split across chunks are never line content', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Chunk boundaries fall inside both markers framing a paste of 'ls'.
    act(() => {
      terminal.emitInput('\x1b[20')
    })
    act(() => {
      terminal.emitInput('0~ls\x1b[20')
    })
    act(() => {
      terminal.emitInput('1~')
    })
    act(() => {
      terminal.emitInput('\x7f\x7f')
    })
    // The split markers counted as nothing: two Backspaces emptied 'ls' and
    // the line is known empty again.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a newline inside bracketed paste is content, not Enter (no false empty)', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Bracketed paste inserts literally: the newline is line content (or an
    // unaccountable edit), never a line submit — Ctrl+D must not close.
    act(() => {
      terminal.emitInput('\x1b[200~ls\ncat\x1b[201~')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })
})
