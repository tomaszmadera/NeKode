---
name: task-plan
description: Create the execution plan for Standard or Large development after a specification exists; Standard has one demonstrable stage and Large has multiple, then the workflow obtains approval.
---
# Task plan

Create `.agents/tasks/<task-id>/plan.md` from `.agents/templates/plan.md`. Link the specification; do not copy it.

- Standard has exactly one independently demonstrable stage.
- Large has two or more independently demonstrable stages.
- A stage must be finishable, verifiable, and showable without requiring a later stage.
- Context pressure is not a stage boundary.
- One user input owns one task and one plan; stages do not receive separate task/spec/plan files.

For each stage keep a compact index: name, outcome, boundary, verification, expected evidence. Expand only the current stage when necessary.
