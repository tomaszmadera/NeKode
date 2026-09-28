# Append new Timing rows at the end of the table

On 2026-09-28, a post-close update to `.agents/tasks/project-files-view/task.md` inserted a new `user-gate:r4` row directly after the older `user-gate:r3` row. `python .agents/scripts/task-status .agents/tasks/project-files-view/task.md` rejected the record with `timing row starts before previous row ended at line 126: close`, because the later `close` row followed the new row in file order.

`task-status` validates Timing rows as chronologically ordered by file position. When adding a row to an existing record, append it after the current last row (even after `close`); do not group it next to the similarly named earlier row.
