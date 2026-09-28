---
task_id: ux-ui-polish-followup
created: 2026-09-28T21:03:02Z
schema_version: 2
from: main session 2026-09-28 evening (polish slice: scrollbars, controls, icons, prompt input; published 0.4.5)
to: next session (user's further UI changes)
branch: main
worktree: current
checkpoint_subject: d88ec4e85e6541313bc616258fe796f031897f4e+sha256:acfda1d589c54122fd09a53ae241d1398189c0023d91735bad59fa1225d2ccf6
current_step: Phase 0.1
next_action: Take the user's concrete UI change list at intake, then plan the first slice
blockers: none
---

# Handoff: UX/UI polish follow-up session

## Repository snapshot

Task record: `.agents/tasks/ux-ui-polish-followup/task.md` (validates under `commands.task_status --check`; created at this handoff, no work done yet). Transferred role: new agent (next ZCode session); reason: user session boundary after publication, more changes announced for the next session without a list.

**Working:**

- Publication: `e965060` (feat commit, full polish slice + completed task record + archived handoff), `d88ec4e` (bump), tag `0.4.5` at HEAD; worktree clean; no remote configured (push impossible, not offered).
- Scrollbars: `.xterm .xterm-viewport.xterm-viewport { overflow-y: auto }` override in `src/renderer/src/index.css` (doubled class beats xterm.css regardless of bundle order) plus token-themed webkit scrollbars (`--color-scrollbar`, `--color-scrollbar-active`, 8px, pill thumb).
- Controls: `--spacing-control: 2rem` in `src/renderer/src/theme.css`; filled buttons and the prompt frame use it (`h-control`/`self-stretch`); radius scale (`--radius-sm/md/lg/pill`) and `--font-mono` are theme tokens now.
- Icons: `src/renderer/src/lib/icons.tsx` maps role names to lucide-react 1.47.0 (dependency was already present); applied in ActionBar (fixed groups, status glyphs, Actions), tab/bottom-tab close, New chat/New terminal, project chevrons, Files action, Add Project, Files-mode back, file tree.
- Prompt input: `src/renderer/src/components/terminal/PromptInput.tsx` under the xterm host in `ChatTerminal.tsx`; Enter semantics via `submitPromptLine` (line + `\r`, prompt base re-collected); Dictation mic button rendered disabled (design doc 21 idle state).
- Tests: 340/340; status buttons are named by their visible label only (icons carry `aria-hidden`), e.g. `Build` not `▶ Build`; xterm-mock `focus()` walks to the `terminal-canvas-*` view container.
- Design contract: `docs/references/NeKode-Design-System.md` sections 3, 7, 8, 10, 11, 15, 21 record the decisions above.

**Broken:**

- Nothing new. `src/main/services/terminal/terminal-service.test.ts:196` (ConPTY spawn) remains flaky on this machine, predates all UI work, and passed in both full verification runs of this session.

## Decisions

- Icons: Lucide only, imported by role name from `src/renderer/src/lib/icons.tsx`, never from `lucide-react` directly; icons carry `aria-hidden` when a visible label names the control.
- Filled buttons and input frames: `--spacing-control` (32px = visible tab height); ghost row controls (Edit/Delete/Close, tab close, chevrons) stay compact.
- Components consume semantic tokens only; no raw palette classes or hex colors in renderer sources (the xterm theme literals in `ChatTerminal.tsx` are a recorded exception).
- Prompt input submits with Enter semantics: the Ctrl+D prompt base must re-collect from the shell's next redraw; do not freeze it like generic synthetic input.
- Dictation button stays disabled until the recognizer feature is decided; design doc 21 owns its states.
- Theme is one file (`src/renderer/src/theme.css`, Tailwind v4 `@theme`, compiled at build); runtime switching does not exist; a variant means a second token set plus a loader (doc section 3).
- Run `pnpm <script>` directly in Git Bash, never via `cmd /c "pnpm ..."` (the chain gets swallowed).

## Failed approaches

- `ci commit -f` with the deleted side of a staged `git mv` rename in the path list: fatal `pathspec ... did not match any files`, because after the rename is staged the old path exists neither in the index nor the worktree. Fix applied: `git reset -- <old> <new>` to unstage the rename, then commit with both paths (the deletion re-stages cleanly). Do not retry the commit while the rename is staged.
- A placeholder verification-subject block in a fresh task record would violate the subject schema (paths must be a non-empty sorted set, subject_sha256 must match); a record with no verification yet simply has no subject block.

## Verification

- `python .agents/scripts/verify-full` exit 0: lint 0 errors, typecheck pass, vitest 340/340 (3 new PromptInput tests).
- `pnpm build` exit 0; compiled CSS contains `.h-control`, `--font-mono`, `--spacing-control`, scrollbar tokens and the viewport override (checked programmatically against `out/renderer/assets/index-*.css`).
- `publication-status --json` after the sequence: version 0.4.5, tag at HEAD, clean worktree, `current branch has no upstream`.
- Not verified: the user's visual acceptance of the running app (`pnpm dev` walkthrough of the theme, controls, icons and prompt input is still pending).

## Open product invariants

- none

## Unresolved assumptions

- Dictation recognizer: source - the user asked only for the button in the prompt frame; consequence - it ships disabled; resolution - decide Web Speech API (needs network/Google key in Electron) versus a local model, then wire it.
- Runtime theme switching: source - the user asked whether it exists; consequence - documented as not existing (design doc 3); resolution - decide whether to build a multi-token-set loader and settings UI.
- Next-session scope: source - the user said "more changes" without a list; consequence - the record sits at intake; resolution - the user provides the concrete list in the next session.

## Resume instructions

1. Read this snapshot and `.agents/tasks/ux-ui-polish-followup/task.md`; confirm `git status` clean and `commands.task_status --check` passes (HEAD at or after `d88ec4e`, version 0.4.5).
2. Resume via `task-record`: end the `handoff` wait row, reopen `intake`; take the user's change list from their first message (ask one concrete question if it is absent), classify, and plan the slice with `.agents/workflows/small-development.md` unless the scope says Standard.
3. Tests-before-edits: run `pnpm test` as the baseline; the ConPTY test passes on rerun.
4. Expected evidence of a correct resume: an explicit change list recorded in the task record, a planned slice, and no edits before the baseline run.
5. Next skill to load: `task-record` (resume), then `small-development`.
