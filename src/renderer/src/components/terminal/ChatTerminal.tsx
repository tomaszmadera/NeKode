import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type React from 'react'
import { useEffect, useRef } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'

// One xterm.js view per chat session (UX-UI §17). The view owns the xterm
// instance and the bridge subscriptions; the PTY itself lives in the main
// process (node-pty) and is spawned lazily on this component's first attach.
// Hidden (deselected) instances stay mounted so scrollback and the live PTY
// survive chat switches (spec Behaviour 6).

interface ChatTerminalProps {
  app: AppApi
  chatId: string
  /** Project directory; becomes the PTY cwd on first attach. */
  cwd: string
  /** Whether this view is the selected chat's visible terminal. */
  visible: boolean
  /** PTY exit: the host closes the chat (spec Behaviour 11). */
  onExit: (exitCode: number) => void
  /**
   * `Ctrl+D` at an empty input line outside full-screen programs: the
   * shortcut is intercepted and the chat closes through the same flow as a
   * terminal exit (spec Behaviour 11 / AC9). Contract decision: at an empty
   * line the chat closes even while a normal-buffer program (e.g. a python
   * REPL) runs — leaving such a program is `exit()`/Ctrl+Z+Enter, not this
   * shortcut.
   */
  onClose: () => void
  /** Spawn failure (e.g. project directory missing): typed error state. */
  onSpawnError: (message: string) => void
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

/**
 * Emptiness of the shell's input line is judged VISUALLY, from the xterm
 * buffer — never by accounting of the byte stream sent to the PTY. The line
 * is empty exactly when the visible text before the cursor on the cursor row
 * is identical to the prompt base (the row prefix collected while the line
 * was clean) and nothing but blank space follows the cursor.
 *
 * Why visual: stream accounting is sticky — one unaccountable byte (`\x04`,
 * any escape sequence) wedged the old tri-state tracker at `unknown` until
 * Enter/Ctrl+C, so a line the user had visibly erased still refused to close
 * the chat (user retest 2026-09-25). Comparison against the rendered buffer
 * self-heals: whatever the stream did before, a row that visibly reads as
 * the prompt base closes again. Paste, history recall, Tab completion and
 * AltGr all edit the line without printable keydowns — the buffer is the
 * only source that reflects the real line. Asynchronous output may shift the
 * comparison in the safe direction (the gate stays shut); acceptable.
 *
 * The prompt base is collected on every xterm write parse while the line is
 * clean (initially, and after a line reset: Enter or Ctrl+C, detected from
 * keydown — a pasted newline is content, never a reset). The first input byte
 * after a reset freezes the base: from then on the shell echoes typed/pasted
 * text onto the same row and the base must stay the prompt, not absorb the
 * input; the next reset thaws it (so e.g. a prompt changed by `cd` is
 * re-collected). The cursor row alone is compared, so multi-line prompts
 * (oh-my-posh) work: their last line is the row the cursor sits on.
 */
export function ChatTerminal({
  app,
  chatId,
  cwd,
  visible,
  onExit,
  onClose,
  onSpawnError,
}: ChatTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Latest callbacks without re-creating the terminal session on re-render.
  const appRef = useRef(app)
  const onExitRef = useRef(onExit)
  const onCloseRef = useRef(onClose)
  const onSpawnErrorRef = useRef(onSpawnError)
  appRef.current = app
  onExitRef.current = onExit
  onCloseRef.current = onClose
  onSpawnErrorRef.current = onSpawnError

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#3f3f46',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    function fitAndResize(): void {
      // Zero-sized (hidden or not yet laid out) containers must not fit; the
      // next resize/visibility change retries with real dimensions.
      if (container === null || container.clientWidth === 0 || container.clientHeight === 0) {
        return
      }
      try {
        fitAddon.fit()
      } catch {
        // A detached container can still fail to fit; the next resize can.
        return
      }
      void appRef.current.terminals.resize(chatId, terminal.cols, terminal.rows).catch(() => {
        // Resizes racing a session exit are expected; nothing to recover.
      })
    }

    const unsubscribeData = appRef.current.terminals.onData(chatId, (data) => {
      terminal.write(data)
    })
    const unsubscribeExit = appRef.current.terminals.onExit(chatId, (exitCode) => {
      onExitRef.current(exitCode)
    })

    // --- Ctrl+D emptiness gate (spec Behaviour 11 / AC9) --------------------
    // The cursor row as the user sees it: `before` is the visible text in
    // columns [0, cursorX) — prompt plus typed input — and `after` is what
    // survives behind the cursor.
    function visibleLine(): { before: string; after: string } | null {
      const buffer = terminal.buffer.active
      const line = buffer.getLine(buffer.baseY + buffer.cursorY)
      if (line === undefined) {
        return null
      }
      return {
        before: line.translateToString(false, 0, buffer.cursorX),
        after: line.translateToString(true, buffer.cursorX),
      }
    }

