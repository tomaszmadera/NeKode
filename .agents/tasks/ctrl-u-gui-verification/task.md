---
id: ctrl-u-gui-verification
schema_version: 2
status: active
intent: analysis
complexity: small
durability: recorded
current_phase: Phase 1
current_step: Phase 1.1
updated: 2026-09-28
branch: main
worktree: current
next_action: In the next session, run the real NeKode GUI and verify Ctrl+U with text on both sides of the cursor
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

- [ ] Phase 1.1 - Exercise Ctrl+U in the real NeKode GUI and record evidence

## Decisions

- User decision 2026-09-28: Ctrl+U removes the whole input line, including text behind the cursor, like default zsh behavior.

## Changed files

- `.agents/tasks/ctrl-u-gui-verification/task.md`
- `.agents/handoffs/ctrl-u-gui-verification.md`

## Verification

| Check | Result | Notes |
|---|---|---|
| Tests before handoff | not run in this task | Prior Ctrl+U change: targeted Vitest 28/28, typecheck and scoped Biome passed; real ConPTY PowerShell smoke passed. See commit `3ad4f65` and session handoff. |
| Task record validation | passed | `python .agents/scripts/task-status --check .agents/tasks/ctrl-u-gui-verification/task.md` exit 0 on 2026-09-28. |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T13:44:45Z | 2026-09-28T13:45:13Z |
| work | work | 2026-09-28T13:45:13Z | 2026-09-28T13:45:38Z |
| handoff | wait | 2026-09-28T13:45:38Z | |

## Risks and blockers

- No known blocker. Manual GUI acceptance remains unverified.

## Resume instructions

Inspect `BACKLOG.md` Ctrl+U item, `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9, and commit `3ad4f65`. Run the real app, type text, move the cursor into the middle, press Ctrl+U, and capture whether both sides of the cursor disappear while the prompt remains.
