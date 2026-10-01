# Active task records keep a current step through wait phases

On 2026-10-01, `.agents/tasks/handoff-resume-flow/task.md` was set to `current_phase: Phase 3`, `current_step: none` while waiting for plan approval. `python .agents/scripts/task-status --check .agents/tasks/handoff-resume-flow/task.md` rejected it with `active task requires a current step`.

`current_step: none` is valid only on a completed record. During a wait phase (`approval`, `user-gate`, `handoff`, `blocked`), an active record keeps its unchecked step, for example `current_step: Phase 3.1`; the wait lives in the Timing element, not in an emptied `current_step`. Setting the step back to the unchecked `Phase 3.1` made the same validator pass.
