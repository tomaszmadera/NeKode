---
workflow: investigation
pipeline: task-record-if-recorded > inspect > systematic-debugging|code-review|analyze > verify-if-changed > completion
---
# Investigation workflow

This workflow owns non-trivial debug and recorded or multi-checkpoint review/analysis. Bounded Small investigations can be ephemeral. Intellectual difficulty alone does not require a record. The current owner conducts the investigation without the development implementer/reviewer loop.

- For `recorded` durability, activate `task-record` before broad discovery and begin `work` after intake. For `ephemeral` durability, keep evidence in the session without record transitions.
- Inspect only evidence required by the question.
- Activate `lesson-select` only after an unexpected operational error, user correction, required-tool unavailability needing another method, a deterministic repository event mapped to a lesson domain, or a known lesson id/hint from state, handoff, or evidence. Do not inspect the index to discover whether a candidate exists.

| Intent | Procedure | Product edits | Recorded closure verification |
|---|---|---|---|
| `debug` | Activate `systematic-debugging`; preserve diagnosis evidence | Only a bounded root-cause fix within the user's request | `already-complete` after `verify`, otherwise `none` |
| `review` | Activate `code-review` in the current owning session; use its durability-specific artifact contract | None | `none` |
| `analysis` | Produce evidence-backed analysis with material assumptions and unavailable evidence | None | `none`, unless an executable or project artifact changed |

- Implementing a recommendation, fixing a reviewed defect, or broadening a bounded fix requires an explicit expansion into development/debug scope.
- If product code or executable configuration changed, inspect the complete diff and finish corrections before activating `verify` at the narrowest sufficient final scope. For recorded work, end `work`, begin `verify`, and end it with real evidence through `task-record`.
- For recorded work, end any remaining `work` row and activate `task-close` with the table's verification mode. For ephemeral work, report findings and verification directly. Failed or unavailable required verification blocks completion.
