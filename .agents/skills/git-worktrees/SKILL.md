---
name: git-worktrees
description: Use when creating, managing, or closing separate Git worktrees for agent work, moving a task between worktrees, or integrating work from several agent worktrees. Do not use for ordinary commits or task handoff snapshots.
---

# Git worktrees for agent isolation

Filesystem-level isolation of agent work. Upstream:
https://git-scm.com/docs/git-worktree

## When to use and when not to use

Use for: `git worktree add/list/remove`, per-agent branch ownership, moving a
task from one worktree to another, integrating changes from multiple
worktrees. Do not use for commits, tags, or push (activate `ci`), pause or
transfer snapshots (activate `handoff`), or work that stays in the main
checkout.

## Relation to the existing task system

NeKode task state lives in `.agents/tasks/<id>/task.md` (skill `task-record`)
and ownership transfers use `.agents/handoffs/<id>.md` (skill `handoff`). A
worktree replaces neither: it is only a separate working copy plus branch.
Never build a second handoff or task board inside worktree tooling.

## Rules

1. Preflight first: `git status --short`, `git worktree list`, and the
   current task record. Report uncommitted or unrelated changes in the main
   checkout before creating anything.
2. One worktree has exactly one owner (agent or session) and one branch; name
   or document both with the task id and record them in the task record.
3. No worktree touches another worktree's branch, index, or files. Run
   commands inside the owning worktree with explicit paths.
4. No `fetch`, `push`, `merge`, `rebase`, `force-push`, or branch deletion
   without a current user request plus the authorizations in
   `.agents/safety.md`. This skill never widens those authorizations.

## Sequence

1. Create: `git worktree add <path> -b <branch>` from the recorded base
   commit; write `path`, `branch`, owner, and task id into the task record.
2. Work inside the worktree; run verification with the worktree as the
   working directory (`pnpm run test` and friends from that path).
3. Moving a task out: run `handoff` create (scoped checkpoint per
   `.agents/safety.md`), then update the task record with the new worktree.
4. Close: run the relevant tests in the worktree first; `git worktree remove
   <path>` only when the worktree is clean or the user explicitly approved
   discarding changes; branch cleanup is a separate, explicitly authorized
   step.

## Checkpoints and verification

- After create: `git worktree list` shows the new path on the expected
  branch (verify by commit object id, not name similarity).
- After remove: the path is gone from `git worktree list` and any kept branch
  still resolves to its recorded commit.
- Reports state which worktree each verification ran in.
