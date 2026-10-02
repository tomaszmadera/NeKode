import { vi } from 'vitest'

// Module-boundary mock for @xterm/xterm (jsdom cannot host a real xterm
// canvas). Tests assert NeKode's own wiring — open/attach, write, fit, dispose
// — not xterm internals. Import this module in tests to inspect the instances
// the code under test constructed.
//
// The mock also carries a tiny visible-screen model (rows + cursor) so tests
// can simulate what the shell echo draws and assert the Ctrl+D gate's visual
// emptiness check (spec Behaviour 11 / AC9) against the buffer, exactly as
// the real `buffer.active.getLine(y).translateToString(...)` does.

/** One buffer row; mirrors `IBufferLine.translateToString`. */
export class MockBufferLine {
  constructor(
    private readonly text: string,
    readonly isWrapped = false,
  ) {}

  /**
   * Real xterm signature: `translateToString(trimRight?, startColumn?,
   * endColumn?)` — columns [startColumn, endColumn), `trimRight` trims the
   * trailing whitespace of the result. The numeric shorthand
   * `translateToString(0, x)` (start, end) is accepted too.
   */
  translateToString(
    trimRight?: boolean | number,
    startColumn?: number,
    endColumn?: number,
  ): string {
    let trim = false
    let start = 0
    let end = this.text.length
    if (typeof trimRight === 'number') {
      start = trimRight
      end = startColumn ?? this.text.length
    } else {
      trim = trimRight === true
      start = startColumn ?? 0
      end = endColumn ?? this.text.length
    }
    const cropped = this.text.slice(Math.max(0, start), Math.max(0, end))
    return trim ? cropped.replace(/\s+$/, '') : cropped
  }
}

export class MockBuffer {
  /** Normal buffer by default; tests flip `type` to 'alternate' (vim/htop). */
  type: 'normal' | 'alternate' = 'normal'
  /** Absolute row indices; `baseY + cursorY` is the cursor row. */
  rows: string[] = ['']
  wrappedRows = new Set<number>()
  baseY = 0
  cursorX = 0
  cursorY = 0

  getLine(y: number): MockBufferLine | undefined {
    if (y < 0) {
      return undefined
    }
    while (this.rows.length <= y) {
      this.rows.push('')
    }
    return new MockBufferLine(this.rows[y], this.wrappedRows.has(y))
  }
}

export class MockTerminal {
  cols = 80
  rows = 24
  options: unknown
  openedElement: HTMLElement | null = null
  written: unknown[] = []
  loadedAddons: unknown[] = []
  disposed = false
  buffer = { active: new MockBuffer() }
  /** Real xterm exposes parser callbacks on `terminal.parser` (IParser). */
  parser = {
    registerOscHandler: (id: number, handler: (data: string) => boolean): { dispose(): void } =>
      this.registerOscHandler(id, handler),
  }
  /** The registered custom key handler (Ctrl+D interception, spec AC9). */
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  private dataListeners = new Set<(data: string) => void>()
  private writeParsedListeners = new Set<() => void>()
  // --- Parser state for the bell/OSC callbacks (chat attention detection) ---
  private bellListeners = new Set<() => void>()
  private oscHandlers = new Map<number, (data: string) => boolean>()
  // A tiny VT parser slice over the written stream: ground text, ESC-prefixed
  // sequences and OSC strings. It exists so tests can trust the SAME semantics
  // the production detector relies on: a BEL that the parser reports as a bell
  // fires `onBell`; a BEL that merely terminates an OSC string never does
  // (spec AC2 — the discriminator against raw byte scanning).
  private parseState: 'ground' | 'esc' | 'oscId' | 'oscBody' = 'ground'
  private oscId = ''
  private oscBody = ''
  // ESC seen inside an OSC string: the next byte either completes an ST
  // terminator (ESC \) or cancels the string (malformed, no dispatch). The
  // flag survives write boundaries, like every other parser state here.
  private oscSawEsc = false

  constructor(options?: unknown) {
    this.options = options
    mockTerminalInstances.push(this)
  }

  open = vi.fn((element: HTMLElement): void => {
    this.openedElement = element
  })

  write = vi.fn((data: unknown): void => {
    this.written.push(data)
    if (typeof data === 'string') {
      this.feedParser(data)
    }
    // Real xterm fires this once the written data has been parsed into the
    // buffer; the mock parses synchronously (tests set the rows first).
    for (const listener of [...this.writeParsedListeners]) {
      listener()
    }
  })

  /** Parser callbacks: standalone BEL (onBell) and OSC `id` strings. */
  onBell = vi.fn((listener: () => void): { dispose(): void } => {
    this.bellListeners.add(listener)
    return {
      dispose: () => {
        this.bellListeners.delete(listener)
      },
    }
  })

  registerOscHandler = vi.fn(
    (id: number, handler: (data: string) => boolean): { dispose(): void } => {
      this.oscHandlers.set(id, handler)
      return {
        dispose: () => {
          this.oscHandlers.delete(id)
        },
      }
    },
  )