    // The prompt base: the cursor-row prefix captured while the line is
    // clean. `null` until the first write after mount/reset — the gate then
    // falls back to the input-freeze state (nothing drawn, nothing typed).
    let promptBase: string | null = null
    // Frozen once user input arrives after a reset: the shell echoes it onto
    // the row and the base must not absorb it.
    let baseFrozen = false
    // A line-reset key was just pressed; the byte xterm sends for it (Enter →
    // '\r', Ctrl+C → '\x03') must not re-freeze the base that reset thawed.
    let resetBytePending = false

    const collectPromptBase = (): void => {
      if (baseFrozen) {
        return
      }
      promptBase = visibleLine()?.before ?? ''
    }
    const writeParsedSubscription = terminal.onWriteParsed(collectPromptBase)

    // Input bytes reach the PTY from here (and only from here): every one of
    // them freezes the base until the next line reset.
    const inputSubscription = terminal.onData((data) => {
      const isResetByte = data === '\r' || data === '\n' || data === '\x03'
      if (!(resetBytePending && isResetByte)) {
        baseFrozen = true
      }
      resetBytePending = false
      void appRef.current.terminals.write(chatId, data).catch(() => undefined)
    })

    // The shell (e.g. PowerShell with PSReadLine) does not end on Ctrl+D, so
    // the app closes the chat — but only when the input line is visibly
    // empty (compared against the prompt base, above) and no full-screen
    // program owns the terminal (alternate buffer, e.g. vim/htop — there
    // Ctrl+D scrolls). At an empty line the chat closes even while a
    // normal-buffer program (e.g. a python REPL) runs: leaving such a program
    // is `exit()`/Ctrl+Z+Enter, not this shortcut (contract decision).
    // Otherwise the key is left to xterm and reaches the PTY as `\x04`, where
    // on a non-empty line it deletes a character.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') {
        return true
      }
      // AltGr characters (ctrlKey and altKey both true) are never a shortcut.
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      // Line resets (keydown only — a pasted newline is content, never an
      // Enter): Enter submits, Ctrl+C aborts. The base may move again and is
      // re-collected from the next drawn prompt.
      const isEnter = event.key === 'Enter'
      const isCtrlC = (event.code === 'KeyC' || event.key === 'c' || event.key === 'C') && ctrlOnly
      if (isEnter || isCtrlC) {
        baseFrozen = false
        resetBytePending = true
        return true
      }
      // Matched on the physical key (event.code) so the shortcut also works on
      // non-Latin layouts where Ctrl+D reports a different event.key.
      const isCtrlD = (event.code === 'KeyD' || event.key === 'd' || event.key === 'D') && ctrlOnly
      if (isCtrlD && terminal.buffer.active.type !== 'alternate' && isInputLineEmpty()) {
        onCloseRef.current()
        return false
      }
      return true
    })

    function isInputLineEmpty(): boolean {
      if (promptBase === null) {
        // Nothing has been drawn since mount/reset: no write means no text on
        // the row either (only writes render), so with no input since the
        // reset the line is empty; input without a drawn base stays shut.
        return !baseFrozen
      }
      const line = visibleLine()
      if (line === null) {
        return false
      }
      // The visible text before the cursor must read exactly as the prompt
      // base …
      if (line.before !== promptBase) {
        return false
      }
      // … and nothing may survive behind the cursor (Ctrl+U mid-line leaves
      // the rest of the input there — that line is not empty).
      return line.after === ''
    }

    // Lazy spawn: the main process creates the PTY on this first attach.
    void appRef.current.terminals
      .create(chatId, cwd)
      .then(() => {
        fitAndResize()
      })
      .catch((error: unknown) => {
        onSpawnErrorRef.current(errorMessage(error, 'Failed to start the terminal for this chat.'))
      })

    // Fit on workspace open and on container resize. ResizeObserver is the
    // precise signal where available (jsdom tests fall back to window resize).
    let cleanupResize: () => void = () => undefined
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        fitAndResize()
      })
      observer.observe(container)
      cleanupResize = () => {
        observer.disconnect()
      }
    } else {
      const onWindowResize = (): void => {
        fitAndResize()
      }
      window.addEventListener('resize', onWindowResize)
      cleanupResize = () => {
        window.removeEventListener('resize', onWindowResize)
      }
    }
    fitAndResize()

    return () => {
      cleanupResize()
      unsubscribeData()
      unsubscribeExit()
      writeParsedSubscription.dispose()
      inputSubscription.dispose()
      terminal.dispose()
    }
    // Session identity is fixed per mount; the host remounts (new generation)
    // when a dead session must be replaced.
  }, [chatId, cwd])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-neutral-950"
      data-testid={`terminal-canvas-${chatId}`}
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
