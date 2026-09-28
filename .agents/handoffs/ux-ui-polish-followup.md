---
task_id: ux-ui-polish-followup
created: 2026-09-28T23:34:37Z
schema_version: 2
from: main session 2026-09-28/29 (resumed follow-up: items 16-17 implemented, verified, published as 0.4.6)
to: next session (user's further UI improvements, list to take at intake)
branch: main
worktree: current
checkpoint_subject: 75094e593909ae63d16763a6936895fd39b3271c+sha256:9b01175e636488e7afc50f12241eb55a69acaa55ce2eee0f9896df5e39637339
current_step: Phase 8.1
next_action: Take the user's next UI improvement list at intake, then plan the first slice
blockers: none
---

# Handoff: UX/UI polish follow-up session (round 3)

## Repository snapshot

Task record: `.agents/tasks/ux-ui-polish-followup/task.md` (validates under `commands.task_status --check`; active at Phase 8.1 intake; Phases 0-7 carry the full slice, correction, and resumed-round history). Transferred role: new agent (next ZCode session); reason: user session boundary after the user approved the 0.4.6 publication and announced more UI improvements without a list. The previous session's snapshot lives unchanged at `.agents/handoffs/archive/ux-ui-polish-followup.md` and owns the round-1/2 state described there; this snapshot adds only what changed since.

**Working:**

- HEAD `75094e5` (version 0.4.6, annotated tag `0.4.6` at HEAD, containing the product commit `4e8d515` and the earlier untagged batch `929f3f6`). The checkpoint commit created by this handoff contains the reopened record and this snapshot only. No remote configured (push impossible, not offered).
- Action row right end: icon-only Actions control (`ActionBar.tsx`): `Icon.settings` 14px, no default fill, `hover:bg-button-hover`, `self-stretch` row height, `rounded-md`, accessible name and tooltip `Actions` via `aria-label`/`title` (the visible label is gone).
- Prompt input frame right end: segmented `Send | Dictation` group (`PromptInput.tsx`): both full-height segments with square left edges, Dictation still the last segment flush to the frame end with clipped corners, a 16px centered `--color-divider` hairline between them. Send (`Icon.send` Lucide paper plane plus the visible `Send` label, `type="submit"`) submits through the form's onSubmit and is disabled while the input is empty; `bg-button`, `hover:bg-button-hover` when enabled.
- Everything from the archived snapshot stands: WCO title bar, action row padding and segments, terminal padding, nav lists, files tree, centered welcome surfaces, cursor rules, prompt frame as the only boundary.
- Tests 342/342; design contract updated in `docs/references/NeKode-Design-System.md` sections 10, 11.4, 15, 21 this round.

**Broken:**

- Nothing new. `src/main/services/terminal/terminal-service.test.ts:196` (ConPTY spawn) remains flaky on this machine, predates all UI work; it failed once in this session's baseline and passed on rerun and in every later full run.

## Decisions

- Icons: Lucide only, imported by role name from `src/renderer/src/lib/icons.tsx`, never from `lucide-react` directly; icons carry `aria-hidden` when a visible label names the control.
- The Actions control stays icon-only: no default background, hover fill, `aria-label`/`title` `Actions` (user approved the look).
- Send is disabled while the input is empty; enabled Send uses `text-ink` with `bg-button-hover` on hover, matching the row's filled controls.
- The prompt frame's right end keeps the segmented language (design doc 5/11.4): single 1px centered 16px hairline, never a two-tone groove or full-height border.
- Filled buttons and input frames: `--spacing-control` (32px); ghost row controls stay compact.
- Components consume semantic tokens only; no raw palette classes or hex colors in renderer sources (xterm theme literals in `ChatTerminal.tsx` and the overlay hexes in `src/main/index.ts` are recorded exceptions).
- The prompt input frame is the only boundary above the input row; no separator line.
- Dictation stays disabled until the recognizer feature is decided; design doc 21 owns its states.
- Prompt input submits with Enter semantics: the Ctrl+D prompt base must re-collect from the shell's next redraw; do not freeze it like generic synthetic input.
- Hand cursor on every enabled button (`index.css` global rule).
- Theme is one file (`src/renderer/src/theme.css`, Tailwind v4 `@theme`); runtime switching does not exist; a variant means a second token set plus a loader (doc section 3).
- Run `pnpm <script>` directly in Git Bash, never via `cmd /c "pnpm ..."`; harness scripts that spawn a command argument (`verify-targeted`, `verify-changed`) are the exception: pass `cmd //c pnpm ...` (lesson `verify-targeted-cmd-wrapper-gitbash`).

## Failed approaches

- Bare `pnpm exec vitest run ...` as the `verify-targeted` command: the script spawns it via `CreateProcess`, which cannot run the pnpm shim (`WinError 2`). And `cmd /c` written literally in Git Bash reaches the child as `cmd C:/` (MSYS path conversion). Use `cmd //c`.
- Carried from the archived snapshot (do not repeat): two-tone divider groove (user rejected as too intense); `fixed inset-0` centering and `flex-1` on plain-block hosts (use `h-full`); alignment by arithmetic from class names (measure with a DOM harness); `git checkout --` on `core.autocrlf=true` (restore via `git show HEAD:<path>`); `ci commit -f` with a staged rename's deleted side (unstage the rename first).

## Verification

- Baseline: `pnpm test` 340/340 (first run hit the known flaky ConPTY test, clean on rerun, 2026-09-28T23:03Z).
- After edits: `pnpm run lint` exit 0; `pnpm run typecheck` exit 0; `pnpm test` 342/342 (two new Send tests in `ChatTerminal.test.tsx`).
- Final: `python .agents/scripts/verify-targeted -- cmd //c pnpm exec vitest run src/renderer/src/App.test.tsx src/renderer/src/components/terminal/ChatTerminal.test.tsx` exit 0 (91/91, two runs); verification subject 3 `check` exit 0 immediately before close.
- Publication: scoped commit `4e8d515` (12 task-owned paths), `ci bump patch` -> `0.4.6` (commit `75094e5`, annotated tag `0.4.6`), worktree clean before the record reopen.
- Not verified: one `pnpm dev` walkthrough of the whole 0.4.5+0.4.6 UI batch by the user (carried from the previous snapshot).

## Open product invariants

- none

## Unresolved assumptions

- Dictation recognizer: source - the user has only ever asked for the button; consequence - Dictation ships disabled inside the prompt frame after Send; resolution - decide Web Speech API (needs network/Google key in Electron) versus a local model, then wire it.
- Runtime theme switching: source - earlier user question; consequence - documented as not existing (design doc 3); resolution - decide whether to build a multi-token-set loader and settings UI.
- Next-session scope: source - the user said they will continue improving the UI in another session; consequence - the record sits at Phase 8.1 intake; resolution - the user provides the concrete list in the next session.

## Resume instructions

1. Read this snapshot and `.agents/tasks/ux-ui-polish-followup/task.md`; confirm the worktree is clean (or holds only unrelated changes) and HEAD is at or after the `0.4.6` bump commit `75094e5`. Run `commands.task_status --check .agents/tasks/ux-ui-polish-followup/task.md`.
2. Resume via `task-record`: end the `handoff` wait, open Phase 8.1 intake; take the user's change list from their first message (ask one concrete question if it is absent), classify, and plan the slice with `.agents/workflows/small-development.md` unless the scope says Standard.
3. Tests-before-edits: run `pnpm test` as the baseline.
4. Expected evidence of a correct resume: an explicit change list recorded in the task record, a planned slice, and no edits before the baseline run.
5. Next skill to load: `task-record` (resume), then `small-development`.