  /**
   * Minimal VT parsing over the written stream, holding exactly the semantics
   * the attention detector relies on: ground BEL fires `onBell`, a BEL or
   * ESC \ (ST) terminating an OSC string dispatches it (BEL here is the
   * terminator, never a bell), ESC-prefixed sequences swallow their final
   * byte, and an unterminated OSC string dispatches nothing (spec AC3).
   */
  private feedParser(data: string): void {
    for (const char of data) {
      const code = char.charCodeAt(0)
      if (this.parseState === 'oscBody') {
        if (this.oscSawEsc) {
          this.oscSawEsc = false
          if (code === 0x5c) {
            // ESC \ = ST terminator: dispatch the string.
            this.dispatchOsc()
          }
          // Any other byte after ESC cancels the string (malformed).
          this.parseState = 'ground'
          continue
        }
        if (code === 0x07) {
          // BEL terminator: dispatch; this BEL is never a bell.
          this.dispatchOsc()
          continue
        }
        if (code === 0x1b) {
          this.oscSawEsc = true
          continue
        }
        this.oscBody += char
        continue
      }
      if (this.parseState === 'oscId') {
        if (code === 0x3b) {
          this.parseState = 'oscBody'
          continue
        }
        if (code === 0x07) {
          // An id-only OSC terminated by BEL still dispatches (empty string).
          this.dispatchOsc()
          continue
        }
        if (code === 0x1b) {
          this.oscSawEsc = true
          this.parseState = 'oscBody'
          continue
        }
        if (code >= 0x30 && code <= 0x39) {
          this.oscId += char
          continue
        }
        // Anything else is malformed: back to ground, nothing dispatched.
        this.parseState = 'ground'
        continue
      }
      if (this.parseState === 'esc') {
        // The byte after ESC ends the sequence. ']' opens an OSC string (the
        // parser then reads its numeric id); anything else is a two-byte
        // escape whose final byte is never ground content.
        if (code === 0x5d) {
          this.parseState = 'oscId'
          this.oscId = ''
          this.oscBody = ''
          continue
        }
        this.parseState = 'ground'
        continue
      }
      // ground:
      if (code === 0x07) {
        for (const listener of [...this.bellListeners]) {
          listener()
        }
      } else if (code === 0x1b) {
        this.parseState = 'esc'
      }
    }
  }

  private dispatchOsc(): void {
    const id = Number.parseInt(this.oscId, 10)
    const body = this.oscBody
    this.parseState = 'ground'
    this.oscId = ''
    this.oscBody = ''
    this.oscSawEsc = false
    const handler = Number.isNaN(id) ? undefined : this.oscHandlers.get(id)
    if (handler !== undefined) {
      handler(body)
    }
  }

  /** Fires after written data has been parsed into the buffer. */
  onWriteParsed = vi.fn((listener: () => void): { dispose(): void } => {
    this.writeParsedListeners.add(listener)
    return {
      dispose: () => {
        this.writeParsedListeners.delete(listener)
      },
    }
  })

  onData = vi.fn((listener: (data: string) => void): { dispose(): void } => {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  })

  loadAddon = vi.fn((addon: unknown): void => {
    this.loadedAddons.push(addon)
  })

  attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean): void => {
    this.keyHandler = handler
  })

  // Selection/clipboard surface used by the terminal copy/paste wiring
  // (ChatTerminal chords and context menu). Real xterm keeps these on the
  // instance; the mock models just enough for the app's own assertions.
  private selectedText: string | null = null

  hasSelection = vi.fn((): boolean => this.selectedText !== null && this.selectedText.length > 0)

  getSelection = vi.fn((): string => this.selectedText ?? '')

  clearSelection = vi.fn((): void => {
    this.selectedText = null
  })

  selectAll = vi.fn((): void => {
    this.selectedText = this.buffer.active.rows.join('\n')
  })

  /** Real xterm.paste routes through onData (bracketed paste); so does the mock. */
  paste = vi.fn((data: string): void => {
    this.emitInput(data)
  })

  /** Test helper: simulates a user text selection inside the view (null clears). */
  setSelection(text: string | null): void {
    this.selectedText = text
  }

  /**
   * Real xterm focuses its hidden textarea inside the opened element; the
   * mock focuses the terminal view container instead: the nearest
   * `data-testid^="terminal-canvas"` ancestor of the opened element (the
   * opened element itself as the fallback), so tests can identify the
   * focused terminal view by its stable test id.
   */
  focus = vi.fn((): void => {
    const view = this.openedElement?.closest<HTMLElement>('[data-testid^="terminal-canvas"]')
    ;(view ?? this.openedElement)?.focus()
  })

  dispose = vi.fn((): void => {
    this.disposed = true
    this.dataListeners.clear()
    this.writeParsedListeners.clear()
    this.bellListeners.clear()
    this.oscHandlers.clear()
  })

  /** Simulates the user typing into the terminal. */
  emitInput(data: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(data)
    }
  }

  /** Simulates the shell echo drawing `text` at the cursor. */
  echo(text: string): void {
    const buffer = this.buffer.active
    const y = buffer.baseY + buffer.cursorY
    while (buffer.rows.length <= y) {
      buffer.rows.push('')
    }
    const row = buffer.rows[y]
    buffer.rows[y] = row.slice(0, buffer.cursorX) + text + row.slice(buffer.cursorX)
    buffer.cursorX += text.length
  }

  /** Simulates erasing `count` characters before the cursor (Backspace echo). */
  eraseBefore(count: number): void {
    const buffer = this.buffer.active
    const y = buffer.baseY + buffer.cursorY
    while (buffer.rows.length <= y) {
      buffer.rows.push('')
    }
    const row = buffer.rows[y]
    const cut = Math.min(count, buffer.cursorX)
    buffer.rows[y] = row.slice(0, buffer.cursorX - cut) + row.slice(buffer.cursorX)
    buffer.cursorX -= cut
  }

  /** Replaces the cursor row and puts the cursor at `cursorX` (default: end). */
  setCursorRow(text: string, cursorX: number = text.length): void {
    const buffer = this.buffer.active
    const y = buffer.baseY + buffer.cursorY
    while (buffer.rows.length <= y) {
      buffer.rows.push('')
    }
    buffer.rows[y] = text
    buffer.cursorX = cursorX
  }
}

export const mockTerminalInstances: MockTerminal[] = []

export function resetMockTerminals(): void {
  mockTerminalInstances.length = 0
}

export { MockTerminal as Terminal }
