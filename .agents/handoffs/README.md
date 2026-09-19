# Handoffs

Store an optional handoff snapshot as `.agents/handoffs/<task-id>.md` when the orchestrator requires a pause, session change, or ownership transfer.

Create, validate, and resume snapshots with [`../skills/handoff/SKILL.md`](../skills/handoff/SKILL.md). The orchestrator decides when that skill runs; this directory is only the snapshot store. There is no parallel local handoff store.

Every snapshot links its task record and uses `.agents/templates/handoff.md`. A handoff is not a competing plan. The task record remains the live progress record, `plan.md` is the execution strategy, and repository evidence takes precedence over the snapshot.

A closed task's snapshot moves to `archive/`. Archived snapshots are not resume candidates: discovery and validation consider only the top level of this directory, and an explicit path is needed to inspect or validate an archived file. `task-close` performs the move when it closes a task; `handoff` also archives a candidate snapshot instead of resuming it when its linked task record is `completed`.

Validate snapshots with:

```bash
python .agents/scripts/handoff-status --check
```
