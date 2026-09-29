# Stage suffixes only on implement, review, correction, user-gate Timing rows

On 2026-09-29, resuming `.agents/tasks/ux-ui-polish-followup/task.md` for round 3 added an `intake:round3` Timing row. `python .agents/scripts/task-status --check .agents/tasks/ux-ui-polish-followup/task.md` rejected it with `timing element does not allow a stage suffix at line 281: intake:round3`.

`.agents/scripts/task-status` defines `STAGED_ELEMENT_BASES = {"implement", "review", "correction", "user-gate"}` and rejects a `:<stage>` suffix on any other element. Use the plain element (`intake`) and put the round or stage detail in the step text, the record body, or the `next_action` field. Renaming the row to `intake` while preserving its timestamps made the same validator pass.

Related: `debug-task-timing-element` (invented element names), `timing-rows-append-chronological` (row ordering).
