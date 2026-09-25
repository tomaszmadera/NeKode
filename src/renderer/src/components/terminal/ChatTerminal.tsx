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

// Bracketed-paste markers (DECSET 200) frame pasted content; the content
// between them is literal line input (newlines included), the markers are not.
// A marker can be split across `onData` chunks, so the stream is scanned with a
// tail carry: a trailing byte sequence that could still grow into a marker is
// held for the next chunk instead of being misread as content.
const PASTE_MARKER_BEGIN = '\x1b[200~'
const PASTE_MARKER_END = '\x1b[201~'

/**
 * Emptiness of the shell's current input line — a tri-state on purpose. The
 * stream cannot always account for what the shell does with a byte (`Ctrl+D`
 * deletes under a cursor of unknown position and deletes nothing at the end of
 * a non-empty line; escape sequences rewrite the whole line), and a
 * merely-wrong character counter can reach zero while the line is full —
 * exactly the state where closing the chat would destroy it. `unknown` is the
 * honest answer for anything unaccountable and blocks the close until the next
 * line reset (Enter, Ctrl+C — or Ctrl+U only when the cursor is known at the
 * end and unix-line-discard therefore empties the whole line).
 */
type InputLineState =
  /** Known empty: `Ctrl+D` may close the chat. */
  | { kind: 'empty' }
  /** Exactly `length` (> 0) characters on the line, cursor at the end. */
  | { kind: 'counted'; length: number }
  /** An unaccountable edit happened; emptiness cannot be told. Never closes. */
  | { kind: 'unknown' }

interface InputLine {
  state: InputLineState
  /** Inside bracketed paste every byte is literal content, never a keystroke. */
  inPaste: boolean
  /** Tail of the stream that may still grow into a paste marker. */
  carry: string
}

function isPrintable(char: string): boolean {
  return char !== '\x7f' && char.charCodeAt(0) >= 0x20
}

function appendChar(state: InputLineState): InputLineState {
  return state.kind === 'counted'
    ? { kind: 'counted', length: state.length + 1 }
    : state.kind === 'empty'
      ? { kind: 'counted', length: 1 }
      : state
}

function stepInputLine(state: InputLineState, char: string, inPaste: boolean): InputLineState {
  if (inPaste) {
    // Bracketed paste inserts literally: a newline or control byte is content,
    // not Enter/Ctrl+C — what it does to the line is unaccountable.
    return isPrintable(char) ? appendChar(state) : { kind: 'unknown' }
  }
  // Enter submits the line, Ctrl+C aborts it: empty again.
  if (char === '\r' || char === '\n' || char === '\x03') {
    return { kind: 'empty' }
  }
  // Ctrl+U is readline's unix-line-discard: it kills only backward from the
  // cursor. With a known cursor at the end ('counted'/'empty') that clears the
  // whole line, but from 'unknown' the cursor may sit mid-line and text can
  // survive behind it — so `unknown` stays until Enter or Ctrl+C.
  if (char === '\x15') {
    return state.kind === 'unknown' ? state : { kind: 'empty' }
  }
  // Backspace/Ctrl+H delete one character, counted only while the count is
  // exact — after an unaccountable edit the cursor may sit where a delete
  // removes nothing (or a different amount).
  if (char === '\x7f' || char === '\x08') {
    if (state.kind === 'counted') {
      return state.length > 1 ? { kind: 'counted', length: state.length - 1 } : { kind: 'empty' }
    }
    return state
  }
  if (isPrintable(char)) {
    return appendChar(state)
  }
  // Escape sequences and remaining control bytes (including `\x04`, which
  // deletes under a cursor of unknown position and nothing at the end of a
  // non-empty line) move the cursor or rewrite the line: unaccountable.
  return { kind: 'unknown' }
}

/**
 * Track the input line from the data stream sent to the PTY — never from
 * keydown flags (spec Behaviour 11 / AC9 gates `Ctrl+D` on an empty input
 * line). Paste (Ctrl+V / context menu / Shift+Insert), history recall
 * (arrows), Tab completion and AltGr characters all edit the line without
 * printable keydowns, so only the stream reflects the real line.
 */
function trackInputLine(input: InputLine, data: string): InputLine {
  const combined = input.carry + data
  let { state, inPaste } = input
  let index = 0
  while (index < combined.length) {
    if (combined.startsWith(PASTE_MARKER_BEGIN, index)) {
      inPaste = true
      index += PASTE_MARKER_BEGIN.length
      continue
    }
    if (combined.startsWith(PASTE_MARKER_END, index)) {
      inPaste = false
      index += PASTE_MARKER_END.length
      continue
    }
    const tail = combined.slice(index)
    if (
      tail.length < PASTE_MARKER_BEGIN.length &&
      (PASTE_MARKER_BEGIN.startsWith(tail) || PASTE_MARKER_END.startsWith(tail))
    ) {
      return { state, inPaste, carry: tail }
    }
    state = stepInputLine(state, combined.charAt(index), inPaste)
    index += 1
  }
  return { state, inPaste, carry: '' }
}

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
    // Input-line state for the Ctrl+D gate: tracked from the input stream
    // actually sent to the PTY (the keydown stream cannot see pasted text,
    // history recall, completion or AltGr characters).
    let inputLine: InputLine = { state: { kind: 'empty' }, inPaste: false, carry: '' }
    const inputSubscription = terminal.onData((data) => {
      inputLine = trackInputLine(inputLine, data)
      void appRef.current.terminals.write(chatId, data).catch(() => undefined)
    })

    // `Ctrl+D` shortcut (spec Behaviour 11 / AC9): the shell (e.g. PowerShell
    // with PSReadLine) does not end on Ctrl+D, so the app closes the chat —
    // but only when the input line is known empty (tracked from the data
    // stream, above) and no full-screen program owns the terminal (alternate
    // buffer, e.g. vim/htop — there Ctrl+D scrolls). At an empty line the chat
    // closes even while a normal-buffer program (e.g. a python REPL) runs:
    // leaving such a program is `exit()`/Ctrl+Z+Enter, not this shortcut
    // (contract decision). Otherwise the key is left to xterm and reaches the
    // PTY as `\x04`, where on a non-empty line it deletes a character.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') {
        return true
      }
      // Matched on the physical key (event.code) so the shortcut also works on
      // non-Latin layouts where Ctrl+D reports a different event.key. AltGr
      // characters (ctrlKey and altKey both true) are never the shortcut.
      const isCtrlD =
        (event.code === 'KeyD' || event.key === 'd' || event.key === 'D') &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      if (
        isCtrlD &&
        inputLine.state.kind === 'empty' &&
        terminal.buffer.active.type !== 'alternate'
      ) {
        onCloseRef.current()
        return false
      }
      return true
    })

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
