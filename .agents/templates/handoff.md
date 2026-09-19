---
task_id: <task-id>
created: YYYY-MM-DDTHH:MM:SSZ
schema_version: 2
from: <current owner or session>
to: <next owner or session>
branch: <branch>
worktree: <worktree>
checkpoint_subject: <pre-checkpoint HEAD SHA>+sha256:<task-owned diff SHA-256>
current_step: Phase 0.1
next_action: <one concrete action>
blockers: none
---

# Handoff: <task title>

## Repository snapshot

Link the task record. State the transferred role and reason. Split current evidence into **Working** and **Broken**. Show paths, signatures, and exact error messages; link specs instead of copying them.

## Decisions

List consequential decisions that the next owner must preserve.

## Failed approaches

For each failed attempt: what was tried, why it failed, and what not to repeat. Use `none` when nothing failed.

## Verification

List fresh checks, failures, skipped checks, and unavailable capabilities.

## Open product invariants

For each open product invariant touched by the task: stable id, status, impact on the current result, and the evidence needed to change the status. Use `none` when no open invariant applies.

## Unresolved assumptions

For each assumption: source, consequence, and the evidence or decision needed to resolve it. Use `none` when nothing is assumed.

## Resume instructions

State the first action, the expected evidence that it succeeded, and files or contracts to inspect before editing. Name the next skill to load. For an implementation handoff, confirm that the spec, plan, approvals, and tests-before-edits evidence are complete, and link those artifacts.
