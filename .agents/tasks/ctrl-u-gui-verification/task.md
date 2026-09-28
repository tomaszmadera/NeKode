---
id: ctrl-u-gui-verification
schema_version: 2
status: completed
intent: analysis
complexity: small
durability: recorded
current_phase: Phase 1
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
blockers: none
---

# Ctrl+U GUI acceptance

## Objective

Confirm in the real NeKode GUI that Ctrl+U clears the whole input line in a chat terminal when the cursor is in the middle. Record the result and resolve the deferred acceptance item in `BACKLOG.md` if it passes. If it fails, diagnose the observed behavior before changing code.

## Scope

Manual acceptance of `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9 after commit `3ad4f65`. The shared `ChatTerminal` also serves bottom terminals. No product edit is authorized by this handoff alone.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (main, commit 3ad4f65, deferred GUI check in BACKLOG.md; small analysis stands)

## Phase 1 - GUI acceptance

- [x] Phase 1.1 - Exercise Ctrl+U in the real NeKode GUI and record evidence (user gate 2026-09-28: user confirmed Ctrl+U works correctly; BACKLOG entry removed, task closed)

## Decisions

- User decision 2026-09-28: Ctrl+U removes the whole input line, including text behind the cursor, like default zsh behavior.

## Changed files

- `.agents/tasks/ctrl-u-gui-verification/task.md`
- `.agents/handoffs/ctrl-u-gui-verification.md` - archived unchanged to `.agents/handoffs/archive/` on close
- `BACKLOG.md` - realized Ctrl+U GUI acceptance entry removed

## Verification

| Check | Result | Notes |
|---|---|---|
| Tests before handoff | not run in this task | Prior Ctrl+U change: targeted Vitest 28/28, typecheck and scoped Biome passed; real ConPTY PowerShell smoke passed. See commit `3ad4f65` and session handoff. |
| Task record validation | passed | `python .agents/scripts/task-status --check .agents/tasks/ctrl-u-gui-verification/task.md` exit 0 on 2026-09-28. |
| GUI acceptance (user gate) | pass | 2026-09-28. User confirmed in the real NeKode GUI that Ctrl+U works correctly: the whole typed line is removed with the cursor mid-line and the prompt remains (invariant `CTRL-U-WHOLE-LINE`). Ctrl+D on an empty prompt was not re-reported in this acceptance; its fix `f91a8b3` keeps its own recorded verification. |
| preflight (resume) | pass | 2026-09-28. `python .agents/scripts/preflight` exit 0 (python 3.13.5, branch main, worktree clean at b8aaf53). Product tests not rerun: no product edit in this closure, prior targeted evidence stands. |
| close validation | pass | 2026-09-28. Snapshot moved unchanged to `.agents/handoffs/archive/`; `python .agents/scripts/task-status --check .agents/tasks/ctrl-u-gui-verification/task.md` exit 0 after the Timing fix; `python .agents/scripts/handoff-status --check` exit 0, handoffs valid: 0. |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T13:44:45Z | 2026-09-28T13:45:13Z |
| work | work | 2026-09-28T13:45:13Z | 2026-09-28T13:45:38Z |
| handoff | wait | 2026-09-28T13:45:38Z | 2026-09-28T14:16:03Z |
| preflight | work | 2026-09-28T14:16:03Z | 2026-09-28T14:17:37Z |
| close | work | 2026-09-28T14:17:37Z | 2026-09-28T14:17:45Z |

## Risks and blockers

- None. GUI acceptance confirmed by the user on 2026-09-28; task closed the same day.

## Resume instructions

Inspect `BACKLOG.md` Ctrl+U item, `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9, and commit `3ad4f65`. Run the real app, type text, move the cursor into the middle, press Ctrl+U, and capture whether both sides of the cursor disappear while the prompt remains.
