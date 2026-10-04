import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { isNewChatChord } from '../../lib/new-chat-chord'
import { writeSubmitLine } from '../../lib/pty-submit'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFonts,
  type TerminalFontFamilies,
  terminalFontStack,
} from '../../lib/terminal-font'
import { themeColor } from '../lib/theme-color'
import { isBottomPanelChord } from './bottom-panel-chord'
import { chatSwitchDirection } from './chat-switch-chord'
import { type PromptInjection, PromptInput } from './PromptInput'
import { TerminalContextMenu } from './TerminalContextMenu'

interface Clipboard {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
}

/** Renderer clipboard (typed locally so tests can stub navigator.clipboard). */
function navigatorClipboard(): Clipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard !== null
    ? navigator.clipboard
    : null
}

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
  /** Whether this view is the selected terminal (chat or bottom tab). */
  visible: boolean
  /** Focus the xterm textarea. Bottom-panel open uses this; chats do not. */
  focused?: boolean
  /** PTY exit: the host closes the chat (spec Behaviour 11). */
  onExit: (exitCode: number) => void
  /**
   * Draft fill addressed to THIS chat's prompt input (Handoff/Resume paste,
   * spec handoff-resume-flow Behaviour 3). The host addresses injections per
   * chat, so hidden terminals never receive another chat's fill.
   */
  injected?: PromptInjection | null
  /** Reports consumption so the host can drop the pending injection. */
  onInjected?: () => void
  /**
   * Terminal font size (App Settings). Applied at mount and, through the
   * option-freeze effect below, live to already-open sessions — xterm reflows
   * the buffer and this view refits and reports the new grid to the PTY.
   * Session identity and the PTY are untouched.
   */
  terminalFontSize?: number
  terminalFontFamilies?: TerminalFontFamilies
  /** Ctrl+V pastes text in full-screen programs; defaults on and applies live. */
  terminalCtrlVPaste?: boolean
  /**
   * `Ctrl+D` at an empty input line outside full-screen programs: the
   * shortcut is intercepted and the chat closes through the same flow as a
   * terminal exit (spec Behaviour 11 / AC9). Contract decision: at an empty
   * line the chat closes even while a normal-buffer program (e.g. a python
   * REPL) runs — leaving such a program is `exit()`/Ctrl+Z+Enter, not this
   * shortcut. On a non-empty line `Ctrl+D` emulates `delete-char`;
   * `Ctrl+U` clears the whole input line (see the key handler below).
   * Shortcut closes pass `viaShortcut` so the bottom-panel host can hide the
   * panel when this was its last tab (spec Behaviour 9, NEKODE-19); chat
   * terminals ignore the flag.
   */
  onClose: (options?: { viaShortcut?: boolean }) => void
  /** Spawn failure (e.g. project directory missing): typed error state. */
  onSpawnError: (message: string) => void
  /**
   * Attention signals parsed from this terminal's stream (chat attention
   * badge spec Behaviour 2-3): BEL as a standalone bell, or an OSC 9
   * notification with its message text (null for an empty one). Detection is
   * passive — these callbacks never consume, block or rewrite stream data.
   */
  onAttention?: (signal: { message: string | null }) => void
  /** Delivered input to THIS chat's PTY (attention spec Behaviour 6 / AC6). */
  onInputDelivered?: () => void
  onReady?: () => void
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
  focused = false,
  onExit,
  onClose,
  onSpawnError,
  onAttention,
  onInputDelivered,
  onReady,
  injected = null,
  onInjected,
  terminalFontSize,
  terminalFontFamilies = DEFAULT_TERMINAL_FONT_FAMILIES,
  terminalCtrlVPaste = true,
}: ChatTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fontReadyRef = useRef(false)
  const pendingOutputRef = useRef<string[]>([])
  const pendingOutputLengthRef = useRef(0)
  const [fontError, setFontError] = useState<string | null>(null)
  const initialFontSizeRef = useRef(terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE)
  // Right-click menu state; null = closed. Coordinates are viewport-relative
  // (clientX/clientY), matching the fixed-position overlay.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // Latest PTY writer for the prompt input below the terminal (assigned inside
  // the mount effect; null outside it). A submission is Enter semantics: the
  // line plus CR goes to the PTY and the Ctrl+D prompt base is re-collected
  // from the shell's next prompt redraw.
  const sendRef = useRef<((data: string) => void) | null>(null)
  // Latest callbacks without re-creating the terminal session on re-render.
  const appRef = useRef(app)
  const onExitRef = useRef(onExit)
  const onCloseRef = useRef(onClose)
  const onSpawnErrorRef = useRef(onSpawnError)
  const onAttentionRef = useRef(onAttention)
  const onInputDeliveredRef = useRef(onInputDelivered)
  const onReadyRef = useRef(onReady)
  const terminalCtrlVPasteRef = useRef(terminalCtrlVPaste)
  // Live copy/paste entry points of the mounted terminal, for the right-click
  // menu rendered outside the mount effect. Null while unmounted.
  const clipboardRef = useRef<{ copy: () => boolean; paste: () => void } | null>(null)
  // Mount effect's fit+PTY-resize routine, reused by the live font-size
  // effect (refit after xterm reflows at the new size). Null while unmounted.
  const fitRef = useRef<(() => void) | null>(null)
  appRef.current = app
  onExitRef.current = onExit
  onCloseRef.current = onClose
  onSpawnErrorRef.current = onSpawnError
  onAttentionRef.current = onAttention
  onInputDeliveredRef.current = onInputDelivered
  onReadyRef.current = onReady
  terminalCtrlVPasteRef.current = terminalCtrlVPaste

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: initialFontSizeRef.current,
      // A distinct initial stack ensures xterm remeasures after font loading,
      // even when the user keeps the default family and size.
      fontFamily: 'Consolas, "Courier New", monospace',
      // Terminal palette follows the active theme tokens (default-beta-1 is
      // darker than default); fallbacks keep jsdom tests (no CSS cascade)
      // on the default palette. Picked up at mount; switching themes while a
      // session is open applies on its next open.
      theme: {
        background: themeColor('--color-terminal', 'rgb(13 15 26)'),
        foreground: themeColor('--color-ink', 'rgb(202 203 209)'),
        cursor: themeColor('--color-ink', 'rgb(202 203 209)'),
        selectionBackground: themeColor('--color-scrollbar', 'rgb(49 66 95)'),
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminalRef.current = terminal
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
      if (fontReadyRef.current) terminal.write(data)
      else {
        pendingOutputRef.current.push(data)
        pendingOutputLengthRef.current += data.length
        // Keep startup output bounded if loading stalls. Preserve every byte
        // in xterm, with an explicit notice while fallback fonts are in use.
        if (pendingOutputLengthRef.current > 1_048_576) {
          setFontError('Terminal fonts are still loading. Output is shown using fallback fonts.')
          fontReadyRef.current = true
          for (const pending of pendingOutputRef.current) terminal.write(pending)
          pendingOutputRef.current = []
          pendingOutputLengthRef.current = 0
        }
      }
    })
    const unsubscribeExit = appRef.current.terminals.onExit(chatId, (exitCode) => {
      onExitRef.current(exitCode)
    })

    // --- Attention detection (chat attention badge spec Behaviour 2-3) ------
    // Parser callbacks only: the terminal's own parser discriminates a
    // standalone BEL (onBell) from a BEL that merely terminates another
    // escape sequence (spec AC2), and delivers OSC 9 strings with their
    // message text for the tooltip. The subscriptions are passive — the data
    // path above stays untouched and never observes or rewrites these bytes.
    const unsubscribeBell = terminal.onBell(() => {
      onAttentionRef.current?.({ message: null })
    })
    const unsubscribeOsc9 = terminal.parser.registerOscHandler(9, (data) => {
      onAttentionRef.current?.({ message: data.length > 0 ? data : null })
      // No handler consumes the string; false leaves other handlers free to
      // act (none are expected — the app never chains OSC 9 consumers).
      return false
    })

    // --- Copy/paste (renderer clipboard + xterm selection) ------------------
    // xterm.js has no built-in copy/paste chords and Electron shows no context
    // menu by default, so both are wired here. Ctrl+C with a selection copies
    // instead of sending SIGINT (selection abort is the Windows-terminal
    // convention); without a selection it still aborts the line. The
    // Shift-carrying chords are always copy/paste. Paste writes to the PTY
    // through the same onData path as typing, so the Ctrl+D prompt-base
    // tracker sees it exactly like keyboard input.
    function copySelection(): boolean {
      if (!terminal.hasSelection()) {
        return false
      }
      void navigatorClipboard()
        ?.writeText(terminal.getSelection())
        .catch(() => undefined)
      return true
    }

    function pasteClipboard(): void {
      const clipboard = navigatorClipboard()
      if (clipboard === null) {
        return
      }
      void clipboard
        .readText()
        .then((text) => {
          if (text.length > 0) {
            terminal.paste(text)
          }
        })
        .catch(() => undefined)
    }

    // The right-click menu lives outside this effect; it reaches the live
    // terminal's copy/paste through this ref (nulled on cleanup).
    clipboardRef.current = { copy: copySelection, paste: pasteClipboard }
    // The live font-size effect reuses this fit+resize routine (nulled below).
    fitRef.current = fitAndResize

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

    // PTY-bound data passes through here. User input freezes the prompt base
    // until the next line reset. DEC focus reports are generated by xterm,
    // not typed input: PowerShell enables them before its first prompt, so
    // freezing on a report would leave that prompt uncaptured.
    const inputSubscription = terminal.onData((data) => {
      const isFocusReport = data === '\x1b[I' || data === '\x1b[O'
      if (!isFocusReport) {
        // Delivered input (typed) clears this chat's attention badge
        // (attention spec Behaviour 6 / AC6). Focus reports are xterm's own
        // bytes, never user attention.
        onInputDeliveredRef.current?.()
        const isResetByte = data === '\r' || data === '\n' || data === '\x03'
        if (!(resetBytePending && isResetByte)) {
          baseFrozen = true
        }
        resetBytePending = false
      }
      void appRef.current.terminals.write(chatId, data).catch(() => undefined)
    })

    // Synthetic input from the app's own line-edit emulations (below): it
    // freezes the prompt base exactly like real input bytes do.
    function sendToPty(data: string): void {
      baseFrozen = true
      onInputDeliveredRef.current?.()
      void appRef.current.terminals.write(chatId, data).catch(() => undefined)
    }

    // Prompt-input submission (sendRef): Enter semantics, not generic input.
    // The submitted bytes never pass through xterm's onData, so the handler
    // above would never see the reset; thawing here lets the next writeParsed
    // after the shell redraws its prompt re-collect the base, keeping the
    // Ctrl+D emptiness gate reading the fresh empty line. The line and its CR
    // go through the split-write helper (see lib/pty-submit.ts): a single
    // `line\r` chunk parses as an unterminated bracketed paste in
    // prompt_toolkit TUIs (Hermes Agent) and never submits.
    let cancelSubmitCr: (() => void) | undefined
    function submitPromptLine(line: string): void {
      baseFrozen = false
      // The prompt-input submission is delivered input too (attention spec
      // Behaviour 6 / AC6): submitted, pasted, typed — any write clears.
      onInputDeliveredRef.current?.()
      cancelSubmitCr?.()
      cancelSubmitCr = writeSubmitLine((data) => {
        void appRef.current.terminals.write(chatId, data).catch(() => undefined)
      }, line)
    }
    sendRef.current = submitPromptLine

    // Only edit a line that still begins with the captured prompt. Follow
    // xterm's wrapped-row chain so long input remains eligible when the cursor
    // has moved onto a continuation row. Program output can repaint the row.
    function hasAttributableInputLine(): boolean {
      if (!baseFrozen || promptBase === null) {
        return false
      }
      const buffer = terminal.buffer.active
      let row = buffer.baseY + buffer.cursorY
      let line = buffer.getLine(row)
      while (line?.isWrapped) {
        line = buffer.getLine(--row)
      }
      return line?.translateToString(false).startsWith(promptBase) ?? false
    }

    // The shell (e.g. PowerShell with PSReadLine) does not end on Ctrl+D, so
    // the app closes the chat — but only when the input line is visibly
    // empty (compared against the prompt base, above) and no full-screen
    // program owns the terminal (alternate buffer, e.g. vim/htop — there
    // Ctrl+D/Ctrl+U keep their program meaning and pass through untouched).
    // At an empty line the chat closes even while a normal-buffer program
    // (e.g. a python REPL) runs: leaving such a program is `exit()`/Ctrl+Z+Enter,
    // not this shortcut (contract decision).
    // On a non-empty line the shortcuts are emulated by shell edits.
    // Raw control bytes must never be forwarded: the user's shell (PSReadLine,
    // Windows edit mode) has no Ctrl+D/Ctrl+U binding and self-inserts them
    // into the input line as visible ^D/^U glyphs, poisoning the line the
    // emptiness gate judges (user retest 2026-09-26). The emulations are what
    // Ctrl+D = delete-char (the Delete key byte). Ctrl+U uses PowerShell's
    // SelectAll binding followed by Backspace, which removes the whole input
    // even when the cursor is in the middle or the line wraps.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      // The bottom-panel chord must never be written to this PTY, including
      // while the terminal textarea has focus (spec Behaviour 3).
      if (isBottomPanelChord(event)) {
        return false
      }
      // The Ctrl+Tab chat-switch chord is the same: the app consumes it and
      // nothing reaches the shell (NEKODE-2).
      if (chatSwitchDirection(event) !== null) {
        return false
      }
      // The Ctrl+N new-chat chord is the same: the app consumes it and
      // nothing reaches the shell.
      if (isNewChatChord(event)) {
        return false
      }
      if (event.type !== 'keydown') {
        return true
      }
      // AltGr characters (ctrlKey and altKey both true) are never a shortcut.
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      // Copy/paste chords (Ctrl+C/Ctrl+Shift+C/Ctrl+Shift/V forms below). The
      // plain Ctrl+C copy only wins while text is selected; otherwise it keeps
      // its abort-line meaning (resetBytePending, as before this feature).
      const isCopyChord =
        (event.code === 'KeyC' || event.key === 'c' || event.key === 'C') &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      if (isCopyChord && (event.shiftKey || terminal.hasSelection()) && event.type === 'keydown') {
        if (copySelection()) {
          return false
        }
      }
      // Paste chords (Ctrl+V / Ctrl+Shift+V) write the clipboard into the PTY
      // through xterm.paste — the same onData path as typing. Intercepted so
      // the raw \x16 byte never reaches the shell: the Windows edit mode would
      // paste a second time on top of ours. Ctrl+Shift+V always pastes text.
      // Ctrl+V does too by default, including inside full-screen programs:
      // forwarding the raw chord to Codex triggers image paste. Turning the
      // setting off restores program-owned Ctrl+V in the alternate buffer.
      const isPasteChord =
        (event.code === 'KeyV' || event.key === 'v' || event.key === 'V') &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      if (
        isPasteChord &&
        (event.shiftKey ||
          terminalCtrlVPasteRef.current ||
          terminal.buffer.active.type !== 'alternate')
      ) {
        // Cancel the browser default action, not only xterm's handling: the
        // handler's `false` return stops xterm but not Chromium's Ctrl+V
        // paste, whose native `paste` event on the hidden helper textarea
        // made xterm paste a second time (user report 2026-10-01).
        event.preventDefault()
        pasteClipboard()
        return false
      }
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
      // Matched on the physical key (event.code) so the shortcuts also work on
      // non-Latin layouts where Ctrl+D/Ctrl+U report a different event.key.
      const isCtrlD = (event.code === 'KeyD' || event.key === 'd' || event.key === 'D') && ctrlOnly
      const isCtrlU = (event.code === 'KeyU' || event.key === 'u' || event.key === 'U') && ctrlOnly
      if ((!isCtrlD && !isCtrlU) || terminal.buffer.active.type === 'alternate') {
        return true
      }
      if (isCtrlD) {
        if (isInputLineEmpty()) {
          onCloseRef.current({ viaShortcut: true })
          return false
        }
        sendToPty('\x1b[3~')
        return false
      }
      if (hasAttributableInputLine()) {
        sendToPty('\x01\x7f')
      }
      return false
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
      // … and nothing may survive behind the cursor.
      return line.after === ''
    }

    // Lazy spawn: the main process creates the PTY on this first attach.
    // An exit can unmount this view before create resolves. Completion after
    // cleanup must not mark the chat live or flush a pending command.
    let disposed = false
    void appRef.current.terminals
      .create(chatId, cwd)
      .then(() => {
        if (disposed) return
        fitAndResize()
        onReadyRef.current?.()
      })
      .catch((error: unknown) => {
        if (disposed) return
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
      disposed = true
      cancelSubmitCr?.()
      cancelSubmitCr = undefined
      terminalRef.current = null
      fontReadyRef.current = false
      pendingOutputRef.current = []
      pendingOutputLengthRef.current = 0
      sendRef.current = null
      clipboardRef.current = null
      fitRef.current = null
      cleanupResize()
      unsubscribeData()
      unsubscribeExit()
      unsubscribeBell.dispose()
      unsubscribeOsc9.dispose()
      writeParsedSubscription.dispose()
      inputSubscription.dispose()
      terminal.dispose()
    }
    // Session identity is fixed per mount; the host remounts (new generation)
    // when a dead session must be replaced.
  }, [chatId, cwd])

  useEffect(() => {
    if (!focused) {
      return
    }
    terminalRef.current?.focus()
  }, [focused])

  // Load before the first output, then apply family/size changes to this
  // view only. Cleanup rejects stale loads, including after disposal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes mount a fresh view; that view also needs its fonts loaded.
  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal === null) return
    let obsolete = false
    const size = terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE
    const families = { text: terminalFontFamilies.text, icons: terminalFontFamilies.icons }
    const apply = (error: string | null): void => {
      if (obsolete || terminalRef.current !== terminal) return
      setFontError(error)
      terminal.options.fontFamily = terminalFontStack(families)
      terminal.options.fontSize = size
      fitRef.current?.()
      fontReadyRef.current = true
      for (const data of pendingOutputRef.current) terminal.write(data)
      pendingOutputRef.current = []
      pendingOutputLengthRef.current = 0
    }
    const loading = loadTerminalFonts(families, size)
    if (loading === null) apply(null)
    else
      void loading.then(
        () => apply(null),
        () => apply('Failed to load terminal fonts. Text remains available using fallback fonts.'),
      )
    return () => {
      obsolete = true
    }
  }, [chatId, cwd, terminalFontSize, terminalFontFamilies.text, terminalFontFamilies.icons])

  return (
    <>
      {fontError ? (
        <p role="alert" className="text-xs text-error">
          {fontError}
        </p>
      ) : null}
      {/* Right-click copy/paste menu over the terminal view. onContextMenu
          also covers xterm's textarea, so it fires even while the view keeps
          keyboard focus. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the view hosts the context-menu gesture (right click); the menu items are real buttons and the menu closes on Escape. */}
      <div
        className="h-full w-full bg-terminal outline-none"
        data-testid={`terminal-canvas-${chatId}`}
        tabIndex={-1}
        style={{ display: visible ? 'block' : 'none' }}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        {/* One uniform 12px inset around the whole terminal window: the prompt
            frame aligns with the terminal text edges, and bottom, side and top
            margins read as one padding (user feedback 2026-10-01). The fit host
            itself must stay paddingless: FitAddon measures only the host box,
            so host padding made the xterm screen overflow it and the last text
            row touched the prompt frame (measured 0.9px gap). */}
        <div className="flex h-full w-full flex-col p-3">
          <div ref={containerRef} className="min-h-0 flex-1" />
          <PromptInput
            onSubmit={(line) => sendRef.current?.(line)}
            injected={injected}
            onInjected={onInjected}
          />
        </div>
      </div>
      {contextMenu !== null ? (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={(terminalRef.current?.hasSelection() ?? false) && visible}
          onCopy={() => {
            clipboardRef.current?.copy()
            setContextMenu(null)
          }}
          onPaste={() => {
            clipboardRef.current?.paste()
            setContextMenu(null)
          }}
          onSelectAll={() => {
            terminalRef.current?.selectAll()
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </>
  )
}
