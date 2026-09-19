---
task_id: <task-id>
spec: docs/features/<slug>/spec.md
status: draft
---

# Plan: <task title>

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

What this task will deliver from the spec.

## Spec

`docs/features/<slug>/spec.md`

## Out of scope

Work the spec allows but this task will not do.

## Stages

List every stage as a small, independently testable slice you can finish and show to the user. Prefer one invariant, observable behavior, or transaction boundary per stage, and name it below. Verification for a stage must not depend on implementing a later stage. Do not merge two demonstrable slices into one stage. If a stage's working set becomes broad, split its remaining scope again in this plan. Do not add a stage only to fit a context window. Do not write a second plan file, a second spec, or a second task for a stage. When a stage starts, expand only that heading. Later stages stay index rows until they start.

### Stage 1 - <name>

- Outcome:
- Boundary:
- Verification:
- Expected evidence:
- Likely files: fill when this stage starts, if the index is not enough

After a completed stage, the next stage receives a fresh bounded scope from the same spec, plan, and task record. Every Large stage uses a fresh bounded extra implementer, which receives those artifacts and the first action instead of the previous stage's conversation. For Standard, Main may continue in its existing session when the stage fits.

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`
- Existing tests to run before product edits, and where to record results (task record Verification table)

## Risks

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
