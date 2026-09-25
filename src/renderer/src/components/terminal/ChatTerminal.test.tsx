import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../../shared/ipc-contract'
import { mockFitAddonInstances, resetMockFitAddons } from '../../test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from '../../test/xterm-mock'
import { ChatTerminal } from './ChatTerminal'

// xterm.js is mocked at the module boundary (no real canvas in jsdom); these
// tests assert NeKode's own wiring: mount → attach → lazy spawn, data/write/exit
// routing, fit on open and resize, and dispose-on-detach — plus the Ctrl+D
// gate, which judges emptiness VISUALLY from the mocked xterm buffer (the
// tests narrate what the shell echo draws).

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

  // Ctrl+D shortcut (spec Behaviour 11 / AC9): the app closes the chat when
  // the input line is visibly empty outside full-screen programs — including
  // while a normal-buffer program (python REPL) runs (contract decision);
  // otherwise the key reaches the PTY as \\x04 (a line edit on a non-empty
  // line). Emptiness is read from the xterm buffer: the row prefix before the
  // cursor must equal the stored prompt base, so any visible return to the
  // prompt closes again — whatever the input stream did before.
  const PROMPT = 'PS D:\\code\\demo> '

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

  // The shell draws the prompt; the echo arrives as terminal output — that
  // write is where the component collects the prompt base.
  function showPrompt(
    terminal: (typeof mockTerminalInstances)[number],
    bundle: AppMockBundle,
    prompt: string = PROMPT,
  ): void {
    act(() => {
      terminal.echo(prompt)
      bundle.emitData(prompt)
    })
  }

  // The user types: keystrokes reach the PTY and the shell echo draws them.
  function typeText(terminal: (typeof mockTerminalInstances)[number], text: string): void {
    act(() => {
      terminal.emitInput(text)
      terminal.echo(text)
    })
  }

  // Backspace: the key reaches the PTY and the echo erases the characters.
  function backspace(terminal: (typeof mockTerminalInstances)[number], count = 1): void {
    act(() => {
      terminal.emitInput('\x7f'.repeat(count))
      terminal.eraseBefore(count)
    })
  }

  it('Ctrl+D with nothing drawn yet closes; typed input without a drawn base stays shut', async () => {
    const onClose = vi.fn()
    const { terminal } = renderTerminal(onClose)

    // Fresh terminal, no output yet: no write has rendered anything, so
    // nothing but a prompt could be on the line — the shortcut closes.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)

    // But input with no drawn base to compare against is unverifiable: the
    // gate stays shut.
    const onClose2 = vi.fn()
    const { terminal: terminal2 } = renderTerminal(onClose2)
    typeText(terminal2, 'abc')
    expect(pressKey(terminal2, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose2).not.toHaveBeenCalled()
  })

  it('Ctrl+D at a visibly empty input line closes the chat (same flow as terminal exit)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    const writesBefore = vi.mocked(bundle.app.terminals.write).mock.calls.length
    const allowed = pressKey(terminal, { key: 'd', ctrlKey: true })
    // Swallowed: no EOF reaches the PTY — the chat closes instead.
    expect(allowed).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(vi.mocked(bundle.app.terminals.write).mock.calls.length).toBe(writesBefore)
  })

  it("typed 'abc' erased with Backspace x3 is visibly the prompt again: Ctrl+D closes", async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    backspace(terminal, 3)
    // The row visibly reads as the prompt base again — the line is empty.
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)

    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Regression (user retest 2026-09-25): an earlier Ctrl+D with text on the
  // line forwards \\x04 to the PTY (a line edit, not a reset). The old stream
  // tracker wedged at 'unknown' on that byte and never recovered, so a later
  // visibly erased line still refused to close. Visual comparison self-heals:
  // whatever happened before, a row that reads as the prompt base closes.
  it('earlier Ctrl+D passthrough never wedges the gate: a visibly erased line closes', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    // Text on the line: not intercepted, \\x04 reaches the PTY.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    act(() => {
      terminal.emitInput('\x04')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', '\x04'))
    // \\x04 deletes nothing at the end of a non-empty line: 'abc' is still
    // there and the user erases it.
    backspace(terminal, 3)

    typeText(terminal, 'abc')
    backspace(terminal, 3)
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)

    // The line is visibly empty: the shortcut closes, despite the earlier
    // \\x04 in the stream.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D with text on the line passes through to the PTY (never closes)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    const allowed = pressKey(terminal, { key: 'd', ctrlKey: true })
    // Not intercepted: xterm forwards \\x04 to the PTY, where on a non-empty
    // line it deletes a character — it is EOF only at an empty line, which is
    // exactly the state the gate requires.
    expect(allowed).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      terminal.emitInput('\x04')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', '\x04'))
  })

  it('history recall fills the line: Ctrl+D passes through until the recall is visibly erased', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    // ArrowUp recalls 'git status'; the recalled text is drawn by the shell.
    expect(pressKey(terminal, { key: 'ArrowUp' })).toBe(true)
    act(() => {
      terminal.emitInput('\x1b[A')
      terminal.echo('git status')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Partial erase still leaves text on the line — never close.
    backspace(terminal, 3)
    expect(terminal.buffer.active.rows[0]).toBe(`${PROMPT}git sta`)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Erased back to the prompt base: the line is visibly empty again.
    backspace(terminal, 7)
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+U that clears the whole line leaves the prompt: Ctrl+D closes', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    // The shell's unix-line-discard clears the whole line and redraws the
    // prompt — the row reads as the base again.
    act(() => {
      terminal.emitInput('\x15')
      terminal.eraseBefore(3)
    })
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)

    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+U leaving text behind the cursor is not empty: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    // ArrowLeft: the cursor sits between 'b' and 'c' ('ab|c').
    expect(pressKey(terminal, { key: 'ArrowLeft' })).toBe(true)
    act(() => {
      terminal.emitInput('\x1b[D')
      terminal.buffer.active.cursorX -= 1
    })
    // unix-line-discard kills only backward from the cursor (down to the
    // prompt): 'c' survives behind it and the row no longer reads as the
    // prompt base.
    act(() => {
      terminal.emitInput('\x15')
      terminal.eraseBefore(2)
    })
    expect(terminal.buffer.active.rows[0]).toBe(`${PROMPT}c`)
    expect(terminal.buffer.active.cursorX).toBe(PROMPT.length)

    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Control: step over the survivor, erase it — the gate closes again.
    expect(pressKey(terminal, { key: 'ArrowRight' })).toBe(true)
    act(() => {
      terminal.emitInput('\x1b[C')
      terminal.buffer.active.cursorX += 1
    })
    backspace(terminal, 1)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pasted text fills the line: Ctrl+D passes through until it is visibly erased', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    // Ctrl+V / right-click / Shift+Insert paste produces data only — no
    // printable keydown ever fires for the pasted text (bracketed paste).
    act(() => {
      terminal.emitInput('\x1b[200~git status\x1b[201~')
      terminal.echo('git status')
    })
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Erased back to the prompt base: the line is visibly empty again.
    backspace(terminal, 10)
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D inside a full-screen program (alternate buffer) never closes', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)
    terminal.buffer.active.type = 'alternate'

    // Even at an empty line: vim/htop use Ctrl+D for scrolling (spec AC9).
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    typeText(terminal, 'abc')
    backspace(terminal, 3)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Ctrl+D is matched on the physical key (non-Latin layouts)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    // Cyrillic layout: Ctrl+physical-D reports event.key 'в' — the shortcut
    // must still fire through event.code === 'KeyD'.
    expect(pressKey(terminal, { code: 'KeyD', key: 'в', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Backspace at an empty line deletes nothing: Ctrl+D still closes', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    // Backspace at an empty line deletes nothing: the row stays at the base.
    expect(pressKey(terminal, { key: 'Backspace' })).toBe(true)
    act(() => {
      terminal.emitInput('\x7f')
    })
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('AltGr characters (ctrlKey+altKey) fill the line: Ctrl+D passes through', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    // Polish-layout AltGr+a → 'ą': both ctrlKey and altKey are true, and the
    // character reaches the PTY as data — a keydown-flag gate missed it.
    expect(pressKey(terminal, { key: 'ą', ctrlKey: true, altKey: true })).toBe(true)
    typeText(terminal, 'ą')
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    // AltGr+d itself is never the Ctrl+D shortcut (altKey is held).
    expect(pressKey(terminal, { key: 'd', ctrlKey: true, altKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('double Ctrl+D at a non-empty line never closes (the forwarded \\x04 is not a delete-at-end)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'a')
    // First Ctrl+D is not intercepted: xterm forwards \\x04 to the PTY, where
    // at the end of a non-empty line it deletes nothing — 'a' stays.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    act(() => {
      terminal.emitInput('\x04')
    })
    await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', '\x04'))
    expect(terminal.buffer.active.rows[0]).toBe(`${PROMPT}a`)
    // The line still holds 'a': a second Ctrl+D must pass through, never close.
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    // Control: visibly erasing 'a' opens the gate again.
    backspace(terminal, 1)
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Enter resets the gate and the next prompt becomes the new base (prompt change)', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'cd ..')
    expect(pressKey(terminal, { key: 'Enter' })).toBe(true)
    act(() => {
      terminal.emitInput('\r')
    })
    // The command output ends with a NEW prompt on a fresh row (cd changed
    // the prompt); the reset thaws the base, so this prompt is collected.
    act(() => {
      const buffer = terminal.buffer.active
      buffer.cursorY = 1
      buffer.cursorX = 0
      terminal.echo('PS D:\\other> ')
      bundle.emitData('\r\nPS D:\\other> ')
    })

    typeText(terminal, 'abc')
    backspace(terminal, 3)
    expect(terminal.buffer.active.rows[1]).toBe('PS D:\\other> ')
    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C aborts the line and the redrawn prompt becomes the new base', async () => {
    const onClose = vi.fn()
    const { terminal, bundle } = renderTerminal(onClose)
    showPrompt(terminal, bundle)

    typeText(terminal, 'abc')
    expect(pressKey(terminal, { key: 'c', ctrlKey: true })).toBe(true)
    // The shell aborts the line and redraws its prompt.
    act(() => {
      terminal.emitInput('\x03')
      terminal.setCursorRow(PROMPT)
      bundle.emitData(`^C\r\n${PROMPT}`)
    })
    expect(terminal.buffer.active.rows[0]).toBe(PROMPT)

    expect(pressKey(terminal, { key: 'd', ctrlKey: true })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
