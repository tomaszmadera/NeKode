# ci commit -f stages whole files: no hunk-level scope

`ci.py commit -f <paths>` stages each named path WHOLE
(`.agents/skills/ci/scripts/git_ops.py:98-110`, `commit_paths` → `git add <path>`).
There is no hunk-level scope: when a modified file interleaves this task's hunks
with another concurrent agent's (or another task's) hunks, `-f` silently commits
the foreign hunks too — verified 2026-10-02 during NEKODE-3, where the first
attempt (`489ca92`, discarded via `git reset --soft HEAD~1` before publication)
pulled 112 lines of another agent's Shortcuts work into the task's commit via a
shared `App.test.tsx`.

Procedure for a hunk-scoped commit (the only correct path in that situation):

1. Build a patch containing only this task's hunks (filter the full `git diff`
   by hunk markers in Python) and stage it with `git apply --cached <patch>`.
2. `git add` the exclusively-owned whole files. Verify the partition:
   `git diff --cached --stat` (this task only) vs `git diff --stat` (the rest
   stays in the worktree).
3. `ci.py commit` without scope errors out ("requires an explicit file scope"),
   and passing `-f` would re-stage whole files and destroy the partition — so
   create the commit with plain `git commit -m "..."` and record the deviation
   from `commands.ci` in the task record (which tool, why, evidence).
4. Before considering the commit done, inspect what actually landed:
   `git show HEAD -- <shared-file>` — confirm only this task's hunks are inside.

Related but distinct: `ci-commit-files-single-flag` (repeated `-f` drops earlier
paths). Both failures end with a commit whose content differs from the intended
scope; that lesson is about flag repetition, this one about whole-file staging.
