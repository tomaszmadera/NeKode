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
  /** The registered custom key handler (Ctrl+D interception, spec AC9). */
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  private dataListeners = new Set<(data: string) => void>()
  private writeParsedListeners = new Set<() => void>()

  constructor(options?: unknown) {
    this.options = options
    mockTerminalInstances.push(this)
  }

  open = vi.fn((element: HTMLElement): void => {
    this.openedElement = element
  })

  write = vi.fn((data: unknown): void => {
    this.written.push(data)
    // Real xterm fires this once the written data has been parsed into the
    // buffer; the mock parses synchronously (tests set the rows first).
    for (const listener of [...this.writeParsedListeners]) {
      listener()
    }
  })

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

  /** Real xterm focuses its textarea; the mock focuses the opened element. */
  focus = vi.fn((): void => {
    this.openedElement?.focus()
  })

  dispose = vi.fn((): void => {
    this.disposed = true
    this.dataListeners.clear()
    this.writeParsedListeners.clear()
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
