/**
 * Pure decision logic for Ctrl+D gate state machine in terminal sessions (spec Behaviour 11 / AC9).
 *
 * Emptiness of the shell's input line is judged visually from the xterm buffer:
 * - When in alternate buffer mode (full-screen programs like vim or htop), Ctrl+D passes through untouched ('ignore').
 * - When at an empty input line outside full-screen programs, the chat session closes ('eof').
 * - When text exists on the line, Ctrl+D emulates forward delete-char (\x1b[3~, 'delete').
 */

export type CtrlDAction = 'eof' | 'delete' | 'ignore'

export interface CursorLine {
  /** Visible text before the cursor on the cursor row (columns [0, cursorX)). */
  before: string
  /** Visible text behind the cursor on the cursor row (columns [cursorX, cols)), right-trimmed. */
  after: string
}

export interface CtrlDGateContext {
  /** The cursor-row prefix captured while the line was clean. Null until first prompt draw. */
  promptBase: string | null
  /** Whether user input has been received since the last line reset. */
  baseFrozen: boolean
  /** Visible line content around the cursor, or null if row buffer is unavailable. */
  cursorLine: CursorLine | null
  /** Xterm buffer type ('normal' or 'alternate'). Defaults to 'normal'. */
  bufferType?: 'normal' | 'alternate'
}

/**
 * Splits a full row text and cursor column into a CursorLine representation.
 * Columns before cursorX are preserved exactly; columns after cursorX are right-trimmed.
 */
export function splitCursorLine(fullLine: string, cursorX: number): CursorLine {
  const clampedX = Math.max(0, Math.min(cursorX, fullLine.length))
  return {
    before: fullLine.slice(0, clampedX),
    after: fullLine.slice(clampedX).trimEnd(),
  }
}

/**
 * Determines whether the shell's input line is visually empty (spec Behaviour 11 / AC9).
 * - If nothing has been drawn yet (promptBase === null), it is empty only if no input has arrived (!baseFrozen).
 * - If cursorLine is null, line is unverifiable -> not empty.
 * - If promptBase is known, text before cursor must match promptBase exactly, and after cursor must be empty.
 */
export function isInputLineEmpty(
  promptBase: string | null,
  baseFrozen: boolean,
  cursorLine: CursorLine | null,
): boolean {
  if (promptBase === null) {
    return !baseFrozen
  }
  if (cursorLine === null) {
    return false
  }
  return cursorLine.before === promptBase && cursorLine.after === ''
}

/**
 * Evaluates the Ctrl+D gate action for a given terminal buffer state.
 */
export function decideCtrlDAction(context: CtrlDGateContext): CtrlDAction {
  if (context.bufferType === 'alternate') {
    return 'ignore'
  }
  if (isInputLineEmpty(context.promptBase, context.baseFrozen, context.cursorLine)) {
    return 'eof'
  }
  return 'delete'
}
