---
task_id: mvp-core-shell
created: 2026-09-25T20:12:01Z
schema_version: 2
from: Main (Hermes coordinator session)
to: Main (next session)
branch: main
worktree: current
checkpoint_subject: c49ab29496f8ebe7a33a5ddf16b4be4817e0d942+sha256:ec875ae6cc94615d045f5472c62543902c9d6922ca5115363737685861d4db56
current_step: Phase 2.5
next_action: Obtain the user's retest of points 3 and 5 after acceptance correction round 5 (Ctrl+D with text on the line emulates delete-char — no line pollution; Ctrl+U emulates kill-line) in pnpm dev / scripts/start.ps1, record per-point results in the task record; then task-close with verification subject + verify-full
blockers: none
---

# Handoff: NeKode MVP Core Shell — acceptance retest of Ctrl+D close pending (chat model complete)

## Repository snapshot

Linked task record: `.agents/tasks/mvp-core-shell/task.md` (current_step: Phase 2.5, plan `.agents/tasks/mvp-core-shell/plan.md` status approved). Spec: `docs/features/mvp-core-shell/spec.md` (contract revised 2026-09-25: chat entity, Behaviour 11, AC9/AC10). Transferred role: Main to Main. Reason: user-requested pause before the acceptance retest — Stage 4 and its acceptance corrections are implemented, independently reviewed and committed; what remains is the manual retest of two points and the final close.

### Working

