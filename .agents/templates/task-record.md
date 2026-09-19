---
id: <task-id>
schema_version: 2
status: active
intent: <intent>
complexity: <trivial | small | standard | large>
durability: recorded
current_phase: Phase 0
current_step: Phase 0.1
updated: YYYY-MM-DD
branch: pending-intake
worktree: current
next_action: Inspect the repository and refine the provisional classification
blockers: none
---

Initial-record contract: fill every placeholder, then remove this paragraph. Format `id` to match `^[A-Za-z0-9][A-Za-z0-9-]{2,79}$` without dots (e.g. `release-5-0-0`). Keep `branch: pending-intake` on the first write; replace it with the actual branch during repository and Git inspection. Keep `blockers: none` while status is `active`. Persist the router's owning intent and complexity without remapping; bootstrap workspace configuration uses `intent: bootstrap`. Every record has `durability: recorded`. If the bounded classification probe cannot resolve a consequential choice, ask before creating the record. Keep the intake phase and row below until repository discovery refines the classification.

# <task title>

## Objective

State the required outcome and users or systems affected.

## Scope

Link `docs/features/<slug>/spec.md` and `.agents/tasks/<task-id>/plan.md` for Standard or larger development work. Trivial and Small have no spec or plan file. Summarize only what this task will do. Do not copy the spec.

## Phase 0 - Intake

- [ ] Phase 0.1 - Inspect the repository and refine the provisional classification

## Decisions

Record approved choices and constraints that an implementer must preserve.

## Changed files

## Verification

| Check | Result | Notes |
|---|---|---|

Include tests-before-edits evidence, planned commands, and final results as they become available.

For every final verification attempt, append the exact immutable `### Verification subject N` JSON block emitted by the task-record verification subject tool. Attempts are append-only and consecutive. The subject covers every task-owned path whose content is being verified, but excludes this task record because recording verification evidence and closing state must update it after the check. Omit subject blocks only when the closure verification mode is `none`.

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | YYYY-MM-DDTHH:MM:SSZ | |

Open `intake` with a real UTC `Started` when creating a new record. After repository discovery, close it and open the first path-specific element: Small development uses `plan`, Standard or Large development uses `spec`, and direct work, investigations, repository operations, and bootstrap use `work`. Existing records created before the intake contract remain valid without this row.

## Risks and blockers

## Resume instructions

State the exact next action and the repository evidence to inspect before editing.
