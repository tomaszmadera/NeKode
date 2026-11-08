/**
 * Mouse-wheel handling for the terminal view.
 *
 * Why NeKode applies the wheel itself: xterm transforms a wheel notch into a
 * `.xterm-viewport` `scrollTop` write and turns the scroll event it causes back
 * into a line delta. While a program streams output, xterm writes `scrollTop`
 * itself on every refresh and marks the next scroll event as its own to ignore
 * (`_ignoreNextScrollEvent`); a wheel notch that lands in that window is
 * dropped. Measured at 25 lines/s in xterm 5.5: 5 notches moved 14 of the
 * nominal 29 lines, and the view never reached the newest output while the
 * program kept writing. Applying the delta through `Terminal.scrollLines()`
 * removes the round-trip, so every notch counts.
 *
 * xterm keeps the wheel where the program owns it: an alternate-screen program
 * (its wheel becomes arrow keys) and a mouse-tracking program (its wheel
 * becomes wheel reports, e.g. Codex and Claude Code, which scroll their own
 * transcripts).
 */

/** `WheelEvent.deltaMode` values (DOM_DELTA_*). */
export const WHEEL_DELTA_PIXELS = 0
export const WHEEL_DELTA_LINES = 1
export const WHEEL_DELTA_PAGES = 2

export interface WheelScrollInput {
  /** Raw event delta, in units of `deltaMode`. */
  deltaY: number
  /** `WheelEvent.deltaMode`. */
  deltaMode: number
  /** Terminal row count (`Terminal.rows`). */
  rows: number
  /** Height of one rendered row in CSS pixels. */
  rowHeight: number
  /** Sub-row pixels carried over from the previous event of the gesture. */
  pendingPixels: number
}

export interface WheelScrollPlan {
  /** Whole buffer lines to scroll; 0 when the gesture has not filled a row. */
  lines: number
  /** Sub-row pixels to carry into the next event. */
  pendingPixels: number
}

/**
 * Converts one wheel event into whole buffer lines plus a carried remainder.
 * High-resolution (smooth) wheels send deltas smaller than a row; keeping the
 * remainder makes their motion accumulate instead of rounding to nothing.
 */
export function planWheelScroll(input: WheelScrollInput): WheelScrollPlan {
  const { rowHeight, rows } = input
  if (!(rowHeight > 0) || !(rows > 0)) {
    return { lines: 0, pendingPixels: input.pendingPixels }
  }
  const pixels =
    input.deltaMode === WHEEL_DELTA_LINES
      ? input.deltaY * rowHeight
      : input.deltaMode === WHEEL_DELTA_PAGES
        ? input.deltaY * rowHeight * rows
        : input.deltaY
  const total = input.pendingPixels + pixels
  const lines = Math.trunc(total / rowHeight)
  return { lines, pendingPixels: total - lines * rowHeight }
}

export interface WheelOwnership {
  /** `Terminal.buffer.active.type`. */
  bufferType: 'normal' | 'alternate'
  /** `Terminal.modes.mouseTrackingMode`. */
  mouseTrackingMode: string
  /** The event carries Shift: xterm's horizontal/passthrough modifier. */
  shiftKey: boolean
  /** Terminal row count. */
  rows: number
  /** Height of one rendered row in CSS pixels; 0 when unmeasurable. */
  rowHeight: number
}

/**
 * Whether NeKode should apply this wheel event itself. Every `false` case keeps
 * xterm's own behaviour, including the "unmeasurable grid" fallback, so a view
 * whose geometry cannot be read still scrolls the way it always did.
 */
export function ownsWheel(input: WheelOwnership): boolean {
  if (input.shiftKey) return false
  if (input.bufferType !== 'normal') return false
  if (input.mouseTrackingMode !== 'none') return false
  return input.rowHeight > 0 && input.rows > 0
}