- Stages 1–3 (commits `49c439b`, `b6ba66a`, `a18c3c2`) — unchanged, previously accepted (evidence in the record).
- Stage 4 (`ec4204d` + `abb509a`): chat entity model across the stack (tree PROJEKT→CHATS; `chats` table without `status`; `window.app.chats.*`; migration v2 `tasks`→`chats` + selection-key rename); terminal exit closes the chat (renderer-driven `chats:remove` on `terminals:exit`, successor selection / "Start new chat" empty state); "session ended" state removed entirely (spawn-error + Retry stays; a failed spawn never closes the chat); app quit never deletes chats (`#quitting` in `TerminalService.terminateAll`, subscriptions disposed before kill).
- Acceptance correction (`395bf62`): Ctrl+D empty-line close + shell-named chats — no naming form ("New Chat"/"Start new chat" create instantly, name = `shellDisplayName()` e.g. "PowerShell", duplicates allowed, migration v3 drops `unique(project_id,name)`); `chats.create(projectId)` single-argument IPC; collapsed project expands on chat creation; shortcut matched on `event.code` (non-Latin layouts).
- Ctrl+D redesign (`c49ab29`): line emptiness judged VISUALLY — close only when the text before the cursor equals the frozen prompt base AND nothing survives behind the cursor (`ChatTerminal.tsx:207-232`); prompt base collected on `onWriteParsed` while the line is clean, frozen on the first input byte, thawed by Enter/Ctrl+C (reset detected from keydown, so a pasted newline is content, never Enter); the whole `InputLineState` machine and paste-marker handling removed.
- User tooling committed (`7cb8f00`): `scripts/start.ps1`, `scripts/stop.ps1`.
- User acceptance results 2026-09-25 (in the record): retest round 1 AC1–6 + 8 pass, `exit` pass, quit pass; retest round 2 points 1, 2, 4, 7 pass (point 6 skipped by the user; REPL behaviour outside the user's scope, decided and implemented).

### Broken

- Points 3/5 retest (2026-09-26, runda 4) FAILED — not an emptiness-gate bug: the user's shell (powershell.exe + PSReadLine 2.4.5, EditMode Windows) treats `\x04`/`\x15` as unbound and SELF-INSERTS them into the input line (visible caret `^D`/`^U`), so the app's Ctrl+D EOF passthrough pollutes the line (an earlier Ctrl+D turns `abc` into `abc^D`; Backspace x3 then leaves `a` + a History-prediction ghost behind the cursor, and the gate correctly refuses to close). Ctrl+U never clears the line in this shell either (point 5's premise is false here). Evidence: raw ConPTY captures `tmp/repro-*.bin`, `tmp/repro2-*.bin` (node-pty, same shell/bytes the app's xterm receives); a clean erased line (no earlier Ctrl+D) IS visually empty in the stream, so point 3 part one needs GUI confirmation. RESOLVED 2026-09-26 (user decision, recommended variant 1+1): outside the alternate buffer Ctrl+D on a non-empty line now emulates readline delete-char (Delete key byte) and Ctrl+U emulates unix-line-discard (backspaces over the input before the cursor); raw control bytes 0x04/0x15 are never forwarded (both keys pass through untouched only in the alternate buffer). Implemented in ChatTerminal.tsx + ChatTerminal.test.tsx + spec.md (Behaviour 11, AC9). Independent review PASSED (deleg_dbdee1df, 0 blocking; emulated-byte mutations caught by tests). Hardening folded in after review: Ctrl+U counts input characters (not cells), the no-blind-backspaces guard is test-covered and mutation-checked, spec wording cleaned. Awaiting the user's retest of points 3/5.

## Decisions

- Domain model (user decision 2026-09-25): left tree PROJEKT → CZATY; a chat is a terminal session and dies with its terminal (exit / Ctrl+D / shell crash); the task entity (work item + harness-agnostic progress record) is post-MVP, attachable to a chat; Kanban and handoff snapshots are post-MVP (requirements.md v0.2 §3).
- exit/Ctrl+D close flow: terminal view disposed, chat removed from tree + DB, next chat of the project auto-selected (previous if the closed one was last), otherwise "Start new chat" empty state; `chats:remove` is idempotent; a background chat closing never steals the current selection; application quit NEVER deletes chats and restart restores the full tree + selection (Zed-like), terminals start fresh on first show.
- Ctrl+D semantics (user decision 2026-09-25): closes only at a known-empty input line outside the alternate buffer; otherwise EOF (`\x04`) to the PTY. At an empty line it closes even inside normal-buffer programs (e.g. a Python REPL) — leaving such a program is `exit()`/Ctrl+Z+Enter. Emptiness is visual (prompt-base comparison), so Ctrl+U follows whatever the running shell does: closes when the line visibly cleared, never when text survives behind the cursor. Amendment 2026-09-26 (user decision): the non-empty-line behavior no longer forwards raw control bytes — the user's shell (PSReadLine, Windows edit mode) self-inserts them as visible glyphs. Ctrl+D on a non-empty line emulates delete-char (Delete key byte), Ctrl+U emulates unix-line-discard (backspaces over the input before the cursor; text behind it survives), both consumed by the app; in the alternate buffer both keys pass through untouched.
- Chat name = platform shell label (`shellDisplayName()` in `terminal-service`, injectable); duplicates within a project allowed (no unique index); manual rename is post-MVP (the `name` column stays).
- Stage-3 session rules preserved: hidden-mounted per-task views, respawn strictly on explicit re-selection, eviction on project removal with main-side PTY termination (chat ids captured before the FK cascade), `terminateAll` on `before-quit`, `terminals:terminate` channel stays absent (spec Data/API unchanged on that point).
- Workflow SDD Large: Main coordinated only; each stage ran a fresh implementer + independent same-agent reviewer subagent. EFFORT DEVIATION: the correction/re-review cap (2 rounds) was exceeded — the user explicitly authorized one narrow fix round (Ctrl+U rule) and one redesign round (visual emptiness) after the acceptance retest failures. MODEL: no deviation (mimo-v2.6-pro for Main and all subagents).

## Failed approaches

- Do not re-introduce stream-tracking heuristics for Ctrl+D line emptiness (keydown flag → length counter → tri-state machine, all in `ChatTerminal.tsx`): every variant wedged or diverged in real usage — paste, history recall, Tab, AltGr and `\x04` passthrough poisoned the tracker with no recovery without Enter, so a visibly empty line stopped closing the chat (user retest failures 3/5). The visual prompt-base comparison is the working approach (regression tests cover the poisoned flows).
- Do not tree-kill the dev run from the recorded root PID alone: `pnpm run dev` re-spawns through intermediate processes (pnpm.exe/cmd with foreign PPIDs) and node-pty ConPTY shells can sit outside that tree. Working attribution in `scripts/stop.ps1` (still valid).
- Do not trust snapshot claims over repository evidence — the previous snapshot's stale claims were caught by preflight (still valid).
- Do not assume `\x04`/`\x15` passthrough gives EOF/kill-line semantics in powershell.exe + PSReadLine (EditMode Windows): both chords are unbound there and self-insert as caret glyphs `^D`/`^U`, poisoning the input line (evidence: `tmp/repro2-*.bin`). Design Ctrl+D/Ctrl+U behavior against captured shell streams, not readline folklore.

## Verification

- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`: all exit 0 at `c49ab29` — 181/181 tests in 17 files (ChatTerminal suite 22 tests; three paste-marker tests removed together with the machinery they covered).
- Discrimination evidence (implementer; accepted by the coordinator): running the new test file against the old `ChatTerminal.tsx` fails exactly 4 tests — the poisoned flows (Ctrl+D passthrough then erase; history recall; Ctrl+U behind-cursor residue; double Ctrl+D).
- `python .agents/scripts/task-status --check .agents/tasks/mvp-core-shell/task.md`: pass (re-validated after every record update).
- Manual acceptance: retest points 1, 2, 4, 7 pass (2026-09-25); point 6 skipped by the user; points 3 and 5 PENDING after `c49ab29` (previous failure root-caused and regression-tested); REPL point outside the user's scope (behaviour decided). Nothing beyond these is claimed as passed.
- Checkpoint subject hash = `git diff HEAD -- .agents/tasks/mvp-core-shell docs/features/mvp-core-shell | sha256sum` evaluated at snapshot creation (the snapshot itself is excluded from the scope); no untracked files in scope.

## Open product invariants

- `sdd-6-renderer-no-os` (renderer must not own OS capabilities): status open by design for the slice. Impact on the current result: none — maintained through Stage 4 (everything via `window.app.*`; renderer drives chat closing through IPC only). Evidence needed to change status: not available in this slice; keep open.

## Unresolved assumptions

- The Ctrl+D close and the erase-to-empty flows hold in a real GUI session (ConPTY echo and real xterm rendering are untestable in vitest/jsdom; the mock simulates echo). Consequence: task close waits for the user's retest of points 3/5. Evidence needed: per-point pass/fail notes.
- The visual prompt-base comparison compares the cursor row only (multi-line prompts like oh-my-posh are handled per row); asynchronous output can desync the base in the SAFE direction (missed close, never a destructive close). Consequence: a rare Ctrl+D that does nothing until Enter. Evidence to resolve: field use; revisit only if the user reports missed closes.
- Post-MVP scope parked in `BACKLOG.md`: bottom terminal panel (multiple terminals/tabs), task entity + progress tracking (harness-agnostic), Kanban, manual chat rename, UX-UI.md/SDD.md terminology alignment (those docs still say "task").

## Resume instructions

1. First action: obtain the user's retest of points 3 and 5 in `pnpm dev` or `scripts\start.ps1` (spec `docs/features/mvp-core-shell/spec.md` AC9): (3) type `abc`, erase with Backspace ×3 — Ctrl+D closes the chat; repeat once after an earlier Ctrl+D with text on the line (the previously poisoned flow); (5) `abc` + Ctrl+U — Ctrl+D closes when the line visibly cleared. Expected evidence: a Verification row with per-point notes. Close the `handoff` Timing row and open the `user-gate` row.
2. Then activate `task-close` with final verification `full` (multi-stage task): capture the verification subject with `python .agents/skills/task-record/scripts/verification_subject.py capture --record .agents/tasks/mvp-core-shell/task.md --path <task-owned paths>`, persist the emitted `### Verification subject N` block, open the `verify` Timing row, run `python .agents/scripts/verify-full`, then close the record (check Phase 2.5, `current_step: none`, status completed) and move this snapshot unchanged to `.agents/handoffs/archive/`. On verification failure follow the SDD correction loop (unscoped `correction` + `review` rows, then a fresh subject and one retry), never a new stage.
3. Before editing anything: read the task record, plan Stage 4 + Stage 4 acceptance correction, the spec, and this snapshot — repository evidence wins over this text. Tests-before-edits baseline: `pnpm run test` (181/181). Spec, plan, approvals and review evidence are complete (record Verification table).
- Next skill to load: `handoff` (this snapshot) on resume, then `task-close` after the user's pass.
