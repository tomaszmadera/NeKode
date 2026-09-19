---
name: handoff
description: Use when pausing incomplete work, changing agents or worktrees, reaching a session or context boundary, transferring ownership, or resuming from a handoff snapshot, prior session, agent, branch, or worktree.
---

# Handoff

A handoff is a tracked snapshot at `.agents/handoffs/<task-id>.md`, never a competing plan. The task record remains the live source of truth. Repository evidence wins over the snapshot and over remembered conversation.

Choose **create** or **resume** from the request and the current role. When the orchestrator starts an implementation-ready transfer, context-budget succession, or a user stop, use this same protocol.

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Use `commands.task_status` and `commands.handoff_status` for validation. The caller supplies the transfer role and checkpoint; this skill preserves them.

## Create

1. Set durability to `recorded` without changing complexity. Activate `task-record` to create or resume the record and preserve earlier session evidence, then update it. End the current open work Timing row, then open `handoff` as `wait` if work will resume later. Run `commands.task_status` with `--check <record>`.
2. Resolve the explicit task-owned checkpoint scope, including the task record and `.agents/handoffs/<task-id>.md`. Before writing the snapshot, capture the full pre-checkpoint `HEAD` object id and the SHA-256 of the canonical task-owned diff against that `HEAD`, excluding the snapshot itself. The diff hash covers staged, unstaged, and untracked changes in the explicit task scope; use the SHA-256 of empty input when no such changes exist. Record these values as `<head>+sha256:<diff-hash>` in `checkpoint_subject`. This subject identifies the state used to prepare the checkpoint without referring to the commit that will contain it.
3. Write or replace `.agents/handoffs/<task-id>.md` from `.agents/templates/handoff.md`. The filename must match the task id. Fill every required section. Declare the snapshot's `schema_version` (currently 2) and fill `Open product invariants` (id, status, impact on the current result, evidence needed to change status) and `Unresolved assumptions` (source, consequence, evidence or decision needed to resolve). A legacy snapshot without a schema version keeps its recorded content and validates under its own version's rules. Keep `current_step` in `Phase N.N` format corresponding to the last real step (never `completed` or `none`). Record working versus broken state with paths, signatures, and exact errors; failed approaches or `none`; verification; and one first resume action with expected evidence plus the next skill to load. State the transferred role as Main, subagent, or new agent.
4. Preserve partial or failing work explicitly. Record any model or effort deviation. Link the spec, plan, and code when they exist; do not copy them or claim absent Git work. Do not create spec or plan files only to satisfy a Small stop.
5. Run `commands.handoff_status` with `--check` before checkpointing.
6. Apply the policy-owned standing handoff checkpoint authorization and create exactly one scoped checkpoint with recorded `commands.ci commit --files`. Include all and only task-owned files and records, including `.agents/handoffs/<task-id>.md`. Do not infer broader permission from the event that triggered handoff. If the authorized scope cannot be separated or the commit fails, preserve the changes uncommitted, stop, and report why the checkpoint could not be made. After success, confirm that the checkpoint contains the snapshot and the complete authorized scope without modifying the snapshot or creating another commit.

Do not mark incomplete work complete. Do not include secrets, private data, or raw logs. Do not start the next pipeline stage after a user stop.

When the user says stop, create is mandatory. Ephemeral work becomes recorded before the snapshot so the task has a stable id; complexity stays unchanged.

## Resume

1. Use the path the user supplied. If none, look only at the top level of `.agents/handoffs/`, never in `archive/`. If several candidates are plausible, ask; do not guess.
2. Read the linked task record, spec, plan, and only the material ADRs and source files. Inspect branch, worktree, and Git status.
3. Classify each material snapshot claim as confirmed, stale, missing, or conflicting. Repository evidence wins.
4. Preserve unrelated or newer user changes. A snapshot cannot grant new authority for destructive, external, or consequential actions.
5. Use the `preflight` skill with the snapshot and session-cached project profile, including the cheapest sufficient existing tests.
6. Before editing, state the objective, confirmed work, discrepancies, tests-before-edits result, spec path, plan path, and first unfinished step with its expected evidence. Then continue from that step; do not stop after summarizing, do not repeat confirmed work, and do not retry a recorded failed approach without new evidence. If the snapshot is mid-stage, resume that same stage. Do not add a plan stage for leftover tokens. End the `handoff` wait row and start the next work Timing element.
7. After meaningful progress, update the same task record and snapshot, then validate both.

If the repository already contains the completed outcome, verify and close instead of reimplementing. When a candidate snapshot links a task record whose status is `completed`, move the snapshot unchanged to `.agents/handoffs/archive/` and report that instead of resuming.
