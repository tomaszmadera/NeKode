# PowerShell + PSReadLine: unbound Ctrl chords self-insert — capture the stream first

Verified 2026-09-26 on this host (mvp-core-shell acceptance retest rounds 4–5).

## Rule

Never design terminal shortcut semantics (Ctrl+D, Ctrl+U, any Ctrl chord) from readline folklore. Capture the real PTY byte stream of the exact shell the app spawns, then design against the capture.

## Facts (powershell.exe 5.1 + PSReadLine 2.4.5, EditMode Windows — the default)

- Ctrl+D and Ctrl+U are UNBOUND: PSReadLine self-inserts the raw control byte into the input line, rendered as caret glyphs `^D`/`^U`. `\x04` is NOT EOF and does not delete a character; `\x15` does NOT clear the line. Any app logic assuming readline semantics is wrong on this stack.
- `PredictionSource: History` + `InlineView` draws grey ghost text BEHIND the cursor on history matches. A visual line-emptiness check must treat behind-cursor text as non-empty (and expect the ghost to vanish only at empty input).
- ConPTY synthesizes the prompt as text WITHOUT the trailing space plus `ESC[1C` (a gap column the cursor sits beyond); erases repaint via absolute `CUP` + `ECH`. Emptiness checks must compare visible row text, not cursor-column arithmetic alone.
- Emulations that DO work everywhere observed: `ESC[3~` (Delete key) = delete-char under the cursor, no-op at end of line; `\x7f` = erase input before the cursor (N backspaces ≈ readline unix-line-discard).

## How to capture

node-pty harness: spawn the app's exact `ShellSpec` (`powershell.exe -NoLogo`, same cols/rows), write the chord bytes, record the raw output with byte-offset marks, then interpret (JSON string dump of the stream is enough — ConPTY emits a small sequence vocabulary). One scratch script per scenario (type/erase, chord-then-erase); artifacts in gitignored `tmp/`.

## Why

Mock xterm echo helpers model a cleaner echo than ConPTY produces, so jsdom tests pass while the GUI flow fails (or vice versa: a "broken" gate can be the shell polluting the line). Byte-level captures settle it in minutes.
