---
name: preflight
description: Use when establishing repository, environment, and existing-test evidence before product edits, adoption bootstrap, or resumed implementation, without changing product behavior.
---

# Preflight

Use this skill before product edits in Standard or Large development work, adoption bootstrap, and implementation resume. It establishes what works before the change; it does not implement product behavior.

1. If a task record exists, open the `preflight` Timing row before running checks. Set `Ended` when this skill finishes, including on a proven pre-existing failure or a blocker.
2. Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Resolve `{python}` to an available interpreter that meets `tooling.python_minimum`. Do not silently switch interpreters. If the current command is too old and the preflight script reports a compatible launcher, rerun with that exact command and record both results.
3. Run the profile's `commands.preflight` target with the compatible interpreter.
4. Run the relevant existing tests named by the approved plan, current task record, or resumed snapshot. Do not run broader tests when they add no useful baseline evidence.
5. Record commands, exit status, failures, skips, and unavailable application gates in the task record Verification table when a record exists.
6. Treat an existing test failure as pre-existing only when repository evidence or the before-edits run proves that classification. State whether it invalidates the planned verification.
7. Proceed to product edits only when prerequisites pass or proven pre-existing failures do not invalidate the work. If a blocking result has no safe next action in the workflow and repository evidence cannot resolve it, stop and ask the user.

Do not repair product behavior, install a different tool as a workaround, hide a failed prerequisite, or convert an ordinary recoverable detail into a user-approval gate.
