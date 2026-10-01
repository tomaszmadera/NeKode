// Split PTY line submission: the line text first, its CR terminator after a
// short gap.
//
// Why not one write: ConPTY hands a single-write `line\r` to the child as one
// arriving chunk, and prompt_toolkit TUIs (Hermes Agent) parse that chunk as
// an unterminated bracketed paste — the text lands in their input box while
// the CR is swallowed, so nothing submits (measured 2026-10-01: a CR reaching
// the child ≥120 ms after the text commits; ≤40 ms never does). A CR arriving
// as its own later chunk is a genuine Enter. Plain shells (PSReadLine) submit
// either way, so the gap changes nothing for them.

/** Gap (ms) between the line text and its CR terminator. */
export const SUBMIT_GAP_MS = 150

/** Effective gap: tests pin 0 through the window override (env.d.ts). */
function effectiveGapMs(): number {
  const override = window.NEKODE_PROMPT_SUBMIT_GAP_MS
  return typeof override === 'number' ? override : SUBMIT_GAP_MS
}

/**
 * Writes `text`, then `'\r'` after the submit gap. `write` is the site's PTY
 * writer (it owns its own error handling). Returns a cancel function: call it
 * on teardown so a pending CR never reaches a disposed session.
 */
export function writeSubmitLine(
  write: (data: string) => void,
  text: string,
  gapMs: number = effectiveGapMs(),
): () => void {
  if (text.length > 0) write(text)
  const timer = window.setTimeout(() => write('\r'), gapMs)
  return () => {
    window.clearTimeout(timer)
  }
}
