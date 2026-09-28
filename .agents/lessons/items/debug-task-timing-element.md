# Use `work` for recorded debug timing

On 2026-09-28, `.agents/tasks/gui-ctrl-d-ctrl-u-diagnosis/task.md` used `repro-gui` as a Timing element. `python .agents/scripts/task-status --check .agents/tasks/gui-ctrl-d-ctrl-u-diagnosis/task.md` rejected it with `invalid timing element at line 53: repro-gui`.

For a recorded debug investigation, use the allowed `work` element from `.agents/skills/task-record/SKILL.md`. Put the specific reproduction name and result in the Verification table or phase step. Renaming the element to `work` while preserving its timestamps made the same validator pass.
